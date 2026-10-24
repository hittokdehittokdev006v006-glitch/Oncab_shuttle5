'use strict';

const express = require('express');
const router = express.Router();
const busController = require('../controllers/busController');
const payuController = require('../controllers/payuController');
const walletController = require('../controllers/walletController');
const couponController = require('../controllers/couponController');
const refundController = require('../controllers/refundController');
const bannerController = require('../controllers/bannerController');
const shuttleController = require('../controllers/shuttleController');
const packagePurchaseController = require('../controllers/packagePurchaseController');
const {
  authenticatePassenger,
  optionalPassengerAuth,
  optionalPassengerTokenAuth,
} = require('../middleware/passengerAuth');

// ── Public Bus APIs (No Authentication Required) ───────────
// These are for user-facing mobile app

// Ride Pack Packages (City Flow -> Ride Pack)
router.get('/packages', shuttleController.getPackages);
router.post('/packages', shuttleController.getPackages);
router.get('/packages/:id', shuttleController.getPackageDetails);
router.post('/package-purchases', authenticatePassenger, packagePurchaseController.create);
router.get('/my-packages', authenticatePassenger, packagePurchaseController.listMine);
router.get('/my-package-transactions', authenticatePassenger, packagePurchaseController.listTransactionsMine);
router.get('/my-packages/:purchaseId/usage', authenticatePassenger, packagePurchaseController.usageMine);
router.get('/my-packages/:purchaseId', authenticatePassenger, packagePurchaseController.showMine);
router.get('/bookings/:bookingId', authenticatePassenger, packagePurchaseController.getBookingMine);
router.post('/bookings/:bookingId/cancel', authenticatePassenger, (req, res, next) => {
  req.body = { ...(req.body || {}), booking_id: req.params.bookingId };
  return busController.cancelBooking(req, res, next);
});

// Bus Types
router.get('/types', busController.getBusTypes);
router.post('/types', busController.getBusTypes);

// Routes
router.get('/routes', busController.getRoutes);
router.post('/routes', busController.getRoutes);

// Search Routes with Filters
router.get('/search-routes', busController.searchRoutes);
router.post('/search-routes', busController.searchRoutes);
router.get('/search', busController.searchRoutes);
router.post('/search', busController.searchRoutes);

// Search Stops Suggestions (Cityflo-style)
router.get('/search-stops', busController.searchStops);
router.post('/search-stops', busController.searchStops);

// Schedules
router.get('/schedules', busController.getSchedules);
router.post('/schedules', busController.getSchedules);

// Seat Availability
router.get('/seat-availability', busController.checkSeatAvailability);
router.post('/seat-availability', busController.checkSeatAvailability);

// Fare Calculation
router.get('/calculate-fare', busController.calculateFare);
router.post('/calculate-fare', busController.calculateFare);
router.get('/coupons', couponController.listAvailable);

// Promotional Banners (Images & Videos for Home Screen & Deals)
router.get('/banners', bannerController.getActiveBanners);
router.post('/banners', bannerController.getActiveBanners);
router.post('/banners/:id/click', bannerController.trackClick);

// User Bookings (Can be made public with passenger_mobile)
router.get('/wallet/balance', walletController.balance);
router.post('/wallet/balance', walletController.balance);
router.get('/wallet/transactions', walletController.transactions);
router.post('/wallet/transactions', walletController.transactions);
router.get('/user-bookings', busController.getUserBookings);
router.post('/user-bookings', busController.getUserBookings);
router.get('/user-refunds', refundController.getUserRefunds);
router.post('/user-refunds', refundController.getUserRefunds);

// Booking Details for Boarding Pass
router.get('/booking-details', busController.getBookingDetails);
router.post('/booking-details', busController.getBookingDetails);

// ── Passenger / User Bus Live Tracking & Stoppage Timing ──
router.get('/track-booking', busController.trackBooking);
router.post('/track-booking', busController.trackBooking);
router.get('/track', busController.trackBooking);
router.post('/track', busController.trackBooking);
router.get('/bookings/:id/track', busController.trackBooking);
router.post('/bookings/:id/track', busController.trackBooking);

// Create / Book Ticket
router.post('/create-booking', optionalPassengerAuth, busController.createBooking);
router.post('/book-ticket', optionalPassengerAuth, busController.createBooking);
router.post('/book', optionalPassengerAuth, busController.createBooking);

// Cancel Booking (Public Mobile App Endpoint)
router.post('/cancel-booking', optionalPassengerTokenAuth, busController.cancelBooking);
router.get('/cancel-booking', optionalPassengerTokenAuth, busController.cancelBooking);
router.post('/cancel', optionalPassengerTokenAuth, busController.cancelBooking);

// PayU checkout and signed hosted-checkout callback
router.post('/payment/payu/initiate', optionalPassengerAuth, payuController.initiate);
router.post('/payment/payu-callback', payuController.callback);

module.exports = router;
