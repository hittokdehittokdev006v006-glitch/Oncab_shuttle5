'use strict';

const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { Trip, Route, Stop, RouteStop, Driver, DriverDetail, Vehicle, BusType, Booking, OwnerApprovalRequest, TripStopArrival, TripLocation } = require('../models');
const { logAction } = require('../middleware/auditLog');
const { hasRole } = require('../utils/roles');
const { releaseUnusedCouponOnTripCompletion } = require('../services/couponReleaseService');
const { getOrderedStopsForRoute } = require('../utils/routeStops');
const { COMPLETION_RADIUS_METERS, checkProximityToStop, getCompletionRadiusMeters } = require('../utils/geoUtils');
const {
  cancelTripPackageBookings,
  settleTripPackageRides,
} = require('../services/packagePurchaseService');

const isOwnerRole = (req) => hasRole(req.user, 'owner');
const ownerCanReadBookings = (req) => (req.userPermissions || []).some((permission) => ['bookings.read', 'bookings.manage'].includes(permission));

const requireOwnerBookingAccess = (req, res) => {
  if (!isOwnerRole(req) || ownerCanReadBookings(req)) return true;
  res.status(403).json({ success: false, message: 'Booking access is required to request assignment changes' });
  return false;
};

const submitOwnerAssignmentRequest = async (req, res, trip) => {
  if (!requireOwnerBookingAccess(req, res)) return;
  const assignmentFields = ['driver_id', 'vehicle_id'];
  const submittedFields = Object.keys(req.body || {});
  if (!submittedFields.some((field) => assignmentFields.includes(field))
    || submittedFields.some((field) => !assignmentFields.includes(field))) {
    return res.status(403).json({ success: false, message: 'Owners can only request trip driver or vehicle changes' });
  }

  const payload = {};
  let ownsCurrentAssignment = false;
  if (trip.driver_id) {
    const currentDriver = await Driver.findByPk(trip.driver_id);
    ownsCurrentAssignment = Number(currentDriver?.owner_id) === Number(req.user.id);
  }
  if (trip.vehicle_id) {
    const currentVehicle = await Vehicle.findByPk(trip.vehicle_id);
    ownsCurrentAssignment = ownsCurrentAssignment || Number(currentVehicle?.owner_id) === Number(req.user.id);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'driver_id')) {
    const driverId = req.body.driver_id ? Number(req.body.driver_id) : null;
    if (driverId) {
      const driver = await Driver.findOne({ where: { id: driverId, owner_id: req.user.id } });
      if (!driver) return res.status(403).json({ success: false, message: 'Select a driver from your own fleet' });
      ownsCurrentAssignment = true;
    }
    payload.driver_id = driverId;
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'vehicle_id')) {
    const vehicleId = req.body.vehicle_id ? Number(req.body.vehicle_id) : null;
    if (vehicleId) {
      const vehicle = await Vehicle.findOne({ where: { id: vehicleId, owner_id: req.user.id } });
      if (!vehicle) return res.status(403).json({ success: false, message: 'Select a vehicle from your own fleet' });
      ownsCurrentAssignment = true;
    }
    payload.vehicle_id = vehicleId;
  }
  if (!ownsCurrentAssignment) {
    return res.status(403).json({ success: false, message: 'This trip is not assigned to your fleet' });
  }

  const approvalRequest = await OwnerApprovalRequest.create({
    owner_id: req.user.id,
    request_type: 'trip_assignment',
    target_id: trip.id,
    payload: JSON.stringify(payload),
  });
  return res.status(202).json({
    success: true,
    message: 'Trip assignment request sent to admin for approval',
    data: approvalRequest,
  });
};

const buildPagination = (page, limit) => {
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit) || 15));
  return { offset: (p - 1) * l, limit: l, page: p };
};

const TRIP_INCLUDE = [
  { model: Route, as: 'route', attributes: ['id', 'route_name', 'route_code', 'origin_city', 'destination_city'] },
  { model: Driver, as: 'driver', attributes: ['id', 'owner_id', 'name', 'mobile', 'photo'] },
  { model: Vehicle, as: 'vehicle', attributes: ['id', 'owner_id', 'registration_number', 'company_model', 'color', 'total_seats'] },
  { model: BusType, as: 'bus_type', attributes: ['id', 'name', 'total_seats'] },
];

const TRIP_DETAILS_INCLUDE = [
  {
    model: Route,
    as: 'route',
    attributes: ['id', 'route_name', 'route_code', 'origin_city', 'destination_city'],
  },
  ...TRIP_INCLUDE.filter((include) => include.as !== 'route'),
];

const scopeTripIncludes = (req, includes) => includes.map((include) => {
  if (!isOwnerRole(req) || !['driver', 'vehicle'].includes(include.as)) return include;
  const Model = include.as === 'driver' ? Driver : Vehicle;
  return { ...include, model: Model, where: { owner_id: req.user.id }, required: false };
});

// ── Helper to normalize date string to YYYY-MM-DD ──────────
const normalizeDateStr = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') return dateStr;
  const str = dateStr.trim();
  const parts = str.split(/[-/]/).map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    let y, m, d;
    if (parts[0] >= 1000) {
      // YYYY-MM-DD format
      y = parts[0]; m = parts[1]; d = parts[2];
    } else if (parts[2] >= 1000) {
      // DD-MM-YYYY format
      y = parts[2]; m = parts[1]; d = parts[0];
    }
    if (y && m && d) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return str;
};

// ── Helper to parse date string into local Date object ───────
const parseLocalDate = (dateStr) => {
  const norm = normalizeDateStr(dateStr);
  if (!norm || typeof norm !== 'string') return new Date();
  const parts = norm.split('-').map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return new Date(norm);
};

// ── Helper to check if a date matches operating_days ─────────
const isOperatingDay = (dateObj, operatingDays) => {
  if (!operatingDays) return true;
  const str = String(operatingDays).toLowerCase().trim();
  if (str === 'daily' || str === 'all' || str === '7' || str === '1,2,3,4,5,6,7') return true;

  const dayOfWeek = dateObj.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek;
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayName = dayNames[dayOfWeek];

  if (str === 'weekdays' && isoDay >= 1 && isoDay <= 5) return true;
  if (str === 'weekends' && (isoDay === 6 || isoDay === 7)) return true;

  const tokens = str.split(/[,;\s]+/).map((s) => s.trim());
  return tokens.includes(String(isoDay)) || tokens.includes(String(dayOfWeek)) || tokens.includes(dayName);
};

// ── Helper to ensure trip instances exist for a date range ────
const ensureTripInstancesForRange = async (startStr, endStr) => {
  try {
    const normStart = normalizeDateStr(startStr);
    const normEnd = normalizeDateStr(endStr || startStr);
    const startDateObj = parseLocalDate(normStart);
    const endDateObj = parseLocalDate(normEnd);
    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) return;

    // Limit maximum auto-generation window per request to 60 days
    const maxEnd = new Date(startDateObj.getTime() + 60 * 24 * 60 * 60 * 1000);
    const finalEnd = endDateObj > maxEnd ? maxEnd : endDateObj;

    const masterSchedules = await Trip.findAll({
      where: {
        status: { [Op.notIn]: ['Cancelled', 'Completed', 'Inactive'] },
        [Op.or]: [
          { notes: null },
          { notes: { [Op.notLike]: 'Generated%' } },
        ],
      },
    });

    if (masterSchedules.length === 0) return;

    const curr = new Date(startDateObj);
    while (curr <= finalEnd) {
      const year = curr.getFullYear();
      const month = String(curr.getMonth() + 1).padStart(2, '0');
      const day = String(curr.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      for (const master of masterSchedules) {
        if (master.valid_from && dateStr < master.valid_from) continue;
        if (master.valid_until && dateStr > master.valid_until) continue;

        if (master.operating_days) {
          if (!isOperatingDay(curr, master.operating_days)) continue;
        } else if (master.trip_date) {
          const masterDayOfWeek = parseLocalDate(master.trip_date).getDay();
          if (curr.getDay() !== masterDayOfWeek) continue;
        }

        const existing = await Trip.findOne({
          paranoid: false,
          where: {
            [Op.or]: [
              { schedule_code: master.schedule_code, trip_date: dateStr },
              { route_id: master.route_id, departure_time: master.departure_time, trip_date: dateStr },
            ],
          },
        });

        if (!existing) {
          await Trip.create({
            schedule_code: master.schedule_code,
            route_id: master.route_id,
            bus_type_id: master.bus_type_id,
            departure_time: master.departure_time,
            arrival_time: master.arrival_time,
            operating_days: master.operating_days,
            trip_date: dateStr,
            valid_from: master.valid_from,
            valid_until: master.valid_until,
            driver_id: master.driver_id,
            vehicle_id: master.vehicle_id,
            status: 'Scheduled',
            notes: master.notes ? `Generated from master schedule: ${master.notes}` : `Generated trip for ${dateStr}`,
          });
        }
      }

      curr.setDate(curr.getDate() + 1);
    }
  } catch (err) {
    console.error('ensureTripInstancesForRange error:', err);
  }
};

// ── List Trips ─────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    let { page, limit, search, status, route_id, driver_id, trip_date, from_date, to_date } = req.query;

    if (trip_date) trip_date = normalizeDateStr(trip_date);
    if (from_date) from_date = normalizeDateStr(from_date);
    if (to_date) to_date = normalizeDateStr(to_date);

    // Note: Do not auto-generate trips on list/GET queries to ensure deleted trips remain deleted.
    // Trip instances should only be generated explicitly via exports.generateFutureTrips.

    const { offset, limit: lim, page: p } = buildPagination(page, limit);
    const where = {};
    if (search) {
      where[Op.or] = [
        { schedule_code: { [Op.like]: `%${search}%` } },
        { '$route.route_name$': { [Op.like]: `%${search}%` } },
        { '$driver.name$': { [Op.like]: `%${search}%` } },
      ];
    }
    if (status) {
      if (status.toLowerCase() !== 'all') {
        where.status = status;
      }
    } else {
      where.status = { [Op.notIn]: ['Cancelled', 'cancelled'] };
    }
    if (route_id) where.route_id = route_id;
    if (driver_id) where.driver_id = driver_id;
    if (trip_date) where.trip_date = trip_date;
    if (from_date && to_date) where.trip_date = { [Op.between]: [from_date, to_date] };
    if (from_date && !to_date) where.trip_date = { [Op.gte]: from_date };
    if (to_date && !from_date) where.trip_date = { [Op.lte]: to_date };

    if (isOwnerRole(req)) {
      const [ownedDrivers, ownedVehicles] = await Promise.all([
        Driver.findAll({ attributes: ['id'], where: { owner_id: req.user.id }, raw: true }),
        Vehicle.findAll({ attributes: ['id'], where: { owner_id: req.user.id }, raw: true }),
      ]);
      const ownerCond = {
        [Op.or]: [
          { driver_id: { [Op.in]: ownedDrivers.map((driver) => driver.id) } },
          { vehicle_id: { [Op.in]: ownedVehicles.map((vehicle) => vehicle.id) } },
        ],
      };
      if (where[Op.and]) {
        where[Op.and].push(ownerCond);
      } else {
        where[Op.and] = [ownerCond];
      }
    }

    const [allMatchingTrips, pageResult] = await Promise.all([
      Trip.findAll({
        where,
        include: scopeTripIncludes(req, TRIP_INCLUDE),
        attributes: ['id', 'vehicle_id', 'bus_type_id', 'booked_seats'],
      }),
      Trip.findAndCountAll({
        where,
        include: scopeTripIncludes(req, TRIP_INCLUDE),
        distinct: true,
        offset, limit: lim,
        order: [['trip_date', 'DESC'], ['departure_time', 'ASC']],
      }),
    ]);
    const count = pageResult.count;
    const rows = pageResult.rows;

    // Compute summary across ALL matching trips (not just current pagination page)
    const allMatchingTripIds = allMatchingTrips.map((t) => t.id);
    const uniqueVehiclesSet = new Set(allMatchingTrips.map((t) => t.vehicle_id).filter(Boolean));
    const totalVehiclesCount = uniqueVehiclesSet.size;

    let allBookingsMap = {};
    if (allMatchingTripIds.length > 0) {
      const allBookingCounts = await Booking.findAll({
        attributes: ['trip_id', [sequelize.fn('SUM', sequelize.col('total_seats')), 'total_booked']],
        where: {
          trip_id: { [Op.in]: allMatchingTripIds },
          booking_status: 'confirmed',
          payment_status: 'paid',
          status: { [Op.notIn]: ['Cancelled', 'cancelled', 'CANCELLED', 'Payment Failed'] },
        },
        group: ['trip_id'],
        raw: true,
      });
      allBookingCounts.forEach((b) => {
        allBookingsMap[b.trip_id] = Number(b.total_booked || 0);
      });
    }

    let summarySeatsBooked = 0;
    let summaryTotalCapacity = 0;
    allMatchingTrips.forEach((t) => {
      const item = t.toJSON ? t.toJSON() : t;
      const cap = Number(
        item.vehicle?.total_seats
        || item.bus_type?.total_seats
        || 40
      );
      summaryTotalCapacity += cap;
      const bSeats = allBookingsMap[item.id] !== undefined ? allBookingsMap[item.id] : Number(item.booked_seats || 0);
      summarySeatsBooked += bSeats;
    });

    const summaryFillRate = summaryTotalCapacity > 0 ? ((summarySeatsBooked / summaryTotalCapacity) * 100).toFixed(2) : '0.00';
    const avgFare = 80.63;
    const summaryGrossRevenue = (summarySeatsBooked * avgFare).toFixed(2);
    const summaryGstAmount = (parseFloat(summaryGrossRevenue) * 0.05).toFixed(2);
    const summaryNetRevenue = (parseFloat(summaryGrossRevenue) - parseFloat(summaryGstAmount)).toFixed(2);

    const tripIds = rows.map((t) => t.id);
    let bookingMap = {};
    if (tripIds.length > 0) {
      const bookingCounts = await Booking.findAll({
        attributes: ['trip_id', [sequelize.fn('SUM', sequelize.col('total_seats')), 'total_booked']],
        where: {
          trip_id: { [Op.in]: tripIds },
          booking_status: 'confirmed',
          payment_status: 'paid',
          status: { [Op.notIn]: ['Cancelled', 'cancelled', 'CANCELLED', 'Payment Failed'] },
        },
        group: ['trip_id'],
        raw: true,
      });
      bookingCounts.forEach((b) => {
        bookingMap[b.trip_id] = Number(b.total_booked || 0);
      });
    }

    // Fetch route stops and arrivals for accurate last stoppage timings
    const routeIds = [...new Set(rows.map((t) => t.route_id).filter(Boolean))];
    let routeLastStopsMap = {};
    if (routeIds.length > 0) {
      try {
        const allRouteStops = await RouteStop.findAll({
          where: { route_id: { [Op.in]: routeIds } },
          include: [{ model: Stop, as: 'stop', attributes: ['id', 'stop_name'] }],
          order: [['route_id', 'ASC'], ['stop_sequence', 'ASC']],
        });

        // Group by route_id and calculate cumulative travel time to get last stop info
        const stopsByRoute = {};
        allRouteStops.forEach((rs) => {
          if (!stopsByRoute[rs.route_id]) stopsByRoute[rs.route_id] = [];
          stopsByRoute[rs.route_id].push(rs);
        });

        Object.keys(stopsByRoute).forEach((rId) => {
          const stops = stopsByRoute[rId];
          if (stops.length > 0) {
            let totalTravelMins = 0;
            stops.forEach((s) => {
              totalTravelMins += Number(s.travel_time_minutes) || 0;
            });
            const lastStop = stops[stops.length - 1];
            routeLastStopsMap[rId] = {
              last_stop_id: lastStop.stop_id,
              last_stop_name: lastStop.stop?.stop_name || 'Last Stop',
              total_travel_minutes: totalTravelMins,
            };
          }
        });
      } catch (err) {
        console.warn('Error fetching route stops for trip list:', err.message);
      }
    }

    // Fetch actual last stoppage arrival recorded by driver (from trip_stop_arrivals)
    let actualLastArrivalMap = {};
    if (tripIds.length > 0) {
      try {
        const stopArrivals = await TripStopArrival.findAll({
          where: { trip_id: { [Op.in]: tripIds } },
          order: [['stop_sequence', 'DESC'], ['arrived_at', 'DESC']],
        });
        stopArrivals.forEach((arr) => {
          if (!actualLastArrivalMap[arr.trip_id]) {
            actualLastArrivalMap[arr.trip_id] = {
              stop_id: arr.stop_id,
              stop_name: arr.stop_name,
              arrived_at: arr.arrived_at,
              completed_at: arr.completed_at,
              status: arr.status,
            };
          }
        });
      } catch (err) {
        console.warn('Error fetching trip stop arrivals for trip list:', err.message);
      }
    }

    const fmt12hFromMins = (totalMinutes) => {
      let tot = (totalMinutes) % (24 * 60);
      if (tot < 0) tot += 24 * 60;
      const h24 = Math.floor(tot / 60);
      const mn = tot % 60;
      const ap = h24 >= 12 ? 'PM' : 'AM';
      const h12 = h24 % 12 || 12;
      return `${h12}:${String(mn).padStart(2, '0')} ${ap}`;
    };

    const getMinsFromMidnight = (ts) => {
      if (!ts || typeof ts !== 'string') return null;
      const p = ts.split(':');
      if (p.length < 2) return null;
      return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
    };

    const formattedRows = rows.map((trip) => {
      const item = trip.toJSON();
      const cap = Number(
        item.vehicle?.total_seats
        || item.bus_type?.total_seats
        || item.seat_capacity
        || 40
      );
      item.seat_capacity = cap;
      item.booked_seats = bookingMap[item.id] !== undefined ? bookingMap[item.id] : Number(item.booked_seats || 0);

      // Scheduled last stoppage time calculation
      const lastStopInfo = routeLastStopsMap[item.route_id];
      let scheduledLastStopTime = null;
      let scheduledLastStopName = lastStopInfo?.last_stop_name || null;
      if (item.arrival_time) {
        const arrivalMins = getMinsFromMidnight(item.arrival_time);
        if (arrivalMins !== null) scheduledLastStopTime = fmt12hFromMins(arrivalMins);
      } else if (item.departure_time && lastStopInfo) {
        const depMins = getMinsFromMidnight(item.departure_time);
        if (depMins !== null) {
          const expectedArrivalMins = depMins + (lastStopInfo.total_travel_minutes || 0);
          scheduledLastStopTime = fmt12hFromMins(expectedArrivalMins);
        }
      }

      item.last_stop_name = scheduledLastStopName;
      item.scheduled_last_stop_time = scheduledLastStopTime;
      item.actual_last_stop_arrival = actualLastArrivalMap[item.id] || null;

      // Completion analysis: Check if driver clicked Complete prematurely or suspicious timing
      let completionAudit = {
        is_completed: item.status === 'Completed',
        completed_at: item.completed_at || null,
        scheduled_arrival: scheduledLastStopTime,
        actual_last_reach_at: actualLastArrivalMap[item.id]?.arrived_at || null,
        time_diff_minutes: null,
        audit_flag: 'Normal', // 'On-Time', 'Early / Suspect', 'Delayed', 'No Data'
      };

      if (item.completed_at) {
        const completedDate = new Date(item.completed_at);
        if (actualLastArrivalMap[item.id]?.arrived_at) {
          const lastReachDate = new Date(actualLastArrivalMap[item.id].arrived_at);
          const diffMs = completedDate.getTime() - lastReachDate.getTime();
          completionAudit.reach_to_complete_diff_mins = Math.round(diffMs / 60000);
        }

        // Compare completed_at against scheduled last stop time if trip_date matches
        if (scheduledLastStopTime && item.trip_date && item.departure_time) {
          const depMins = getMinsFromMidnight(item.departure_time);
          const lastStopMins = lastStopInfo?.total_travel_minutes || 0;
          const expectedMinsFromMidnight = (depMins || 0) + lastStopMins;
          
          const completedMinsFromMidnight = completedDate.getHours() * 60 + completedDate.getMinutes();
          const diffMinutes = completedMinsFromMidnight - expectedMinsFromMidnight;
          completionAudit.time_diff_minutes = diffMinutes;

          if (diffMinutes < -15) {
            completionAudit.audit_flag = 'Suspiciously Early';
          } else if (diffMinutes > 30) {
            completionAudit.audit_flag = 'Delayed';
          } else {
            completionAudit.audit_flag = 'On-Time';
          }
        }
      }

      item.completion_audit = completionAudit;

      return item;
    });

    res.json({
      success: true,
      data: formattedRows,
      pagination: { total: count, page: p, limit: lim, pages: Math.ceil(count / lim) },
      summary: {
        total_trips: count,
        total_vehicles: totalVehiclesCount,
        total_seats_booked: summarySeatsBooked,
        total_capacity: summaryTotalCapacity,
        fill_rate: summaryFillRate,
        net_revenue: summaryNetRevenue,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Get Trip ───────────────────────────────────────────────
exports.show = async (req, res, next) => {
  try {
    const trip = await Trip.findByPk(req.params.id, { include: scopeTripIncludes(req, TRIP_DETAILS_INCLUDE) });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found' });
    if (isOwnerRole(req)) {
      if (!ownerCanReadBookings(req)) {
        return res.status(403).json({ success: false, message: 'Booking access is required to view trip details' });
      }
      const ownsDriver = trip.driver && Number(trip.driver.owner_id) === Number(req.user.id);
      const ownsVehicle = trip.vehicle && Number(trip.vehicle.owner_id) === Number(req.user.id);
      if (!ownsDriver && !ownsVehicle) return res.status(403).json({ success: false, message: 'This trip is not assigned to your fleet' });
    }
    const bookingsCount = await Booking.count({ where: { trip_id: trip.id, booking_status: 'confirmed', payment_status: 'paid' } });
    const bookingSum = await Booking.sum('total_seats', {
      where: {
        trip_id: trip.id,
        booking_status: 'confirmed',
        payment_status: 'paid',
        status: { [Op.notIn]: ['Cancelled', 'cancelled', 'CANCELLED', 'Payment Failed'] },
      },
    });
    const item = trip.toJSON();
    item.seat_capacity = Number(
      item.vehicle?.total_seats
      || item.bus_type?.total_seats
      || item.seat_capacity
      || 40
    );
    item.booked_seats = bookingSum !== null && !isNaN(bookingSum) ? Number(bookingSum) : Number(item.booked_seats || 0);

    const { getOrderedStopsForRoute } = require('../utils/routeStops');
    if (item.route?.id) {
      const canonicalStops = await getOrderedStopsForRoute(item.route.id, item.departure_time);
      if (canonicalStops && canonicalStops.length > 0) {
        item.route.stops = canonicalStops;
      }
    }

    // Load driver breadcrumb locations and stoppage arrivals
    const [locations, stopArrivals] = await Promise.all([
      TripLocation.findAll({
        where: { trip_id: trip.id },
        order: [['recorded_at', 'ASC']],
        limit: 3000,
        attributes: ['id', 'latitude', 'longitude', 'speed_kmh', 'heading', 'accuracy', 'battery_level', 'recorded_at'],
      }),
      TripStopArrival.findAll({
        where: { trip_id: trip.id },
        order: [['arrived_at', 'ASC']],
      }),
    ]);
    // Scheduled last stoppage time & stop name calculation
    let scheduledLastStopTime = null;
    let scheduledLastStopName = null;
    let actualLastStopArrival = null;

    if (item.route?.stops && item.route.stops.length > 0) {
      const lastStop = item.route.stops[item.route.stops.length - 1];
      scheduledLastStopName = lastStop.stop_name || lastStop.name || null;
      if (lastStop.pickup_time || lastStop.scheduled_arrival_time) {
        const timeVal = lastStop.pickup_time || lastStop.scheduled_arrival_time;
        // Format to 12h AM/PM if in HH:mm:ss format
        const parts = String(timeVal).split(':');
        if (parts.length >= 2) {
          const h = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          const ap = h >= 12 ? 'PM' : 'AM';
          const h12 = h % 12 || 12;
          scheduledLastStopTime = `${h12}:${String(m).padStart(2, '0')} ${ap}`;
        } else {
          scheduledLastStopTime = timeVal;
        }
      }
    }

    if (!scheduledLastStopTime && item.arrival_time) {
      const parts = String(item.arrival_time).split(':');
      if (parts.length >= 2) {
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const ap = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        scheduledLastStopTime = `${h12}:${String(m).padStart(2, '0')} ${ap}`;
      } else {
        scheduledLastStopTime = item.arrival_time;
      }
    }

    if (stopArrivals && stopArrivals.length > 0) {
      const sortedArrivals = [...stopArrivals].sort((a, b) => (Number(b.stop_sequence || 0) - Number(a.stop_sequence || 0)));
      const lastArr = sortedArrivals[0];
      if (lastArr) {
        actualLastStopArrival = {
          stop_id: lastArr.stop_id,
          stop_name: lastArr.stop_name,
          arrived_at: lastArr.arrived_at,
          completed_at: lastArr.completed_at,
          status: lastArr.status,
        };
      }
    }

    item.scheduled_last_stop_time = scheduledLastStopTime;
    item.last_stop_name = scheduledLastStopName;
    item.actual_last_stop_arrival = actualLastStopArrival;

    res.json({ success: true, data: { ...item, bookings_count: bookingsCount } });
  } catch (err) {
    next(err);
  }
};

exports.assignmentOptions = async (req, res, next) => {
  try {
    if (!isOwnerRole(req)) {
      return res.status(403).json({ success: false, message: 'Owner role required' });
    }
    const [drivers, vehicles] = await Promise.all([
      Driver.findAll({
        attributes: ['id', 'name', 'mobile'],
        where: { owner_id: req.user.id },
        order: [['name', 'ASC']],
      }),
      Vehicle.findAll({
        attributes: ['id', 'registration_number', 'company_model', 'bus_type_id'],
        where: { owner_id: req.user.id },
        include: [{ model: BusType, as: 'bus_type', attributes: ['id', 'name'] }],
        order: [['registration_number', 'ASC']],
      }),
    ]);
    return res.json({ success: true, data: { drivers, vehicles } });
  } catch (err) {
    return next(err);
  }
};

// ── Core Function: Generate/Update Individual Daily Trip Rows for Date Range ──
const processTripDateRange = async ({
  scheduleCode,
  routeId,
  busTypeId,
  driverId,
  vehicleId,
  departureTime,
  arrivalTime,
  operatingDays,
  validFrom,
  validUntil,
  singleTripDate,
  status = 'Scheduled',
  notes = null,
  seatCapacity = 40,
  transaction,
}) => {
  const normValidFrom = normalizeDateStr(validFrom || singleTripDate || new Date().toISOString().split('T')[0]);
  const normValidUntil = normalizeDateStr(validUntil || normValidFrom);

  const startObj = parseLocalDate(normValidFrom);
  const endObj = parseLocalDate(normValidUntil);

  if (isNaN(startObj.getTime()) || isNaN(endObj.getTime())) {
    throw new Error('Invalid valid_from or valid_until date format');
  }

  // Find all existing trips belonging to this schedule_code
  const existingTrips = await Trip.findAll({
    where: { schedule_code: scheduleCode },
    transaction,
  });

  const existingMap = new Map();
  existingTrips.forEach((t) => {
    if (t.trip_date) {
      existingMap.set(normalizeDateStr(t.trip_date), t);
    }
  });

  const targetDates = new Set();
  const resultTrips = [];

  const curr = new Date(startObj);
  while (curr <= endObj) {
    const year = curr.getFullYear();
    const month = String(curr.getMonth() + 1).padStart(2, '0');
    const day = String(curr.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    if (isOperatingDay(curr, operatingDays)) {
      targetDates.add(dateStr);

      if (existingMap.has(dateStr)) {
        // Update existing trip record for this date (preserves unique ID and booked seats)
        const existingTrip = existingMap.get(dateStr);
        await existingTrip.update(
          {
            route_id: routeId,
            bus_type_id: busTypeId,
            driver_id: driverId,
            vehicle_id: vehicleId,
            departure_time: departureTime,
            arrival_time: arrivalTime,
            operating_days: String(curr.getDay() === 0 ? 7 : curr.getDay()),
            valid_from: normValidFrom,
            valid_until: normValidUntil,
            seat_capacity: seatCapacity,
            status: status,
            notes: notes !== undefined ? notes : existingTrip.notes,
          },
          { transaction }
        );
        resultTrips.push(existingTrip);
      } else {
        // Check duplicate by schedule_code + trip_date or route_id + departure_time + trip_date
        const duplicateCheck = await Trip.findOne({
          where: {
            [Op.or]: [
              { schedule_code: scheduleCode, trip_date: dateStr },
              { route_id: routeId, departure_time: departureTime, trip_date: dateStr },
            ],
          },
          transaction,
        });

        if (!duplicateCheck) {
          const newTrip = await Trip.create(
            {
              schedule_code: scheduleCode,
              route_id: routeId,
              bus_type_id: busTypeId,
              driver_id: driverId,
              vehicle_id: vehicleId,
              departure_time: departureTime,
              arrival_time: arrivalTime,
              operating_days: String(curr.getDay() === 0 ? 7 : curr.getDay()),
              trip_date: dateStr,
              valid_from: normValidFrom,
              valid_until: normValidUntil,
              seat_capacity: seatCapacity,
              status: status,
              notes: notes,
            },
            { transaction }
          );
          resultTrips.push(newTrip);
        } else {
          // If duplicate exists under route/time, update its details
          await duplicateCheck.update(
            {
              schedule_code: scheduleCode,
              driver_id: driverId,
              vehicle_id: vehicleId,
              bus_type_id: busTypeId,
              operating_days: String(curr.getDay() === 0 ? 7 : curr.getDay()),
              valid_from: normValidFrom,
              valid_until: normValidUntil,
              seat_capacity: seatCapacity,
              status: status,
            },
            { transaction }
          );
          resultTrips.push(duplicateCheck);
        }
      }
    }

    curr.setDate(curr.getDate() + 1);
  }

  // Remove / Cancel trips for dates no longer part of the range / operating days
  for (const [dateStr, oldTrip] of existingMap.entries()) {
    if (!targetDates.has(dateStr)) {
      const bookingCount = await Booking.count({
        where: { trip_id: oldTrip.id, booking_status: { [Op.ne]: 'cancelled' } },
        transaction,
      });

      if (bookingCount === 0) {
        await oldTrip.destroy({ transaction });
      } else {
        await oldTrip.update({ status: 'Cancelled' }, { transaction });
        await cancelTripPackageBookings({ trip: oldTrip, transaction });
      }
    }
  }

  return resultTrips;
};

// ── Create Trip ────────────────────────────────────────────
exports.create = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    if (isOwnerRole(req)) {
      await t.rollback();
      return res.status(403).json({ success: false, message: 'Owners cannot create trips directly' });
    }

    let {
      schedule_code,
      route_id,
      bus_type_id,
      departure_time,
      arrival_time,
      operating_days,
      trip_date,
      valid_from,
      valid_until,
      driver_id,
      vehicle_id,
      notes,
      seat_capacity,
      status = 'Scheduled',
    } = req.body;

    const targetDate = normalizeDateStr(trip_date || valid_from || new Date().toISOString().split('T')[0]);
    const endDate = valid_until ? normalizeDateStr(valid_until) : targetDate;

    if (!schedule_code) {
      schedule_code = `SCH-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    if (!bus_type_id && vehicle_id) {
      const vehicle = await Vehicle.findByPk(vehicle_id, { transaction: t });
      if (vehicle && vehicle.bus_type_id) {
        bus_type_id = vehicle.bus_type_id;
      }
    }

    // Single Date Creation (when valid_until is not specified or equals targetDate)
    if (!valid_until || endDate === targetDate) {
      const duplicateCheck = await Trip.findOne({
        where: {
          [Op.or]: [
            { schedule_code, trip_date: targetDate },
            { route_id: parseInt(route_id), departure_time, trip_date: targetDate },
          ],
        },
        transaction: t,
      });

      let trip;
      if (duplicateCheck) {
        await duplicateCheck.update({
          schedule_code,
          route_id: parseInt(route_id),
          bus_type_id: bus_type_id ? parseInt(bus_type_id) : null,
          driver_id: driver_id ? parseInt(driver_id) : null,
          vehicle_id: vehicle_id ? parseInt(vehicle_id) : null,
          departure_time,
          arrival_time: arrival_time || null,
          operating_days: operating_days ? (Array.isArray(operating_days) ? operating_days.join(',') : String(operating_days)) : String(parseLocalDate(targetDate).getDay() === 0 ? 7 : parseLocalDate(targetDate).getDay()),
          trip_date: targetDate,
          valid_from: targetDate,
          valid_until: targetDate,
          seat_capacity: seat_capacity ? parseInt(seat_capacity) : 40,
          status,
          notes: notes !== undefined ? notes : duplicateCheck.notes,
        }, { transaction: t });
        trip = duplicateCheck;
      } else {
        trip = await Trip.create({
          schedule_code,
          route_id: parseInt(route_id),
          bus_type_id: bus_type_id ? parseInt(bus_type_id) : null,
          driver_id: driver_id ? parseInt(driver_id) : null,
          vehicle_id: vehicle_id ? parseInt(vehicle_id) : null,
          departure_time,
          arrival_time: arrival_time || null,
          operating_days: operating_days ? (Array.isArray(operating_days) ? operating_days.join(',') : String(operating_days)) : String(parseLocalDate(targetDate).getDay() === 0 ? 7 : parseLocalDate(targetDate).getDay()),
          trip_date: targetDate,
          valid_from: targetDate,
          valid_until: targetDate,
          seat_capacity: seat_capacity ? parseInt(seat_capacity) : 40,
          status,
          notes,
        }, { transaction: t });
      }

      await logAction({
        userId: req.user?.id,
        userType: req.user?.role?.name,
        userName: req.user?.name,
        action: 'create',
        module: 'trips',
        entityType: 'Trip',
        entityId: trip.id,
        newValues: { schedule_code, trip_date: targetDate },
        ipAddress: req.ip,
        description: `Created trip record for schedule ${schedule_code} on ${targetDate}`,
      });

      await t.commit();

      const fullTrip = await Trip.findByPk(trip.id, {
        include: scopeTripIncludes(req, TRIP_INCLUDE),
      });

      return res.status(201).json({
        success: true,
        message: `Trip created successfully for ${targetDate}`,
        data: fullTrip,
      });
    }

    // Range Creation (if valid_until is explicitly provided as a range)
    const createdTrips = await processTripDateRange({
      scheduleCode: schedule_code,
      routeId: parseInt(route_id),
      busTypeId: bus_type_id ? parseInt(bus_type_id) : null,
      driverId: driver_id ? parseInt(driver_id) : null,
      vehicleId: vehicle_id ? parseInt(vehicle_id) : null,
      departureTime: departure_time,
      arrivalTime: arrival_time || null,
      operatingDays: '1,2,3,4,5,6,7',
      validFrom: targetDate,
      validUntil: endDate,
      singleTripDate: targetDate,
      status,
      notes,
      seatCapacity: seat_capacity ? parseInt(seat_capacity) : 40,
      transaction: t,
    });

    await logAction({
      userId: req.user?.id,
      userType: req.user?.role?.name,
      userName: req.user?.name,
      action: 'create',
      module: 'trips',
      entityType: 'Trip',
      entityId: createdTrips[0]?.id || null,
      newValues: { schedule_code, total_generated: createdTrips.length },
      ipAddress: req.ip,
      description: `Created ${createdTrips.length} daily trip record(s) for schedule ${schedule_code}`,
    });

    await t.commit();

    const tripIds = createdTrips.map((tr) => tr.id);
    const fullTrips = await Trip.findAll({
      where: { id: { [Op.in]: tripIds } },
      include: scopeTripIncludes(req, TRIP_INCLUDE),
      order: [['trip_date', 'ASC']],
    });

    res.status(201).json({
      success: true,
      message: `Created ${fullTrips.length} trip record(s) for date range`,
      data: fullTrips.length === 1 ? fullTrips[0] : fullTrips,
      count: fullTrips.length,
    });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ── Update Trip ────────────────────────────────────────────
exports.update = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    if (!requireOwnerBookingAccess(req, res)) {
      await t.rollback();
      return;
    }

    const targetTrip = await Trip.findByPk(req.params.id, { transaction: t });
    if (!targetTrip) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Trip not found' });
    }

    if (isOwnerRole(req)) {
      await t.rollback();
      return submitOwnerAssignmentRequest(req, res, targetTrip);
    }

    const payload = { ...req.body };
    const scheduleCode = payload.schedule_code || targetTrip.schedule_code;
    const targetDate = normalizeDateStr(payload.trip_date || payload.valid_from || targetTrip.trip_date || targetTrip.valid_from || new Date().toISOString().split('T')[0]);
    const endDate = payload.valid_until ? normalizeDateStr(payload.valid_until) : targetDate;

    if (!payload.bus_type_id && payload.vehicle_id) {
      const vehicle = await Vehicle.findByPk(payload.vehicle_id, { transaction: t });
      if (vehicle && vehicle.bus_type_id) {
        payload.bus_type_id = vehicle.bus_type_id;
      }
    }

    const updatedTrips = await processTripDateRange({
      scheduleCode,
      routeId: payload.route_id ? parseInt(payload.route_id) : targetTrip.route_id,
      busTypeId: payload.bus_type_id !== undefined ? payload.bus_type_id : targetTrip.bus_type_id,
      driverId: payload.driver_id !== undefined ? (payload.driver_id ? parseInt(payload.driver_id) : null) : targetTrip.driver_id,
      vehicleId: payload.vehicle_id !== undefined ? (payload.vehicle_id ? parseInt(payload.vehicle_id) : null) : targetTrip.vehicle_id,
      departureTime: payload.departure_time || targetTrip.departure_time,
      arrivalTime: payload.arrival_time !== undefined ? payload.arrival_time : targetTrip.arrival_time,
      operatingDays: '1,2,3,4,5,6,7',
      validFrom: targetDate,
      validUntil: endDate,
      singleTripDate: targetDate,
      status: payload.status || targetTrip.status || 'Scheduled',
      notes: payload.notes !== undefined ? payload.notes : targetTrip.notes,
      seatCapacity: payload.seat_capacity ? parseInt(payload.seat_capacity) : targetTrip.seat_capacity,
      transaction: t,
    });

    await logAction({
      userId: req.user?.id,
      userType: req.user?.role?.name,
      userName: req.user?.name,
      action: 'update',
      module: 'trips',
      entityType: 'Trip',
      entityId: targetTrip.id,
      newValues: { schedule_code: scheduleCode, updated_count: updatedTrips.length },
      ipAddress: req.ip,
      description: `Updated/Generated ${updatedTrips.length} trips for schedule ${scheduleCode}`,
    });

    await t.commit();

    const tripIds = updatedTrips.map((tr) => tr.id);
    const fullTrips = await Trip.findAll({
      where: { id: { [Op.in]: tripIds } },
      include: scopeTripIncludes(req, TRIP_INCLUDE),
      order: [['trip_date', 'ASC']],
    });

    res.json({
      success: true,
      message: 'Trip updated successfully',
      data: fullTrips.length === 1 ? fullTrips[0] : fullTrips,
    });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ── Delete Trip ────────────────────────────────────────────
exports.destroy = async (req, res, next) => {
  try {
    if (isOwnerRole(req)) return res.status(403).json({ success: false, message: 'Owners cannot delete trips' });
    const trip = await Trip.findByPk(req.params.id);
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found' });
    const bookingsCount = await Booking.count({ where: { trip_id: trip.id } });
    if (bookingsCount > 0) return res.status(409).json({ success: false, message: `Cannot delete: ${bookingsCount} bookings exist` });
    await trip.destroy();
    res.json({ success: true, message: 'Trip deleted' });
  } catch (err) {
    next(err);
  }
};

// ── Update Trip Status ─────────────────────────────────────
exports.updateStatus = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    if (isOwnerRole(req)) {
      await transaction.rollback();
      return res.status(403).json({ success: false, message: 'Only admins and operators can change trip status' });
    }
    const trip = await Trip.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!trip) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Trip not found' });
    }
    const { status } = req.body;
    const allowedStatuses = ['Scheduled', 'Active', 'Completed', 'Cancelled', 'Delayed'];
    if (!status || !allowedStatuses.includes(status)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Invalid trip status '${status}'. Allowed values: ${allowedStatuses.join(', ')}`,
      });
    }

    // Enforce 150-meter destination radius restriction on trip completion
    if (status === 'Completed' && !req.body?.admin_override && !req.body?.force) {
      if (trip.route_id) {
        const stops = await getOrderedStopsForRoute(trip.route_id, trip.departure_time);
        const finalStop = stops && stops.length > 0 ? stops[stops.length - 1] : null;

        if (finalStop && finalStop.latitude != null && finalStop.longitude != null) {
          const detail = trip.driver_id ? await DriverDetail.findOne({ where: { driver_id: trip.driver_id } }) : null;
          const rawLat = req.body?.latitude != null ? req.body.latitude : detail?.latitude;
          const rawLng = req.body?.longitude != null ? req.body.longitude : detail?.longitude;
          const accuracy = req.body?.accuracy != null ? Number(req.body.accuracy) : null;
          let driverLat = rawLat != null && rawLat !== '' ? Number(rawLat) : null;
          let driverLng = rawLng != null && rawLng !== '' ? Number(rawLng) : null;

          if (driverLat == null || driverLng == null) {
            const latestBreadcrumb = await TripLocation.findOne({
              where: { trip_id: trip.id },
              order: [['recorded_at', 'DESC'], ['id', 'DESC']],
            });
            if (latestBreadcrumb) {
              driverLat = Number(latestBreadcrumb.latitude);
              driverLng = Number(latestBreadcrumb.longitude);
            }
          }

          if (driverLat != null && driverLng != null && Number.isFinite(driverLat) && Number.isFinite(driverLng)) {
            const allowedRadius = await getCompletionRadiusMeters();
            const proximity = checkProximityToStop(driverLat, driverLng, finalStop.latitude, finalStop.longitude, allowedRadius, accuracy);
            if (!proximity.isWithin) {
              await transaction.rollback();
              return res.status(400).json({
                success: false,
                code: 'OUTSIDE_RADIUS',
                message: `You must reach within ${allowedRadius} meters of the final destination to complete this trip.`,
                data: {
                  distance_meters: proximity.rawDistanceMeters,
                  effective_distance_meters: proximity.effectiveDistanceMeters,
                  allowed_radius_meters: allowedRadius,
                  final_stop: {
                    id: finalStop.id,
                    stop_name: finalStop.stop_name,
                    latitude: Number(finalStop.latitude),
                    longitude: Number(finalStop.longitude),
                  },
                  driver_location: {
                    latitude: driverLat,
                    longitude: driverLng,
                  },
                },
              });
            }
          } else if (req.body?.require_location === true) {
            await transaction.rollback();
            return res.status(400).json({
              success: false,
              code: 'LOCATION_REQUIRED',
              message: 'Live GPS location is required to verify distance to final destination. Please ensure location services are enabled.',
            });
          }
        }
      }
    }

    const updates = { status };
    if (status === 'Active') updates.started_at = new Date();
    if (status === 'Completed') updates.completed_at = new Date();
    await trip.update(updates, { transaction });

    if (status === 'Completed') {
      await settleTripPackageRides({ tripId: trip.id, transaction });
    } else if (status === 'Cancelled') {
      await cancelTripPackageBookings({ trip, transaction });
    }

    await transaction.commit();
    if (status === 'Completed') {
      try {
        await releaseUnusedCouponOnTripCompletion(trip.id);
      } catch (couponErr) {
        console.warn('[Trip updateStatus] Error releasing unused coupons:', couponErr.message);
      }
    }
    res.json({ success: true, message: `Trip status updated to ${status}`, data: trip });
  } catch (err) {
    if (!transaction.finished) await transaction.rollback();
    next(err);
  }
};

// ── Assign Driver ──────────────────────────────────────────
exports.assignDriver = async (req, res, next) => {
  try {
    if (!requireOwnerBookingAccess(req, res)) return;
    const trip = await Trip.findByPk(req.params.id);
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found' });
    if (isOwnerRole(req)) return submitOwnerAssignmentRequest(req, res, trip);
    const { driver_id } = req.body;
    const driver = await Driver.findByPk(driver_id);
    if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });
    await trip.update({ driver_id });
    res.json({ success: true, message: 'Driver assigned', data: { trip_id: trip.id, driver_id } });
  } catch (err) {
    next(err);
  }
};

// ── Assign Vehicle ─────────────────────────────────────────
exports.assignVehicle = async (req, res, next) => {
  try {
    if (!requireOwnerBookingAccess(req, res)) return;
    const trip = await Trip.findByPk(req.params.id);
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found' });
    if (isOwnerRole(req)) return submitOwnerAssignmentRequest(req, res, trip);
    const { vehicle_id } = req.body;
    const vehicle = await Vehicle.findByPk(vehicle_id);
    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found' });
    const payload = { vehicle_id };
    if (vehicle.bus_type_id) {
      payload.bus_type_id = vehicle.bus_type_id;
    }
    await trip.update(payload);
    res.json({ success: true, message: 'Vehicle assigned', data: { trip_id: trip.id, vehicle_id, bus_type_id: payload.bus_type_id || trip.bus_type_id } });
  } catch (err) {
    next(err);
  }
};

// ── Assign Route ───────────────────────────────────────────
exports.assignRoute = async (req, res, next) => {
  try {
    if (!requireOwnerBookingAccess(req, res)) return;
    if (isOwnerRole(req)) return res.status(403).json({ success: false, message: 'Owners cannot change trip route' });
    const trip = await Trip.findByPk(req.params.id);
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found' });
    const { route_id } = req.body;
    if (!route_id) return res.status(400).json({ success: false, message: 'Route ID is required' });
    const route = await Route.findByPk(route_id);
    if (!route) return res.status(404).json({ success: false, message: 'Route not found' });

    const oldRouteId = trip.route_id;
    await trip.update({ route_id: parseInt(route_id) });

    const bookingsCount = await Booking.count({
      where: {
        trip_id: trip.id,
        status: { [Op.notIn]: ['Cancelled', 'cancelled', 'CANCELLED'] },
      },
    });

    await logAction({
      userId: req.user?.id,
      userType: req.user?.role?.name,
      userName: req.user?.name,
      action: 'update',
      module: 'trips',
      entityType: 'Trip',
      entityId: trip.id,
      newValues: { old_route_id: oldRouteId, new_route_id: parseInt(route_id) },
      ipAddress: req.ip,
      description: `Reassigned route for trip #${trip.id} to '${route.route_name}' (${route.origin_city} -> ${route.destination_city})`,
    });

    res.json({
      success: true,
      message: bookingsCount > 0
        ? `Route reassigned to ${route.route_name}. Notice: ${bookingsCount} active booking(s) exist on this trip.`
        : `Route reassigned to ${route.route_name} successfully`,
      data: { trip_id: trip.id, route_id: parseInt(route_id), route_name: route.route_name },
    });
  } catch (err) {
    next(err);
  }
};

// ── Bulk Generate Future Trips Endpoint ───────────────────────
exports.generateFutureTrips = async (req, res, next) => {
  try {
    if (isOwnerRole(req)) return res.status(403).json({ success: false, message: 'Owners cannot generate trips' });
    const { start_date, end_date, days_ahead = 14, schedule_ids } = req.body || {};

    const today = new Date();
    const startDateObj = start_date ? parseLocalDate(start_date) : today;
    let endDateObj = end_date ? parseLocalDate(end_date) : new Date(startDateObj.getTime() + (parseInt(days_ahead) || 14) * 24 * 60 * 60 * 1000);

    const maxEndDate = new Date(startDateObj.getTime() + 60 * 24 * 60 * 60 * 1000);
    if (endDateObj > maxEndDate) endDateObj = maxEndDate;

    const scheduleWhere = {
      status: { [Op.notIn]: ['Cancelled', 'Completed', 'Inactive'] },
      [Op.or]: [
        { notes: null },
        { notes: { [Op.notLike]: 'Generated%' } },
      ],
    };
    if (Array.isArray(schedule_ids) && schedule_ids.length > 0) {
      scheduleWhere.id = schedule_ids;
    }

    let masterSchedules = await Trip.findAll({ where: scheduleWhere });
    if (masterSchedules.length === 0) {
      const fallbackWhere = {
        status: { [Op.notIn]: ['Cancelled', 'Completed', 'Inactive'] },
      };
      if (Array.isArray(schedule_ids) && schedule_ids.length > 0) {
        fallbackWhere.id = schedule_ids;
      }
      masterSchedules = await Trip.findAll({ where: fallbackWhere });
    }
    if (masterSchedules.length === 0) {
      return res.json({ success: true, message: 'No active master schedules found to generate trips', data: { created_count: 0, skipped_count: 0 } });
    }

    let createdCount = 0;
    let skippedCount = 0;
    const createdTrips = [];

    const curr = new Date(startDateObj);
    while (curr <= endDateObj) {
      const year = curr.getFullYear();
      const month = String(curr.getMonth() + 1).padStart(2, '0');
      const day = String(curr.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      for (const master of masterSchedules) {
        if (master.valid_from && dateStr < master.valid_from) continue;
        if (master.valid_until && dateStr > master.valid_until) continue;

        if (master.operating_days) {
          if (!isOperatingDay(curr, master.operating_days)) {
            skippedCount++;
            continue;
          }
        } else if (master.trip_date) {
          const masterDayOfWeek = parseLocalDate(master.trip_date).getDay();
          if (curr.getDay() !== masterDayOfWeek) {
            skippedCount++;
            continue;
          }
        }

        const existing = await Trip.findOne({
          paranoid: false,
          where: {
            [Op.or]: [
              { schedule_code: master.schedule_code, trip_date: dateStr },
              { route_id: master.route_id, departure_time: master.departure_time, trip_date: dateStr },
            ],
          },
        });

        if (existing) {
          skippedCount++;
          continue;
        }

        const dailyTrip = await Trip.create({
          schedule_code: master.schedule_code,
          route_id: master.route_id,
          bus_type_id: master.bus_type_id,
          departure_time: master.departure_time,
          arrival_time: master.arrival_time,
          operating_days: master.operating_days,
          trip_date: dateStr,
          valid_from: master.valid_from,
          valid_until: master.valid_until,
          driver_id: master.driver_id,
          vehicle_id: master.vehicle_id,
          status: 'Scheduled',
          notes: master.notes ? `Generated from master schedule: ${master.notes}` : `Generated trip for ${dateStr}`,
        });

        createdCount++;
        createdTrips.push({ id: dailyTrip.id, schedule_code: dailyTrip.schedule_code, trip_date: dateStr, departure_time: dailyTrip.departure_time });
      }

      curr.setDate(curr.getDate() + 1);
    }

    res.json({
      success: true,
      message: `Generated ${createdCount} future trip instances (${skippedCount} skipped/existing)`,
      data: {
        created_count: createdCount,
        skipped_count: skippedCount,
        start_date: startDateObj.toISOString().split('T')[0],
        end_date: endDateObj.toISOString().split('T')[0],
        trips: createdTrips.slice(0, 50),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Replicate / Copy Trips From Date to Date Endpoint ───────────
exports.copyTrips = async (req, res, next) => {
  try {
    if (isOwnerRole(req)) {
      return res.status(403).json({ success: false, message: 'Owners cannot copy trips directly' });
    }

    let {
      source_date,
      target_date,
      target_end_date,
      trip_ids,
      include_driver_vehicle = true,
      overwrite_existing = true,
    } = req.body || {};

    if (!source_date || !target_date) {
      return res.status(400).json({ success: false, message: 'source_date and target_date are required' });
    }

    source_date = normalizeDateStr(source_date);
    target_date = normalizeDateStr(target_date);
    const targetEnd = target_end_date ? normalizeDateStr(target_end_date) : target_date;

    const sourceWhere = {
      trip_date: source_date,
      status: { [Op.notIn]: ['Cancelled', 'cancelled', 'Inactive'] },
    };

    if (Array.isArray(trip_ids) && trip_ids.length > 0) {
      sourceWhere.id = { [Op.in]: trip_ids.map(Number) };
    }

    const sourceTrips = await Trip.findAll({
      where: sourceWhere,
      order: [['departure_time', 'ASC']],
    });

    if (sourceTrips.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No active trips found on ${source_date} to copy`,
      });
    }

    const startDateObj = parseLocalDate(target_date);
    const endDateObj = parseLocalDate(targetEnd);
    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid target date format' });
    }

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const replicatedTrips = [];

    const curr = new Date(startDateObj);
    while (curr <= endDateObj) {
      const year = curr.getFullYear();
      const month = String(curr.getMonth() + 1).padStart(2, '0');
      const day = String(curr.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      if (dateStr === source_date) {
        curr.setDate(curr.getDate() + 1);
        continue;
      }

      for (const src of sourceTrips) {
        const existing = await Trip.findOne({
          paranoid: false,
          where: {
            [Op.or]: [
              { schedule_code: src.schedule_code, trip_date: dateStr },
              { route_id: src.route_id, departure_time: src.departure_time, trip_date: dateStr },
            ],
          },
        });

        if (existing) {
          if (overwrite_existing) {
            await existing.update({
              schedule_code: src.schedule_code,
              route_id: src.route_id,
              bus_type_id: src.bus_type_id,
              driver_id: include_driver_vehicle ? src.driver_id : existing.driver_id,
              vehicle_id: include_driver_vehicle ? src.vehicle_id : existing.vehicle_id,
              departure_time: src.departure_time,
              arrival_time: src.arrival_time,
              operating_days: src.operating_days || '1,2,3,4,5,6,7',
              valid_from: dateStr,
              valid_until: dateStr,
              seat_capacity: src.seat_capacity || 40,
              status: 'Scheduled',
              notes: `Copied from ${source_date} (Trip #${src.id})`,
              deleted_at: null,
            });
            updatedCount++;
            replicatedTrips.push({ id: existing.id, schedule_code: existing.schedule_code, trip_date: dateStr, departure_time: existing.departure_time, action: 'updated' });
          } else {
            skippedCount++;
          }
        } else {
          const newTrip = await Trip.create({
            schedule_code: src.schedule_code,
            route_id: src.route_id,
            bus_type_id: src.bus_type_id,
            driver_id: include_driver_vehicle ? src.driver_id : null,
            vehicle_id: include_driver_vehicle ? src.vehicle_id : null,
            departure_time: src.departure_time,
            arrival_time: src.arrival_time,
            operating_days: src.operating_days || '1,2,3,4,5,6,7',
            trip_date: dateStr,
            valid_from: dateStr,
            valid_until: dateStr,
            seat_capacity: src.seat_capacity || 40,
            status: 'Scheduled',
            notes: `Copied from ${source_date} (Trip #${src.id})`,
          });
          createdCount++;
          replicatedTrips.push({ id: newTrip.id, schedule_code: newTrip.schedule_code, trip_date: dateStr, departure_time: newTrip.departure_time, action: 'created' });
        }
      }

      curr.setDate(curr.getDate() + 1);
    }

    const summaryMsg = `Successfully replicated ${createdCount} trips from ${source_date} to ${target_date}${targetEnd !== target_date ? ` to ${targetEnd}` : ''}${updatedCount > 0 ? ` (${updatedCount} updated)` : ''}${skippedCount > 0 ? ` (${skippedCount} already existed)` : ''}`;

    return res.json({
      success: true,
      message: summaryMsg,
      data: {
        source_date,
        target_date,
        target_end_date: targetEnd,
        total_source_trips: sourceTrips.length,
        created_count: createdCount,
        updated_count: updatedCount,
        skipped_count: skippedCount,
        trips: replicatedTrips.slice(0, 50),
      },
    });
  } catch (err) {
    next(err);
  }
};

