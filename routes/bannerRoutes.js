'use strict';

const express = require('express');
const router = express.Router();
const bannerController = require('../controllers/bannerController');
const { authenticate, requirePermission, optionalAuth } = require('../middleware/auth');
const { bannerUploadFields } = require('../middleware/bannerUpload');

// ── Public Endpoints ─────────────────────────────────────────
// For client apps, mobile app, and tracking
router.get('/active', bannerController.getActiveBanners);
router.post('/:id/click', bannerController.trackClick);

// ── Admin Panel Endpoints (Protected) ───────────────────────
router.use(authenticate);

router.get('/', requirePermission('banners.read'), bannerController.list);
router.get('/:id', requirePermission('banners.read'), bannerController.show);
router.post('/', requirePermission('banners.manage'), bannerUploadFields, bannerController.create);
router.put('/:id', requirePermission('banners.manage'), bannerUploadFields, bannerController.update);
router.patch('/:id/toggle-status', requirePermission('banners.manage'), bannerController.toggleStatus);
router.patch('/reorder', requirePermission('banners.manage'), bannerController.reorder);
router.delete('/:id', requirePermission('banners.manage'), bannerController.destroy);

module.exports = router;
