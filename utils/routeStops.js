'use strict';

const { Op } = require('sequelize');
const { RouteStop, Stop } = require('../models');

/**
 * Add minutes to an HH:mm:ss or HH:mm time string.
 *
 * @param {string|null} timeStr
 * @param {number} minutesToAdd
 * @returns {string|null}
 */
const addMinutesToTime = (timeStr, minutesToAdd) => {
  if (!timeStr) return null;
  const parts = String(timeStr).trim().split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return timeStr;
  const totalMinutes = (h * 60 + m + (minutesToAdd || 0)) % (24 * 60);
  const newH = Math.floor(totalMinutes / 60);
  const newM = totalMinutes % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}:00`;
};

/**
 * Computes cumulative scheduled arrival / pickup times for an array of ordered stops
 * based on the trip's departure time and each stop's travel_time_minutes.
 *
 * @param {Array} stops
 * @param {string|null} departureTime
 * @returns {Array}
 */
const attachPickupTimesToStops = (stops, departureTime) => {
  if (!Array.isArray(stops) || !stops.length) return [];
  let cumulativeMinutes = 0;
  return stops.map((stop, index) => {
    if (index > 0) {
      cumulativeMinutes += Number(stop.travel_time_minutes) || 0;
    }
    const pickup_time = departureTime ? addMinutesToTime(departureTime, cumulativeMinutes) : null;
    return {
      ...stop,
      pickup_time,
      scheduled_arrival_time: pickup_time,
    };
  });
};

/**
 * Efficiently loads ordered stops for a set of route IDs in a single batch query.
 * Canonical data source: `route_stops` table joined with master `stops` table.
 * If a route has no records in `route_stops`, it falls back to the legacy `stops` table
 * where `stops.route_id` was directly assigned.
 *
 * @param {number[]} routeIds
 * @returns {Promise<Map<number, Array>>} Map of route_id -> ordered stops array
 */
const loadOrderedStopsForRoutes = async (routeIds) => {
  if (!routeIds || !routeIds.length) return new Map();

  const uniqueRouteIds = [...new Set(routeIds.map((id) => Number(id)).filter(Boolean))];
  if (!uniqueRouteIds.length) return new Map();

  const resultMap = new Map();
  uniqueRouteIds.forEach((rid) => resultMap.set(rid, []));

  // 1. Fetch canonical stops from junction table route_stops
  const routeStops = await RouteStop.findAll({
    where: { route_id: { [Op.in]: uniqueRouteIds } },
    include: [{
      model: Stop,
      as: 'stop',
      attributes: ['id', 'stop_name', 'stop_code', 'latitude', 'longitude', 'address', 'landmark', 'status'],
    }],
    order: [['route_id', 'ASC'], ['stop_sequence', 'ASC']],
  });

  for (const rs of routeStops) {
    const s = rs.stop || {};
    const rid = Number(rs.route_id);
    const list = resultMap.get(rid) || [];
    list.push({
      id: Number(rs.stop_id),
      stop_id: Number(rs.stop_id),
      stop_name: s.stop_name || `Stop ${rs.stop_sequence}`,
      name: s.stop_name || `Stop ${rs.stop_sequence}`,
      stop_code: s.stop_code || null,
      stop_sequence: Number(rs.stop_sequence),
      travel_time_minutes: Number(rs.travel_time_minutes) || 0,
      latitude: s.latitude != null && s.latitude !== '' ? Number(s.latitude) : null,
      longitude: s.longitude != null && s.longitude !== '' ? Number(s.longitude) : null,
      address: s.address || null,
      landmark: s.landmark || null,
      pickup_allowed: rs.pickup_allowed !== false,
      dropoff_allowed: rs.dropoff_allowed !== false,
      status: rs.status || 'Active',
    });
    resultMap.set(rid, list);
  }

  // 2. Fallback for any routes that had 0 records in route_stops
  const missingRouteIds = uniqueRouteIds.filter((rid) => (resultMap.get(rid) || []).length === 0);
  if (missingRouteIds.length > 0) {
    const legacyStops = await Stop.findAll({
      where: { route_id: { [Op.in]: missingRouteIds } },
      order: [['route_id', 'ASC'], ['stop_sequence', 'ASC'], ['id', 'ASC']],
    });

    for (const s of legacyStops) {
      const rid = Number(s.route_id);
      const list = resultMap.get(rid) || [];
      const seq = list.length + 1;
      list.push({
        id: Number(s.id),
        stop_id: Number(s.id),
        stop_name: s.stop_name,
        name: s.stop_name,
        stop_code: s.stop_code || null,
        stop_sequence: Number(s.stop_sequence) > 0 ? Number(s.stop_sequence) : seq,
        travel_time_minutes: Number(s.travel_time_minutes) || 0,
        latitude: s.latitude != null && s.latitude !== '' ? Number(s.latitude) : null,
        longitude: s.longitude != null && s.longitude !== '' ? Number(s.longitude) : null,
        address: s.address || null,
        landmark: s.landmark || null,
        pickup_allowed: true,
        dropoff_allowed: true,
        status: s.status || 'Active',
      });
      resultMap.set(rid, list);
    }
  }

  // 3. Ensure strictly ascending sequence order for every route
  for (const [rid, list] of resultMap.entries()) {
    list.sort((a, b) => a.stop_sequence - b.stop_sequence);
  }

  return resultMap;
};

/**
 * Convenience helper to load ordered stops for a single route ID.
 *
 * @param {number} routeId
 * @param {string|null} [departureTime=null]
 * @returns {Promise<Array>}
 */
const getOrderedStopsForRoute = async (routeId, departureTime = null) => {
  if (!routeId) return [];
  const map = await loadOrderedStopsForRoutes([routeId]);
  const stops = map.get(Number(routeId)) || [];
  return attachPickupTimesToStops(stops, departureTime);
};

module.exports = {
  addMinutesToTime,
  attachPickupTimesToStops,
  loadOrderedStopsForRoutes,
  getOrderedStopsForRoute,
};
