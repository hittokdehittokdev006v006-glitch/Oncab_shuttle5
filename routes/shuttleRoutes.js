'use strict';

const express = require('express');
const router = express.Router();
const shuttleController = require('../controllers/shuttleController');
const { authenticate, requirePermission } = require('../middleware/auth');

const payuController = require('../controllers/payuController');
const {
  optionalPassengerAuth,
  optionalPassengerTokenAuth,
} = require('../middleware/passengerAuth');

// ── Public Shuttle & Ride Pack APIs ───────────────────────────

// Package Listing & Details
router.get('/packages', shuttleController.getPackages);
router.post('/packages/list', shuttleController.getPackages);
router.get('/packages/:id', shuttleController.getPackageDetails);

// Shuttle Route Search with Fixed-Price Ride Packs
router.get('/search', shuttleController.searchShuttles);
router.post('/search', shuttleController.searchShuttles);
router.get('/search-routes', shuttleController.searchShuttles);
router.post('/search-routes', shuttleController.searchShuttles);

// Shuttle Booking (Single Ride or Ride Pack Package)
router.post('/book', optionalPassengerAuth, shuttleController.bookShuttle);
router.post('/book-ticket', optionalPassengerAuth, shuttleController.bookShuttle);
router.post('/create-booking', optionalPassengerAuth, shuttleController.bookShuttle);

// Shuttle Booking Cancellation
router.post('/cancel-booking', optionalPassengerTokenAuth, shuttleController.cancelBooking);
router.get('/cancel-booking', optionalPassengerTokenAuth, shuttleController.cancelBooking);
router.post('/cancel', optionalPassengerTokenAuth, shuttleController.cancelBooking);

// PayU Online Payment Gateway for Shuttle & Ride Pack bookings
router.post('/payment/payu/initiate', optionalPassengerAuth, payuController.initiate);
router.post('/payment/payu-callback', payuController.callback);

// ── Authenticated Package Management (Admin/Operator) ─────────
router.get('/admin/packages', authenticate, requirePermission('packages.read'), (req, res, next) => {
  req.query.status = req.query.status || 'all';
  return shuttleController.getPackages(req, res, next);
});
router.post('/packages', authenticate, requirePermission('packages.manage'), shuttleController.createPackage);
router.put('/packages/:id', authenticate, requirePermission('packages.manage'), shuttleController.updatePackage);
router.patch('/packages/:id/toggle-status', authenticate, requirePermission('packages.manage'), shuttleController.togglePackageStatus);
router.delete('/packages/:id', authenticate, requirePermission('packages.manage'), shuttleController.deletePackage);

module.exports = router;
