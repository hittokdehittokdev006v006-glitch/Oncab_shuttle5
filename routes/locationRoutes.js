'use strict';

const express = require('express');
const locationController = require('../controllers/locationController');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.get('/dashboard', requirePermission('locations.read'), locationController.dashboard);
router.get('/history', requirePermission('locations.read'), locationController.getHistoryList);
router.get('/trips/:id', requirePermission('locations.read'), locationController.getTripLocationHistory);
router.get('/trips/:id/history', requirePermission('locations.read'), locationController.getTripLocationHistory);

module.exports = router;