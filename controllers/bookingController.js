'use strict';

const { Op, fn, col } = require('sequelize');
const { Booking, Trip, CustomerUser, Stop, RouteStop, Payment, Refund, Coupon, CouponUsage, Route, Vehicle, Driver, DriverDetail, BusType, TripLocation, TripStopArrival } = require('../models');
const { logAction } = require('../middleware/auditLog');
const { releaseBookingReservation } = require('../services/packagePurchaseService');
const sequelize = require('../config/database');
const { calculateCouponDiscount } = require('../utils/coupon');
const { resolveFare } = require('../utils/fareCalculator');
const SeatReservationService = require('../services/seatReservationService');
const { confirmPaidBooking } = require('../services/bookingConfirmationService');
const { hasRole } = require('../utils/roles');
const { getOrderedStopsForRoute } = require('../utils/routeStops');

const calculateDistanceMeters = (lat1, lon1, lat2, lon2) => {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371e3;
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const buildPagination = (page, limit) => {
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit) || 15));
  return { offset: (p - 1) * l, limit: l, page: p };
};

/** Convert HH:MM:SS string to minutes from midnight */
const getMinutesFromMidnight = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const parts = timeStr.split(':');
  return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
};

/** Format 24h time string + offset to 12h AM/PM */
const format12HourTime = (timeStr, offsetMins = 0) => {
  if (!timeStr) return '';
  let totalMins = (getMinutesFromMidnight(timeStr) + offsetMins) % (24 * 60);
  if (totalMins < 0) totalMins += 24 * 60;
  const h24 = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
};

const BOOKING_INCLUDE = [
  {
    model: Trip,
    as: 'trip',
    include: [
      {
        model: Route,
        as: 'route',
        include: [{
          model: Stop,
          as: 'stops',
          attributes: ['id', 'stop_name', 'stop_code', 'latitude', 'longitude', 'address', 'landmark', 'stop_sequence'],
          required: false,
        }],
      },
      {
        model: Driver,
        as: 'driver',
        attributes: ['id', 'name', 'mobile', 'online_status', 'photo'],
        required: false,
        include: [
          {
            model: DriverDetail,
            as: 'details',
            attributes: ['latitude', 'longitude', 'location_speed_kmh', 'location_heading', 'location_trip_id', 'updated_at'],
            required: false,
          },
        ],
      },
      {
        model: Vehicle,
        as: 'vehicle',
        attributes: ['id', 'registration_number', 'company_model', 'status', 'latitude', 'longitude', 'total_seats', 'driver_id'],
        required: false,
        include: [
          {
            model: Driver,
            as: 'driver',
            attributes: ['id', 'name', 'mobile', 'online_status', 'photo'],
            required: false,
            include: [
              {
                model: DriverDetail,
                as: 'details',
                attributes: ['latitude', 'longitude', 'location_speed_kmh', 'location_heading', 'location_trip_id', 'updated_at'],
                required: false,
              },
            ],
          },
        ],
      },
      {
        model: TripStopArrival,
        as: 'stop_arrivals',
        required: false,
      },
    ],
  },
  { model: CustomerUser, as: 'passenger', attributes: ['id', 'name', 'mobile', 'email'] },
  { model: Stop, as: 'origin_stop', attributes: ['id', 'stop_name', 'stop_code', 'latitude', 'longitude', 'address', 'landmark'] },
  { model: Stop, as: 'destination_stop', attributes: ['id', 'stop_name', 'stop_code', 'latitude', 'longitude', 'address', 'landmark'] },
  { model: Coupon, as: 'coupon', attributes: ['id', 'code', 'code_type', 'amount'] },
];

// ── List Bookings ──────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    let {
      page,
      limit,
      search,
      booking_status,
      payment_status,
      from_date,
      to_date,
      date,
      trip_id,
      route_id,
      vehicle_id,
      driver_id,
    } = req.query;

    const { offset, limit: lim, page: p } = buildPagination(page, limit);
    const where = {};

    if (search) {
      where[Op.or] = [
        { booking_reference: { [Op.like]: `%${search}%` } },
        { passenger_name: { [Op.like]: `%${search}%` } },
        { passenger_mobile: { [Op.like]: `%${search}%` } },
        { passenger_email: { [Op.like]: `%${search}%` } },
        { boarding_pass_code: { [Op.like]: `%${search}%` } },
      ];
    }

    if (booking_status) where.booking_status = booking_status;
    if (payment_status) where.payment_status = payment_status;
    if (trip_id) where.trip_id = trip_id;

    // Date filtering (support single date or range)
    if (date) {
      where.travel_date = date;
    } else if (from_date && to_date) {
      where.travel_date = { [Op.between]: [from_date, to_date] };
    } else if (from_date) {
      where.travel_date = { [Op.gte]: from_date };
    } else if (to_date) {
      where.travel_date = { [Op.lte]: to_date };
    }

    // Role-based scoping for owners
    let ownerTripIds = null;
    if (hasRole(req.user, 'owner')) {
      const [vehicles, drivers] = await Promise.all([
        Vehicle.findAll({ attributes: ['id'], where: { owner_id: req.user.id }, raw: true }),
        Driver.findAll({ attributes: ['id'], where: { owner_id: req.user.id }, raw: true }),
      ]);
      const vehicleIds = vehicles.map((v) => v.id);
      const driverIds = drivers.map((d) => d.id);
      const assignedTrips = (vehicleIds.length || driverIds.length)
        ? await Trip.findAll({
          attributes: ['id'],
          where: {
            [Op.or]: [
              ...(vehicleIds.length ? [{ vehicle_id: { [Op.in]: vehicleIds } }] : []),
              ...(driverIds.length ? [{ driver_id: { [Op.in]: driverIds } }] : []),
            ],
          },
          raw: true,
        })
        : [];
      ownerTripIds = assignedTrips.map((t) => Number(t.id));
      where.booking_status = { [Op.ne]: 'cancelled' };
    }

    // Filter by route, vehicle, or driver via associated Trip
    if (route_id || vehicle_id || driver_id || ownerTripIds !== null) {
      const tripWhere = {};
      if (route_id) tripWhere.route_id = route_id;
      if (vehicle_id) tripWhere.vehicle_id = vehicle_id;
      if (driver_id) tripWhere.driver_id = driver_id;

      if (ownerTripIds !== null) {
        if (ownerTripIds.length === 0) {
          return res.json({
            success: true,
            data: [],
            pagination: { total: 0, page: p, limit: lim, pages: 0 },
            summary: { total_bookings: 0, total_seats: 0, total_revenue: '0.00', confirmed_count: 0, cancelled_count: 0 },
          });
        }
        tripWhere.id = { [Op.in]: ownerTripIds };
      }

      if (where.trip_id) {
        tripWhere.id = tripWhere.id ? { [Op.and]: [tripWhere.id, where.trip_id] } : where.trip_id;
      }

      const matchingTrips = await Trip.findAll({
        attributes: ['id'],
        where: tripWhere,
        raw: true,
      });

      const matchingTripIds = matchingTrips.map((t) => Number(t.id));
      if (matchingTripIds.length === 0) {
        return res.json({
          success: true,
          data: [],
          pagination: { total: 0, page: p, limit: lim, pages: 0 },
          summary: { total_bookings: 0, total_seats: 0, total_revenue: '0.00', confirmed_count: 0, cancelled_count: 0 },
        });
      }
      where.trip_id = { [Op.in]: matchingTripIds };
    }

    const [count, rows, summaryStats] = await Promise.all([
      Booking.count({ where, distinct: true }),
      Booking.findAll({
        where,
        include: BOOKING_INCLUDE,
        offset,
        limit: lim,
        order: [['created_at', 'DESC']],
      }),
      Booking.findAll({
        where,
        attributes: [
          [fn('COUNT', col('id')), 'total_bookings'],
          [fn('SUM', col('total_seats')), 'total_seats'],
          [
            fn('SUM', fn('COALESCE', col('final_amount'), col('total_fare'), 0)),
            'total_revenue',
          ],
        ],
        raw: true,
      }),
    ]);

    const stats = summaryStats[0] || {};
    const totalBookings = Number(stats.total_bookings || count || 0);
    const totalSeats = Number(stats.total_seats || 0);
    const totalRevenue = Number(stats.total_revenue || 0).toFixed(2);

    res.json({
      success: true,
      data: rows,
      pagination: { total: count, page: p, limit: lim, pages: Math.ceil(count / lim) },
      summary: {
        total_bookings: totalBookings,
        total_seats: totalSeats,
        total_revenue: totalRevenue,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Get Booking ────────────────────────────────────────────
exports.show = async (req, res, next) => {
  try {
    const booking = await Booking.findByPk(req.params.id, { include: [...BOOKING_INCLUDE, { model: Payment, as: 'payments' }, { model: Refund, as: 'refunds' }] });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    res.json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
};

// ── Create Booking ─────────────────────────────────────────
exports.create = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { trip_id, schedule_id, passenger_id, passenger_name, passenger_mobile, passenger_email, origin_stop_id, destination_stop_id, travel_date, seat_numbers, total_seats, payment_method, coupon_id, coupon_code, device_id, special_requests } = req.body;
    const tripIdsToTry = [...new Set([trip_id, schedule_id].filter((id) => id != null && id !== ''))];
    if (tripIdsToTry.length === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'trip_id or schedule_id is required' });
    }

    const requestedTravelDate = travel_date ? String(travel_date).slice(0, 10) : null;
    let trip = null;
    let dateMismatchTrip = null;
    for (const candidateTripId of tripIdsToTry) {
      const candidateTrip = await Trip.findByPk(candidateTripId, {
        include: [
          { model: Vehicle, as: 'vehicle', required: false },
          { model: BusType, as: 'bus_type', required: false },
        ],
        transaction: t,
      });
      if (candidateTrip && requestedTravelDate && candidateTrip.trip_date
        && String(candidateTrip.trip_date).slice(0, 10) !== requestedTravelDate) {
        dateMismatchTrip = candidateTrip;
        continue;
      }
      trip = candidateTrip;
      if (trip) break;
    }
    if (!trip) {
      await t.rollback();
      if (dateMismatchTrip) {
        return res.status(409).json({
          success: false,
          message: 'Selected trip is scheduled for a different travel date',
          data: { trip_id: dateMismatchTrip.id, trip_date: dateMismatchTrip.trip_date, requested_travel_date: requestedTravelDate },
        });
      }
      return res.status(404).json({ success: false, message: 'Trip not found' });
    }

    if (!['Scheduled', 'Active'].includes(String(trip.status))) {
      await t.rollback();
      return res.status(409).json({
        success: false,
        message: 'Only Scheduled or Active trips can be booked',
        data: { trip_id: trip.id, trip_status: trip.status },
      });
    }

    const selectedStopIds = [...new Set([origin_stop_id, destination_stop_id]
      .filter((stopId) => stopId != null && stopId !== '')
      .map(Number))];
    if (selectedStopIds.length) {
      const [selectedStops, routeStopLinks] = await Promise.all([
        Stop.findAll({ where: { id: { [Op.in]: selectedStopIds } }, attributes: ['id', 'route_id'], transaction: t }),
        RouteStop.findAll({
          where: { route_id: trip.route_id, stop_id: { [Op.in]: selectedStopIds }, status: 'Active' },
          attributes: ['stop_id'],
          transaction: t,
          raw: true,
        }),
      ]);
      const linkedStopIds = new Set(routeStopLinks.map((link) => Number(link.stop_id)));
      const stopsById = new Map(selectedStops.map((stop) => [Number(stop.id), stop]));
      const invalidStopIds = selectedStopIds.filter((stopId) => {
        const stop = stopsById.get(stopId);
        return !stop || (Number(stop.route_id) !== Number(trip.route_id) && !linkedStopIds.has(stopId));
      });
      if (invalidStopIds.length) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: 'Pickup and destination stops must belong to the selected trip route',
          code: 'STOP_NOT_ON_TRIP_ROUTE',
          data: { trip_id: trip.id, route_id: trip.route_id, invalid_stop_ids: invalidStopIds },
        });
      }
    }

    const requestedSeats = SeatReservationService.parseSeatNumbers(seat_numbers || req.body.seat_number || req.body.seats);
    if (requestedSeats.length > 0) {
      const conflictRes = await SeatReservationService.checkSeatConflict({
        tripId: trip.id,
        travelDate: travel_date || trip.trip_date,
        requestedSeats,
        transaction: t,
      });

      if (conflictRes.hasConflict) {
        await t.rollback();
        return res.status(409).json({
          success: false,
          message: `Seat ${conflictRes.conflictingSeat} is already booked`,
          code: 'SEAT_ALREADY_BOOKED',
          data: {
            trip_id: Number(trip.id),
            seat_number: conflictRes.conflictingSeat,
          },
        });
      }
    }

    const effectiveCapacity = trip.vehicle?.total_seats || trip.bus_type?.total_seats || 30;
    const numSeats = total_seats || (requestedSeats.length > 0 ? requestedSeats.length : 1);
    const available = effectiveCapacity - (trip.booked_seats || 0);
    if (available < numSeats) { await t.rollback(); return res.status(409).json({ success: false, message: `Only ${available} seats available` }); }

    const fareResult = await resolveFare({
      routeId: trip.route_id,
      originStopId: origin_stop_id,
      destinationStopId: destination_stop_id,
      fallbackFare: 0,
      transaction: t,
    });
    let total_fare = (fareResult.fare || 0) * (total_seats || 1);
    let discount_amount = 0;
    let appliedCoupon = null;

    if (coupon_id || coupon_code) {
      const couponResult = await calculateCouponDiscount({
        couponId: coupon_id,
        couponCode: coupon_code,
        amount: total_fare,
        seatCount: total_seats || 1,
        passengerId: passenger_id,
        passengerMobile: passenger_mobile,
        deviceId: device_id,
        transaction: t,
        lock: true,
      });
      if (couponResult.error) {
        await t.rollback();
        return res.status(400).json({ success: false, message: couponResult.error });
      }
      appliedCoupon = couponResult.coupon;
      discount_amount = couponResult.discount;
      await appliedCoupon.increment('used_count', { by: 1, transaction: t });
    }

    const final_amount = Math.max(0, total_fare - discount_amount);
    const booking_reference = `BK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const booking = await Booking.create({
      booking_reference, trip_id, passenger_id, passenger_name, passenger_mobile, passenger_email, origin_stop_id, destination_stop_id, travel_date, seat_numbers, total_seats: total_seats || 1, total_fare, discount_amount, final_amount, payment_method, coupon_id: appliedCoupon?.id || null, special_requests, boarding_pass_code: null, boarding_pin: null, booking_status: 'pending', payment_status: final_amount <= 0 ? 'paid' : 'pending', qr_token: null,
    }, { transaction: t });

    if (final_amount <= 0) await confirmPaidBooking({ booking, transaction: t });

    if (appliedCoupon) {
      await CouponUsage.create({
        coupon_id: appliedCoupon.id,
        booking_id: booking.id,
        passenger_id,
        device_id: device_id ? String(device_id).trim() : null,
        discount_amount,
      }, { transaction: t });
    }

    await logAction({ userId: req.user?.id, userType: req.user?.role?.name, userName: req.user?.name, action: 'create', module: 'bookings', entityType: 'Booking', entityId: booking.id, newValues: { booking_reference, trip_id, final_amount }, ipAddress: req.ip, description: `Created booking ${booking_reference}` });

    await t.commit();
    const created = await Booking.findByPk(booking.id, { include: BOOKING_INCLUDE });
    const createdData = created.toJSON();
    // Determine used_by sources
    const used_by = [];
    if (appliedCoupon) used_by.push('coupon');
    if (payment_method && final_amount > 0) used_by.push('payu');
    res.status(201).json({ success: true, message: final_amount <= 0 ? 'Booking confirmed' : 'Booking created and awaiting payment', data: { booking_id: created.id, ...createdData, used_by } });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ── Cancel Booking ─────────────────────────────────────────
exports.cancel = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const booking = await Booking.findByPk(req.params.id, { transaction: t });
    if (!booking) { await t.rollback(); return res.status(404).json({ success: false, message: 'Booking not found' }); }
    if (booking.booking_status === 'cancelled') { await t.rollback(); return res.status(400).json({ success: false, message: 'Booking already cancelled' }); }
    if (booking.booking_status === 'completed') { await t.rollback(); return res.status(409).json({ success: false, message: 'Completed bookings cannot be cancelled' }); }

    const wasSeatAllocated = booking.booking_status === 'confirmed' && booking.payment_status === 'paid';
    const { cancellation_reason } = req.body;
    await booking.update({ booking_status: 'cancelled', status: 'Cancelled', cancellation_reason, cancelled_at: new Date(), cancelled_by: req.user?.id }, { transaction: t });
    await releaseBookingReservation({ bookingId: booking.id, transaction: t });

    const trip = await Trip.findByPk(booking.trip_id, { transaction: t });
    if (trip && wasSeatAllocated) await trip.decrement('booked_seats', { by: booking.total_seats, transaction: t });

    // Auto-create refund if payment was captured
    let refundRecord = null;
    if (booking.payment_status === 'paid' && Number(booking.final_amount) > 0) {
      const passenger = booking.passenger_id
        ? await CustomerUser.findByPk(booking.passenger_id, { transaction: t })
        : await CustomerUser.findOne({ where: { mobile: booking.passenger_mobile }, transaction: t });
      const payment = await Payment.findOne({ where: { booking_id: booking.id, status: ['captured', 'partial_refund'] }, order: [['created_at', 'DESC']], transaction: t });
      const refund_reference = `REF-${Date.now()}`;
      refundRecord = await Refund.create({ booking_id: booking.id, payment_id: payment?.id || null, passenger_id: passenger?.id || booking.passenger_id, refund_reference, refund_amount: booking.final_amount, refund_reason: cancellation_reason || 'Cancelled by admin', status: 'pending', initiated_by: req.user?.id }, { transaction: t });
    }

    await t.commit();
    const responseData = { booking };
    if (refundRecord) responseData.refund = refundRecord;
    res.json({ success: true, message: 'Booking cancelled', data: responseData });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ── Cancelled Bookings ─────────────────────────────────────
exports.cancelledList = async (req, res, next) => {
  try {
    if (hasRole(req.user, 'owner')) {
      return res.status(403).json({ success: false, message: 'Cancelled tickets are not available to owners' });
    }
    const { page, limit, search } = req.query;
    const { offset, limit: lim, page: p } = buildPagination(page, limit);
    const where = { booking_status: 'cancelled' };
    if (search) where[Op.or] = [{ booking_reference: { [Op.like]: `%${search}%` } }, { passenger_name: { [Op.like]: `%${search}%` } }];

    const { count, rows } = await Booking.findAndCountAll({ where, include: [...BOOKING_INCLUDE, { model: Refund, as: 'refunds', attributes: ['id', 'status', 'refund_amount', 'refund_reference', 'refund_method'], separate: true, order: [['created_at', 'DESC']] }], offset, limit: lim, order: [['cancelled_at', 'DESC']] });
    res.json({ success: true, data: rows, pagination: { total: count, page: p, limit: lim, pages: Math.ceil(count / lim) } });
  } catch (err) {
    next(err);
  }
};

// ── Update Booking Payment ─────────────────────────────────
exports.updatePayment = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const booking = await Booking.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!booking) { await t.rollback(); return res.status(404).json({ success: false, message: 'Booking not found' }); }
    const { payment_status, transaction_id, payment_method } = req.body;
    if (booking.booking_status === 'cancelled' && payment_status === 'paid') {
      await t.rollback();
      return res.status(409).json({ success: false, message: 'Cancelled booking cannot be marked paid' });
    }
    const wasPaid = booking.payment_status === 'paid';
    await booking.update({ payment_status, transaction_id, payment_method }, { transaction: t });
    if (payment_status === 'paid') {
      if (!wasPaid && Number(booking.final_amount) > 0) {
        await Payment.create({ booking_id: booking.id, passenger_id: booking.passenger_id, amount: booking.final_amount, payment_method, status: 'captured' }, { transaction: t });
      }
      await confirmPaidBooking({ booking, transaction: t });
    }
    await t.commit();
    res.json({ success: true, message: 'Payment updated', data: booking });
  } catch (err) {
    if (!t.finished) await t.rollback();
    next(err);
  }
};

// ── Track Booking Bus & Boarding Stop ──────────────────────────────
exports.track = async (req, res, next) => {
  try {
    const booking = await Booking.findByPk(req.params.id, {
      include: BOOKING_INCLUDE,
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const bookingData = booking.toJSON();
    const trip = bookingData.trip || {};
    let driver = trip.driver || trip.vehicle?.driver || null;
    let vehicle = trip.vehicle || null;

    // Fallback: If driver is not resolved through associations, query directly
    if (!driver && trip.driver_id) {
      const d = await Driver.findByPk(trip.driver_id, {
        attributes: ['id', 'name', 'mobile', 'online_status', 'photo'],
        include: [{
          model: DriverDetail,
          as: 'details',
          attributes: ['latitude', 'longitude', 'location_speed_kmh', 'location_heading', 'location_trip_id', 'updated_at'],
        }],
      });
      if (d) driver = d.toJSON();
    }
    if (!driver && vehicle?.driver_id) {
      const d = await Driver.findByPk(vehicle.driver_id, {
        attributes: ['id', 'name', 'mobile', 'online_status', 'photo'],
        include: [{
          model: DriverDetail,
          as: 'details',
          attributes: ['latitude', 'longitude', 'location_speed_kmh', 'location_heading', 'location_trip_id', 'updated_at'],
        }],
      });
      if (d) driver = d.toJSON();
    }

    // Fallback: If vehicle is not resolved through associations, query directly
    if (!vehicle && trip.vehicle_id) {
      const v = await Vehicle.findByPk(trip.vehicle_id, {
        attributes: ['id', 'registration_number', 'company_model', 'status', 'latitude', 'longitude', 'total_seats'],
      });
      if (v) vehicle = v.toJSON();
    }

    // Fetch canonical ordered stops using RouteStop junction table
    const tripStops = trip.route_id ? await getOrderedStopsForRoute(trip.route_id, trip.departure_time) : [];

    // Fetch confirmed stoppage arrivals for this trip
    let stopArrivals = trip.stop_arrivals || [];
    if ((!stopArrivals || !stopArrivals.length) && trip.id) {
      const dbArrivals = await TripStopArrival.findAll({
        where: { trip_id: trip.id },
        order: [['arrived_at', 'ASC']],
      });
      if (dbArrivals && dbArrivals.length) {
        stopArrivals = dbArrivals.map(a => a.toJSON ? a.toJSON() : a);
      }
    }

    const arrivalsMap = new Map();
    stopArrivals.forEach((arr) => {
      arrivalsMap.set(Number(arr.stop_id), arr);
    });

    const processedStops = tripStops.map((stop, idx) => {
      const stopId = Number(stop.id || stop.stop_id);
      const arr = arrivalsMap.get(stopId) || null;
      const isReached = Boolean(arr && (arr.status === 'ARRIVED' || arr.status === 'COMPLETED'));
      const isBoarding = stopId === Number(bookingData.origin_stop_id);
      const isDest = stopId === Number(bookingData.destination_stop_id);

      return {
        id: stopId,
        stop_id: stopId,
        stop_name: stop.stop_name,
        stop_code: stop.stop_code || null,
        stop_sequence: stop.stop_sequence != null ? Number(stop.stop_sequence) : idx + 1,
        latitude: stop.latitude != null ? Number(stop.latitude) : null,
        longitude: stop.longitude != null ? Number(stop.longitude) : null,
        address: stop.address || null,
        landmark: stop.landmark || null,
        travel_time_minutes: Number(stop.travel_time_minutes) || 0,
        pickup_time: stop.pickup_time || null,
        dropoff_time: stop.pickup_time || null,
        arrival_time: stop.pickup_time || null,
        scheduled_arrival_time: stop.pickup_time || trip.departure_time || null,
        is_reached: isReached,
        status: arr?.status || 'PENDING',
        arrived_at: arr?.arrived_at || null,
        completed_at: arr?.completed_at || null,
        passengers_boarded: arr?.passengers_boarded || 0,
        is_user_boarding_stop: isBoarding,
        is_user_destination_stop: isDest,
      };
    });

    const pickupStopEntry = processedStops.find(s => Number(s.id) === Number(bookingData.origin_stop_id));
    const dropStopEntry = processedStops.find(s => Number(s.id) === Number(bookingData.destination_stop_id));

    const originStop = bookingData.origin_stop || {};
    const destinationStop = bookingData.destination_stop || {};

    const boardingStop = {
      id: originStop.id || bookingData.origin_stop_id,
      stop_name: originStop.stop_name || 'Pickup Stop',
      stop_code: originStop.stop_code || null,
      latitude: originStop.latitude != null && originStop.latitude !== '' ? Number(originStop.latitude) : null,
      longitude: originStop.longitude != null && originStop.longitude !== '' ? Number(originStop.longitude) : null,
      address: originStop.address || null,
      landmark: originStop.landmark || null,
      pickup_time: pickupStopEntry?.pickup_time || null,
      sequence: pickupStopEntry?.stop_sequence || null,
    };

    const destinationLocation = {
      id: destinationStop.id || bookingData.destination_stop_id,
      stop_name: destinationStop.stop_name || 'Dropoff Stop',
      stop_code: destinationStop.stop_code || null,
      latitude: destinationStop.latitude != null && destinationStop.latitude !== '' ? Number(destinationStop.latitude) : null,
      longitude: destinationStop.longitude != null && destinationStop.longitude !== '' ? Number(destinationStop.longitude) : null,
      address: destinationStop.address || null,
      landmark: destinationStop.landmark || null,
      dropoff_time: dropStopEntry?.dropoff_time || null,
      sequence: dropStopEntry?.stop_sequence || null,
    };

    // Resolve live bus GPS coordinates
    const driverDetail = driver?.details || {};
    let busLatRaw = driverDetail.latitude;
    let busLngRaw = driverDetail.longitude;
    let busSpeedRaw = driverDetail.location_speed_kmh;
    let busHeadingRaw = driverDetail.location_heading;
    let busUpdatedAt = driverDetail.updated_at;

    // If driver coordinates belong to another trip or are empty, check latest TripLocation breadcrumb
    if (trip.id && (busLatRaw == null || busLngRaw == null || (driverDetail.location_trip_id && Number(driverDetail.location_trip_id) !== Number(trip.id)))) {
      const latestBreadcrumb = await TripLocation.findOne({
        where: { trip_id: trip.id },
        order: [['recorded_at', 'DESC'], ['id', 'DESC']],
      });
      if (latestBreadcrumb) {
        busLatRaw = latestBreadcrumb.latitude;
        busLngRaw = latestBreadcrumb.longitude;
        busSpeedRaw = latestBreadcrumb.speed_kmh;
        busHeadingRaw = latestBreadcrumb.heading;
        busUpdatedAt = latestBreadcrumb.recorded_at;
      }
    }

    // Fallback to vehicle coordinates if driver detail is missing
    if (busLatRaw == null || busLngRaw == null) {
      if (vehicle?.latitude != null && vehicle?.longitude != null) {
        busLatRaw = vehicle.latitude;
        busLngRaw = vehicle.longitude;
        busSpeedRaw = 0;
        busHeadingRaw = 0;
        busUpdatedAt = vehicle.updated_at || null;
      }
    }

    const parsedLat = busLatRaw != null && busLatRaw !== '' ? Number(busLatRaw) : null;
    const parsedLng = busLngRaw != null && busLngRaw !== '' ? Number(busLngRaw) : null;
    const hasBusLocation = parsedLat != null && parsedLng != null
      && Number.isFinite(parsedLat) && Number.isFinite(parsedLng)
      && Math.abs(parsedLat) <= 90 && Math.abs(parsedLng) <= 180;

    const busLocation = {
      latitude: hasBusLocation ? parsedLat : null,
      longitude: hasBusLocation ? parsedLng : null,
      speed_kmh: busSpeedRaw != null ? Number(busSpeedRaw) : 0,
      heading: busHeadingRaw != null ? Number(busHeadingRaw) : null,
      updated_at: busUpdatedAt || null,
      driver_name: driver?.name || null,
      driver_mobile: driver?.mobile || null,
      vehicle_registration: vehicle?.registration_number || null,
      vehicle_model: vehicle?.company_model || vehicle?.model || null,
      online_status: driver?.online_status || null,
      has_gps: Boolean(hasBusLocation),
    };

    // Calculate proximity & distance to passenger's pickup stoppage
    let distanceMeters = null;
    let distanceText = 'N/A';
    let trackingStatus = 'NO_GPS';
    let trackingStatusMessage = 'Bus GPS ping unavailable';

    const pickupArr = arrivalsMap.get(Number(bookingData.origin_stop_id)) || null;

    if (trip.status === 'Completed') {
      trackingStatus = 'COMPLETED';
      trackingStatusMessage = 'Trip has completed';
    } else if (trip.status === 'Cancelled') {
      trackingStatus = 'CANCELLED';
      trackingStatusMessage = 'Trip has been cancelled';
    } else if (pickupArr && pickupArr.status === 'COMPLETED') {
      trackingStatus = 'DEPARTED_PICKUP';
      trackingStatusMessage = `Bus has departed Pickup Stop (${boardingStop.stop_name})`;
    } else if (pickupArr && pickupArr.status === 'ARRIVED') {
      trackingStatus = 'ARRIVED';
      trackingStatusMessage = `Bus is at Pickup Stop (${boardingStop.stop_name})`;
    } else if (hasBusLocation && boardingStop.latitude != null && boardingStop.longitude != null) {
      distanceMeters = calculateDistanceMeters(
        busLocation.latitude,
        busLocation.longitude,
        boardingStop.latitude,
        boardingStop.longitude
      );

      if (distanceMeters !== null) {
        if (distanceMeters < 1000) {
          distanceText = `${distanceMeters} m`;
        } else {
          distanceText = `${(distanceMeters / 1000).toFixed(2)} km`;
        }

        if (distanceMeters <= 150) {
          trackingStatus = 'ARRIVED';
          trackingStatusMessage = `Bus HAS ARRIVED at Pickup Stop (${boardingStop.stop_name})`;
        } else if (distanceMeters <= 1000) {
          trackingStatus = 'ARRIVING_SOON';
          trackingStatusMessage = `Bus is ARRIVING SOON (${distanceText} away from ${boardingStop.stop_name})`;
        } else {
          trackingStatus = 'EN_ROUTE';
          trackingStatusMessage = `Bus is EN ROUTE (${distanceText} away from ${boardingStop.stop_name})`;
        }
      }
    } else if (!hasBusLocation) {
      trackingStatusMessage = trip.status === 'Active'
        ? 'Bus trip is in progress. Waiting for driver GPS ping...'
        : `Trip scheduled for ${trip.trip_date || booking.travel_date} at ${trip.departure_time || 'departure time'}`;
    }

    res.json({
      success: true,
      data: {
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        passenger_name: booking.passenger_name,
        passenger_mobile: booking.passenger_mobile,
        passenger_email: booking.passenger_email || booking.passenger?.email || null,
        seat_numbers: booking.seat_numbers,
        total_seats: booking.total_seats,
        total_fare: booking.total_fare,
        booking_status: booking.booking_status,
        payment_status: booking.payment_status,
        boarding_status: booking.boarding_status,
        travel_date: booking.travel_date,
        created_at: booking.created_at,
        trip: {
          id: trip.id,
          schedule_code: trip.schedule_code,
          trip_date: trip.trip_date,
          departure_time: trip.departure_time,
          arrival_time: trip.arrival_time,
          status: trip.status || 'Scheduled',
        },
        route: {
          id: trip.route?.id,
          route_name: trip.route?.route_name,
          route_code: trip.route?.route_code,
          origin_city: trip.route?.origin_city,
          destination_city: trip.route?.destination_city,
        },
        driver: driver ? {
          id: driver.id,
          name: driver.name,
          mobile: driver.mobile,
          online_status: driver.online_status || null,
          is_online: driver.online_status === 'online',
          photo: driver.photo || null,
        } : null,
        vehicle: vehicle ? {
          id: vehicle.id,
          registration_number: vehicle.registration_number,
          company_model: vehicle.company_model || null,
          model: vehicle.company_model || null,
          status: vehicle.status || null,
          total_seats: vehicle.total_seats || null,
        } : null,
        bus_location: busLocation,
        trip_stops: processedStops,
        boarding_stop: boardingStop,
        destination_stop: destinationLocation,
        distance_meters: distanceMeters,
        distance_text: distanceText,
        tracking_status: trackingStatus,
        tracking_status_message: trackingStatusMessage,
        scheduled_pickup_time: pickupStopEntry?.pickup_time || null,
        scheduled_drop_time: dropStopEntry?.dropoff_time || null,
      },
    });
  } catch (err) {
    next(err);
  }
};
