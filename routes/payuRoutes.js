'use strict';

const express = require('express');
const router = express.Router();
const payuWebhookController = require('../controllers/payuWebhookController');
const { authenticate, requirePermission } = require('../middleware/auth');

// Public webhook endpoint — PayU calls this. No auth (verified by PayU hash).
router.post('/webhook', payuWebhookController.receive);

// Admin panel: view webhook logs
router.get('/logs', authenticate, requirePermission('webhooks.read'), payuWebhookController.list);
router.post('/refunds/:id/resync', authenticate, requirePermission('refunds.process'), payuWebhookController.resync);

module.exports = router;
