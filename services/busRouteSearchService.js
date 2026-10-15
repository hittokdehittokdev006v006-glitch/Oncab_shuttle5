'use strict';

const { Op } = require('sequelize');
const { Route, Stop, RouteStop, BusRoute, BusStop, BusSchedule, Trip, BusType, RateChart, Booking } = require('../models');
const { syncRouteStopsTable } = require('../utils/routeStopMigrator');
const { resolveFare } = require('../utils/fareCalculator');
const {
  formatDistance,
  getConfiguredSearchRadiusKm,
  resolveLocation,
  normalizeText,
} = require('./busStopSearchService');

/**
 * Convert HH:MM / HH:MM:SS string to minutes from midnight
 */
const getMinutesFromMidnight = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const parts = timeStr.split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
};

/**
 * Format 24h time string to 12h AM/PM
 */
const format12HourTime = (timeStr, offsetMins = 0) => {
  if (!timeStr) return '';
  let baseMins = getMinutesFromMidnight(timeStr);
  let totalMins = (baseMins + offsetMins) % (24 * 60);
  if (totalMins < 0) totalMins += 24 * 60;

  const h24 = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  const mmStr = String(m).padStart(2, '0');
  return `${h12}:${mmStr} ${ampm}`;
};

/**
 * Format Date String YYYY-MM-DD
 */
const formatDateStr = (val) => {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
};

/**
 * Check if schedule can operate on a given date
 */
const scheduleCanRunOnDate = (sch, searchDateStr) => {
  if (!sch || !searchDateStr) return false;
  const validFrom = formatDateStr(sch.valid_from);
  const validUntil = formatDateStr(sch.valid_until);
  const tripDate = formatDateStr(sch.trip_date);

  if (validFrom && validFrom > searchDateStr) return false;
  if (validUntil && validUntil < searchDateStr) return false;
  if (tripDate) return tripDate === searchDateStr;

  if (!sch.operating_days) return true;

  const str = String(sch.operating_days).toLowerCase().trim();
  if (['daily', 'all', 'everyday', '7', '1,2,3,4,5,6,7'].includes(str)) return true;

  const searchDateObj = new Date(`${searchDateStr}T00:00:00.000Z`);
  const dayOfWeek = isNaN(searchDateObj.getUTCDay()) ? 0 : searchDateObj.getUTCDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek; // 1 = Mon ... 7 = Sun
  const dayNamesShort = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayNamesFull = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayNameShort = dayNamesShort[dayOfWeek];
  const dayNameFull = dayNamesFull[dayOfWeek];

  if (str === 'weekdays' && isoDay >= 1 && isoDay <= 5) return true;
  if (str === 'weekends' && (isoDay === 6 || isoDay === 7)) return true;

  const tokens = str.split(/[,;:\s]+/).map((s) => s.trim().toLowerCase());
  return (
    tokens.includes(String(isoDay)) ||
    tokens.includes(String(dayOfWeek)) ||
    tokens.includes(dayNameShort) ||
    tokens.includes(dayNameFull)
  );
};

/**
 * Main Cityflo-Style Route Search Service
 */
class BusRouteSearchService {
  /**
   * Search routes matching pickup & dropoff candidates
   */
  static async search(params) {
    const {
      pickupInput,
      dropoffInput,
      travelDateInput,
      passengersInput,
      busTypeId,
    } = params;

    const todayStr = new Date().toISOString().split('T')[0];
    const travelDate = travelDateInput || todayStr;
    const reqPassengers = parseInt(passengersInput || 1, 10);
    const searchRadiusKm = await getConfiguredSearchRadiusKm();
    const hasPickupCoordinates = pickupInput?.latitude != null && pickupInput?.longitude != null
      && Number.isFinite(Number(pickupInput.latitude)) && Number.isFinite(Number(pickupInput.longitude));
    const hasDropoffCoordinates = dropoffInput?.latitude != null && dropoffInput?.longitude != null
      && Number.isFinite(Number(dropoffInput.latitude)) && Number.isFinite(Number(dropoffInput.longitude));

    // 1. Resolve Pickup & Dropoff Stop Candidates
    const pickupCandidates = await resolveLocation(pickupInput, 'pickup', {
      radiusKm: searchRadiusKm,
      strictCoordinates: hasPickupCoordinates,
      allowExpandedRadius: !hasPickupCoordinates,
    });
    const dropoffCandidates = await resolveLocation(dropoffInput, 'dropoff', {
      radiusKm: searchRadiusKm,
      strictCoordinates: hasDropoffCoordinates,
      allowExpandedRadius: !hasDropoffCoordinates,
    });

    const topResolvedPickup = pickupCandidates.length > 0 ? pickupCandidates[0] : null;
    const topResolvedDropoff = dropoffCandidates.length > 0 ? dropoffCandidates[0] : null;

    if (!topResolvedPickup || !topResolvedDropoff) {
      return this.formatNoRoutesResponse({
        pickupInput,
        dropoffInput,
        travelDate,
        reqPassengers,
        topResolvedPickup,
        topResolvedDropoff,
        searchRadiusKm,
        message: 'Could not resolve pickup or dropoff within the configured OpenStreetMap road-distance radius',
      });
    }

    // Ensure table migration runs
    await syncRouteStopsTable();

    // 2. Fetch All Active Routes & Route Stops from Database
    let routes = await Route.findAll({
      where: {
        deleted_at: null,
        status: { [Op.notIn]: ['Inactive', 'inactive', 'Disabled', 'disabled'] },
      },
      include: [
        { model: Stop, as: 'stops', required: false },
        {
          model: RouteStop,
          as: 'route_stops',
          required: false,
          include: [{ model: Stop, as: 'stop', required: false }],
        },
      ],
    });

    if (routes && routes.length > 0) {
      routes = await Promise.all(
        routes.map(async (r) => {
          const routeObj = r.toJSON();
          let finalStops = [];
          if (routeObj.route_stops && routeObj.route_stops.length > 0) {
            finalStops = routeObj.route_stops
              .filter((rs) => rs.stop)
              .sort((a, b) => Number(a.stop_sequence || 0) - Number(b.stop_sequence || 0))
              .map((rs) => ({
                id: Number(rs.stop.id),
                stop_id: Number(rs.stop.id),
                stop_name: rs.stop.stop_name,
                name: rs.stop.stop_name,
                stop_sequence: Number(rs.stop_sequence || 1),
                travel_time_minutes: Number(rs.travel_time_minutes) || 0,
                latitude: parseFloat(rs.stop.latitude),
                longitude: parseFloat(rs.stop.longitude),
                address: rs.stop.address,
                landmark: rs.stop.landmark,
                pickup_allowed: rs.pickup_allowed !== false,
                dropoff_allowed: rs.dropoff_allowed !== false,
              }));
          } else if (routeObj.stops && routeObj.stops.length > 0) {
            // Fetch real travel_time_minutes from route_stops table
            const rsRows = await RouteStop.findAll({ where: { route_id: r.id }, attributes: ['stop_id', 'travel_time_minutes'], raw: true });
            const ttMap = new Map(rsRows.map(row => [Number(row.stop_id), Number(row.travel_time_minutes) || 0]));
            finalStops = routeObj.stops
              .sort((a, b) => Number(a.stop_sequence || 0) - Number(b.stop_sequence || 0))
              .map((s) => ({
                id: Number(s.id),
                stop_id: Number(s.id),
                stop_name: s.stop_name,
                name: s.stop_name,
                stop_sequence: Number(s.stop_sequence || 1),
                travel_time_minutes: ttMap.get(Number(s.id)) || 0,
                latitude: parseFloat(s.latitude),
                longitude: parseFloat(s.longitude),
                address: s.address,
                landmark: s.landmark,
                pickup_allowed: true,
                dropoff_allowed: true,
              }));
          } else {
            // Additional fallback: query legacy Stop table by route_id directly
            const directStops = await Stop.findAll({
              where: { route_id: r.id },
              order: [['stop_sequence', 'ASC']],
            });
            if (directStops && directStops.length > 0) {
              // Fetch real travel_time_minutes from route_stops table
              const rsRows = await RouteStop.findAll({ where: { route_id: r.id }, attributes: ['stop_id', 'travel_time_minutes'], raw: true });
              const ttMap = new Map(rsRows.map(row => [Number(row.stop_id), Number(row.travel_time_minutes) || 0]));
              finalStops = directStops.map((s) => ({
                id: Number(s.id),
                stop_id: Number(s.id),
                stop_name: s.stop_name,
                name: s.stop_name,
                stop_sequence: Number(s.stop_sequence || 1),
                travel_time_minutes: ttMap.get(Number(s.id)) || 0,
                latitude: parseFloat(s.latitude),
                longitude: parseFloat(s.longitude),
                address: s.address,
                landmark: s.landmark,
                pickup_allowed: true,
                dropoff_allowed: true,
              }));
            }
          }
          routeObj.stops = finalStops;
          return routeObj;
        })
      );
    }

    if (!routes || routes.length === 0) {
      routes = await BusRoute.findAll({
        where: { status: { [Op.notIn]: ['Inactive', 'inactive'] } },
        include: [
          { model: BusStop, as: 'stops', required: false },
        ],
      });
    }

    // Extract user input coordinates if available
    // 3. Search Direct Candidate Routes
    const directCandidates = await this.findMatchingRoutes({
      routes,
      pickupCandidates,
      dropoffCandidates,
      travelDate,
      reqPassengers,
      busTypeId,
      hasPickupCoordinates,
      hasDropoffCoordinates,
    });

    const nearbyCandidates = [];
    const finalCandidates = directCandidates;

    return this.buildFormattedSearchResponse({
      pickupInput,
      dropoffInput,
      travelDate,
      reqPassengers,
      topResolvedPickup,
      topResolvedDropoff,
      searchRadiusKm,
      directCandidates,
      nearbyCandidates,
      finalCandidates,
    });
  }

  /**
   * Find routes matching candidate stops and validating stop order direction (pickup_seq < dropoff_seq)
   */
  static async findMatchingRoutes(opts) {
    const {
      routes,
      pickupCandidates,
      dropoffCandidates,
      travelDate,
      reqPassengers,
      busTypeId,
      hasPickupCoordinates = false,
      hasDropoffCoordinates = false,
    } = opts;

    const matchedResults = [];
    const pickupIds = new Set(pickupCandidates.map((c) => Number(c.id || c.stop_id)));
    const dropoffIds = new Set(dropoffCandidates.map((c) => Number(c.id || c.stop_id)));

    for (const route of routes) {
      const stops = (route.stops || []).sort((a, b) => Number(a.stop_sequence || 0) - Number(b.stop_sequence || 0));
      if (stops.length < 2) continue;

      // Find all matching pickup stops on this route
      const matchingPickupStops = stops.filter((s) => {
        const sId = Number(s.id || s.stop_id);
        const nameNorm = normalizeText(s.stop_name || s.name);
        if (hasPickupCoordinates) return pickupIds.has(sId);
        return (
          pickupIds.has(sId) ||
          pickupCandidates.some(
            (c) => Number(c.id || c.stop_id) === sId || normalizeText(c.name) === nameNorm
          )
        );
      });

      if (matchingPickupStops.length === 0) continue;

      // Find all matching dropoff stops on this route
      const matchingDropoffStops = stops.filter((s) => {
        const sId = Number(s.id || s.stop_id);
        const nameNorm = normalizeText(s.stop_name || s.name);
        if (hasDropoffCoordinates) return dropoffIds.has(sId);
        return (
          dropoffIds.has(sId) ||
          dropoffCandidates.some(
            (c) => Number(c.id || c.stop_id) === sId || normalizeText(c.name) === nameNorm
          )
        );
      });

      if (matchingDropoffStops.length === 0) continue;

      // DIRECTION VALIDATION: Check all valid pairs and select the pair with the shortest total road distance
      const validPairs = [];
      for (const pStop of matchingPickupStops) {
        const pSeq = Number(pStop.stop_sequence || 1);
        for (const dStop of matchingDropoffStops) {
          const dSeq = Number(dStop.stop_sequence || 2);

          const pickupCandidate = pickupCandidates.find((candidate) => Number(candidate.id || candidate.stop_id) === Number(pStop.id || pStop.stop_id));
          const dropoffCandidate = dropoffCandidates.find((candidate) => Number(candidate.id || candidate.stop_id) === Number(dStop.id || dStop.stop_id));
          if (hasPickupCoordinates && !pickupCandidate) continue;
          if (hasDropoffCoordinates && !dropoffCandidate) continue;

          if (pSeq < dSeq && Number(pStop.id || pStop.stop_id) !== Number(dStop.id || dStop.stop_id)) {
            const pDist = Number(pickupCandidate?.distance || 0);
            const dDist = Number(dropoffCandidate?.distance || 0);
            validPairs.push({
              pickupStop: pStop,
              dropStop: dStop,
              totalDist: pDist + dDist,
              pDist,
              dDist,
            });
          }
        }
      }

      if (validPairs.length === 0) continue; // Invalid direction (pickup is after dropoff)

      // Choose the pair that provides the shortest walking/road distance to user
      validPairs.sort((a, b) => a.totalDist - b.totalDist || a.pDist - b.pDist || a.dDist - b.dDist);
      const validPair = validPairs[0];

      const { pickupStop, dropStop } = validPair;

      // Retrieve trips/schedules for this route & stop pair
      const scheduleRes = await this.getSchedulesForRouteStopPair({
        route,
        pickupStop,
        dropStop,
        travelDate,
        reqPassengers,
        busTypeId,
      });

      if (!scheduleRes.success || scheduleRes.schedules.length === 0) continue;

      const pickupCandidate = pickupCandidates.find((candidate) => Number(candidate.id || candidate.stop_id) === Number(pickupStop.id || pickupStop.stop_id));
      const dropoffCandidate = dropoffCandidates.find((candidate) => Number(candidate.id || candidate.stop_id) === Number(dropStop.id || dropStop.stop_id));
      const pDistKm = Number(pickupCandidate?.distance || 0) / 1000;
      const dDistKm = Number(dropoffCandidate?.distance || 0) / 1000;

      matchedResults.push({
        route,
        pickupStop,
        dropStop,
        pickupDistKm: pDistKm,
        dropDistKm: dDistKm,
        schedules: scheduleRes.schedules,
        rawSchedules: scheduleRes.rawSchedules || [],
        durationMinutes: scheduleRes.durationMinutes,
        fareAmount: scheduleRes.schedules[0]?.fare?.amount || scheduleRes.fareAmount || 0,
        pickupSeq: Number(pickupStop.stop_sequence || 1),
        dropSeq: Number(dropStop.stop_sequence || 2),
      });
    }

    // Deterministic ranking: prioritize total distance (pickup + dropoff), then existing criteria
    matchedResults.sort((a, b) => {
      const aTotalDist = (a.pickupDistKm || 0) + (a.dropDistKm || 0);
      const bTotalDist = (b.pickupDistKm || 0) + (b.dropDistKm || 0);
      if (Math.abs(aTotalDist - bTotalDist) > 0.001) return aTotalDist - bTotalDist;
      if (Math.abs(a.pickupDistKm - b.pickupDistKm) > 0.1) return a.pickupDistKm - b.pickupDistKm;
      if (Math.abs(a.dropDistKm - b.dropDistKm) > 0.1) return a.dropDistKm - b.dropDistKm;
      const aMinPickup = Math.min(...a.schedules.map((s) => s.pickupMins || 0));
      const bMinPickup = Math.min(...b.schedules.map((s) => s.pickupMins || 0));
      if (aMinPickup !== bMinPickup) return aMinPickup - bMinPickup;
      return a.durationMinutes - b.durationMinutes;
    });

    return matchedResults;
  }

  /**
   * Fetch active schedules and calculate fares for a specific route & stop pair
   */
  static async getSchedulesForRouteStopPair(opts) {
    const { route, pickupStop, dropStop, travelDate, reqPassengers, busTypeId } = opts;

    const whereSchedule = {
      route_id: route.id,
      status: { [Op.notIn]: ['Cancelled', 'cancelled', 'Inactive', 'inactive'] },
    };
    if (busTypeId) whereSchedule.bus_type_id = busTypeId;

    let rawSchedules = await BusSchedule.findAll({
      where: whereSchedule,
      include: [{ model: BusType, as: 'bus_type', required: false }],
      order: [['departure_time', 'ASC']],
    });

    if (!rawSchedules || rawSchedules.length === 0) {
      rawSchedules = await Trip.findAll({
        where: whereSchedule,
        include: [{ model: BusType, as: 'bus_type', required: false }],
        order: [['departure_time', 'ASC']],
      });
    }

    let matchingSchedules = [];
    if (rawSchedules && rawSchedules.length > 0) {
      matchingSchedules = rawSchedules.filter((sch) => scheduleCanRunOnDate(sch, travelDate));
    }

    if (matchingSchedules.length === 0) {
      return {
        success: false,
        reason: 'NO_SCHEDULES_FOUND',
        schedules: [],
        rawSchedules: [],
      };
    }

    // Stop duration calculation
    const stops = (route.stops || []).sort((a, b) => Number(a.stop_sequence || 0) - Number(b.stop_sequence || 0));
    const pSeq = Number(pickupStop.stop_sequence || 1);
    const dSeq = Number(dropStop.stop_sequence || 2);
    const pickupOffsetMins = stops.filter((s) => Number(s.stop_sequence) <= pSeq).reduce((sum, s) => sum + (Number(s.travel_time_minutes) || 0), 0);
    const dropOffsetMins = stops.filter((s) => Number(s.stop_sequence) <= dSeq).reduce((sum, s) => sum + (Number(s.travel_time_minutes) || 0), 0);
    const tripDurationMins = Math.max(0, dropOffsetMins - pickupOffsetMins);

    // Calculate fare for pickup and dropoff stop pair
    // Routes with NO rate chart entry in the DB are excluded from results
    let fareAmount = 0;
    let hasRateChart = false;
    try {
      const pStopId = Number(pickupStop.id || pickupStop.stop_id);
      const dStopId = Number(dropStop.id || dropStop.stop_id);
      const fareRes = await resolveFare({
        routeId: Number(route.id),
        originStopId: pStopId,
        destinationStopId: dStopId,
        fallbackFare: null, // no fallback — must come from DB
      });
      if (fareRes && fareRes.fare > 0 && fareRes.source !== 'schedule') {
        fareAmount = fareRes.fare;
        hasRateChart = true;
      }
    } catch (e) {
      // fare resolution failed — treat as no rate chart
    }

    // Skip this route entirely if no rate chart found in DB
    if (!hasRateChart) {
      return { success: false, reason: 'NO_RATE_CHART', schedules: [], rawSchedules: [] };
    }

    const validSchedules = [];

    for (const sch of matchingSchedules) {
      const schId = Number(sch.id);
      const busCap = sch.bus_type?.total_seats || sch.seat_capacity || 40;

      const bookedCount = await Booking.count({
        where: {
          trip_id: schId,
          booking_status: { [Op.ne]: 'cancelled' },
        },
      });

      const availSeats = Math.max(0, busCap - bookedCount);
      if (availSeats < reqPassengers) continue;

      const baseDepTime = sch.departure_time || '08:00:00';
      const pickupTimeDisplay = format12HourTime(baseDepTime, pickupOffsetMins);
      const dropTimeDisplay = format12HourTime(baseDepTime, dropOffsetMins);
      const pickupMins = (getMinutesFromMidnight(baseDepTime) + pickupOffsetMins) % (24 * 60);

      const schFare = (sch.fare_amount && Number(sch.fare_amount) > 0)
        ? Number(sch.fare_amount)
        : ((sch.base_fare && Number(sch.base_fare) > 0) ? Number(sch.base_fare) : fareAmount);

      validSchedules.push({
        schedule_id: schId,
        trip_id: schId,
        trip_date: sch.trip_date || travelDate,
        route_id: Number(route.id),
        bus_type_id: sch.bus_type_id || sch.bus_type?.id || 1,
        bus_type: sch.bus_type || { id: 1, name: 'AC Executive Shuttle' },
        departure_time: sch.departure_time,
        pickup_time: pickupTimeDisplay,
        drop_time: dropTimeDisplay,
        pickupMins,
        available_seats: availSeats,
        seat_capacity: busCap,
        status: sch.status || 'Active',
        fare: {
          amount: schFare,
          currency: 'INR',
          display: `₹${schFare.toFixed(0)}`,
        },
        pickup_stop: { id: pickupStop.id, name: pickupStop.stop_name || pickupStop.name },
        drop_stop: { id: dropStop.id, name: dropStop.stop_name || dropStop.name },
      });
    }

    if (validSchedules.length === 0) {
      return { success: false, reason: 'SEATS_FULL', schedules: [] };
    }

    return {
      success: true,
      schedules: validSchedules,
      rawSchedules,
      durationMinutes: tripDurationMins,
      fareAmount: validSchedules[0]?.fare?.amount || fareAmount,
    };
  }

  /**
   * Format empty search response
   */
  static formatNoRoutesResponse(opts) {
    const { pickupInput, dropoffInput, travelDate, reqPassengers, topResolvedPickup, topResolvedDropoff, searchRadiusKm, message } = opts;
    return {
      success: true,
      message: message || 'No direct routes found',
      search: {
        pickup: typeof pickupInput === 'string' ? pickupInput : pickupInput?.name || 'Pickup',
        dropoff: typeof dropoffInput === 'string' ? dropoffInput : dropoffInput?.name || 'Dropoff',
        date: travelDate,
        passengers: reqPassengers,
        search_radius_km: searchRadiusKm,
      },
      resolved_pickup: topResolvedPickup ? {
        stop_id: topResolvedPickup.id,
        name: topResolvedPickup.name,
        matched_by: topResolvedPickup.matched_by,
        distance: topResolvedPickup.distance,
      } : null,
      resolved_dropoff: topResolvedDropoff ? {
        stop_id: topResolvedDropoff.id,
        name: topResolvedDropoff.name,
        matched_by: topResolvedDropoff.matched_by,
        distance: topResolvedDropoff.distance,
      } : null,
      routes: [],
      direct_routes: [],
      nearby_routes: [],
      top_pick: null,
      reason: !topResolvedPickup ? 'PICKUP_OUTSIDE_SEARCH_RADIUS' : !topResolvedDropoff ? 'DROPOFF_OUTSIDE_SEARCH_RADIUS' : 'NO_ROUTE_OR_SCHEDULE_MATCH',
      pickup_groups: [],
      all_timings: [],
      available_dates: [],
      summary: { total_routes: 0, total_timings: 0, direct_routes_count: 0 },
    };
  }

  /**
   * Format full Cityflo-style search response with backward-compatible legacy structures
   */
  static buildFormattedSearchResponse(opts) {
    const {
      pickupInput,
      dropoffInput,
      travelDate,
      reqPassengers,
      topResolvedPickup,
      topResolvedDropoff,
      searchRadiusKm,
      directCandidates,
      nearbyCandidates,
      finalCandidates,
    } = opts;

    const pickupStr = typeof pickupInput === 'string' ? pickupInput : pickupInput?.name || topResolvedPickup.name;
    const dropoffStr = typeof dropoffInput === 'string' ? dropoffInput : dropoffInput?.name || topResolvedDropoff.name;

    // Cityflo Route Response Objects
    const routesFormatted = finalCandidates.map((cand) => {
      const routeObj = cand.route;
      const pDistMeters = cand.pickupDistKm != null && cand.pickupDistKm > 0
        ? Math.round(cand.pickupDistKm * 1000)
        : (topResolvedPickup?.distance || 0);
      const dDistMeters = cand.dropDistKm != null && cand.dropDistKm > 0
        ? Math.round(cand.dropDistKm * 1000)
        : (topResolvedDropoff?.distance || 0);

      const pDistKmVal = Number((pDistMeters / 1000).toFixed(3));
      const dDistKmVal = Number((dDistMeters / 1000).toFixed(3));

      // Full ordered list of all stops on this route with cumulative arrival offsets
      const sortedStops = (routeObj.stops || [])
        .sort((a, b) => Number(a.stop_sequence || 0) - Number(b.stop_sequence || 0));
      let cumMinsForStops = 0;
      const allStops = sortedStops.map((s) => {
          cumMinsForStops += Number(s.travel_time_minutes) || 0;
          return {
            id: Number(s.id || s.stop_id),
            name: s.stop_name || s.name,
            stop_order: Number(s.stop_sequence || 0),
            travel_time_minutes: Number(s.travel_time_minutes) || 0,
            cumulative_minutes: cumMinsForStops,
            latitude: s.latitude ? parseFloat(s.latitude) : null,
            longitude: s.longitude ? parseFloat(s.longitude) : null,
            address: s.address || null,
            landmark: s.landmark || null,
            pickup_allowed: s.pickup_allowed !== false,
            dropoff_allowed: s.dropoff_allowed !== false,
          };
        });

      return {
        route_id: Number(routeObj.id),
        route_name: routeObj.route_name || `${cand.pickupStop.name} → ${cand.dropStop.name}`,
        route_code: routeObj.route_code || `R-${routeObj.id}`,
        pickup_stop: {
          id: Number(cand.pickupStop.id),
          name: cand.pickupStop.stop_name || cand.pickupStop.name,
          stop_order: Number(cand.pickupStop.stop_sequence || 1),
          latitude: parseFloat(cand.pickupStop.latitude),
          longitude: parseFloat(cand.pickupStop.longitude),
          distance: pDistMeters,
          distance_km: pDistKmVal,
        },
        dropoff_stop: {
          id: Number(cand.dropStop.id),
          name: cand.dropStop.stop_name || cand.dropStop.name,
          stop_order: Number(cand.dropStop.stop_sequence || 2),
          latitude: parseFloat(cand.dropStop.latitude),
          longitude: parseFloat(cand.dropStop.longitude),
          distance: dDistMeters,
          distance_km: dDistKmVal,
        },
        all_stops: allStops,
        pickup_distance: pDistMeters,
        dropoff_distance: dDistMeters,
        distance_km: pDistKmVal,
        duration_minutes: cand.durationMinutes,
        fare: {
          amount: cand.fareAmount,
          currency: 'INR',
          display: `₹${cand.fareAmount.toFixed(0)}`,
        },
        trips: cand.schedules.map((sch) => {
          // Compute per-stop arrival schedule for this trip
          const baseDepTime = sch.departure_time || '08:00:00';
          const stopSchedule = allStops.map((st) => ({
            stop_id: st.id,
            name: st.name,
            stop_order: st.stop_order,
            travel_time_minutes: st.travel_time_minutes,
            cumulative_minutes: st.cumulative_minutes,
            arrival_time: format12HourTime(baseDepTime, st.cumulative_minutes),
          }));
          return {
            trip_id: sch.schedule_id,
            schedule_id: sch.schedule_id,
            departure_time: sch.departure_time,
            pickup_time: sch.pickup_time,
            drop_time: sch.drop_time,
            available_seats: sch.available_seats,
            bus_type: sch.bus_type?.name || 'AC Executive Shuttle',
            stop_schedule: stopSchedule,
          };
        }),
      };
    });

    // Backward-Compatible Structures (top_pick, pickup_groups, all_timings)
    let topPickItem = null;
    const pickupGroupMap = new Map();
    const allValidTimings = [];

    finalCandidates.forEach((cand, idx) => {
      const pDistInfo = formatDistance(cand.pickupDistKm || (topResolvedPickup?.distance ? topResolvedPickup.distance / 1000 : 0));
      const dDistInfo = formatDistance(cand.dropDistKm || (topResolvedDropoff?.distance ? topResolvedDropoff.distance / 1000 : 0));

      cand.schedules.forEach((sch) => {
        const timingEntry = {
          schedule_id: sch.schedule_id,
          route_id: sch.route_id,
          pickup_time: sch.pickup_time,
          drop_time: sch.drop_time,
          drop_stop: sch.drop_stop.name,
          drop_stop_id: sch.drop_stop.id,
          fare: sch.fare.amount,
          fare_display: sch.fare.display,
          available_seats: sch.available_seats,
          status: sch.status,
        };

        allValidTimings.push(timingEntry);

        if (!topPickItem && idx === 0) {
          topPickItem = {
            route_id: sch.route_id,
            schedule_id: sch.schedule_id,
            pickup_stop: {
              id: cand.pickupStop.id,
              name: cand.pickupStop.stop_name || cand.pickupStop.name,
              address: cand.pickupStop.address || cand.pickupStop.landmark || '',
              latitude: parseFloat(cand.pickupStop.latitude || topResolvedPickup.latitude || 0),
              longitude: parseFloat(cand.pickupStop.longitude || topResolvedPickup.longitude || 0),
              ...pDistInfo,
            },
            pickup_time: sch.pickup_time,
            drop_stop: {
              id: cand.dropStop.id,
              name: cand.dropStop.stop_name || cand.dropStop.name,
              address: cand.dropStop.address || cand.dropStop.landmark || '',
              latitude: parseFloat(cand.dropStop.latitude || topResolvedDropoff.latitude || 0),
              longitude: parseFloat(cand.dropStop.longitude || topResolvedDropoff.longitude || 0),
              ...dDistInfo,
            },
            drop_time: sch.drop_time,
            duration_minutes: cand.durationMinutes,
            fare: sch.fare,
            available_seats: sch.available_seats,
          };
        }

        const pStopId = cand.pickupStop.id;
        if (!pickupGroupMap.has(pStopId)) {
          pickupGroupMap.set(pStopId, {
            pickup_stop: {
              id: cand.pickupStop.id,
              name: cand.pickupStop.stop_name || cand.pickupStop.name,
              ...pDistInfo,
            },
            timings_count: 0,
            timings: [],
          });
        }
        const group = pickupGroupMap.get(pStopId);
        group.timings.push(timingEntry);
        group.timings_count = group.timings.length;
      });
    });

    // Generate upcoming dates dynamically based on actual scheduled trips
    const availableDates = [];
    const searchDateObj = new Date(travelDate);
    const baseDate = isNaN(searchDateObj.getTime()) ? new Date() : searchDateObj;

    for (let i = 0; i < 7; i++) {
      const dObj = new Date(baseDate);
      dObj.setDate(baseDate.getDate() + i);

      const yyyy = dObj.getFullYear();
      const mm = String(dObj.getMonth() + 1).padStart(2, '0');
      const dd = String(dObj.getDate()).padStart(2, '0');
      const formattedDateStr = `${yyyy}-${mm}-${dd}`;

      let totalTimingsForDate = 0;
      if (formattedDateStr === travelDate) {
        totalTimingsForDate = allValidTimings.length;
      } else {
        finalCandidates.forEach((cand) => {
          const matchingForDate = (cand.rawSchedules || []).filter((sch) => scheduleCanRunOnDate(sch, formattedDateStr));
          totalTimingsForDate += matchingForDate.length;
        });
      }

      // Only include dates that actually have trips running
      if (totalTimingsForDate > 0 || formattedDateStr === travelDate) {
        availableDates.push({
          date: formattedDateStr,
          day: dObj.toLocaleString('en-US', { weekday: 'short' }),
          month: dObj.toLocaleString('en-US', { month: 'short' }),
          day_number: String(dObj.getDate()),
          is_selected: formattedDateStr === travelDate,
          total_timings: totalTimingsForDate,
          has_trips: totalTimingsForDate > 0,
        });
      }
    }

    const isDirect = directCandidates.length > 0;
    const msg = isDirect
      ? 'Routes found successfully'
      : (nearbyCandidates.length > 0 ? 'No direct route found. Nearby routes available.' : 'No routes found');
    const resolvedPickup = finalCandidates[0]
      ? { stop_id: Number(finalCandidates[0].pickupStop.id), name: finalCandidates[0].pickupStop.stop_name || finalCandidates[0].pickupStop.name, matched_by: 'osm_road_distance', distance: Math.round(finalCandidates[0].pickupDistKm * 1000) }
      : topResolvedPickup ? { stop_id: topResolvedPickup.id, name: topResolvedPickup.name, matched_by: topResolvedPickup.matched_by, distance: topResolvedPickup.distance } : null;
    const resolvedDropoff = finalCandidates[0]
      ? { stop_id: Number(finalCandidates[0].dropStop.id), name: finalCandidates[0].dropStop.stop_name || finalCandidates[0].dropStop.name, matched_by: 'osm_road_distance', distance: Math.round(finalCandidates[0].dropDistKm * 1000) }
      : topResolvedDropoff ? { stop_id: topResolvedDropoff.id, name: topResolvedDropoff.name, matched_by: topResolvedDropoff.matched_by, distance: topResolvedDropoff.distance } : null;

    return {
      success: true,
      message: msg,
      reason: finalCandidates.length === 0 ? 'NO_ROUTE_OR_SCHEDULE_MATCH' : (isDirect ? 'DIRECT_MATCH' : 'NEARBY_MATCH'),
      search: {
        pickup: pickupStr,
        dropoff: dropoffStr,
        date: travelDate,
        passengers: reqPassengers,
        search_radius_km: searchRadiusKm,
      },
      resolved_pickup: resolvedPickup,
      resolved_dropoff: resolvedDropoff,
      routes: routesFormatted,
      direct_routes: isDirect ? routesFormatted : [],
      nearby_routes: !isDirect ? routesFormatted : [],
      top_pick: topPickItem,
      pickup_groups: Array.from(pickupGroupMap.values()),
      all_timings: allValidTimings,
      available_dates: availableDates,
      summary: {
        total_routes: routesFormatted.length,
        total_timings: allValidTimings.length,
        direct_routes_count: directCandidates.length,
        nearby_routes_count: nearbyCandidates.length,
      },
    };
  }
}

module.exports = BusRouteSearchService;
