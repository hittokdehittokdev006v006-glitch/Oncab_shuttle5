'use strict';

const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const { Banner } = require('../models');
const { saveBase64File, deleteFile, getImageUrl } = require('../utils/fileUpload');

const buildPagination = (page, limit) => {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 15));
  return { offset: (p - 1) * l, limit: l, page: p };
};

// Guard to ensure seed check only happens once in memory, never repeating Banner.sync() on requests
let defaultsChecked = false;
const seedDefaultsIfEmpty = async () => {
  if (defaultsChecked) return;
  try {
    const count = await Banner.count();
    if (count === 0) {
      await Banner.bulkCreate([
        {
          id: 1,
          title: 'Daily Commute Made Easy - Flat 20% Off Monthly Passes',
          subtitle: 'Skip the surge prices and crowded trains. Reserved AC seat on premier routes starting at ₹49/ride.',
          banner_type: 'image',
          media_url: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=1400&q=80',
          thumbnail_url: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=600&q=80',
          video_type: 'file',
          cta_title: 'Explore Passes',
          cta_url: '/passes',
          position: 'home_top',
          display_order: 1,
          is_active: true,
          autoplay: true,
          is_muted: true,
          loop_video: true,
          show_controls: true,
        },
        {
          id: 2,
          title: 'Experience Oncab Executive Shuttle Service',
          subtitle: 'Direct business-class shuttles with guaranteed seating, high-speed Wi-Fi, and live GPS tracking.',
          banner_type: 'video',
          media_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
          thumbnail_url: 'https://images.unsplash.com/photo-1570125909232-eb263c188f7e?auto=format&fit=crop&w=1200&q=80',
          video_type: 'file',
          cta_title: 'Book Your Seat',
          cta_url: '/trips',
          position: 'home_top',
          display_order: 2,
          is_active: true,
          autoplay: true,
          is_muted: true,
          loop_video: true,
          show_controls: true,
        },
      ]);
    }
    defaultsChecked = true;
  } catch (err) {
    console.warn('Default banners check warning:', err.message);
    defaultsChecked = true;
  }
};

/**
 * List all banners for admin panel with filters, search, and analytics stats
 */
exports.list = async (req, res, next) => {
  try {
    await seedDefaultsIfEmpty();

    const { page, limit, type, is_active, position, search } = req.query;
    const { offset, limit: lim, page: p } = buildPagination(page, limit);

    const where = {};

    if (type && type !== 'all') {
      where.banner_type = type;
    }

    if (is_active !== undefined && is_active !== 'all' && is_active !== '') {
      where.is_active = is_active === 'true' || is_active === '1' || is_active === true;
    }

    if (position && position !== 'all') {
      where.position = position;
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      where[Op.or] = [
        { title: { [Op.like]: q } },
        { subtitle: { [Op.like]: q } },
        { cta_title: { [Op.like]: q } },
      ];
    }

    const { count, rows } = await Banner.findAndCountAll({
      where,
      offset,
      limit: lim,
      order: [
        ['display_order', 'ASC'],
        ['created_at', 'DESC'],
      ],
    });

    // Compute stats safely in parallel with fallback to prevent timeouts
    let stats = {
      total: count,
      active: 0,
      inactive: 0,
      image_count: 0,
      video_count: 0,
      total_views: 0,
      total_clicks: 0,
    };

    try {
      const [totalCount, activeCount, imageCount, videoCount, totalViews, totalClicks] = await Promise.all([
        Banner.count().catch(() => count),
        Banner.count({ where: { is_active: true } }).catch(() => 0),
        Banner.count({ where: { banner_type: 'image' } }).catch(() => 0),
        Banner.count({ where: { banner_type: 'video' } }).catch(() => 0),
        Banner.sum('view_count').catch(() => 0),
        Banner.sum('click_count').catch(() => 0),
      ]);

      stats = {
        total: Number(totalCount) || count,
        active: Number(activeCount) || 0,
        inactive: Math.max(0, (Number(totalCount) || count) - (Number(activeCount) || 0)),
        image_count: Number(imageCount) || 0,
        video_count: Number(videoCount) || 0,
        total_views: Number(totalViews) || 0,
        total_clicks: Number(totalClicks) || 0,
      };
    } catch (statsErr) {
      console.warn('Banner stats calculation warning:', statsErr.message);
    }

    const formattedRows = rows.map((banner) => {
      const b = banner.toJSON();
      b.media_full_url = getImageUrl(b.media_url);
      b.thumbnail_full_url = b.thumbnail_url ? getImageUrl(b.thumbnail_url) : null;
      return b;
    });

    return res.json({
      success: true,
      data: formattedRows,
      stats,
      pagination: {
        total: count,
        page: p,
        limit: lim,
        pages: Math.ceil(count / lim) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Public endpoint: Get active banners for client mobile app and web frontend
 */
exports.getActiveBanners = async (req, res, next) => {
  try {
    await seedDefaultsIfEmpty();

    const { position, type } = req.query;
    const now = new Date();

    const where = {
      is_active: true,
      [Op.and]: [
        {
          [Op.or]: [
            { start_date: null },
            { start_date: { [Op.lte]: now } },
          ],
        },
        {
          [Op.or]: [
            { end_date: null },
            { end_date: { [Op.gte]: now } },
          ],
        },
      ],
    };

    if (position && position !== 'all') {
      where.position = position;
    }

    if (type && type !== 'all') {
      where.banner_type = type;
    }

    const banners = await Banner.findAll({
      where,
      order: [
        ['display_order', 'ASC'],
        ['created_at', 'DESC'],
      ],
    });

    // Increment view counts asynchronously
    if (banners.length > 0) {
      Banner.increment('view_count', {
        where: { id: { [Op.in]: banners.map((b) => b.id) } },
      }).catch((e) => console.error('Error incrementing banner view count:', e.message));
    }

    const formatted = banners.map((banner) => {
      const b = banner.toJSON();
      b.media_full_url = getImageUrl(b.media_url);
      b.thumbnail_full_url = b.thumbnail_url ? getImageUrl(b.thumbnail_url) : null;
      return b;
    });

    return res.json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get single banner by ID
 */
exports.show = async (req, res, next) => {
  try {
    const banner = await Banner.findByPk(req.params.id);
    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' });
    }

    const b = banner.toJSON();
    b.media_full_url = getImageUrl(b.media_url);
    b.thumbnail_full_url = b.thumbnail_url ? getImageUrl(b.thumbnail_url) : null;

    return res.json({ success: true, data: b });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new banner (supports multipart form file uploads, base64, and URLs)
 */
exports.create = async (req, res, next) => {
  try {
    const {
      title,
      subtitle,
      banner_type = 'image',
      video_type = 'file',
      media_url: mediaUrlFromPayload,
      thumbnail_url: thumbUrlFromPayload,
      media_base64,
      thumbnail_base64,
      cta_title,
      cta_url,
      position = 'home_top',
      display_order = 0,
      is_active = true,
      autoplay = true,
      is_muted = true,
      loop_video = true,
      show_controls = true,
      start_date,
      end_date,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Banner title is required' });
    }

    let mediaUrl = mediaUrlFromPayload || null;
    let thumbnailUrl = thumbUrlFromPayload || null;

    // 1. Check if files were uploaded via multer
    if (req.files) {
      if (req.files.media && req.files.media[0]) {
        mediaUrl = `/uploads/banners/${req.files.media[0].filename}`;
      }
      if (req.files.thumbnail && req.files.thumbnail[0]) {
        thumbnailUrl = `/uploads/banners/${req.files.thumbnail[0].filename}`;
      }
    }

    // 2. Check if base64 payloads were supplied
    if (!mediaUrl && media_base64) {
      mediaUrl = saveBase64File(media_base64, 'banners', `banner_${banner_type}`);
    }
    if (!thumbnailUrl && thumbnail_base64) {
      thumbnailUrl = saveBase64File(thumbnail_base64, 'banners', 'thumb');
    }

    if (!mediaUrl) {
      return res.status(400).json({
        success: false,
        message: banner_type === 'video' ? 'Please provide a video file or video URL' : 'Please provide an image file or image URL',
      });
    }

    const newBanner = await Banner.create({
      title: title.trim(),
      subtitle: subtitle ? subtitle.trim() : null,
      banner_type,
      media_url: mediaUrl,
      thumbnail_url: thumbnailUrl,
      video_type,
      cta_title: cta_title ? cta_title.trim() : null,
      cta_url: cta_url ? cta_url.trim() : null,
      position,
      display_order: parseInt(display_order, 10) || 0,
      is_active: is_active === true || is_active === 'true' || is_active === '1' || is_active === 1,
      autoplay: autoplay === true || autoplay === 'true' || autoplay === '1' || autoplay === 1,
      is_muted: is_muted === true || is_muted === 'true' || is_muted === '1' || is_muted === 1,
      loop_video: loop_video === true || loop_video === 'true' || loop_video === '1' || loop_video === 1,
      show_controls: show_controls === true || show_controls === 'true' || show_controls === '1' || show_controls === 1,
      start_date: start_date ? new Date(start_date) : null,
      end_date: end_date ? new Date(end_date) : null,
      created_by: req.user ? req.user.id : null,
    });

    const result = newBanner.toJSON();
    result.media_full_url = getImageUrl(result.media_url);
    result.thumbnail_full_url = result.thumbnail_url ? getImageUrl(result.thumbnail_url) : null;

    return res.status(201).json({
      success: true,
      message: `${banner_type === 'video' ? 'Video' : 'Image'} banner created successfully`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update an existing banner
 */
exports.update = async (req, res, next) => {
  try {
    const banner = await Banner.findByPk(req.params.id);
    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' });
    }

    const {
      title,
      subtitle,
      banner_type,
      video_type,
      media_url: mediaUrlFromPayload,
      thumbnail_url: thumbUrlFromPayload,
      media_base64,
      thumbnail_base64,
      cta_title,
      cta_url,
      position,
      display_order,
      is_active,
      autoplay,
      is_muted,
      loop_video,
      show_controls,
      start_date,
      end_date,
    } = req.body;

    let mediaUrl = mediaUrlFromPayload !== undefined ? mediaUrlFromPayload : banner.media_url;
    let thumbnailUrl = thumbUrlFromPayload !== undefined ? thumbUrlFromPayload : banner.thumbnail_url;

    // 1. Files uploaded via multer
    if (req.files) {
      if (req.files.media && req.files.media[0]) {
        // Delete previous file if local upload
        if (banner.media_url && banner.media_url.startsWith('/uploads/banners/')) {
          deleteFile(banner.media_url);
        }
        mediaUrl = `/uploads/banners/${req.files.media[0].filename}`;
      }
      if (req.files.thumbnail && req.files.thumbnail[0]) {
        if (banner.thumbnail_url && banner.thumbnail_url.startsWith('/uploads/banners/')) {
          deleteFile(banner.thumbnail_url);
        }
        thumbnailUrl = `/uploads/banners/${req.files.thumbnail[0].filename}`;
      }
    }

    // 2. Base64 payload
    if (media_base64 && typeof media_base64 === 'string' && media_base64.startsWith('data:')) {
      if (banner.media_url && banner.media_url.startsWith('/uploads/banners/')) {
        deleteFile(banner.media_url);
      }
      mediaUrl = saveBase64File(media_base64, 'banners', `banner_${banner_type || banner.banner_type}`);
    }

    if (thumbnail_base64 && typeof thumbnail_base64 === 'string' && thumbnail_base64.startsWith('data:')) {
      if (banner.thumbnail_url && banner.thumbnail_url.startsWith('/uploads/banners/')) {
        deleteFile(banner.thumbnail_url);
      }
      thumbnailUrl = saveBase64File(thumbnail_base64, 'banners', 'thumb');
    }

    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (subtitle !== undefined) updates.subtitle = subtitle ? subtitle.trim() : null;
    if (banner_type !== undefined) updates.banner_type = banner_type;
    if (video_type !== undefined) updates.video_type = video_type;
    if (mediaUrl !== undefined) updates.media_url = mediaUrl;
    if (thumbnailUrl !== undefined) updates.thumbnail_url = thumbnailUrl;
    if (cta_title !== undefined) updates.cta_title = cta_title ? cta_title.trim() : null;
    if (cta_url !== undefined) updates.cta_url = cta_url ? cta_url.trim() : null;
    if (position !== undefined) updates.position = position;
    if (display_order !== undefined) updates.display_order = parseInt(display_order, 10) || 0;
    if (is_active !== undefined) updates.is_active = is_active === true || is_active === 'true' || is_active === '1' || is_active === 1;
    if (autoplay !== undefined) updates.autoplay = autoplay === true || autoplay === 'true' || autoplay === '1' || autoplay === 1;
    if (is_muted !== undefined) updates.is_muted = is_muted === true || is_muted === 'true' || is_muted === '1' || is_muted === 1;
    if (loop_video !== undefined) updates.loop_video = loop_video === true || loop_video === 'true' || loop_video === '1' || loop_video === 1;
    if (show_controls !== undefined) updates.show_controls = show_controls === true || show_controls === 'true' || show_controls === '1' || show_controls === 1;
    if (start_date !== undefined) updates.start_date = start_date ? new Date(start_date) : null;
    if (end_date !== undefined) updates.end_date = end_date ? new Date(end_date) : null;

    await banner.update(updates);

    const result = banner.toJSON();
    result.media_full_url = getImageUrl(result.media_url);
    result.thumbnail_full_url = result.thumbnail_url ? getImageUrl(result.thumbnail_url) : null;

    return res.json({
      success: true,
      message: 'Banner updated successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Toggle active / inactive status
 */
exports.toggleStatus = async (req, res, next) => {
  try {
    const banner = await Banner.findByPk(req.params.id);
    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' });
    }

    const newStatus = !banner.is_active;
    await banner.update({ is_active: newStatus });

    return res.json({
      success: true,
      message: `Banner ${newStatus ? 'activated' : 'deactivated'} successfully`,
      data: { id: banner.id, is_active: newStatus },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a banner
 */
exports.destroy = async (req, res, next) => {
  try {
    const banner = await Banner.findByPk(req.params.id);
    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' });
    }

    // Safely delete associated files if stored locally
    if (banner.media_url && banner.media_url.startsWith('/uploads/banners/')) {
      deleteFile(banner.media_url);
    }
    if (banner.thumbnail_url && banner.thumbnail_url.startsWith('/uploads/banners/')) {
      deleteFile(banner.thumbnail_url);
    }

    await banner.destroy();

    return res.json({
      success: true,
      message: 'Banner deleted successfully',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Reorder banners in bulk
 */
exports.reorder = async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'Items must be an array of { id, display_order }' });
    }

    for (const item of items) {
      if (item.id !== undefined && item.display_order !== undefined) {
        await Banner.update(
          { display_order: parseInt(item.display_order, 10) || 0 },
          { where: { id: item.id } }
        );
      }
    }

    return res.json({ success: true, message: 'Banners reordered successfully' });
  } catch (err) {
    next(err);
  }
};

/**
 * Track banner click
 */
exports.trackClick = async (req, res, next) => {
  try {
    const banner = await Banner.findByPk(req.params.id);
    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' });
    }

    await banner.increment('click_count', { by: 1 });
    return res.json({
      success: true,
      message: 'Click recorded',
      data: { id: banner.id, click_count: banner.click_count + 1 },
    });
  } catch (err) {
    next(err);
  }
};
