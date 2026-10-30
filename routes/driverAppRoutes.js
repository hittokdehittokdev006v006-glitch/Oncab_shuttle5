'use strict';

const express = require('express');
const router = express.Router();
const driverAppController = require('../controllers/driverAppController');
const busDriverAssignmentController = require('../controllers/busDriverAssignmentController');
const { authenticateDriver } = require('../middleware/driverAuth');

// ── 1. AUTHENTICATION (PUBLIC) ──────────────────────────────
router.post('/auth/login-otp', driverAppController.sendOtp);
router.post('/auth/verify-otp', driverAppController.verifyOtp);

// Legacy / alias authentication endpoints
router.post('/login-otp', driverAppController.sendOtp);
router.post('/verify-otp', driverAppController.verifyOtp);

// ── PROTECTED DRIVER APP ROUTES ──────────────────────────────
router.use(authenticateDriver);

// Profile & Duty Status
router.get('/home', driverAppController.getDriverHome);
router.get('/profile', driverAppController.getProfile);
router.put('/profile', driverAppController.updateProfile);
router.patch('/duty-status', driverAppController.toggleDutyStatus);

// Assigned Trips & Schedule
router.get('/assigned-trips', driverAppController.getAssignedTrips);
router.post('/assigned-trips', driverAppController.getAssignedTrips);
router.get('/my-assignments', busDriverAssignmentController.getMyAssignments);
router.post('/available-schedules', busDriverAssignmentController.getAvailableSchedules);
router.post('/accept-assignment', busDriverAssignmentController.acceptAssignment);
router.post('/my-assignments', busDriverAssignmentController.getMyAssignments);
router.post('/assignments/:id/start', busDriverAssignmentController.startAssignment);
router.post('/assignments/:id/complete', busDriverAssignmentController.completeAssignment);
router.post('/assignments/:id/cancel', busDriverAssignmentController.cancelAssignment);
router.get('/trips/:id', driverAppController.getTripDetails);
router.get('/trips/:id/manifest', driverAppController.getPassengerManifest);

// Stop-by-Stop Navigation & Boarding Operations (Cityflo-style)
router.get('/trips/:id/route-map', driverAppController.getTripRouteMap);
router.get('/trips/:id/current-stop', driverAppController.getCurrentStop);
router.post('/trips/:id/stops/:stopId/arrive', driverAppController.arriveAtStop);
router.post('/trips/:id/stops/:stopId/reach', driverAppController.arriveAtStop);
router.get('/trips/:id/stops/:stopId/passengers', driverAppController.getStopPassengers);
router.post('/trips/:id/stops/:stopId/complete', driverAppController.completeStop);
router.post('/trips/:id/stops/:stopId/mark-no-show', driverAppController.markNoShow);

// Trip Action Operations
router.post('/trips/:id/start', driverAppController.startTrip);
router.post('/start-trip', busDriverAssignmentController.startTrip); // Assignment workflow compatibility

router.get('/trips/:id/completion-eligibility', driverAppController.checkCompletionEligibility);
router.post('/trips/:id/complete', driverAppController.completeTrip);
router.post('/complete-trip', busDriverAssignmentController.completeTrip); // Assignment workflow compatibility

// Ticket Boarding Verification Flow
router.post('/scan-boarding-pass', driverAppController.scanBoardingPass);
router.post('/confirm-boarding', driverAppController.confirmBoarding);
router.post('/manual-verify-boarding', driverAppController.manualVerifyBoarding);

// GPS Live Location
router.post('/location/update', driverAppController.updateLocation);
router.get('/trips/:id/locations', driverAppController.getTripLocations);

// History & Earnings
router.get('/history', driverAppController.getTripHistory);
router.get('/earnings', driverAppController.getEarningsSummary);

module.exports = router;
