'use strict';

const { Op, fn, col } = require('sequelize');
const { BusType, BusRoute, BusSchedule, BusStop, Trip, Booking, Vehicle, Stop, Route, RouteStop, BusDriverAssignment, CustomerUser, Coupon, CouponUsage, RateChart, Driver, DriverDetail, Payment, WalletTransaction } = require('../models');
const sequelize = require('../config/database');
const { resolveFare } = require('../utils/fareCalculator');
const { calculateCouponDiscount } = require('../utils/coupon');
const BusStopSearchService = require('../services/busStopSearchService');
const BusRouteSearchService = require('../services/busRouteSearchService');
const SeatReservationService = require('../services/seatReservationService');
const { confirmPaidBooking } = require('../services/bookingConfirmationService');

const buildPagination = (page, limit) => {
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit) || 15));
  return { offset: (p - 1) * l, limit: l, page: p };
};

const getEtaMinutesToPickup = async ({ driverDetail = {}, originStop = {} }) => {
  const driverLat = driverDetail.latitude != null && driverDetail.latitude !== '' ? Number(driverDetail.latitude) : null;
  const driverLng = driverDetail.longitude != null && driverDetail.longitude !== '' ? Number(driverDetail.longitude) : null;
  const stopLat = originStop.latitude != null && originStop.latitude !== '' ? Number(originStop.latitude) : null;
  const stopLng = originStop.longitude != null && originStop.longitude !== '' ? Number(originStop.longitude) : null;

  if (driverLat == null || driverLng == null || stopLat == null || stopLng == null) return null;
  if (!Number.isFinite(driverLat) || !Number.isFinite(driverLng) || !Number.isFinite(stopLat) || !Number.isFinite(stopLng)) return null;
  if (Math.abs(driverLat) > 90 || Math.abs(stopLat) > 90 || Math.abs(driverLng) > 180 || Math.abs(stopLng) > 180) return null;

  try {
    const routingBaseUrl = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
    const routeUrl = new URL(
      `/route/v1/driving/${driverLng},${driverLat};${stopLng},${stopLat}`,
      routingBaseUrl
    );
    routeUrl.searchParams.set('overview', 'false');
    routeUrl.searchParams.set('alternatives', 'false');
    routeUrl.searchParams.set('steps', 'false');

    const response = await fetch(routeUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;

    const result = await response.json();
    const route = result.code === 'Ok' ? result.routes?.[0] : null;
    if (!route || !Number.isFinite(Number(route.duration)) || !Number.isFinite(Number(route.distance))) return null;

    return {
      distance_meters: Number(route.distance),
      eta_minutes: Math.max(0, Number(route.duration) / 60),
      eta_source: 'openstreetmap_osrm_road_route',
    };
  } catch (err) {
    return null;
  }
};

const isDateKeyEnabled = (value) => value === true || value === 1 || ['true', '1'].includes(String(value).toLowerCase());

const groupSchedulesByTripDate = (schedules) => schedules.reduce((grouped, schedule) => {
  const tripDate = schedule.trip_date;
  if (!tripDate) return grouped;
  if (!grouped[tripDate]) grouped[tripDate] = [];
  grouped[tripDate].push(schedule);
  return grouped;
}, {});

// ── 1. Get Bus Types ─────────────────────────────────────────
exports.getBusTypes = async (req, res, next) => {
  try {
    const busTypes = await BusType.findAll({
      where: { status: 'Active' },
      order: [['name', 'ASC']],
    });

    res.json({
      status: 200,
      success: true,
      message: 'Bus types retrieved successfully',
      data: busTypes,
    });
  } catch (err) {
    next(err);
  }
};

// ── 2. Get Routes ──────────────────────────────────────────────
exports.getRoutes = async (req, res, next) => {
  try {
    const origin_city = req.query?.origin_city || req.body?.origin_city;
    const destination_city = req.query?.destination_city || req.body?.destination_city;

    const where = { status: 'Active' };
    if (origin_city) where.origin_city = origin_city;
    if (destination_city) where.destination_city = destination_city;

    let routes = await Route.findAll({
      where,
      include: [
        { model: Stop, as: 'stops', required: false },
      ],
      order: [['origin_city', 'ASC'], ['destination_city', 'ASC']],
    });

    if (!routes || routes.length === 0) {
      routes = await BusRoute.findAll({
        where,
        include: [
          { model: BusStop, as: 'stops', required: false },
        ],
        order: [['origin_city', 'ASC'], ['destination_city', 'ASC']],
      });
    }

    res.json({
      status: 200,
      success: true,
      message: 'Routes retrieved successfully',
      data: routes,
    });
  } catch (err) {
    next(err);
  }
};

// Configurable Search Radii (in KM)
const PICKUP_SEARCH_RADIUS_KM = parseFloat(process.env.PICKUP_SEARCH_RADIUS_KM || 5.0);
const DROPOFF_SEARCH_RADIUS_KM = parseFloat(process.env.DROPOFF_SEARCH_RADIUS_KM || 5.0);

// Coordinate Validator
const validateCoordinates = (lat, lng) => {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
};

// Haversine Distance in Kilometers
const calcHaversineDistanceKm = (lat1, lon1, lat2, lon2) => {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null || isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return Infinity;
  const R = 6371; // Earth radius in KM
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Format Distance & Labels (Separate walking vs driving fields per specification)
const formatDistanceAndLabel = (distKm) => {
  const distMeters = Math.round(distKm * 1000);
  const roundedKm = Number(distKm.toFixed(2));

  if (distKm <= 1.0) {
    const walkMins = Math.max(1, Math.ceil(distMeters / 80));
    const walkLabel = distMeters <= 100 ? 'less than a min walk' : `${walkMins} min walk`;
    return {
      distance_meters: distMeters,
      distance_km: roundedKm,
      walking_minutes: walkMins,
      walking_label: walkLabel,
    };
  } else {
    const driveMins = Math.max(1, Math.ceil((distKm / 30) * 60));
    const driveLabel = `${driveMins} min drive (${roundedKm} km)`;
    return {
      distance_meters: distMeters,
      distance_km: roundedKm,
      driving_minutes: driveMins,
      driving_label: driveLabel,
    };
  }
};

// Convert 24h / 12h time string to minutes from midnight
const getMinutesFromMidnight = (timeStr) => {
  if (!timeStr) return 0;
  const parts = String(timeStr).trim().split(/[:\s]/);
  if (parts.length < 2) return 0;
  let h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  const ampm = String(timeStr).toUpperCase();
  if (ampm.includes('PM') && h < 12) h += 12;
  if (ampm.includes('AM') && h === 12) h = 0;
  return h * 60 + m;
};

// Format time string to 12h display
const formatTime12h = (timeStr, offsetMins = 0) => {
  let baseMins = getMinutesFromMidnight(timeStr);
  let totalMins = (baseMins + offsetMins) % (24 * 60);
  if (totalMins < 0) totalMins += 24 * 60;

  const h24 = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const displayH = h24 % 12 || 12;
  return `${String(displayH).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
};

// ── Core Schedule Fetching Helper for Route + Stop Pair ────────
const fetchSchedulesForRouteStopPair = async ({ routeId, pickupStopId, dropStopId, travelDate, passengers }) => {
  const reqPassengers = parseInt(passengers || 1, 10);
  if (reqPassengers < 1) {
    return { success: false, reason: 'INVALID_PASSENGERS', schedules: [] };
  }

  const searchDateStr = travelDate || new Date().toISOString().split('T')[0];

  let route = await Route.findOne({
    where: { id: routeId, deleted_at: null, status: { [Op.notIn]: ['Inactive', 'inactive'] } },
    include: [
      { model: Stop, as: 'stops', required: false },
      { model: RouteStop, as: 'route_stops', required: false, include: [{ model: Stop, as: 'stop', required: false }] },
    ],
  });

  if (!route) {
    route = await BusRoute.findOne({
      where: { id: routeId, status: { [Op.notIn]: ['Inactive', 'inactive'] } },
      include: [{ model: BusStop, as: 'stops', required: false }],
    });
  }

  if (!route) {
    console.log(`[REJECTION] Route ${routeId} not found or inactive`);
    return { success: false, reason: 'ROUTE_INACTIVE', schedules: [] };
  }

  let stops = [];
  const routeObj = route.toJSON();
  if (routeObj.route_stops && routeObj.route_stops.length > 0) {
    stops = routeObj.route_stops
      .filter((rs) => rs.stop)
      .sort((a, b) => Number(a.stop_sequence || 0) - Number(b.stop_sequence || 0))
      .map((rs) => ({
        id: Number(rs.stop.id),
        stop_name: rs.stop.stop_name,
        name: rs.stop.stop_name,
        stop_sequence: Number(rs.stop_sequence || 1),
      }));
  } else if (routeObj.stops && routeObj.stops.length > 0) {
    stops = routeObj.stops
      .sort((a, b) => Number(a.stop_sequence || 0) - Number(b.stop_sequence || 0))
      .map((s) => ({
        id: Number(s.id),
        stop_name: s.stop_name,
        name: s.stop_name,
        stop_sequence: Number(s.stop_sequence || 1),
      }));
  } else {
    const directStops = await Stop.findAll({
      where: { route_id: routeId },
      order: [['stop_sequence', 'ASC']],
    });
    stops = (directStops || []).map((s) => ({
      id: Number(s.id),
      stop_name: s.stop_name,
      name: s.stop_name,
      stop_sequence: Number(s.stop_sequence || 1),
    }));
  }

  let pickupStop = stops.find((s) => Number(s.id) === Number(pickupStopId));
  let dropStop = stops.find((s) => Number(s.id) === Number(dropStopId));

  if (!pickupStop || !dropStop) {
    console.log(`[REJECTION] Pickup or drop stop invalid for route ${routeId}`);
    return { success: false, reason: 'INVALID_STOPS', schedules: [] };
  }

  if (Number(pickupStop.id) === Number(dropStop.id)) {
    console.log(`[REJECTION] Same stop requested: pickup ${pickupStop.id} === drop ${dropStop.id}`);
    return { success: false, reason: 'SAME_STOP', schedules: [] };
  }

  const pSeq = Number(pickupStop.stop_sequence || 1);
  const dSeq = Number(dropStop.stop_sequence || 2);

  if (pSeq >= dSeq) {
    console.log(`[REJECTION] Invalid sequence: pickup ${pSeq} >= drop ${dSeq}`);
    return { success: false, reason: 'INVALID_SEQUENCE', schedules: [] };
  }

  let rawSchedules = await BusSchedule.findAll({
    where: { route_id: route.id, status: { [Op.notIn]: ['Cancelled', 'cancelled', 'Inactive', 'inactive'] } },
    include: [
      { model: BusType, as: 'bus_type', required: false },
      { model: Vehicle, as: 'vehicle', required: false },
    ],
    order: [['departure_time', 'ASC']],
  });

  if (!rawSchedules || rawSchedules.length === 0) {
    rawSchedules = await Trip.findAll({
      where: { route_id: route.id, status: { [Op.notIn]: ['Cancelled', 'cancelled', 'Inactive', 'inactive'] }, deleted_at: null },
      include: [
        { model: BusType, as: 'bus_type', required: false },
        { model: Vehicle, as: 'vehicle', required: false },
      ],
      order: [['departure_time', 'ASC']],
    });
  }

  const searchDateObj = new Date(searchDateStr);
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const weekday = weekdays[isNaN(searchDateObj.getDay()) ? 1 : searchDateObj.getDay()];

  let dayFilteredSchedules = (rawSchedules || []).filter((sch) => {
    if (sch.trip_date) return String(sch.trip_date).slice(0, 10) === searchDateStr;
    if (!sch.operating_days) return true;
    const operatingDays = String(sch.operating_days).toLowerCase().split(/[,:]/).map((d) => d.trim());
    return operatingDays.includes(weekday);
  });

  if (dayFilteredSchedules.length === 0) {
    const defaultTimes = ['07:30:00', '10:00:00', '13:30:00', '16:30:00', '19:30:00'];
    dayFilteredSchedules = defaultTimes.map((timeStr, idx) => ({
      id: Number(route.id) * 1000 + (idx + 1),
      route_id: Number(route.id),
      schedule_code: `SCH-${route.id}-${idx + 1}`,
      departure_time: timeStr,
      trip_date: searchDateStr,
      operating_days: 'Daily',
      status: 'Active',
      bus_type: { id: 1, name: 'AC Executive Shuttle', total_seats: 40 },
      seat_capacity: 40,
      booked_seats: 0,
      is_virtual: true,
    }));
  }

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const isToday = searchDateStr === todayStr;
  const currentMinsFromMidnight = now.getHours() * 60 + now.getMinutes();

  let fareAmount = 85;
  try {
    const stopPairRate = await RateChart.findOne({
      where: {
        route_id: route.id,
        origin_stop_id: pickupStop.id,
        destination_stop_id: dropStop.id,
      },
    });
    if (stopPairRate && Number(stopPairRate.fare_amount) > 0) {
      fareAmount = Math.round(Number(stopPairRate.fare_amount));
    } else {
      const routeRate = await RateChart.findOne({
        where: { route_id: route.id, origin_stop_id: null, destination_stop_id: null },
      });
      if (routeRate && Number(routeRate.fare_amount) > 0) {
        fareAmount = Math.round(Number(routeRate.fare_amount));
      }
    }
  } catch (e) {
    fareAmount = 85;
  }

  const totalStops = Math.max(2, stops.length);
  const estDuration = Number(route.estimated_duration) || 60;
  const minsPerStop = Math.max(5, Math.round(estDuration / Math.max(1, totalStops - 1)));

  const pickupOffsetMins = (pSeq - 1) * minsPerStop;
  const dropOffsetMins = (dSeq - 1) * minsPerStop;
  const tripDurationMins = Math.max(10, dropOffsetMins - pickupOffsetMins);

  const validFormattedSchedules = [];

  for (const sch of dayFilteredSchedules) {
    const schId = Number(sch.id);
    const depTimeRaw = sch.departure_time || '07:35:00';
    const baseDepMins = getMinutesFromMidnight(depTimeRaw);
    const pickupMins = baseDepMins + pickupOffsetMins;

    if (isToday && pickupMins <= currentMinsFromMidnight) {
      console.log(`[REJECTION] Past departure for schedule ${schId}: pickupMins ${pickupMins} <= currentMins ${currentMinsFromMidnight}`);
      continue;
    }

    let bookedSeatsCount = sch.booked_seats || 0;
    try {
      const activeBookings = await Booking.findAll({
        where: {
          trip_id: sch.id,
          travel_date: searchDateStr,
          booking_status: { [Op.ne]: 'cancelled' },
        },
        attributes: ['total_seats', 'seat_numbers'],
      });
      if (activeBookings && activeBookings.length > 0) {
        bookedSeatsCount = activeBookings.reduce((sum, b) => sum + (b.total_seats || (b.seat_numbers ? b.seat_numbers.length : 1)), 0);
      }
    } catch (err) {
      // fallback
    }

    const seatCap = sch.vehicle?.total_seats || sch.bus_type?.total_seats || sch.seat_capacity || 30;
    const availSeats = Math.max(0, seatCap - bookedSeatsCount);

    if (availSeats < reqPassengers) {
      console.log(`[REJECTION] No seats for schedule ${schId}: available ${availSeats} < requested ${reqPassengers}`);
      continue;
    }

    const pickupTimeStr = formatTime12h(depTimeRaw, pickupOffsetMins);
    const dropTimeStr = formatTime12h(depTimeRaw, dropOffsetMins);

    validFormattedSchedules.push({
      schedule_id: schId,
      trip_date: sch.trip_date || searchDateStr,
      route_id: Number(route.id),
      bus_type_id: sch.bus_type_id || sch.bus_type?.id || null,
      bus_type: sch.bus_type || null,
      bus_number: sch.bus_number || sch.vehicle?.registration_number || null,
      pickup_stop: {
        id: Number(pickupStop.id),
        name: pickupStop.stop_name || pickupStop.name,
      },
      drop_stop: {
        id: Number(dropStop.id),
        name: dropStop.stop_name || dropStop.name,
      },
      pickup_time: pickupTimeStr,
      drop_time: dropTimeStr,
      duration_minutes: tripDurationMins,
      fare: {
        amount: fareAmount,
        currency: 'INR',
        display: `₹${fareAmount}`,
      },
      available_seats: availSeats,
      requested_seats: reqPassengers,
      booking_allowed: true,
      status: 'active',
      pickupMins,
    });
  }

  return {
    success: validFormattedSchedules.length > 0,
    reason: validFormattedSchedules.length > 0 ? 'SUCCESS' : 'NO_VALID_SCHEDULES',
    schedules: validFormattedSchedules,
    route,
    pickupStop,
    dropStop,
    fareAmount,
    durationMinutes: tripDurationMins,
  };
};

// ── 3. Search Routes with Filters ─────────────────────────────
// ── 3. Search Routes with Filters (Cityflo-Style Location-First & Alias Aware) ───
exports.searchRoutes = async (req, res, next) => {
  try {
    const rawPickupObj = req.body?.pickup ?? req.query?.pickup;
    const rawDropoffObj = req.body?.dropoff ?? req.query?.dropoff;

    // Extract latitude and longitude from nested objects or flat parameters
    const pLatRaw = (typeof rawPickupObj === 'object' && rawPickupObj !== null ? (rawPickupObj.latitude ?? rawPickupObj.lat) : undefined)
      ?? req.body?.pickup_latitude ?? req.query?.pickup_latitude ?? req.body?.pickup_lat ?? req.query?.pickup_lat;

    const pLngRaw = (typeof rawPickupObj === 'object' && rawPickupObj !== null ? (rawPickupObj.longitude ?? rawPickupObj.lng) : undefined)
      ?? req.body?.pickup_longitude ?? req.query?.pickup_longitude ?? req.body?.pickup_lng ?? req.query?.pickup_lng;

    const dLatRaw = (typeof rawDropoffObj === 'object' && rawDropoffObj !== null ? (rawDropoffObj.latitude ?? rawDropoffObj.lat) : undefined)
      ?? req.body?.dropoff_latitude ?? req.query?.dropoff_latitude ?? req.body?.dropoff_lat ?? req.query?.dropoff_lat;

    const dLngRaw = (typeof rawDropoffObj === 'object' && rawDropoffObj !== null ? (rawDropoffObj.longitude ?? rawDropoffObj.lng) : undefined)
      ?? req.body?.dropoff_longitude ?? req.query?.dropoff_longitude ?? req.body?.dropoff_lng ?? req.query?.dropoff_lng;

    let pLat = pLatRaw !== undefined && pLatRaw !== null && pLatRaw !== '' ? parseFloat(pLatRaw) : NaN;
    let pLng = pLngRaw !== undefined && pLngRaw !== null && pLngRaw !== '' ? parseFloat(pLngRaw) : NaN;
    let dLat = dLatRaw !== undefined && dLatRaw !== null && dLatRaw !== '' ? parseFloat(dLatRaw) : NaN;
    let dLng = dLngRaw !== undefined && dLngRaw !== null && dLngRaw !== '' ? parseFloat(dLngRaw) : NaN;

    let rawPickupName = req.body?.pickup_name || req.query?.pickup_name || req.body?.pickup_location || req.query?.pickup_location;
    if (!rawPickupName && typeof rawPickupObj === 'string') rawPickupName = rawPickupObj;
    if (!rawPickupName && typeof rawPickupObj === 'object' && rawPickupObj !== null && typeof rawPickupObj.name === 'string') rawPickupName = rawPickupObj.name;

    let rawDropoffName = req.body?.dropoff_name || req.query?.dropoff_name || req.body?.dropoff_location || req.query?.dropoff_location;
    if (!rawDropoffName && typeof rawDropoffObj === 'string') rawDropoffName = rawDropoffObj;
    if (!rawDropoffName && typeof rawDropoffObj === 'object' && rawDropoffObj !== null && typeof rawDropoffObj.name === 'string') rawDropoffName = rawDropoffObj.name;

    const pStopId = req.body?.pickup?.stop_id || req.query?.pickup?.stop_id || req.body?.pickup_stop_id || req.query?.pickup_stop_id || null;
    const dStopId = req.body?.dropoff?.stop_id || req.query?.dropoff?.stop_id || req.body?.drop_stop_id || req.query?.drop_stop_id || null;

    // Validation check
    const errors = {};
    if (!pStopId && isNaN(pLat) && !rawPickupName) {
      errors.pickup = 'Pickup latitude and longitude coordinates or valid stop_id/name are required';
    }
    if (!dStopId && isNaN(dLat) && !rawDropoffName) {
      errors.dropoff = 'Dropoff latitude and longitude coordinates or valid stop_id/name are required';
    }

    if (Object.keys(errors).length > 0) {
      return res.status(422).json({
        status: false,
        message: 'Invalid or missing pickup/dropoff details',
        errors,
      });
    }

    const travelDate = req.body?.date || req.query?.date || req.body?.travel_date || req.query?.travel_date || new Date().toISOString().split('T')[0];
    const rawPassengers = req.body?.passengers ?? req.query?.passengers;
    const passengers = parseInt(rawPassengers !== undefined ? rawPassengers : 1, 10);
    const busTypeId = req.body?.bus_type_id || req.query?.bus_type_id || null;

    const pickupInput = {
      stop_id: pStopId,
      name: rawPickupName || 'Pickup Location',
      latitude: !isNaN(pLat) ? pLat : null,
      longitude: !isNaN(pLng) ? pLng : null,
    };

    const dropoffInput = {
      stop_id: dStopId,
      name: rawDropoffName || 'Dropoff Location',
      latitude: !isNaN(dLat) ? dLat : null,
      longitude: !isNaN(dLng) ? dLng : null,
    };

    const searchResult = await BusRouteSearchService.search({
      pickupInput,
      dropoffInput,
      travelDateInput: travelDate,
      passengersInput: passengers,
      busTypeId,
    });

    res.json(searchResult);
  } catch (err) {
    next(err);
  }
};

exports.searchStops = BusStopSearchService.searchStopsSuggestions;

// ── 4. Get Schedules ──────────────────────────────────────────
exports.getSchedules = async (req, res, next) => {
  try {
    const route_id = req.query?.route_id || req.body?.route_id;
    const pickup_stop_id = req.query?.pickup_stop_id || req.body?.pickup_stop_id;
    const drop_stop_id = req.query?.drop_stop_id || req.body?.drop_stop_id;
    const requestedTravelDate = req.query?.date || req.body?.date || req.query?.travel_date || req.body?.travel_date;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const windowEndDate = new Date(`${todayStr}T00:00:00`);
    windowEndDate.setDate(windowEndDate.getDate() + 6);
    const windowEndStr = `${windowEndDate.getFullYear()}-${String(windowEndDate.getMonth() + 1).padStart(2, '0')}-${String(windowEndDate.getDate()).padStart(2, '0')}`;
    const travel_date = requestedTravelDate || todayStr;
    const passengers = parseInt(req.query?.passengers || req.body?.passengers || 1, 10);
    const dateKeyEnabled = isDateKeyEnabled(req.query?.date_key ?? req.body?.date_key);

    if (route_id && pickup_stop_id && drop_stop_id) {
      let searchDates = [travel_date];
      if (!requestedTravelDate && dateKeyEnabled) {
        const [datedSchedules, datedTrips] = await Promise.all([
          BusSchedule.findAll({
            attributes: ['trip_date'],
            where: { route_id, status: 'Active', trip_date: { [Op.between]: [todayStr, windowEndStr] } },
            raw: true,
          }),
          Trip.findAll({
            attributes: ['trip_date'],
            where: { route_id, status: { [Op.in]: ['Active', 'Scheduled'] }, trip_date: { [Op.between]: [todayStr, windowEndStr] } },
            raw: true,
          }),
        ]);
        const upcomingDates = new Set([...datedSchedules, ...datedTrips].map((item) => item.trip_date).filter(Boolean));
        for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
          const date = new Date(today);
          date.setDate(today.getDate() + dayOffset);
          upcomingDates.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
        }
        searchDates = [...upcomingDates].sort();
      }

      const scheduleResults = await Promise.all(searchDates.map((searchDate) => fetchSchedulesForRouteStopPair({
        routeId: route_id,
        pickupStopId: pickup_stop_id,
        dropStopId: drop_stop_id,
        travelDate: searchDate,
        passengers,
      })));
      const foundSchedules = scheduleResults.flatMap((result) => result.success ? result.schedules : []);

      if (foundSchedules.length === 0) {
        return res.json({
          status: false,
          message: scheduleResults.find((result) => result.reason)?.reason || 'No schedules found',
          search: {
            route_id: Number(route_id),
            pickup_stop_id: Number(pickup_stop_id),
            drop_stop_id: Number(drop_stop_id),
            date: requestedTravelDate || null,
            passengers,
          },
          total: 0,
          schedules: dateKeyEnabled ? {} : [],
        });
      }

      return res.json({
        status: true,
        message: 'Schedules found',
        search: {
          route_id: Number(route_id),
          pickup_stop_id: Number(pickup_stop_id),
          drop_stop_id: Number(drop_stop_id),
          date: requestedTravelDate || null,
          passengers,
        },
        total: foundSchedules.length,
        schedules: dateKeyEnabled
          ? groupSchedulesByTripDate(foundSchedules)
          : foundSchedules,
      });
    }

    const rawTravelDate = req.query?.date || req.body?.date || req.query?.travel_date || req.body?.travel_date;
    const bus_type_id = req.query?.bus_type_id || req.body?.bus_type_id;

    const where = {};
    if (route_id) where.route_id = route_id;
    if (bus_type_id) where.bus_type_id = bus_type_id;

    if (rawTravelDate) {
      where.trip_date = rawTravelDate;
    } else {
      where.trip_date = { [Op.between]: [todayStr, windowEndStr] };
    }

    let schedules = await BusSchedule.findAll({
      where,
      include: [
        { model: BusType, as: 'bus_type', required: false },
        { model: Vehicle, as: 'vehicle', required: false },
        { model: Route, as: 'route', include: [{ model: Stop, as: 'stops', required: false }], required: false },
        { model: Route, as: 'main_route', include: [{ model: Stop, as: 'stops', required: false }], required: false },
        { model: BusRoute, as: 'bus_route', include: [{ model: BusStop, as: 'stops', required: false }], required: false },
      ],
      order: [['trip_date', 'ASC'], ['departure_time', 'ASC']],
    });

    if (!schedules || schedules.length === 0) {
      const tripWhere = {};
      if (route_id) tripWhere.route_id = route_id;
      if (bus_type_id) tripWhere.bus_type_id = bus_type_id;
      if (rawTravelDate) {
        tripWhere.trip_date = rawTravelDate;
      } else {
        tripWhere.trip_date = { [Op.between]: [todayStr, windowEndStr] };
      }

      schedules = await Trip.findAll({
        where: tripWhere,
        include: [
          { model: BusType, as: 'bus_type', required: false },
          { model: Vehicle, as: 'vehicle', required: false },
          { model: Route, as: 'route', include: [{ model: Stop, as: 'stops', required: false }], required: false },
        ],
        order: [['trip_date', 'ASC'], ['departure_time', 'ASC']],
      });
    }

    // If no travel_date was passed and no future schedules exist, fetch latest active/scheduled trips
    if ((!schedules || schedules.length === 0) && !rawTravelDate && !dateKeyEnabled) {
      const fallbackWhere = {};
      if (route_id) fallbackWhere.route_id = route_id;
      if (bus_type_id) fallbackWhere.bus_type_id = bus_type_id;

      schedules = await Trip.findAll({
        where: fallbackWhere,
        include: [
          { model: BusType, as: 'bus_type', required: false },
          { model: Vehicle, as: 'vehicle', required: false },
          { model: Route, as: 'route', include: [{ model: Stop, as: 'stops', required: false }], required: false },
        ],
        order: [['trip_date', 'DESC'], ['departure_time', 'ASC']],
      });
    }

    // Collect all distinct route IDs to lookup base_fare from rate_charts
    const routeIds = [...new Set((schedules || []).map((s) => s.route_id || (s.route && s.route.id)).filter(Boolean))];
    const rateCharts = routeIds.length > 0 ? await RateChart.findAll({ where: { route_id: routeIds } }) : [];

    // Map route_id -> rateChart fare_amount
    const routeFareMap = {};
    rateCharts.forEach((rc) => {
      const rId = Number(rc.route_id);
      const amt = parseFloat(rc.fare_amount);
      if (!isNaN(amt) && amt > 0) {
        // Prefer route-level rate_chart (where origin & dest stops are null) or first valid fare
        if (!routeFareMap[rId] || (rc.origin_stop_id === null && rc.destination_stop_id === null)) {
          routeFareMap[rId] = amt;
        }
      }
    });

    const formattedSchedules = (schedules || []).map((s) => {
      const item = s.toJSON();
      if (!item.route && item.bus_route) {
        item.route = item.bus_route;
      }
      if (!item.route && item.main_route) {
        item.route = item.main_route;
      }
      delete item.main_route;

      // Dynamic seat_capacity from vehicle total_seats or bus_type total_seats
      if (item.vehicle && item.vehicle.total_seats) {
        item.seat_capacity = Number(item.vehicle.total_seats);
      } else if (item.bus_type && item.bus_type.total_seats) {
        item.seat_capacity = Number(item.bus_type.total_seats);
      }

      const rId = Number(item.route_id || (item.route && item.route.id));
      if (routeFareMap[rId] !== undefined) {
        item.base_fare = routeFareMap[rId].toFixed(2);
      }

      return item;
    });

    res.json({
      status: true,
      message: 'Schedules retrieved successfully',
      data: dateKeyEnabled
        ? groupSchedulesByTripDate(formattedSchedules)
        : formattedSchedules,
    });
  } catch (err) {
    next(err);
  }
};

// ── 5. Check Seat Availability ────────────────────────────────
exports.checkSeatAvailability = async (req, res, next) => {
  try {
    const rawScheduleId = req.query?.schedule_id || req.body?.schedule_id;
    const travel_date = req.query?.travel_date || req.body?.travel_date;

    if (!rawScheduleId || !travel_date) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: 'schedule_id and travel_date are required',
      });
    }

    const schedule_id = Number(rawScheduleId) || rawScheduleId;

    let schedule = await BusSchedule.findByPk(schedule_id, {
      include: [
        { model: BusType, as: 'bus_type', required: false },
        { model: Route, as: 'route', include: [{ model: Stop, as: 'stops', required: false }], required: false },
        { model: Route, as: 'main_route', include: [{ model: Stop, as: 'stops', required: false }], required: false },
        { model: BusRoute, as: 'bus_route', include: [{ model: BusStop, as: 'stops', required: false }], required: false },
      ],
    });

    if (!schedule) {
      schedule = await Trip.findByPk(schedule_id, {
        include: [
          { model: BusType, as: 'bus_type', required: false },
          { model: Vehicle, as: 'vehicle', required: false },
          { model: Route, as: 'route', include: [{ model: Stop, as: 'stops', required: false }], required: false },
        ],
      });
    }

    if (!schedule) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: 'Schedule not found',
      });
    }

    // Determine all related trip/schedule IDs matching schedule_id, schedule_code, or route_id + departure_time
    const matchConditions = [];
    if (schedule.id) matchConditions.push({ id: schedule.id });
    if (schedule_id) matchConditions.push({ id: schedule_id });
    if (schedule.schedule_code) matchConditions.push({ schedule_code: schedule.schedule_code });
    if (schedule.route_id && schedule.departure_time) {
      matchConditions.push({ route_id: schedule.route_id, departure_time: schedule.departure_time });
    }

    const tripIds = new Set([Number(schedule.id), Number(schedule_id)]);
    if (matchConditions.length > 0) {
      const relatedTrips = await Trip.findAll({
        where: { [Op.or]: matchConditions },
        attributes: ['id'],
      });
      const relatedSchedules = await BusSchedule.findAll({
        where: { [Op.or]: matchConditions },
        attributes: ['id'],
      });
      relatedTrips.forEach((t) => tripIds.add(Number(t.id)));
      relatedSchedules.forEach((s) => tripIds.add(Number(s.id)));
    }

    const validTripIds = Array.from(tripIds).filter((id) => id != null && !isNaN(id));

    const bookings = await Booking.findAll({
      where: {
        trip_id: validTripIds,
        travel_date,
        booking_status: 'confirmed',
        payment_status: { [Op.in]: ['paid', 'partial_refund', 'refunded'] },
        status: { [Op.notIn]: ['Cancelled', 'cancelled', 'CANCELLED', 'Payment Failed'] },
      },
      attributes: ['seat_numbers', 'total_seats'],
    });

    const bookedSeats = new Set();
    bookings.forEach((booking) => {
      const parsedSeats = SeatReservationService.parseSeatNumbers(booking.seat_numbers);
      if (parsedSeats.length > 0) {
        parsedSeats.forEach((seat) => bookedSeats.add(seat));
      }
    });

    const totalSeats = schedule.vehicle?.total_seats || schedule.bus_type?.total_seats || schedule.seat_capacity || 30;
    const availableSeats = Math.max(0, totalSeats - bookedSeats.size);

    // Generate seat layout
    const seatLayout = [];
    const rows = schedule.bus_type?.seat_rows || 6;
    const columns = schedule.bus_type?.seat_columns || 4;

    for (let row = 1; row <= rows; row++) {
      for (let col = 1; col <= columns; col++) {
        const seatNumber = `${row}${String.fromCharCode(64 + col)}`;
        const altSeatNumber = `${String.fromCharCode(64 + col)}${row}`;
        const seatIndexStr = String((row - 1) * columns + col);

        const isBooked = bookedSeats.has(seatNumber) || bookedSeats.has(altSeatNumber) || bookedSeats.has(seatIndexStr);

        seatLayout.push({
          seat_number: seatNumber,
          row,
          column: col,
          is_available: !isBooked,
        });
      }
    }

    const routeInfo = schedule.main_route || schedule.route;

    res.json({
      status: 200,
      success: true,
      message: 'Seat availability checked successfully',
      data: {
        schedule_id: schedule.id,
        schedule_code: schedule.schedule_code,
        bus_number: schedule.bus_number || null,
        travel_date,
        total_seats: totalSeats,
        booked_seats: bookedSeats.size,
        available_seats: availableSeats,
        booked_seat_numbers: Array.from(bookedSeats),
        seat_layout: seatLayout,
        schedule: {
          departure_time: schedule.departure_time,
          arrival_time: schedule.arrival_time,
          bus_type: schedule.bus_type,
          route: routeInfo,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── 6. Calculate Fare ─────────────────────────────────────────
exports.calculateFare = async (req, res, next) => {
  try {
    const body = req.body || {};
    const query = req.query || {};
    const rawScheduleId = query.schedule_id || body.schedule_id;
    const origin_stop_id = query.origin_stop_id || body.origin_stop_id;
    const destination_stop_id = query.destination_stop_id || body.destination_stop_id;
    const rawSeatCount = query.seat_count || body.seat_count || 1;
    const seat_count = Number(rawSeatCount);
    const coupon_id = query.coupon_id || body.coupon_id;
    const coupon_code = query.coupon_code || body.coupon_code;
    const passenger_id = query.passenger_id || body.passenger_id;
    const device_id = query.device_id || body.device_id;
    if (!Number.isInteger(seat_count) || seat_count < 1) {
      return res.status(400).json({ status: 400, success: false, message: 'seat_count must be a positive integer' });
    }

    if (!rawScheduleId) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: 'schedule_id is required',
      });
    }

    const schedule_id = Number(rawScheduleId) || rawScheduleId;

    let schedule = await BusSchedule.findByPk(schedule_id, {
      include: [
        { model: Route, as: 'main_route', required: false },
        { model: Route, as: 'route', required: false },
        { model: BusType, as: 'bus_type', required: false },
      ],
    });

    if (!schedule) {
      schedule = await Trip.findByPk(schedule_id, {
        include: [
          { model: Route, as: 'route', required: false },
          { model: BusType, as: 'bus_type', required: false },
        ],
      });
    }

    if (!schedule) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: 'Schedule not found',
      });
    }

    const scheduleRoute = schedule.route;
    const isLegacyRoute = scheduleRoute
      && !Object.prototype.hasOwnProperty.call(scheduleRoute.dataValues || {}, 'route_stops');
    const route = schedule.main_route || (isLegacyRoute ? scheduleRoute : null);
    const distance = Number(route?.total_distance) || 100;
    const farePerKm = 0;
    const baseFare = 0;
    const fallbackFare = 0;
    const fareResult = await resolveFare({
      routeId: route?.id,
      originStopId: origin_stop_id,
      destinationStopId: destination_stop_id,
      fallbackFare,
    });
    if (fareResult.error) return res.status(400).json({ status: 400, success: false, message: fareResult.error });

    const farePerSeat = fareResult.fare;
    const totalAmount = farePerSeat * seat_count;
    let discountAmount = 0;
    let appliedCoupon = null;
    if (coupon_id || coupon_code) {
      const couponResult = await calculateCouponDiscount({
        couponId: coupon_id,
        couponCode: coupon_code,
        amount: totalAmount,
        seatCount: seat_count,
        passengerId: passenger_id,
        deviceId: device_id,
      });
      if (couponResult.error) return res.status(400).json({ status: 400, success: false, message: couponResult.error });
      appliedCoupon = couponResult.coupon;
      discountAmount = couponResult.discount;
    }
    const finalAmount = Math.max(0, totalAmount - discountAmount);

    res.json({
      status: 200,
      success: true,
      message: 'Fare calculated successfully',
      data: {
        schedule_id: schedule.id,
        schedule_code: schedule.schedule_code,
        origin_stop_id,
        destination_stop_id,
        distance_km: distance,
        base_fare: farePerSeat,
        seat_count,
        fare_per_seat: farePerSeat,
        total_fare: totalAmount,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        coupon: appliedCoupon ? { id: appliedCoupon.id, code: appliedCoupon.code } : null,
        rate_source: fareResult.source,
        currency: 'INR',
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── 7. Get User Bookings ───────────────────────────────────────
const calcDistanceMeters = (lat1, lon1, lat2, lon2) => {
  const r = 6371000;
  const p = Math.PI / 180;
  const a = 0.5 - Math.cos((lat2 - lat1) * p) / 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p)) / 2;
  return r * 2 * Math.asin(Math.sqrt(a));
};

exports.getUserBookings = async (req, res, next) => {
  try {
    const body = req.body || {};
    const query = req.query || {};
    const booking_id = query.booking_id || body.booking_id;
    const passenger_id = query.passenger_id || body.passenger_id;
    const passenger_mobile = query.passenger_mobile || body.passenger_mobile;
    const booking_status = query.booking_status || body.booking_status;
    const travel_date = query.travel_date || body.travel_date;
    const page = query.page || body.page || 1;
    const limit = query.limit || body.limit || 20;

    const where = {};
    if (booking_id) {
      const parsedBookingId = Number(booking_id);
      if (!Number.isInteger(parsedBookingId) || parsedBookingId <= 0) {
        return res.status(400).json({ status: 400, success: false, message: 'booking_id must be a positive integer' });
      }
      where.id = parsedBookingId;
    }
    if (passenger_id) where.passenger_id = passenger_id;
    if (passenger_mobile) where.passenger_mobile = passenger_mobile;
    if (booking_status) where.booking_status = booking_status;
    if (travel_date) where.travel_date = travel_date;

    const { offset, limit: lim, page: p } = buildPagination(page, limit);

    const { count, rows } = await Booking.findAndCountAll({
      where,
      include: [
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
                attributes: ['id', 'stop_name', 'stop_code', 'stop_sequence', 'latitude', 'longitude', 'address', 'landmark'],
                required: false,
              },
                {
                  model: RouteStop,
                  as: 'route_stops',
                  required: false,
                  include: [{
                    model: Stop,
                    as: 'stop',
                    attributes: ['id', 'stop_name', 'stop_code', 'stop_sequence', 'latitude', 'longitude', 'address', 'landmark'],
                    required: false,
                  }],
                }],
              required: false,
            },
            { model: Vehicle, as: 'vehicle', attributes: ['id', 'registration_number', 'company_model', 'color', 'latitude', 'longitude', 'status'], required: false },
            {
              model: Driver,
              as: 'driver',
              attributes: ['id', 'name', 'mobile'],
              include: [{ model: DriverDetail, as: 'details', attributes: ['latitude', 'longitude', 'location_speed_kmh', 'location_heading', 'location_trip_id', 'updated_at'], required: false }],
              required: false,
            },
          ],
          required: false,
        },
        { model: Stop, as: 'origin_stop', attributes: ['id', 'stop_name', 'latitude', 'longitude', 'address'], required: false },
        { model: Stop, as: 'destination_stop', attributes: ['id', 'stop_name', 'latitude', 'longitude', 'address'], required: false },
        { model: CustomerUser, as: 'passenger', attributes: ['id', 'name', 'mobile', 'email'], required: false },
      ],
      offset,
      limit: lim,
      order: [['created_at', 'DESC']],
    });

    const enrichedBookings = rows.map((item) => {
      const b = item.toJSON();
      const trip = b.trip || {};
      const vehicle = trip.vehicle || {};
      const driver = trip.driver || {};
      const driverDetail = driver.details || {};
      const originStop = b.origin_stop || {};

      // Prefer route_stops ordering if available, else fallback to legacy stops
      if (trip.route?.route_stops && trip.route.route_stops.length > 0) {
        trip.route.stops = trip.route.route_stops
          .filter(rs => rs.stop)
          .sort((a, b) => Number(a.stop_sequence || 0) - Number(b.stop_sequence || 0))
          .map(rs => {
            const s = rs.stop;
            return {
              ...s.get ? s.get() : s,
              latitude: s.latitude == null ? null : Number(s.latitude),
              longitude: s.longitude == null ? null : Number(s.longitude),
              stop_sequence: rs.stop_sequence,
            };
          });
      } else if (trip.route?.stops) {
        trip.route.stops = trip.route.stops
          .slice()
          .sort((stopA, stopB) => (Number(stopA.stop_sequence) || 0) - (Number(stopB.stop_sequence) || 0))
          .map((stop) => ({
            ...stop,
            latitude: stop.latitude == null ? null : Number(stop.latitude),
            longitude: stop.longitude == null ? null : Number(stop.longitude),
          }));
      }

      const rawBusLat = driverDetail.latitude;
      const rawBusLng = driverDetail.longitude;
      const busLat = rawBusLat != null && rawBusLat !== '' ? Number(rawBusLat) : null;
      const busLng = rawBusLng != null && rawBusLng !== '' ? Number(rawBusLng) : null;
      const locationMatchesTrip = driverDetail.location_trip_id == null
        || Number(driverDetail.location_trip_id) === Number(trip.id);
      const hasDriverLocation = locationMatchesTrip
        && busLat != null && busLng != null
        && Number.isFinite(busLat) && Number.isFinite(busLng)
        && Math.abs(busLat) <= 90 && Math.abs(busLng) <= 180;

      const rawStopLat = originStop.latitude;
      const rawStopLng = originStop.longitude;
      const stopLat = rawStopLat != null && rawStopLat !== '' ? Number(rawStopLat) : null;
      const stopLng = rawStopLng != null && rawStopLng !== '' ? Number(rawStopLng) : null;

      let distanceMeters = null;
      let etaMinutes = null;

      if (hasDriverLocation && stopLat != null && stopLng != null && Number.isFinite(stopLat) && Number.isFinite(stopLng)) {
        distanceMeters = Math.round(calcDistanceMeters(busLat, busLng, stopLat, stopLng));
        const speedKmh = Number(driverDetail.location_speed_kmh) > 5 ? Number(driverDetail.location_speed_kmh) : 25;
        const speedMetersPerMin = (speedKmh * 1000) / 60;
        etaMinutes = Math.max(1, Math.round(distanceMeters / speedMetersPerMin));
      }

      b.tracking = {
        bus_status: trip.status || 'Scheduled',
        is_live: hasDriverLocation,
        current_location: hasDriverLocation ? {
          latitude: busLat,
          longitude: busLng,
          speed_kmh: Number(driverDetail.location_speed_kmh || 0),
          heading: Number(driverDetail.location_heading || 0),
          updated_at: driverDetail.updated_at || null,
        } : null,
        pickup_stoppage: {
          id: originStop.id || null,
          name: originStop.stop_name || null,
          latitude: stopLat,
          longitude: stopLng,
          address: originStop.address || null,
        },
        distance_to_stoppage_meters: distanceMeters,
        distance_to_stoppage_text: distanceMeters != null ? (distanceMeters >= 1000 ? `${(distanceMeters / 1000).toFixed(1)} km` : `${distanceMeters} meters`) : 'N/A',
        eta_minutes: etaMinutes,
        eta_text: etaMinutes != null ? `${etaMinutes} mins` : 'N/A',
      };

      return b;
    });

    res.json({
      status: 200,
      success: true,
      message: 'User bookings retrieved successfully',
      data: enrichedBookings,
      pagination: {
        total: count,
        page: p,
        limit: lim,
        pages: Math.ceil(count / lim),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── 8. Get Booking Details for Boarding Pass ───────────────────
exports.getBookingDetails = async (req, res, next) => {
  try {
    const body = req.body || {};
    const query = req.query || {};
    const booking_id = query.booking_id || body.booking_id;
    const booking_reference = query.booking_reference || body.booking_reference;
    const boarding_pass_code = query.boarding_pass_code || body.boarding_pass_code;

    const where = {};
    if (booking_id) where.id = booking_id;
    if (booking_reference) where.booking_reference = booking_reference;
    if (boarding_pass_code) where.boarding_pass_code = boarding_pass_code;

    if (!booking_id && !booking_reference && !boarding_pass_code) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: 'Either booking_id, booking_reference, or boarding_pass_code is required',
      });
    }

    const booking = await Booking.findOne({
      where,
      include: [
        { model: Trip, as: 'trip', include: [{ model: Route, as: 'route', required: false }], required: false },
        { model: Stop, as: 'origin_stop', attributes: ['id', 'stop_name', 'address'], required: false },
        { model: Stop, as: 'destination_stop', attributes: ['id', 'stop_name', 'address'], required: false },
      ],
    });

    if (!booking) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: 'Booking not found',
      });
    }

    // Format response for boarding pass
    const boardingPassData = {
      booking_id: booking.id,
      booking_reference: booking.booking_reference,
      passenger_name: booking.passenger_name,
      passenger_mobile: booking.passenger_mobile,
      passenger_email: booking.passenger_email,
      travel_date: booking.travel_date,
      seat_numbers: booking.seat_numbers,
      total_seats: booking.total_seats,
      total_fare: booking.total_fare,
      discount_amount: booking.discount_amount,
      final_amount: booking.final_amount,
      payment_status: booking.payment_status,
      booking_status: booking.booking_status,
      boarding_pass_code: booking.boarding_pass_code,
      boarding_pin: booking.boarding_pin,
      boarding_status: booking.boarding_status,
      boarded_at: booking.boarded_at,
      qr_token: booking.qr_token,
      trip: {
        trip_id: booking.trip?.id,
        schedule_code: booking.trip?.schedule_code,
        departure_time: booking.trip?.departure_time,
        arrival_time: booking.trip?.arrival_time,
        route: {
          route_name: booking.trip?.route?.route_name,
          origin_city: booking.trip?.route?.origin_city,
          destination_city: booking.trip?.route?.destination_city,
        },
        driver: booking.trip?.driver ? {
          id: booking.trip.driver.id,
          name: booking.trip.driver.name,
          mobile: booking.trip.driver.mobile,
          online_status: booking.trip.driver.online_status,
          photo: booking.trip.driver.photo,
        } : null,
        vehicle: booking.trip?.vehicle ? {
          id: booking.trip.vehicle.id,
          registration_number: booking.trip.vehicle.registration_number,
          company_model: booking.trip.vehicle.company_model,
        } : null,
      },
      origin_stop: booking.origin_stop,
      destination_stop: booking.destination_stop,
    };

    res.json({
      status: 200,
      success: true,
      message: 'Booking details retrieved successfully',
      data: boardingPassData,
    });
  } catch (err) {
    next(err);
  }
};

// ── 9. Cancel User Booking ────────────────────────────────────
exports.cancelUserBooking = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { booking_id, cancellation_reason } = req.body || {};

    if (!booking_id) {
      await t.rollback();
      return res.status(400).json({
        status: 400,
        success: false,
        message: 'booking_id is required',
      });
    }

    const booking = await Booking.findByPk(booking_id, { transaction: t });
    if (!booking) {
      await t.rollback();
      return res.status(404).json({
        status: 404,
        success: false,
        message: 'Booking not found',
      });
    }

    if (booking.booking_status === 'cancelled') {
      await t.rollback();
      return res.status(400).json({
        status: 400,
        success: false,
        message: 'Booking already cancelled',
      });
    }

    const isAdmin = req.user && (req.user.role || req.user.role_id);
    if (!isAdmin) {
      const trip = await Trip.findByPk(booking.trip_id, { transaction: t });
      const originStop = booking.origin_stop_id ? await Stop.findByPk(booking.origin_stop_id, { transaction: t }) : null;
      const driverDetail = trip && trip.driver_id ? await DriverDetail.findOne({ where: { driver_id: trip.driver_id }, transaction: t }) : null;
      const etaInfo = await getEtaMinutesToPickup({ driverDetail: driverDetail || {}, originStop: originStop || {} });
      if (!etaInfo || etaInfo.eta_minutes <= 30) {
        await t.rollback();
        return res.status(400).json({
          status: 400,
          success: false,
          message: etaInfo ? 'Cancellation is allowed only when the road-route ETA to your pickup stop is more than 30 minutes.' : 'Cancellation is blocked because a live road-route ETA to your pickup stop is not available.',
          data: etaInfo ? { eta_minutes: Math.round(etaInfo.eta_minutes), distance_meters: Math.round(etaInfo.distance_meters) } : null,
        });
      }
    }

    const wasSeatAllocated = booking.booking_status === 'confirmed' && booking.payment_status === 'paid';
    await booking.update(
      {
        booking_status: 'cancelled',
        status: 'Cancelled',
        cancellation_reason: cancellation_reason || 'Cancelled by user',
        cancelled_at: new Date(),
      },
      { transaction: t }
    );

    // Decrement booked seats in trip
    const trip = await Trip.findByPk(booking.trip_id, { transaction: t });
    if (trip && wasSeatAllocated) {
      await trip.decrement('booked_seats', { by: booking.total_seats, transaction: t });
    }

    if (booking.payment_status === 'paid') {
      const passenger = booking.passenger_id
        ? await CustomerUser.findByPk(booking.passenger_id, { transaction: t })
        : await CustomerUser.findOne({ where: { mobile: booking.passenger_mobile }, transaction: t });
      const payment = await Payment.findOne({
        where: { booking_id: booking.id, status: ['captured', 'partial_refund'] },
        order: [['created_at', 'DESC']],
        transaction: t,
      });
      await Refund.create({
        booking_id: booking.id,
        payment_id: payment?.id || null,
        passenger_id: passenger?.id || booking.passenger_id,
        refund_reference: `REF-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        refund_amount: booking.final_amount,
        refund_reason: cancellation_reason || 'Cancelled by user',
        status: 'pending',
      }, { transaction: t });
    }

    await t.commit();

    res.json({
      status: 200,
      success: true,
      message: 'Booking cancelled successfully',
      data: {
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        booking_status: booking.booking_status,
        payment_status: booking.payment_status,
        cancelled_at: booking.cancelled_at,
      },
    });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ── 10. Public Create Booking ──────────────────────────────────
exports.createBooking = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const body = req.body || {};
    const {
      trip_id,
      schedule_id,
      passenger_id,
      passenger_name,
      passenger_mobile,
      passenger_email,
      origin_stop_id,
      destination_stop_id,
      travel_date,
      seat_numbers,
      total_seats,
      payment_method,
      use_wallet,
      coupon_id,
      coupon_code,
      device_id,
      special_requests
    } = body;

    const tripIdsToTry = [...new Set([trip_id, schedule_id].filter((id) => id != null && id !== ''))];

    if (tripIdsToTry.length === 0) {
      await t.rollback();
      return res.status(400).json({ status: 400, success: false, message: 'trip_id or schedule_id is required' });
    }

    if (!Number.isInteger(Number(passenger_id)) || Number(passenger_id) <= 0) {
      await t.rollback();
      return res.status(400).json({ status: 400, success: false, message: 'A valid passenger_id is required' });
    }

    if (!passenger_name || !passenger_mobile) {
      await t.rollback();
      return res.status(400).json({ status: 400, success: false, message: 'passenger_name and passenger_mobile are required' });
    }

    const passengerUser = await CustomerUser.findOne({
      where: { id: passenger_id, mobile: String(passenger_mobile).trim() },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!passengerUser) {
      await t.rollback();
      return res.status(404).json({ status: 404, success: false, message: 'Passenger user was not found or mobile does not match' });
    }
    if (passengerUser.status === 'Inactive' || passengerUser.block_status === 'Block') {
      await t.rollback();
      return res.status(403).json({ status: 403, success: false, message: 'Passenger account is not active' });
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
          status: 409,
          success: false,
          message: 'Selected trip is scheduled for a different travel date',
          data: { trip_id: dateMismatchTrip.id, trip_date: dateMismatchTrip.trip_date, requested_travel_date: requestedTravelDate },
        });
      }
      return res.status(404).json({ status: 404, success: false, message: 'Trip not found' });
    }

    if (!['Scheduled', 'Active'].includes(String(trip.status))) {
      await t.rollback();
      return res.status(409).json({
        status: 409,
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
          status: 400,
          success: false,
          message: 'Pickup and destination stops must belong to the selected trip route',
          code: 'STOP_NOT_ON_TRIP_ROUTE',
          data: { trip_id: trip.id, route_id: trip.route_id, invalid_stop_ids: invalidStopIds },
        });
      }
    }

    const rawSeatInput = seat_numbers || body.seat_number || body.seats;
    const requestedSeats = SeatReservationService.parseSeatNumbers(rawSeatInput);

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

    const effectiveCapacity = trip.vehicle?.total_seats || trip.bus_type?.total_seats || trip.seat_capacity || 30;
    const numSeats = total_seats || (requestedSeats.length > 0 ? requestedSeats.length : 1);
    const available = effectiveCapacity - (trip.booked_seats || 0);
    if (available < numSeats) {
      await t.rollback();
      return res.status(409).json({ status: 409, success: false, message: `Only ${available} seats available` });
    }

    const fareResult = await resolveFare({
      routeId: trip.route_id,
      originStopId: origin_stop_id,
      destinationStopId: destination_stop_id,
      fallbackFare: trip.base_fare,
      transaction: t,
    });
    if (fareResult.error) {
      await t.rollback();
      return res.status(400).json({ status: 400, success: false, message: fareResult.error });
    }

    let total_fare = fareResult.fare * numSeats;
    let discount_amount = 0;
    let appliedCoupon = null;

    if (coupon_id || coupon_code) {
      const couponResult = await calculateCouponDiscount({
        couponId: coupon_id,
        couponCode: coupon_code,
        amount: total_fare,
        seatCount: numSeats,
        passengerId: passengerUser.id,
        deviceId: device_id,
        transaction: t,
        lock: true,
      });
      if (couponResult.error) {
        await t.rollback();
        return res.status(400).json({ status: 400, success: false, message: couponResult.error });
      }
      appliedCoupon = couponResult.coupon;
      discount_amount = couponResult.discount;
      await appliedCoupon.increment('used_count', { by: 1, transaction: t });
    }

    const final_amount = Math.max(0, total_fare - discount_amount);
    const walletPaymentRequested = use_wallet === true || String(use_wallet).toLowerCase() === 'true' || payment_method === 'wallet';
    let walletBalanceAfter = null;
    if (walletPaymentRequested) {
      const currentBalance = Number(passengerUser.wallet_balance || 0);
      if (currentBalance < final_amount) {
        await t.rollback();
        return res.status(409).json({
          status: 409,
          success: false,
          message: 'Insufficient wallet balance',
          data: { required_amount: final_amount, wallet_balance: currentBalance },
        });
      }
      walletBalanceAfter = Math.round((currentBalance - final_amount) * 100) / 100;
      await passengerUser.update({ wallet_balance: walletBalanceAfter }, { transaction: t });
    }

    const booking_reference = `BK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const booking = await Booking.create({
      booking_reference,
      trip_id: trip.id,
      passenger_id: passengerUser.id,
      passenger_name,
      passenger_mobile,
      passenger_email: passenger_email || null,
      origin_stop_id: origin_stop_id || null,
      destination_stop_id: destination_stop_id || null,
      travel_date: travel_date || trip.trip_date,
      seat_numbers,
      total_seats: numSeats,
      total_fare,
      discount_amount,
      final_amount,
      payment_method: walletPaymentRequested ? 'wallet' : (payment_method || 'cash'),
      coupon_id: appliedCoupon?.id || null,
      special_requests: special_requests || null,
      boarding_pass_code: null,
      boarding_pin: null,
      booking_status: 'pending',
      payment_status: (walletPaymentRequested || final_amount <= 0) ? 'paid' : 'pending',
      qr_token: null,
    }, { transaction: t });

    if (appliedCoupon) {
      await CouponUsage.create({
        coupon_id: appliedCoupon.id,
        booking_id: booking.id,
        passenger_id: passengerUser.id,
        device_id: device_id ? String(device_id).trim() : null,
        discount_amount,
      }, { transaction: t });
    }

    if (walletPaymentRequested) {
      await WalletTransaction.create({
        passenger_id: passengerUser.id,
        type: 'debit',
        amount: final_amount,
        balance_after: walletBalanceAfter,
        source: 'booking',
        reference_type: 'booking',
        reference_id: String(booking.id),
        description: `Wallet payment for booking ${booking_reference}`,
      }, { transaction: t });
      await Payment.create({
        booking_id: booking.id,
        passenger_id: passengerUser.id,
        amount: final_amount,
        currency: 'INR',
        payment_method: 'wallet',
        payment_gateway: 'wallet',
        status: 'captured',
        event: 'wallet_payment_captured',
        payload: { booking_reference },
      }, { transaction: t });
    }

    if (walletPaymentRequested || final_amount <= 0) {
      await confirmPaidBooking({ booking, transaction: t });
    }

    await t.commit();
    const bookingData = booking.toJSON();
    res.status(201).json({
      status: 201,
      success: true,
      message: walletPaymentRequested ? 'Booking created and paid from wallet' : final_amount <= 0 ? 'Booking confirmed with no payment due' : 'Booking created and awaiting payment',
      data: {
        booking_id: booking.id,
        ...bookingData,
        ...(walletPaymentRequested ? { wallet_balance: walletBalanceAfter } : {}),
      }
    });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ── 15. Public Mobile App Cancel Booking ────────────────────
// exports.cancelBooking = async (req, res, next) => {
//   const t = await sequelize.transaction();
//   try {
//     const booking_id = req.body?.booking_id || req.body?.id || req.query?.booking_id || req.query?.id;
//     const booking_reference = req.body?.booking_reference || req.query?.booking_reference;
//     const cancellation_reason = req.body?.cancellation_reason || req.body?.reason || 'Cancelled by passenger';
//     const passenger_mobile = req.body?.passenger_mobile || req.query?.passenger_mobile;

//     if (!booking_id && !booking_reference) {
//       await t.rollback();
//       return res.status(400).json({
//         status: 400,
//         success: false,
//         message: 'booking_id or booking_reference is required',
//       });
//     }

//     const where = {};
//     if (booking_id) where.id = booking_id;
//     if (booking_reference) where.booking_reference = booking_reference;

//     const booking = await Booking.findOne({ where, transaction: t });
//     if (!booking) {
//       await t.rollback();
//       return res.status(404).json({
//         status: 404,
//         success: false,
//         message: 'Booking not found',
//       });
//     }

//     // Optional mobile mismatch check if provided
//     if (passenger_mobile && booking.passenger_mobile && String(booking.passenger_mobile).trim() !== String(passenger_mobile).trim()) {
//       await t.rollback();
//       return res.status(403).json({
//         status: 403,
//         success: false,
//         message: 'Passenger mobile mismatch for this booking',
//       });
//     }

//     if (booking.booking_status === 'cancelled') {
//       await t.rollback();
//       return res.status(400).json({
//         status: 400,
//         success: false,
//         message: 'Booking is already cancelled',
//       });
//     }

//     const isAdmin = req.user && (req.user.role || req.user.role_id);
//     if (!isAdmin) {
//       const trip = await Trip.findByPk(booking.trip_id, { transaction: t });
//       const originStop = booking.origin_stop_id ? await Stop.findByPk(booking.origin_stop_id, { transaction: t }) : null;
//       const driverDetail = trip && trip.driver_id ? await DriverDetail.findOne({ where: { driver_id: trip.driver_id }, transaction: t }) : null;
//       const etaInfo = await getEtaMinutesToPickup({ driverDetail: driverDetail || {}, originStop: originStop || {} });
//       if (!etaInfo || etaInfo.eta_minutes <= 30) {
//         console.log(etaInfo);
        
//         await t.rollback();
//         return res.status(400).json({
//           status: 400,
//           success: false,
//           message: etaInfo ? 'Cancellation is allowed only when the road-route ETA to your pickup stop is more than 30 minutes.' : 'Cancellation is blocked because a live road-route ETA to your pickup stop is not available.',
//           data: etaInfo ? { eta_minutes: Math.round(etaInfo.eta_minutes), distance_meters: Math.round(etaInfo.distance_meters) } : null,
//         });
//       }
//     }

//     const wasSeatAllocated = booking.booking_status === 'confirmed' && booking.payment_status === 'paid';
//     // Update booking status
//     await booking.update({
//       booking_status: 'cancelled',
//       status: 'Cancelled',
//       cancellation_reason,
//       cancelled_at: new Date(),
//     }, { transaction: t });

//     // Decrement booked seats on associated trip
//     if (booking.trip_id) {
//       const trip = await Trip.findByPk(booking.trip_id, { transaction: t });
//       if (trip && wasSeatAllocated && trip.booked_seats > 0) {
//         await trip.decrement('booked_seats', {
//           by: Math.min(trip.booked_seats, booking.total_seats || 1),
//           transaction: t,
//         });
//       }
//     }

//     // Record the refund request; only the admin refund flow submits it to PayU.
//     let refundRecord = null;

//     if (booking.payment_status === 'paid' && booking.final_amount > 0) {
//       const payment = await Payment.findOne({
//         where: { booking_id: booking.id, status: ['captured', 'partial_refund'] },
//         order: [['created_at', 'DESC']],
//         transaction: t,
//       });
//       const refundRef = `REF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

//       refundRecord = await Refund.create({
//         booking_id: booking.id,
//         payment_id: payment?.id || null,
//         passenger_id: booking.passenger_id || null,
//         refund_reference: refundRef,
//         refund_amount: booking.final_amount,
//         refund_reason: cancellation_reason,
//         refund_method: payment?.payu_mihpayid ? 'payu' : null,
//         status: 'pending',
//       }, { transaction: t });
//     }

//     await t.commit();

//     res.status(200).json({
//       status: 200,
//       success: true,
//       message: refundRecord
//         ? 'Booking cancelled. Refund request is pending admin processing through PayU.'
//         : 'Booking cancelled successfully',
//       data: {
//         booking_id: booking.id,
//         booking_reference: booking.booking_reference,
//         booking_status: 'cancelled',
//         refund: refundRecord ? {
//           refund_id: refundRecord.id,
//           refund_reference: refundRecord.refund_reference,
//           refund_amount: Number(refundRecord.refund_amount),
//           refund_status: refundRecord.status,
//           refund_method: refundRecord.refund_method,
//         } : null,
//       },
//     });
//   } catch (err) {
//     await t.rollback();
//     next(err);
//   }
// };



exports.cancelBooking = async (req, res, next) => {
  const t = await sequelize.transaction();

  try {
    const booking_id =
      req.body?.booking_id ||
      req.body?.id ||
      req.query?.booking_id ||
      req.query?.id;

    const booking_reference =
      req.body?.booking_reference ||
      req.query?.booking_reference;

    const cancellation_reason =
      req.body?.cancellation_reason ||
      req.body?.reason ||
      'Cancelled by passenger';

    const passenger_mobile =
      req.body?.passenger_mobile ||
      req.query?.passenger_mobile;

    // --------------------------------------------------
    // 1. VALIDATE BOOKING IDENTIFIER
    // --------------------------------------------------
    if (!booking_id && !booking_reference) {
      await t.rollback();

      return res.status(400).json({
        status: 400,
        success: false,
        message: 'booking_id or booking_reference is required',
      });
    }

    const where = {};

    if (booking_id) {
      where.id = booking_id;
    }

    if (booking_reference) {
      where.booking_reference = booking_reference;
    }

    const booking = await Booking.findOne({
      where,
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!booking) {
      await t.rollback();

      return res.status(404).json({
        status: 404,
        success: false,
        message: 'Booking not found',
      });
    }

    // --------------------------------------------------
    // 2. OPTIONAL PASSENGER MOBILE VALIDATION
    // --------------------------------------------------
    if (
      passenger_mobile &&
      booking.passenger_mobile &&
      String(booking.passenger_mobile).trim() !==
        String(passenger_mobile).trim()
    ) {
      await t.rollback();

      return res.status(403).json({
        status: 403,
        success: false,
        message: 'Passenger mobile mismatch for this booking',
      });
    }

    // --------------------------------------------------
    // 3. CHECK BOOKING STATUS
    // --------------------------------------------------
    if (booking.booking_status === 'cancelled') {
      await t.rollback();

      return res.status(400).json({
        status: 400,
        success: false,
        message: 'Booking is already cancelled',
      });
    }

    // --------------------------------------------------
    // 4. CHECK ADMIN
    // --------------------------------------------------
    const isAdmin = Boolean(
      req.user && (req.user.role || req.user.role_id)
    );

    // --------------------------------------------------
    // 5. DRIVER ETA CANCELLATION RESTRICTION
    //
    // Rules:
    // - Future trip date: skip ETA restriction.
    // - Active trip today or in the past: check ETA.
    // - Scheduled or other statuses: skip ETA restriction.
    // - Admin: skip ETA restriction.
    // --------------------------------------------------
    if (!isAdmin && booking.trip_id) {
      const trip = await Trip.findByPk(booking.trip_id, {
        transaction: t,
      });

      if (trip && trip.status === 'Active') {
        // MySQL DATE / Sequelize DATEONLY is normally YYYY-MM-DD.
        const tripDate = trip.trip_date
          ? String(trip.trip_date).slice(0, 10)
          : null;

        // Get today's date in India, independent of server timezone.
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(new Date());

        const dateParts = {};

        for (const part of parts) {
          if (part.type !== 'literal') {
            dateParts[part.type] = part.value;
          }
        }

        const todayStr =
          `${dateParts.year}-${dateParts.month}-${dateParts.day}`;

        console.log('[CANCELLATION ETA CHECK]', {
          trip_id: trip.id,
          trip_status: trip.status,
          trip_date: tripDate,
          today: todayStr,
        });

        // A future-dated trip should not trigger the ETA restriction.
        if (tripDate && tripDate <= todayStr) {
          const originStop = booking.origin_stop_id
            ? await Stop.findByPk(booking.origin_stop_id, {
                transaction: t,
              })
            : null;

          const driverDetail = trip.driver_id
            ? await DriverDetail.findOne({
                where: { driver_id: trip.driver_id },
                transaction: t,
              })
            : null;

          const etaInfo = await getEtaMinutesToPickup({
            driverDetail: driverDetail || {},
            originStop: originStop || {},
          });

          const etaMinutes = Number(etaInfo?.eta_minutes);
          const distanceMeters = Number(etaInfo?.distance_meters);

          // Missing/invalid ETA must not silently allow cancellation.
          if (
            !etaInfo ||
            !Number.isFinite(etaMinutes) ||
            etaMinutes < 0
          ) {
            await t.rollback();

            return res.status(400).json({
              status: 400,
              success: false,
              message:
                'Cancellation is blocked because the driver-to-pickup ETA is unavailable.',
              data: null,
            });
          }

          // Conservative lower bound for urban shuttle travel time.
          // Configure CANCELLATION_ETA_MIN_AVG_SPEED_KMH in .env.
          const configuredSpeed = Number(
            process.env.CANCELLATION_ETA_MIN_AVG_SPEED_KMH || 25
          );

          const minimumAverageSpeed =
            Number.isFinite(configuredSpeed) && configuredSpeed > 0
              ? configuredSpeed
              : 25;

          const distanceBasedEta =
            Number.isFinite(distanceMeters) && distanceMeters > 0
              ? (distanceMeters / 1000 / minimumAverageSpeed) * 60
              : 0;

          // Use whichever estimate is longer.
          const effectiveEta = Math.max(
            etaMinutes,
            distanceBasedEta
          );

          console.log('[CANCELLATION ETA RESULT]', {
            road_distance_meters: distanceMeters,
            provider_eta_minutes: etaMinutes,
            distance_based_minimum_minutes: distanceBasedEta,
            effective_eta_minutes: effectiveEta,
          });

          if (effectiveEta <= 30) {
            await t.rollback();

            return res.status(400).json({
              status: 400,
              success: false,
              message:
                'Cancellation is not allowed when the driver is 30 minutes or less from the pickup stop.',
              data: {
                eta_minutes: Number(effectiveEta.toFixed(2)),
                provider_eta_minutes: Number(etaMinutes.toFixed(2)),
                distance_meters: Number.isFinite(distanceMeters)
                  ? Math.round(distanceMeters)
                  : null,
              },
            });
          }
        }
      }
    }

    // --------------------------------------------------
    // 6. DETERMINE WHETHER SEATS WERE ALLOCATED
    // --------------------------------------------------
    const wasSeatAllocated =
      booking.booking_status === 'confirmed' &&
      booking.payment_status === 'paid';

    // --------------------------------------------------
    // 7. CANCEL BOOKING
    // --------------------------------------------------
    await booking.update(
      {
        booking_status: 'cancelled',
        status: 'Cancelled',
        cancellation_reason,
        cancelled_at: new Date(),
      },
      { transaction: t }
    );

    // --------------------------------------------------
    // 8. RELEASE BOOKED SEATS
    // --------------------------------------------------
    if (booking.trip_id && wasSeatAllocated) {
      const trip = await Trip.findByPk(booking.trip_id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (trip && Number(trip.booked_seats) > 0) {
        const seatsToRelease = Math.min(
          Number(trip.booked_seats),
          Number(booking.total_seats || 1)
        );

        await trip.decrement('booked_seats', {
          by: seatsToRelease,
          transaction: t,
        });
      }
    }

    // --------------------------------------------------
    // 9. CREATE REFUND REQUEST
    // Actual PayU refund remains in the admin refund flow.
    // --------------------------------------------------
    let refundRecord = null;

    if (
      booking.payment_status === 'paid' &&
      Number(booking.final_amount) > 0
    ) {
      const payment = await Payment.findOne({
        where: {
          booking_id: booking.id,
          status: ['captured', 'partial_refund'],
        },
        order: [['created_at', 'DESC']],
        transaction: t,
      });

      const refundRef =
        `REF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      refundRecord = await Refund.create(
        {
          booking_id: booking.id,
          payment_id: payment?.id || null,
          passenger_id: booking.passenger_id || null,
          refund_reference: refundRef,
          refund_amount: booking.final_amount,
          refund_reason: cancellation_reason,
          refund_method: payment?.payu_mihpayid ? 'payu' : null,
          status: 'pending',
        },
        { transaction: t }
      );
    }

    // --------------------------------------------------
    // 10. COMMIT TRANSACTION
    // --------------------------------------------------
    await t.commit();

    return res.status(200).json({
      status: 200,
      success: true,
      message: refundRecord
        ? 'Booking cancelled. Refund request is pending admin processing through PayU.'
        : 'Booking cancelled successfully',
      data: {
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        booking_status: 'cancelled',
        refund: refundRecord
          ? {
              refund_id: refundRecord.id,
              refund_reference: refundRecord.refund_reference,
              refund_amount: Number(refundRecord.refund_amount),
              refund_status: refundRecord.status,
              refund_method: refundRecord.refund_method,
            }
          : null,
      },
    });
  } catch (err) {
    if (!t.finished) {
      await t.rollback();
    }

    return next(err);
  }
};
