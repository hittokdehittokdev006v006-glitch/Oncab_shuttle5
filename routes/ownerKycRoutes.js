'use strict';

const express = require('express');
const router = express.Router();
const ownerKycController = require('../controllers/ownerKycController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

// Owner profile & KYC endpoints
router.get('/profile', ownerKycController.getProfile);
router.post('/', ownerKycController.submitKyc);
router.get('/mine', ownerKycController.getMine);

// Admin review endpoints
router.get('/', requireRole('admin'), ownerKycController.listAll);
router.patch('/:id/status', requireRole('admin'), ownerKycController.updateStatus);

module.exports = router;
