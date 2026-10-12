'use strict';

const express = require('express');
const router = express.Router();
const busController = require('../controllers/busController');
const payuController = require('../controllers/payuController');
const walletController = require('../controllers/walletController');
const couponController = require('../controllers/couponController');
const refundController = require('../controllers/refundController');

// ── Public Bus APIs (No Authentication Required) ───────────
// These are for user-facing mobile app

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

// User Bookings (Can be made public with passenger_mobile)
router.post('/wallet/balance', walletController.balance);
router.post('/wallet/transactions', walletController.transactions);
router.get('/user-bookings', busController.getUserBookings);
router.post('/user-bookings', busController.getUserBookings);
router.get('/user-refunds', refundController.getUserRefunds);
router.post('/user-refunds', refundController.getUserRefunds);

// Booking Details for Boarding Pass
router.get('/booking-details', busController.getBookingDetails);
router.post('/booking-details', busController.getBookingDetails);

// Create / Book Ticket
router.post('/create-booking', busController.createBooking);
router.post('/book-ticket', busController.createBooking);
router.post('/book', busController.createBooking);

// Cancel Booking (Public Mobile App Endpoint)
router.post('/cancel-booking', busController.cancelBooking);
router.get('/cancel-booking', busController.cancelBooking);
router.post('/cancel', busController.cancelBooking);

// PayU checkout and signed hosted-checkout callback
router.post('/payment/payu/initiate', payuController.initiate);
router.post('/payment/payu-callback', payuController.callback);

module.exports = router;
