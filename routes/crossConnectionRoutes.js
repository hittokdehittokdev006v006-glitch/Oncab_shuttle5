'use strict';

const express = require('express');
const router = express.Router();
const crossConnectionController = require('../controllers/crossConnectionController');
const { authenticate, requirePermission } = require('../middleware/auth');

router.use(authenticate);

// View list of cross connections
router.get('/', requirePermission('cross_connection.view'), crossConnectionController.list);

// Get dynamic configuration thresholds
router.get('/config', requirePermission('cross_connection.view'), crossConnectionController.getConfig);

// Update dynamic configuration thresholds
router.put('/config', requirePermission('cross_connection.configure'), crossConnectionController.updateConfig);

// Export data records
router.get('/export', requirePermission('cross_connection.export'), crossConnectionController.export);

// Trigger evaluation and recalculation
router.post('/evaluate', requirePermission('cross_connection.manage'), crossConnectionController.evaluate);

// View single cross connection details with full map geometry
router.get('/:id', requirePermission('cross_connection.view_details'), crossConnectionController.show);

module.exports = router;
