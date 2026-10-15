'use strict';

const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authenticate, requirePermission } = require('../middleware/auth');

router.use(authenticate);
router.get('/stats', requirePermission('dashboard.read'), dashboardController.stats);
router.get('/boarded-passengers', requirePermission('dashboard.read'), dashboardController.boardedPassengers);
router.get('/revenue-report', requirePermission('reports.read'), dashboardController.revenueReport);
router.get('/audit-logs', requirePermission('audit_logs.read'), dashboardController.auditLogs);
module.exports = router;
