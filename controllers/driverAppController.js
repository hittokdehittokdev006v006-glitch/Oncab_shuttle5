'use strict';

const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { Driver, DriverDetail, Trip, Route, Stop, RouteStop, Vehicle, Booking, Passenger, BusType, TripLocation, TripStopArrival } = require('../models');
const { saveOtp, verifyOtp: verifySmsOtp, sendFast2SMSOtp } = require('../services/smsService');
const { releaseUnusedCouponOnTripCompletion } = require('../services/couponReleaseService');
const { getOrderedStopsForRoute } = require('../utils/routeStops');

// Helper to generate JWT Token for Driver
const generateDriverToken = (driver) => {
  return jwt.sign(
    {
      id: driver.id,
      driver_id: driver.id,
      driver_user_id: driver.driver_user_id,
      name: driver.name,
      mobile: driver.mobile,
      role: 'driver',
    },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
};

// Mask mobile number for privacy (e.g., 98XXXXXX10)
const maskMobile = (mobile) => {
  if (!mobile || mobile.length < 10) return mobile;
  return mobile.substring(0, 2) + 'XXXXXX' + mobile.substring(mobile.length - 2);
};

// ── 1. AUTHENTICATION & PROFILE ────────────────────────────

/**
 * Send OTP for Driver Login
 * POST /api/bus-driver/auth/login-otp
 */
exports.sendOtp = async (req, res, next) => {
  try {
    const { mobile } = req.body || {};
    if (!mobile) {
      return res.status(400).json({ status: 400, success: false, message: 'Mobile number is required' });
    }

    const driver = await Driver.findOne({ where: { mobile } });
    if (!driver) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: 'Driver mobile number not registered. Please contact operator admin.',
      });
    }

    if (driver.block_status === 'Block') {
      return res.status(403).json({ status: 403, success: false, message: 'Your driver account has been blocked' });
    }

    // Generate real 4-digit numeric OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Save OTP to in-memory store (expires in 10 minutes)
    saveOtp(mobile, otp, 10);

    // Send real OTP via Fast2SMS SMS gateway
    const smsResult = await sendFast2SMSOtp(mobile, otp);
    const smsSent = Boolean(smsResult && (smsResult.return === true || smsResult.status_code === 200));

    res.json({
      status: 200,
      success: true,
      message: smsSent
        ? 'OTP sent successfully to registered mobile number'
        : 'OTP generated and sent to registered mobile number',
      data: {
        mobile,
        otp_demo: process.env.NODE_ENV !== 'production' ? otp : undefined,
        sms_sent: smsSent,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Verify OTP & Authenticate Driver
 * POST /api/bus-driver/auth/verify-otp
 */
exports.verifyOtp = async (req, res, next) => {
  try {
    const { mobile, otp, device_id } = req.body || {};
    if (!mobile || !otp) {
      return res.status(400).json({ status: 400, success: false, message: 'Mobile number and OTP are required' });
    }

    // Verify OTP code against cached OTP or fallback master test OTPs ('1234', '0000')
    const isValidOtp = verifySmsOtp(mobile, otp) || otp === '1234' || otp === '0000';

    if (!isValidOtp) {
      return res.status(400).json({ status: 400, success: false, message: 'Invalid or expired OTP code' });
    }

    const driver = await Driver.findOne({
      where: { mobile },
      include: [{ model: DriverDetail, as: 'details' }],
    });

    if (!driver) {
      return res.status(404).json({ status: 404, success: false, message: 'Driver not found' });
    }

    if (driver.block_status === 'Block') {
      return res.status(403).json({ status: 403, success: false, message: 'Your driver account is blocked' });
    }

    // Update device ID if provided
    if (device_id) {
      await driver.update({ device_id });
    }

    const token = generateDriverToken(driver);

    res.json({
      status: 200,
      success: true,
      message: 'Login successful',
      data: {
        token,
        driver: {
          id: driver.id,
          driver_user_id: driver.driver_user_id,
          name: driver.name,
          email: driver.email,
          mobile: driver.mobile,
          online_status: driver.online_status,
          status: driver.status,
          photo: driver.photo,
          details: driver.details,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Driver Profile
 * GET /api/bus-driver/profile
 */
exports.getProfile = async (req, res, next) => {
  try {
    const driver = await Driver.findByPk(req.driver.id, {
      include: [
        { model: DriverDetail, as: 'details' },
        { model: Vehicle, as: 'vehicles', include: [{ model: BusType, as: 'bus_type' }] },
      ],
    });

    res.json({
      status: 200,
      success: true,
      data: driver,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update Profile & Device ID
 * PUT /api/bus-driver/profile
 */
exports.updateProfile = async (req, res, next) => {
  try {
    const { name, email, device_id, address } = req.body || {};
    const driver = req.driver;

    await driver.update({
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
      ...(device_id ? { device_id } : {}),
      ...(address ? { address } : {}),
    });

    res.json({
      status: 200,
      success: true,
      message: 'Profile updated successfully',
      data: driver,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Toggle Duty Status (Online / Offline)
 * PATCH /api/bus-driver/duty-status
 */
exports.toggleDutyStatus = async (req, res, next) => {
  try {
    const { online_status } = req.body || {};
    if (!['Online', 'Offline'].includes(online_status)) {
      return res.status(400).json({ status: 400, success: false, message: 'Invalid online_status. Must be Online or Offline' });
    }

    const driver = req.driver;
    await driver.update({ online_status });

    res.json({
      status: 200,
      success: true,
      message: `Duty status updated to ${online_status}`,
      data: {
        driver_id: driver.id,
        online_status: driver.online_status,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── 2. ASSIGNED TRIPS & MANIFEST ───────────────────────────

/**
 * Get Driver Assigned Trips
 * GET /api/bus-driver/assigned-trips
 */
exports.getAssignedTrips = async (req, res, next) => {
  try {
    const driverId = req.driver.id;
    const status = req.query.status || req.body?.status;
    const date = req.query.date || req.body?.date;

    const where = { driver_id: driverId };
    if (status) {
      where.status = status;
    }
    if (date) {
      where.trip_date = date;
    }

    const trips = await Trip.findAll({
      where,
      include: [
        {
          model: Route,
          as: 'route',
          include: [{ model: Stop, as: 'stops' }],
        },
        { model: Vehicle, as: 'vehicle', include: [{ model: BusType, as: 'bus_type' }] },
        {
          model: Booking,
          as: 'bookings',
          where: { booking_status: 'confirmed', payment_status: 'paid' },
          required: false,
          attributes: ['id', 'boarding_status', 'seat_numbers', 'total_seats'],
        },
      ],
      order: [
        ['trip_date', 'ASC'],
        ['departure_time', 'ASC'],
      ],
    });

    const formattedTrips = trips.map((t) => {
      const bookings = t.bookings || [];
      const totalBookings = bookings.length;
      const boardedCount = bookings.filter((b) => b.boarding_status === 'boarded').length;
      const pendingBoardingCount = bookings.filter((b) => b.boarding_status === 'not_boarded').length;

      let totalBookedSeats = 0;
      bookings.forEach((b) => {
        totalBookedSeats += (b.seat_numbers ? b.seat_numbers.length : b.total_seats || 1);
      });

      return {
        trip_id: t.id,
        schedule_code: t.schedule_code,
        route_id: t.route_id,
        route_name: t.route ? t.route.route_name : null,
        source_city: t.route ? t.route.source_city : null,
        destination_city: t.route ? t.route.destination_city : null,
        trip_date: t.trip_date,
        departure_time: t.departure_time,
        arrival_time: t.arrival_time,
        status: t.status,
        vehicle: t.vehicle ? {
          id: t.vehicle.id,
          vehicle_number: t.vehicle.registration_number || t.vehicle.vehicle_number,
          model: t.vehicle.model,
          bus_type: t.vehicle.bus_type?.name,
        } : null,
        summary: {
          total_capacity: t.seat_capacity || 40,
          total_bookings: totalBookings,
          total_booked_seats: totalBookedSeats,
          boarded_passengers: boardedCount,
          pending_passengers: pendingBoardingCount,
        },
        started_at: t.started_at,
        completed_at: t.completed_at,
      };
    });

    res.json({
      status: 200,
      success: true,
      data: formattedTrips,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Trip Details with Route Stops & Seat Info
 * GET /api/bus-driver/trips/:id
 */
exports.getTripDetails = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({
      where: { id: req.params.id, driver_id: req.driver.id },
      include: [
        { model: Route, as: 'route' },
        { model: Vehicle, as: 'vehicle', include: [{ model: BusType, as: 'bus_type' }] },
        {
          model: Booking,
          as: 'bookings',
          include: [
            { model: Stop, as: 'origin_stop' },
            { model: Stop, as: 'destination_stop' },
          ],
        },
      ],
    });

    if (!trip) {
      return res.status(404).json({ status: 404, success: false, message: 'Trip assignment not found for this driver' });
    }

    const tripData = trip.toJSON();
    if (tripData.route) {
      tripData.route.stops = await getOrderedStopsForRoute(tripData.route.id, tripData.departure_time);
    }

    res.json({
      status: 200,
      success: true,
      data: tripData,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Passenger Manifest for a Trip
 * GET /api/bus-driver/trips/:id/manifest
 */
exports.getPassengerManifest = async (req, res, next) => {
  try {
    const tripId = req.params.id;
    const { boarding_status, search } = req.query;

    const trip = await Trip.findOne({
      where: { id: tripId, driver_id: req.driver.id },
      include: [{ model: Route, as: 'route' }],
    });

    if (!trip) {
      return res.status(404).json({ status: 404, success: false, message: 'Trip assignment not found' });
    }

    const whereBooking = {
      trip_id: tripId,
      [Op.or]: [
        { booking_status: 'confirmed', payment_status: 'paid' },
        { booking_status: 'cancelled', payment_status: { [Op.in]: ['paid', 'refunded', 'partial_refund', 'pending'] } },
      ],
    };
    if (boarding_status) {
      whereBooking.boarding_status = boarding_status;
    }
    if (search) {
      whereBooking[Op.or] = [
        { passenger_name: { [Op.like]: `%${search}%` } },
        { passenger_mobile: { [Op.like]: `%${search}%` } },
        { booking_reference: { [Op.like]: `%${search}%` } },
        { boarding_pass_code: { [Op.like]: `%${search}%` } },
      ];
    }

    const bookings = await Booking.findAll({
      where: whereBooking,
      include: [
        { model: Stop, as: 'origin_stop', attributes: ['id', 'stop_name'] },
        { model: Stop, as: 'destination_stop', attributes: ['id', 'stop_name'] },
      ],
      order: [['id', 'ASC']],
    });

    const manifest = bookings.map((b) => ({
      booking_id: b.id,
      booking_reference: b.booking_reference,
      passenger_name: b.passenger_name,
      passenger_mobile_masked: maskMobile(b.passenger_mobile),
      seat_numbers: b.seat_numbers,
      total_seats: b.total_seats,
      origin_stop: b.origin_stop ? b.origin_stop.stop_name : 'Default Station',
      destination_stop: b.destination_stop ? b.destination_stop.stop_name : 'Destination Station',
      boarding_status: b.booking_status === 'cancelled' ? 'cancelled' : b.boarding_status,
      booking_status: b.booking_status,
      cancellation_reason: b.cancellation_reason || null,
      cancelled_at: b.cancelled_at || null,
      boarding_pass_code: b.boarding_pass_code,
      boarded_at: b.boarded_at,
      payment_status: b.payment_status,
    }));

    const totalCount = bookings.length;
    const boardedCount = bookings.filter((b) => b.boarding_status === 'boarded').length;

    res.json({
      status: 200,
      success: true,
      data: {
        trip_id: trip.id,
        schedule_code: trip.schedule_code,
        route_name: trip.route?.route_name,
        stats: {
          total_passengers: totalCount,
          boarded_passengers: boardedCount,
          pending_passengers: totalCount - boardedCount,
        },
        passengers: manifest,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Start Trip
 * POST /api/bus-driver/trips/:id/start
 */
exports.startTrip = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ where: { id: req.params.id, driver_id: req.driver.id } });
    if (!trip) {
      return res.status(404).json({ status: 404, success: false, message: 'Trip not found or not assigned to you' });
    }

    if (trip.status === 'Active') {
      return res.status(400).json({ status: 400, success: false, message: 'Trip is already active' });
    }
    if (trip.status === 'Completed') {
      return res.status(400).json({ status: 400, success: false, message: 'Trip is already completed' });
    }

    await trip.update({
      status: 'Active',
      started_at: new Date(),
    });

    // Check if starting GPS coordinates were provided or exist in DriverDetail
    const detail = await DriverDetail.findOne({ where: { driver_id: req.driver.id } });
    const rawLat = req.body?.latitude != null ? req.body.latitude : detail?.latitude;
    const rawLng = req.body?.longitude != null ? req.body.longitude : detail?.longitude;
    const startLat = rawLat != null && rawLat !== '' ? Number(rawLat) : null;
    const startLng = rawLng != null && rawLng !== '' ? Number(rawLng) : null;

    let initialLocation = null;
    if (startLat != null && startLng != null && Number.isFinite(startLat) && Number.isFinite(startLng)
        && Math.abs(startLat) <= 90 && Math.abs(startLng) <= 180) {
      const rawSpeed = req.body?.speed != null ? req.body.speed : detail?.location_speed_kmh;
      const rawHeading = req.body?.heading != null ? req.body.heading : detail?.location_heading;
      const startSpeed = rawSpeed != null && rawSpeed !== '' && Number.isFinite(Number(rawSpeed)) ? Number(rawSpeed) : null;
      const startHeading = rawHeading != null && rawHeading !== '' && Number.isFinite(Number(rawHeading)) ? Number(rawHeading) : null;

      initialLocation = await TripLocation.create({
        trip_id: trip.id,
        driver_id: req.driver.id,
        vehicle_id: trip.vehicle_id || null,
        latitude: startLat,
        longitude: startLng,
        speed_kmh: startSpeed,
        heading: startHeading,
        recorded_at: new Date(),
      });
    }

    if (detail) {
      await detail.update({ location_trip_id: trip.id });
    }

    res.json({
      status: 200,
      success: true,
      message: 'Trip started successfully',
      data: {
        trip_id: trip.id,
        status: trip.status,
        started_at: trip.started_at,
        initial_location_recorded: Boolean(initialLocation),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Complete Trip
 * POST /api/bus-driver/trips/:id/complete
 */
exports.completeTrip = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({ where: { id: req.params.id, driver_id: req.driver.id } });
    if (!trip) {
      return res.status(404).json({ status: 404, success: false, message: 'Trip not found or not assigned to you' });
    }

    if (trip.status === 'Completed') {
      return res.status(400).json({ status: 400, success: false, message: 'Trip is already completed' });
    }

    await trip.update({
      status: 'Completed',
      completed_at: new Date(),
    });

    // Automatically remove coupon usage for passengers who cancelled or did not board
    try {
      await releaseUnusedCouponOnTripCompletion(trip.id);
    } catch (couponErr) {
      console.warn('[Driver completeTrip] Error releasing unused coupons:', couponErr.message);
    }

    // Check if final ending GPS coordinates were provided or exist in DriverDetail
    const detail = await DriverDetail.findOne({ where: { driver_id: req.driver.id } });
    const rawLat = req.body?.latitude != null ? req.body.latitude : detail?.latitude;
    const rawLng = req.body?.longitude != null ? req.body.longitude : detail?.longitude;
    const endLat = rawLat != null && rawLat !== '' ? Number(rawLat) : null;
    const endLng = rawLng != null && rawLng !== '' ? Number(rawLng) : null;

    let finalLocation = null;
    if (endLat != null && endLng != null && Number.isFinite(endLat) && Number.isFinite(endLng)
        && Math.abs(endLat) <= 90 && Math.abs(endLng) <= 180) {
      const rawSpeed = req.body?.speed != null ? req.body.speed : detail?.location_speed_kmh;
      const rawHeading = req.body?.heading != null ? req.body.heading : detail?.location_heading;
      const endSpeed = rawSpeed != null && rawSpeed !== '' && Number.isFinite(Number(rawSpeed)) ? Number(rawSpeed) : 0;
      const endHeading = rawHeading != null && rawHeading !== '' && Number.isFinite(Number(rawHeading)) ? Number(rawHeading) : null;

      finalLocation = await TripLocation.create({
        trip_id: trip.id,
        driver_id: req.driver.id,
        vehicle_id: trip.vehicle_id || null,
        latitude: endLat,
        longitude: endLng,
        speed_kmh: endSpeed,
        heading: endHeading,
        recorded_at: new Date(),
      });
    }

    if (detail && Number(detail.location_trip_id) === Number(trip.id)) {
      await detail.update({ location_trip_id: null });
    }

    res.json({
      status: 200,
      success: true,
      message: 'Trip completed successfully',
      data: {
        trip_id: trip.id,
        status: trip.status,
        completed_at: trip.completed_at,
        final_location_recorded: Boolean(finalLocation),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── 3. TICKET VERIFICATION & BOARDING ───────────────────────

/**
 * Scan Boarding Pass (QR Code)
 * POST /api/bus-driver/scan-boarding-pass
 */
exports.scanBoardingPass = async (req, res, next) => {
  try {
    const { trip_id, assignment_id, stop_id, boarding_pass_code } = req.body || {};
    const targetTripId = trip_id || assignment_id;

    if (!boarding_pass_code) {
      return res.status(400).json({ status: 400, success: false, message: 'Boarding pass code is required' });
    }

    // Find booking by QR / boarding_pass_code
    const booking = await Booking.findOne({
      where: { boarding_pass_code },
      include: [
        { model: Trip, as: 'trip', include: [{ model: Route, as: 'route' }] },
        { model: Stop, as: 'origin_stop' },
        { model: Stop, as: 'destination_stop' },
      ],
    });

    if (!booking) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: 'Invalid boarding pass code. Ticket not found.',
      });
    }

    if (booking.booking_status === 'cancelled') {
      return res.status(400).json({
        status: 400,
        success: false,
        message: `This ticket was cancelled by the passenger (${booking.cancellation_reason || 'Cancelled'}). Boarding is not allowed.`,
        data: {
          booking_id: booking.id,
          booking_reference: booking.booking_reference,
          passenger_name: booking.passenger_name,
          booking_status: 'cancelled',
          boarding_status: 'cancelled',
          cancellation_reason: booking.cancellation_reason,
          cancelled_at: booking.cancelled_at,
        },
      });
    }

    if (booking.booking_status !== 'confirmed' || booking.payment_status !== 'paid') {
      return res.status(400).json({
        status: 400,
        success: false,
        message: 'This booking is not confirmed or payment is pending/failed',
      });
    }

    // Validation 1: Match Driver Trip
    if (targetTripId && parseInt(booking.trip_id) !== parseInt(targetTripId)) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: 'This booking is for a different bus trip schedule',
      });
    }

    // Validation 2: Stop Level Matching (if current stop_id provided)
    if (stop_id && booking.origin_stop_id && parseInt(booking.origin_stop_id) !== parseInt(stop_id)) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: `Passenger pickup is at a different stop (${booking.origin_stop ? booking.origin_stop.stop_name : 'another stop'})`,
        data: {
          booking_id: booking.id,
          expected_stop_id: booking.origin_stop_id,
          expected_stop_name: booking.origin_stop ? booking.origin_stop.stop_name : null,
        },
      });
    }

    // Validation 3: Check Boarding Status
    if (booking.boarding_status === 'boarded') {
      return res.status(400).json({
        status: 400,
        success: false,
        message: 'Passenger has already boarded this bus',
        data: {
          booking_id: booking.id,
          passenger_name: booking.passenger_name,
          seat_numbers: booking.seat_numbers,
          boarded_at: booking.boarded_at,
        },
      });
    }

    res.json({
      status: 200,
      success: true,
      message: 'Boarding pass verified successfully',
      data: {
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        passenger_name: booking.passenger_name,
        passenger_mobile_masked: maskMobile(booking.passenger_mobile),
        seat_numbers: booking.seat_numbers,
        origin_stop_id: booking.origin_stop_id,
        origin: booking.origin_stop ? booking.origin_stop.stop_name : 'Origin',
        destination_stop_id: booking.destination_stop_id,
        destination: booking.destination_stop ? booking.destination_stop.stop_name : 'Destination',
        boarding_pin_required: true,
        boarding_status: booking.boarding_status,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Confirm Boarding via PIN
 * POST /api/bus-driver/confirm-boarding
 */
exports.confirmBoarding = async (req, res, next) => {
  try {
    const { booking_id, trip_id, stop_id, boarding_pin } = req.body || {};

    if (!booking_id || !boarding_pin) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: 'booking_id and boarding_pin are required',
      });
    }

    const booking = await Booking.findByPk(booking_id);
    if (!booking) {
      return res.status(404).json({ status: 404, success: false, message: 'Booking not found' });
    }

    if (booking.booking_status === 'cancelled') {
      return res.status(400).json({
        status: 400,
        success: false,
        message: `Cannot board passenger. Booking was cancelled (${booking.cancellation_reason || 'Cancelled by passenger'}).`,
      });
    }

    if (booking.booking_status !== 'confirmed' || booking.payment_status !== 'paid') {
      return res.status(400).json({
        status: 400,
        success: false,
        message: 'Cannot board passenger. Booking is not confirmed or payment is pending/failed',
      });
    }

    if (trip_id && parseInt(booking.trip_id) !== parseInt(trip_id)) {
      return res.status(400).json({ status: 400, success: false, message: 'Booking does not match specified trip' });
    }

    if (stop_id && booking.origin_stop_id && parseInt(booking.origin_stop_id) !== parseInt(stop_id)) {
      return res.status(400).json({ status: 400, success: false, message: 'Booking pickup stop does not match specified stop' });
    }

    if (booking.boarding_status === 'boarded') {
      return res.status(400).json({
        status: 400,
        success: false,
        message: 'Passenger already boarded',
        data: {
          booking_id: booking.id,
          boarded_at: booking.boarded_at,
        },
      });
    }

    // Strict PIN verification (universal 9999 override removed for security)
    if (booking.boarding_pin && booking.boarding_pin !== String(boarding_pin).trim()) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: 'Invalid boarding PIN code entered',
      });
    }

    const now = new Date();
    const timeString = now.toTimeString().split(' ')[0];

    await booking.update({
      boarding_status: 'boarded',
      boarded_at: now,
      boarding_time: timeString,
    });

    res.json({
      status: 200,
      success: true,
      message: 'Passenger boarding confirmed successfully',
      data: {
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        passenger_name: booking.passenger_name,
        seat_numbers: booking.seat_numbers,
        boarding_status: booking.boarding_status,
        boarding_time: booking.boarding_time,
        boarded_at: booking.boarded_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Manual Passenger Boarding Verification
 * POST /api/bus-driver/manual-verify-boarding
 */
exports.manualVerifyBoarding = async (req, res, next) => {
  try {
    const { trip_id, query } = req.body || {};
    if (!trip_id || !query) {
      return res.status(400).json({ status: 400, success: false, message: 'trip_id and query (phone/ref/seat) are required' });
    }

    const booking = await Booking.findOne({
      where: {
        trip_id,
        booking_status: 'confirmed',
        payment_status: 'paid',
        [Op.or]: [
          { booking_reference: query },
          { passenger_mobile: query },
          { boarding_pass_code: query },
        ],
      },
    });

    if (!booking) {
      return res.status(404).json({ status: 404, success: false, message: 'Passenger booking not found for this trip' });
    }

    res.json({
      status: 200,
      success: true,
      data: {
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        passenger_name: booking.passenger_name,
        passenger_mobile: booking.passenger_mobile,
        seat_numbers: booking.seat_numbers,
        boarding_status: booking.boarding_status,
        boarding_pin: booking.boarding_pin,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── 4. LIVE LOCATION TRACKING ──────────────────────────────

/**
 * Update Driver GPS Location
 * POST /api/bus-driver/location/update
 */
exports.updateLocation = async (req, res, next) => {
  try {
    const { latitude, longitude, speed, heading, trip_id, accuracy, battery_level, recorded_at } = req.body || {};
    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);
    if (latitude == null || longitude == null || latitude === '' || longitude === ''
      || !Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)
      || Math.abs(parsedLatitude) > 90 || Math.abs(parsedLongitude) > 180) {
      return res.status(400).json({ status: 400, success: false, message: 'Latitude and Longitude are required' });
    }

    const parsedSpeed = speed == null || speed === '' ? null : Number(speed);
    const parsedHeading = heading == null || heading === '' ? null : Number(heading);
    if ((parsedSpeed !== null && (!Number.isFinite(parsedSpeed) || parsedSpeed < 0))
      || (parsedHeading !== null && (!Number.isFinite(parsedHeading) || parsedHeading < 0 || parsedHeading >= 360))) {
      return res.status(400).json({ status: 400, success: false, message: 'Speed or heading is invalid' });
    }

    const driverId = req.driver.id;

    // Determine associated trip
    let activeTrip = null;
    if (trip_id) {
      activeTrip = await Trip.findOne({ where: { id: trip_id, driver_id: driverId } });
      if (!activeTrip) {
        return res.status(403).json({ status: 403, success: false, message: 'Trip is not assigned to this driver' });
      }
    } else {
      // Auto-detect currently active trip for this driver
      activeTrip = await Trip.findOne({
        where: { driver_id: driverId, status: 'Active' },
        order: [['started_at', 'DESC'], ['id', 'DESC']],
      });
    }

    let detail = await DriverDetail.findOne({ where: { driver_id: driverId } });
    const currentTripId = activeTrip ? activeTrip.id : (trip_id || null);

    if (detail) {
      await detail.update({
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        location_speed_kmh: parsedSpeed,
        location_heading: parsedHeading,
        location_trip_id: currentTripId,
      });
    } else {
      await DriverDetail.create({
        driver_id: driverId,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        location_speed_kmh: parsedSpeed,
        location_heading: parsedHeading,
        location_trip_id: currentTripId,
      });
    }

    // Per user requirement:
    // When trips start, store per-trip driver location in database
    let recordedBreadcrumb = null;
    if (activeTrip) {
      const parsedAccuracy = accuracy == null || accuracy === '' ? null : Number(accuracy);
      const parsedBattery = battery_level == null || battery_level === '' ? null : Number(battery_level);

      recordedBreadcrumb = await TripLocation.create({
        trip_id: activeTrip.id,
        driver_id: driverId,
        vehicle_id: activeTrip.vehicle_id || null,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        speed_kmh: parsedSpeed,
        heading: parsedHeading,
        accuracy: Number.isFinite(parsedAccuracy) ? parsedAccuracy : null,
        battery_level: Number.isFinite(parsedBattery) ? parsedBattery : null,
        recorded_at: recorded_at ? new Date(recorded_at) : new Date(),
      });
    }

    res.json({
      status: 200,
      success: true,
      message: 'Location updated successfully',
      data: {
        driver_id: driverId,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        speed: parsedSpeed,
        heading: parsedHeading,
        trip_id: currentTripId,
        is_trip_active: Boolean(activeTrip && activeTrip.status === 'Active'),
        location_stored: Boolean(recordedBreadcrumb),
        breadcrumb_id: recordedBreadcrumb ? recordedBreadcrumb.id : null,
        updated_at: new Date(),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Trip GPS Location History (Breadcrumbs)
 * GET /api/bus-driver/trips/:id/locations
 */
exports.getTripLocations = async (req, res, next) => {
  try {
    const tripId = req.params.id;
    const trip = await Trip.findOne({
      where: { id: tripId },
      include: [
        { model: Driver, as: 'driver', attributes: ['id', 'name', 'mobile'] },
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'registration_number', 'company_model'] },
        { model: Route, as: 'route', attributes: ['id', 'route_name', 'origin_city', 'destination_city'] },
      ],
    });

    if (!trip) {
      return res.status(404).json({ status: 404, success: false, message: 'Trip not found' });
    }

    // Driver can only access trips assigned to them
    if (req.driver && Number(trip.driver_id) !== Number(req.driver.id)) {
      return res.status(403).json({ status: 403, success: false, message: 'Unauthorized access to trip locations' });
    }

    const { limit = 1000 } = req.query;
    const locations = await TripLocation.findAll({
      where: { trip_id: tripId },
      order: [['recorded_at', 'ASC']],
      limit: Math.min(5000, Math.max(1, parseInt(limit, 10) || 1000)),
      attributes: ['id', 'latitude', 'longitude', 'speed_kmh', 'heading', 'accuracy', 'battery_level', 'recorded_at'],
    });

    res.json({
      status: 200,
      success: true,
      data: {
        trip_id: trip.id,
        status: trip.status,
        started_at: trip.started_at,
        completed_at: trip.completed_at,
        driver: trip.driver,
        vehicle: trip.vehicle,
        route: trip.route,
        total_points: locations.length,
        locations,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── 5. EARNINGS & TRIP HISTORY ─────────────────────────────

/**
 * Get Driver Trip History
 * GET /api/bus-driver/history
 */
exports.getTripHistory = async (req, res, next) => {
  try {
    const driverId = req.driver.id;
    const { limit = 20, page = 1 } = req.query;
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, Math.max(1, parseInt(limit)));

    const { count, rows } = await Trip.findAndCountAll({
      where: { driver_id: driverId, status: 'Completed' },
      include: [
        { model: Route, as: 'route' },
        { model: Vehicle, as: 'vehicle' },
        { model: Booking, as: 'bookings' },
      ],
      offset: (p - 1) * l,
      limit: l,
      order: [['completed_at', 'DESC']],
    });

    const history = rows.map((t) => {
      const bookings = t.bookings || [];
      const boarded = bookings.filter((b) => b.boarding_status === 'boarded').length;
      return {
        trip_id: t.id,
        schedule_code: t.schedule_code,
        route_name: t.route ? t.route.route_name : null,
        trip_date: t.trip_date,
        started_at: t.started_at,
        completed_at: t.completed_at,
        total_bookings: bookings.length,
        boarded_passengers: boarded,
      };
    });

    res.json({
      status: 200,
      success: true,
      data: history,
      pagination: {
        total: count,
        page: p,
        limit: l,
        pages: Math.ceil(count / l),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Driver Earnings Summary
 * GET /api/bus-driver/earnings
 */
exports.getEarningsSummary = async (req, res, next) => {
  try {
    const driverId = req.driver.id;

    // Aggregate completed trips stats
    const completedTrips = await Trip.findAll({
      where: { driver_id: driverId, status: 'Completed' },
      include: [{ model: Booking, as: 'bookings' }],
    });

    const totalTripsCompleted = completedTrips.length;
    let totalPassengersBoarded = 0;

    completedTrips.forEach((t) => {
      if (t.bookings) {
        totalPassengersBoarded += t.bookings.filter((b) => b.boarding_status === 'boarded').length;
      }
    });

    res.json({
      status: 200,
      success: true,
      data: {
        driver_id: driverId,
        driver_name: req.driver.name,
        total_completed_trips: totalTripsCompleted,
        total_passengers_boarded: totalPassengersBoarded,
        rating: 4.8, // Default rating representation
        duty_status: req.driver.online_status,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── 6. CITYFLO-STYLE STOP-BY-STOP OPERATIONS ─────────────────────

/**
 * Driver Home Summary
 * GET /api/bus-driver/home
 */
exports.getDriverHome = async (req, res, next) => {
  try {
    const driverId = req.driver.id;
    const today = new Date().toISOString().slice(0, 10);

    const activeTrip = await Trip.findOne({
      where: {
        driver_id: driverId,
        status: { [Op.in]: ['Active', 'Scheduled'] },
      },
      include: [
        { model: Route, as: 'route' },
        { model: Vehicle, as: 'vehicle', include: [{ model: BusType, as: 'bus_type' }] },
        { model: Booking, as: 'bookings', where: { booking_status: 'confirmed', payment_status: 'paid' }, required: false },
      ],
      order: [['status', 'ASC'], ['departure_time', 'ASC']],
    });

    if (!activeTrip) {
      return res.json({
        status: 200,
        success: true,
        data: {
          driver: { id: req.driver.id, name: req.driver.name, online_status: req.driver.online_status },
          today: { date: today },
          current_trip: null,
          current_stop: null,
          next_stop: null,
          boarding: { total: 0, boarded: 0, pending: 0 },
        },
      });
    }

    const bookings = activeTrip.bookings || [];
    const totalBookings = bookings.length;
    const boardedCount = bookings.filter((b) => b.boarding_status === 'boarded').length;
    const pendingCount = bookings.filter((b) => b.boarding_status === 'not_boarded').length;

    const stops = activeTrip.route_id ? await getOrderedStopsForRoute(activeTrip.route_id, activeTrip.departure_time) : [];
    const currentStop = stops.length > 0 ? stops[0] : null;
    const nextStop = stops.length > 1 ? stops[1] : null;

    res.json({
      status: 200,
      success: true,
      data: {
        driver: {
          id: req.driver.id,
          name: req.driver.name,
          online_status: req.driver.online_status,
        },
        today: { date: today },
        current_trip: {
          trip_id: activeTrip.id,
          schedule_code: activeTrip.schedule_code,
          status: activeTrip.status,
          bus_number: activeTrip.vehicle?.registration_number || activeTrip.vehicle?.vehicle_number || 'TBD',
          route_name: activeTrip.route?.route_name,
          departure_time: activeTrip.departure_time,
          trip_date: activeTrip.trip_date,
        },
        current_stop: currentStop ? {
          stop_id: currentStop.id,
          name: currentStop.stop_name,
          sequence: currentStop.stop_sequence || 1,
          eta: currentStop.pickup_time || activeTrip.departure_time,
        } : null,
        next_stop: nextStop ? {
          stop_id: nextStop.id,
          name: nextStop.stop_name,
          sequence: nextStop.stop_sequence || 2,
        } : null,
        boarding: {
          total: totalBookings,
          boarded: boardedCount,
          pending: pendingCount,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Current Stop Info
 * GET /api/bus-driver/trips/:id/current-stop
 */
exports.getCurrentStop = async (req, res, next) => {
  try {
    const trip = await Trip.findOne({
      where: { id: req.params.id, driver_id: req.driver.id },
      include: [
        { model: Route, as: 'route' },
        { model: Booking, as: 'bookings', where: { booking_status: 'confirmed', payment_status: 'paid' }, required: false },
      ],
    });

    if (!trip) {
      return res.status(404).json({ status: 404, success: false, message: 'Trip assignment not found' });
    }

    const stops = trip.route_id ? await getOrderedStopsForRoute(trip.route_id, trip.departure_time) : [];
    const bookings = trip.bookings || [];

    // Identify current active stop by first stop with pending boardings
    let activeStop = stops[0] || null;
    for (const s of stops) {
      const stopPending = bookings.filter((b) => Number(b.origin_stop_id) === Number(s.id) && b.boarding_status === 'not_boarded').length;
      if (stopPending > 0) {
        activeStop = s;
        break;
      }
    }

    const stopBookings = activeStop ? bookings.filter((b) => Number(b.origin_stop_id) === Number(activeStop.id)) : [];
    const stopBoarded = stopBookings.filter((b) => b.boarding_status === 'boarded').length;

    res.json({
      status: 200,
      success: true,
      data: {
        trip_id: trip.id,
        stop: activeStop ? {
          id: activeStop.id,
          name: activeStop.stop_name,
          sequence: activeStop.stop_sequence || 1,
          latitude: activeStop.latitude,
          longitude: activeStop.longitude,
          scheduled_time: activeStop.pickup_time || trip.departure_time,
          eta: activeStop.pickup_time || trip.departure_time,
        } : null,
        passengers: {
          total: stopBookings.length,
          boarded: stopBoarded,
          pending: stopBookings.length - stopBoarded,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Trip Route & Stops for Map Display (with reached stoppage status)
 * GET /api/bus-driver/trips/:id/route-map
 */
exports.getTripRouteMap = async (req, res, next) => {
  try {
    const tripId = req.params.id;
    const trip = await Trip.findOne({
      where: { id: tripId, driver_id: req.driver.id },
      include: [
        {
          model: Route,
          as: 'route',
        },
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'registration_number', 'company_model'] },
        { model: Driver, as: 'driver', attributes: ['id', 'name', 'mobile'] },
        { model: TripStopArrival, as: 'stop_arrivals' },
      ],
    });

    if (!trip) {
      return res.status(404).json({ status: 404, success: false, message: 'Trip assignment not found for this driver' });
    }

    const bookings = await Booking.findAll({
      where: {
        trip_id: tripId,
        [Op.or]: [
          { booking_status: 'confirmed', payment_status: 'paid' },
          { booking_status: 'cancelled' },
        ],
      },
      attributes: ['id', 'origin_stop_id', 'destination_stop_id', 'boarding_status'],
    });

    const arrivalsMap = new Map();
    (trip.stop_arrivals || []).forEach((arr) => {
      arrivalsMap.set(Number(arr.stop_id), arr);
    });

    const rawStops = trip.route_id ? await getOrderedStopsForRoute(trip.route_id, trip.departure_time) : [];

    let reachedCount = 0;
    const stops = rawStops.map((stop) => {
      const arr = arrivalsMap.get(Number(stop.id)) || null;
      const isReached = Boolean(arr && (arr.status === 'ARRIVED' || arr.status === 'COMPLETED'));
      if (isReached) reachedCount++;

      const stopBookings = bookings.filter((b) => Number(b.origin_stop_id) === Number(stop.id));
      const boarded = stopBookings.filter((b) => b.boarding_status === 'boarded').length;
      const noShow = stopBookings.filter((b) => b.boarding_status === 'no_show').length;
      const pending = stopBookings.length - boarded - noShow;

      return {
        id: stop.id,
        stop_id: stop.id,
        stop_name: stop.stop_name,
        stop_code: stop.stop_code,
        stop_sequence: stop.stop_sequence,
        latitude: stop.latitude != null ? Number(stop.latitude) : null,
        longitude: stop.longitude != null ? Number(stop.longitude) : null,
        scheduled_time: stop.pickup_time || trip.departure_time,
        is_reached: isReached,
        status: arr?.status || 'PENDING',
        arrived_at: arr?.arrived_at || null,
        completed_at: arr?.completed_at || null,
        arrival_latitude: arr?.arrival_latitude != null ? Number(arr.arrival_latitude) : null,
        arrival_longitude: arr?.arrival_longitude != null ? Number(arr.arrival_longitude) : null,
        passengers: {
          total: stopBookings.length,
          boarded,
          pending,
          no_show: noShow,
        },
      };
    });

    const currentStop = stops.find((s) => s.status === 'ARRIVED') || stops.find((s) => s.status === 'PENDING') || stops[stops.length - 1] || null;

    const detail = await DriverDetail.findOne({
      where: { driver_id: req.driver.id },
      attributes: ['latitude', 'longitude', 'location_speed_kmh', 'location_heading', 'updated_at'],
    });

    res.json({
      status: 200,
      success: true,
      data: {
        trip: {
          id: trip.id,
          schedule_code: trip.schedule_code,
          status: trip.status,
          trip_date: trip.trip_date,
          departure_time: trip.departure_time,
          started_at: trip.started_at,
          completed_at: trip.completed_at,
        },
        route: {
          id: trip.route?.id,
          route_name: trip.route?.route_name,
          route_code: trip.route?.route_code,
          origin_city: trip.route?.origin_city,
          destination_city: trip.route?.destination_city,
          total_distance: trip.route?.total_distance,
          estimated_duration: trip.route?.estimated_duration,
        },
        driver: trip.driver,
        vehicle: trip.vehicle,
        driver_location: detail ? {
          latitude: detail.latitude != null ? Number(detail.latitude) : null,
          longitude: detail.longitude != null ? Number(detail.longitude) : null,
          speed_kmh: detail.location_speed_kmh != null ? Number(detail.location_speed_kmh) : null,
          heading: detail.location_heading != null ? Number(detail.location_heading) : null,
          updated_at: detail.updated_at,
        } : null,
        progress: {
          total_stops: stops.length,
          reached_stops: reachedCount,
          pending_stops: stops.length - reachedCount,
          percent_complete: stops.length > 0 ? Math.round((reachedCount / stops.length) * 100) : 0,
        },
        current_stop: currentStop,
        stops,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Arrive at Stop (Persist Stoppage Reach in Database)
 * POST /api/bus-driver/trips/:id/stops/:stopId/arrive
 * POST /api/bus-driver/trips/:id/stops/:stopId/reach
 */
exports.arriveAtStop = async (req, res, next) => {
  try {
    const { id: tripId, stopId } = req.params;
    const { latitude, longitude, speed, heading, accuracy, notes } = req.body || {};

    const trip = await Trip.findOne({
      where: { id: tripId, driver_id: req.driver.id },
      include: [{ model: Route, as: 'route', include: [{ model: Stop, as: 'stops' }] }],
    });
    if (!trip) {
      return res.status(404).json({ status: 404, success: false, message: 'Trip assignment not found' });
    }

    const stop = await Stop.findByPk(stopId);
    if (!stop) {
      return res.status(404).json({ status: 404, success: false, message: 'Stop not found' });
    }

    const now = new Date();
    const parsedLat = latitude != null && latitude !== '' ? Number(latitude) : null;
    const parsedLng = longitude != null && longitude !== '' ? Number(longitude) : null;
    const validCoords = parsedLat != null && parsedLng != null && Number.isFinite(parsedLat) && Number.isFinite(parsedLng)
      && Math.abs(parsedLat) <= 90 && Math.abs(parsedLng) <= 180;

    const bookings = await Booking.findAll({
      where: {
        trip_id: tripId,
        origin_stop_id: stopId,
        [Op.or]: [
          { booking_status: 'confirmed', payment_status: 'paid' },
          { booking_status: 'cancelled' },
        ],
      },
    });

    const total = bookings.length;
    const boarded = bookings.filter((b) => b.boarding_status === 'boarded').length;
    const noShow = bookings.filter((b) => b.boarding_status === 'no_show').length;
    const pending = total - boarded - noShow;

    // Find or create in TripStopArrival table
    let arrivalRecord = await TripStopArrival.findOne({
      where: { trip_id: trip.id, stop_id: stop.id },
    });

    if (arrivalRecord) {
      await arrivalRecord.update({
        arrived_at: now,
        status: 'ARRIVED',
        arrival_latitude: validCoords ? parsedLat : arrivalRecord.arrival_latitude,
        arrival_longitude: validCoords ? parsedLng : arrivalRecord.arrival_longitude,
        passengers_boarded: boarded,
        passengers_pending: pending,
        passengers_no_show: noShow,
        notes: notes !== undefined ? notes : arrivalRecord.notes,
      });
    } else {
      const routeStop = await RouteStop.findOne({
        where: { route_id: trip.route_id, stop_id: stop.id },
      });
      const resolvedSequence = routeStop ? Number(routeStop.stop_sequence) : (Number(stop.stop_sequence) > 0 ? Number(stop.stop_sequence) : 1);
      arrivalRecord = await TripStopArrival.create({
        trip_id: trip.id,
        stop_id: stop.id,
        driver_id: req.driver.id,
        vehicle_id: trip.vehicle_id || null,
        stop_sequence: resolvedSequence,
        stop_name: stop.stop_name,
        scheduled_arrival_time: stop.pickup_time || trip.departure_time || null,
        arrived_at: now,
        status: 'ARRIVED',
        arrival_latitude: validCoords ? parsedLat : null,
        arrival_longitude: validCoords ? parsedLng : null,
        passengers_boarded: boarded,
        passengers_pending: pending,
        passengers_no_show: noShow,
        notes: notes || null,
      });
    }

    // Also record arrival breadcrumb in trip_locations table
    if (validCoords) {
      try {
        await TripLocation.create({
          trip_id: trip.id,
          driver_id: req.driver.id,
          vehicle_id: trip.vehicle_id || null,
          latitude: parsedLat,
          longitude: parsedLng,
          speed_kmh: speed != null && Number.isFinite(Number(speed)) ? Number(speed) : 0,
          heading: heading != null && Number.isFinite(Number(heading)) ? Number(heading) : null,
          accuracy: accuracy != null && Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
          recorded_at: now,
        });

        // Update DriverDetail live location
        const detail = await DriverDetail.findOne({ where: { driver_id: req.driver.id } });
        if (detail) {
          await detail.update({
            latitude: parsedLat,
            longitude: parsedLng,
            location_trip_id: trip.id,
          });
        }
      } catch (locErr) {
        console.warn('TripLocation arrival ping recording error:', locErr.message);
      }
    }

    // Determine next stop
    const stops = (trip.route?.stops || []).slice().sort((a, b) => (a.stop_sequence || 0) - (b.stop_sequence || 0));
    const currentIndex = stops.findIndex((s) => Number(s.id) === Number(stopId));
    const nextStop = currentIndex >= 0 && currentIndex + 1 < stops.length ? stops[currentIndex + 1] : null;

    res.json({
      status: 200,
      success: true,
      message: `Arrived at stop ${stop.stop_name}. Stoppage reach recorded in database.`,
      data: {
        trip_id: trip.id,
        stop_id: stop.id,
        stop_name: stop.stop_name,
        stop_sequence: stop.stop_sequence,
        arrived_at: now,
        arrival_latitude: arrivalRecord.arrival_latitude,
        arrival_longitude: arrivalRecord.arrival_longitude,
        status: arrivalRecord.status,
        passengers: {
          total,
          boarded,
          pending,
          no_show: noShow,
        },
        stoppage_arrival_id: arrivalRecord.id,
        next_stop: nextStop ? {
          stop_id: nextStop.id,
          name: nextStop.stop_name,
          sequence: nextStop.stop_sequence,
        } : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Passengers for Current Stop
 * GET /api/bus-driver/trips/:id/stops/:stopId/passengers
 */
exports.getStopPassengers = async (req, res, next) => {
  try {
    const { id: tripId, stopId } = req.params;

    const trip = await Trip.findOne({ where: { id: tripId, driver_id: req.driver.id } });
    if (!trip) {
      return res.status(404).json({ status: 404, success: false, message: 'Trip assignment not found' });
    }

    const stop = await Stop.findByPk(stopId);
    const bookings = await Booking.findAll({
      where: {
        trip_id: tripId,
        origin_stop_id: stopId,
        [Op.or]: [
          { booking_status: 'confirmed', payment_status: 'paid' },
          { booking_status: 'cancelled', payment_status: { [Op.in]: ['paid', 'refunded', 'partial_refund', 'pending'] } },
        ],
      },
      order: [['id', 'ASC']],
    });

    const passengers = bookings.map((b) => ({
      booking_id: b.id,
      booking_reference: b.booking_reference,
      passenger_name: b.passenger_name,
      passenger_mobile_masked: maskMobile(b.passenger_mobile),
      seat: Array.isArray(b.seat_numbers) ? b.seat_numbers.join(', ') : b.seat_numbers,
      boarding_status: b.booking_status === 'cancelled' ? 'cancelled' : b.boarding_status,
      booking_status: b.booking_status,
      cancellation_reason: b.cancellation_reason || null,
      cancelled_at: b.cancelled_at || null,
      boarding_pass_code: b.boarding_pass_code,
      boarded_at: b.boarded_at,
    }));

    const total = bookings.length;
    const boarded = bookings.filter((b) => b.boarding_status === 'boarded').length;

    res.json({
      status: 200,
      success: true,
      data: {
        stop: {
          id: Number(stopId),
          name: stop ? stop.stop_name : 'Pickup Stop',
        },
        summary: {
          total,
          boarded,
          pending: total - boarded,
          no_show: bookings.filter((b) => b.boarding_status === 'no_show').length,
        },
        passengers,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Complete Stop Operations (Persist Stoppage Departure in Database)
 * POST /api/bus-driver/trips/:id/stops/:stopId/complete
 */
exports.completeStop = async (req, res, next) => {
  try {
    const { id: tripId, stopId } = req.params;
    const { latitude, longitude, notes } = req.body || {};

    const trip = await Trip.findOne({
      where: { id: tripId, driver_id: req.driver.id },
      include: [{ model: Route, as: 'route', include: [{ model: Stop, as: 'stops' }] }],
    });
    if (!trip) {
      return res.status(404).json({ status: 404, success: false, message: 'Trip assignment not found' });
    }

    const bookings = await Booking.findAll({ where: { trip_id: tripId, origin_stop_id: stopId } });
    const total = bookings.length;
    const boarded = bookings.filter((b) => b.boarding_status === 'boarded').length;
    const noShow = bookings.filter((b) => b.boarding_status === 'no_show').length;
    const pending = total - boarded - noShow;
    const now = new Date();

    // Update TripStopArrival record
    let arrivalRecord = await TripStopArrival.findOne({
      where: { trip_id: trip.id, stop_id: stopId },
    });

    if (arrivalRecord) {
      await arrivalRecord.update({
        completed_at: now,
        status: 'COMPLETED',
        passengers_boarded: boarded,
        passengers_pending: pending,
        passengers_no_show: noShow,
        notes: notes !== undefined ? notes : arrivalRecord.notes,
      });
    } else {
      const stop = await Stop.findByPk(stopId);
      const routeStop = await RouteStop.findOne({
        where: { route_id: trip.route_id, stop_id: Number(stopId) },
      });
      const resolvedSequence = routeStop ? Number(routeStop.stop_sequence) : (Number(stop?.stop_sequence) > 0 ? Number(stop?.stop_sequence) : 1);
      arrivalRecord = await TripStopArrival.create({
        trip_id: trip.id,
        stop_id: Number(stopId),
        driver_id: req.driver.id,
        vehicle_id: trip.vehicle_id || null,
        stop_sequence: resolvedSequence,
        stop_name: stop?.stop_name || 'Stop',
        scheduled_arrival_time: stop?.pickup_time || trip.departure_time || null,
        arrived_at: now,
        completed_at: now,
        status: 'COMPLETED',
        passengers_boarded: boarded,
        passengers_pending: pending,
        passengers_no_show: noShow,
        notes: notes || null,
      });
    }

    const stops = trip.route_id ? await getOrderedStopsForRoute(trip.route_id, trip.departure_time) : [];
    const currentIndex = stops.findIndex((s) => Number(s.id) === Number(stopId));
    const nextStop = currentIndex >= 0 && currentIndex + 1 < stops.length ? stops[currentIndex + 1] : null;

    res.json({
      status: 200,
      success: true,
      message: 'Stop completed successfully. Stoppage departure recorded in database.',
      data: {
        stop_id: Number(stopId),
        total_passengers: total,
        boarded,
        no_show: noShow,
        pending,
        arrived_at: arrivalRecord.arrived_at,
        completed_at: now,
        status: 'COMPLETED',
        next_stop: nextStop ? {
          stop_id: nextStop.id,
          name: nextStop.stop_name,
          sequence: nextStop.stop_sequence,
        } : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Mark Passenger No-Show at Stop
 * POST /api/bus-driver/trips/:id/stops/:stopId/mark-no-show
 */
exports.markNoShow = async (req, res, next) => {
  try {
    const { booking_id, reason } = req.body || {};
    if (!booking_id) {
      return res.status(400).json({ status: 400, success: false, message: 'booking_id is required' });
    }

    const booking = await Booking.findOne({ where: { id: booking_id, trip_id: req.params.id } });
    if (!booking) {
      return res.status(404).json({ status: 404, success: false, message: 'Booking not found for this trip' });
    }

    if (booking.boarding_status === 'boarded') {
      return res.status(400).json({ status: 400, success: false, message: 'Passenger has already boarded' });
    }

    await booking.update({
      boarding_status: 'no_show',
      cancellation_reason: reason || 'Passenger did not arrive at stop',
    });

    res.json({
      status: 200,
      success: true,
      message: 'Passenger marked as no-show',
      data: {
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        passenger_name: booking.passenger_name,
        boarding_status: booking.boarding_status,
      },
    });
  } catch (err) {
    next(err);
  }
};
