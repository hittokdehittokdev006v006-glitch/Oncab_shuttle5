'use strict';

const express = require('express');
const router = express.Router();
const bannerController = require('../controllers/bannerController');
const { authenticate, requirePermission, optionalAuth } = require('../middleware/auth');
const { bannerUploadFields } = require('../middleware/bannerUpload');
const { hasRole } = require('../utils/roles');

// ── Public Endpoints ─────────────────────────────────────────
// For client apps, mobile app, and tracking
router.get('/active', bannerController.getActiveBanners);
router.post('/:id/click', bannerController.trackClick);

// ── Admin Panel Endpoints (Protected) ───────────────────────
router.use(authenticate);

// Resilient permission check: allows admin, operator, or users with explicit banner permissions
const allowBannerRead = (req, res, next) => {
  if (
    hasRole(req.user, 'admin') ||
    hasRole(req.user, 'operator') ||
    (req.userPermissions && (req.userPermissions.includes('banners.read') || req.userPermissions.includes('banners.manage')))
  ) {
    return next();
  }
  return requirePermission('banners.read')(req, res, next);
};

const allowBannerManage = (req, res, next) => {
  if (
    hasRole(req.user, 'admin') ||
    hasRole(req.user, 'operator') ||
    (req.userPermissions && req.userPermissions.includes('banners.manage'))
  ) {
    return next();
  }
  return requirePermission('banners.manage')(req, res, next);
};

router.get('/', allowBannerRead, bannerController.list);
router.get('/:id', allowBannerRead, bannerController.show);
router.post('/', allowBannerManage, bannerUploadFields, bannerController.create);
router.put('/:id', allowBannerManage, bannerUploadFields, bannerController.update);
router.patch('/:id/toggle-status', allowBannerManage, bannerController.toggleStatus);
router.patch('/reorder', allowBannerManage, bannerController.reorder);
router.delete('/:id', allowBannerManage, bannerController.destroy);

module.exports = router;
