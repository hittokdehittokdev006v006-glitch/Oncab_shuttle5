'use strict';

const express = require('express');
const router = express.Router();
const settlementController = require('../controllers/settlementController');
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');

router.use(authenticate);

// Config & Context for Owner submission
router.get('/config', settlementController.getConfig);

// Trip rates by bus type (Admin configured)
router.get('/trip-rates', settlementController.getTripRates);

// Previous week settlement summary for owner
router.get('/previous-week-summary', settlementController.getPreviousWeekSummary);

// List settlements (Admin sees all; Owner sees only their own)
router.get('/', settlementController.list);

// Create settlement request (Owner or Admin)
router.post('/', settlementController.create);

// Get single settlement by ID
router.get('/:id', settlementController.getById);

// Admin Action: Approve / Reject (with UTR or rejection notes)
router.patch('/:id/status', requireRole('admin'), settlementController.updateStatus);

// Admin Action: Permanent Delete (removes from both owner and admin panels)
router.delete('/:id', requireRole('admin'), settlementController.delete);

module.exports = router;
