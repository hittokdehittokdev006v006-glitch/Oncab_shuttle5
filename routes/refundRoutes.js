'use strict';

const express = require('express');
const router = express.Router();
const refundController = require('../controllers/refundController');
const { authenticate, requirePermission } = require('../middleware/auth');

router.use(authenticate);
router.get('/failed', requirePermission('refunds.read'), refundController.failedList);
router.get('/completed', requirePermission('refunds.read'), refundController.completedList);
router.get('/user', refundController.getUserRefunds);
router.get('/', requirePermission('refunds.read'), refundController.list);
router.patch('/:id/process', requirePermission('refunds.process'), refundController.process);
router.patch('/:id/verify-payu', requirePermission('refunds.process'), refundController.verifyPayU);
router.patch('/:id/retry', requirePermission('refunds.process'), refundController.retry);
router.patch('/:id/mark-failed', requirePermission('refunds.process'), refundController.markFailed);
module.exports = router;
