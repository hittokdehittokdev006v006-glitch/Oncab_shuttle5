'use strict';

const { Op } = require('sequelize');
const {
  CrossConnection,
  Trip,
  Route,
  Stop,
  RouteStop,
  Vehicle,
  Driver,
  DriverDetail,
  TripLocation,
  SystemSetting,
} = require('../models');

// Haversine distance in meters
const distanceInMeters = (lat1, lon1, lat2, lon2) => {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Calculate initial compass bearing from point 1 to point 2 (in degrees 0-360)
const calculateBearing = (lat1, lon1, lat2, lon2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  let brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
};

// Angular difference between two headings/bearings in degrees (0 to 180)
const angularDifference = (h1, h2) => {
  let diff = Math.abs(h1 - h2) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
};

/**
 * Fetch dynamic configuration from system_settings or default values
 */
const getCrossConnectionConfig = async () => {
  const defaultSettings = {
    cross_connection_max_distance_meters: 500, // Distance threshold (e.g. 500m)
    cross_connection_min_overlap_minutes: 5,   // Min travel overlap duration (e.g. 5 min)
    cross_connection_eval_frequency_seconds: 30, // Evaluation frequency (e.g. 30s)
    cross_connection_supported_route_types: 'Regular,Scheduled,Dynamic,Express,Shuttle',
    cross_connection_match_expiration_minutes: 15, // Mark Completed / No Longer Matching if no ping for 15 min
    cross_connection_heading_tolerance_degrees: 60, // Max heading difference to consider same direction
  };

  try {
    const keys = Object.keys(defaultSettings);
    const dbSettings = await SystemSetting.findAll({
      where: { key: { [Op.in]: keys } },
      raw: true,
    });

    const config = { ...defaultSettings };
    for (const s of dbSettings) {
      if (s.value !== null && s.value !== undefined) {
        if (s.key === 'cross_connection_max_distance_meters' || s.key === 'cross_connection_min_overlap_minutes' || s.key === 'cross_connection_eval_frequency_seconds' || s.key === 'cross_connection_match_expiration_minutes' || s.key === 'cross_connection_heading_tolerance_degrees') {
          const num = parseFloat(s.value);
          if (!isNaN(num) && num > 0) config[s.key] = num;
        } else {
          config[s.key] = s.value;
        }
      }
    }
    return config;
  } catch (err) {
    console.error('[CrossConnectionService] Error fetching config:', err.message);
    return defaultSettings;
  }
};

/**
 * Find the latest valid GPS point for a trip
 */
const getTripLatestLocation = async (trip) => {
  // 1. Try DriverDetail location
  const driverDetail = trip.driver?.details;
  const now = Date.now();

  let lat = null;
  let lon = null;
  let heading = null;
  let speed = null;
  let recordedAt = null;

  if (driverDetail && driverDetail.latitude && driverDetail.longitude) {
    lat = parseFloat(driverDetail.latitude);
    lon = parseFloat(driverDetail.longitude);
    heading = driverDetail.location_heading != null ? parseFloat(driverDetail.location_heading) : null;
    speed = driverDetail.location_speed_kmh != null ? parseFloat(driverDetail.location_speed_kmh) : null;
    recordedAt = driverDetail.updated_at ? new Date(driverDetail.updated_at) : new Date();
  }

  // 2. Check TripLocation table for the most recent log
  try {
    const latestLog = await TripLocation.findOne({
      where: { trip_id: trip.id },
      order: [['recorded_at', 'DESC']],
      raw: true,
    });
    if (latestLog) {
      const logTime = new Date(latestLog.recorded_at);
      if (!recordedAt || logTime >= recordedAt) {
        lat = parseFloat(latestLog.latitude);
        lon = parseFloat(latestLog.longitude);
        heading = latestLog.heading != null ? parseFloat(latestLog.heading) : heading;
        speed = latestLog.speed_kmh != null ? parseFloat(latestLog.speed_kmh) : speed;
        recordedAt = logTime;
      }
    }
  } catch (_) {}

  // 3. Fallback to Vehicle static or latest coordinates
  if ((lat == null || lon == null) && trip.vehicle) {
    if (trip.vehicle.latitude && trip.vehicle.longitude) {
      lat = parseFloat(trip.vehicle.latitude);
      lon = parseFloat(trip.vehicle.longitude);
      recordedAt = new Date();
    }
  }

  // Validate coordinates
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) {
    return null;
  }

  return {
    latitude: lat,
    longitude: lon,
    heading,
    speed,
    recorded_at: recordedAt || new Date(),
  };
};

/**
 * Determine overall direction/bearing of a trip's route from origin to destination stops
 */
const getRouteBearingAndStops = (route) => {
  if (!route) return { bearing: null, stops: [], segmentName: 'Unknown Route' };
  const stops = route.physical_stops || route.stops || [];
  const sortedStops = [...stops].sort((a, b) => {
    const seqA = a.RouteStop?.stop_sequence ?? a.stop_sequence ?? 0;
    const seqB = b.RouteStop?.stop_sequence ?? b.stop_sequence ?? 0;
    return seqA - seqB;
  });

  let bearing = null;
  if (sortedStops.length >= 2) {
    const first = sortedStops[0];
    const last = sortedStops[sortedStops.length - 1];
    if (first.latitude && first.longitude && last.latitude && last.longitude) {
      bearing = calculateBearing(
        parseFloat(first.latitude),
        parseFloat(first.longitude),
        parseFloat(last.latitude),
        parseFloat(last.longitude)
      );
    }
  }

  const segmentName = `${route.origin_city || 'Origin'} ➔ ${route.destination_city || 'Destination'}`;
  return { bearing, stops: sortedStops, segmentName };
};

/**
 * Calculate common route segment between two routes based on nearby or shared stops
 */
const findSharedRouteSegment = (stops1, stops2, thresholdMeters = 1000) => {
  if (!stops1.length || !stops2.length) return null;

  const matchedPairs = [];
  for (const s1 of stops1) {
    if (s1.latitude == null || s1.longitude == null) continue;
    for (const s2 of stops2) {
      if (s2.latitude == null || s2.longitude == null) continue;
      const dist = distanceInMeters(
        parseFloat(s1.latitude),
        parseFloat(s1.longitude),
        parseFloat(s2.latitude),
        parseFloat(s2.longitude)
      );
      if (dist <= thresholdMeters) {
        matchedPairs.push({
          stop1_name: s1.stop_name,
          stop2_name: s2.stop_name,
          distance_meters: Math.round(dist),
          latitude: parseFloat(s1.latitude),
          longitude: parseFloat(s1.longitude),
        });
        break; // Match once per s1
      }
    }
  }

  if (matchedPairs.length >= 1) {
    const firstName = matchedPairs[0].stop1_name;
    const lastName = matchedPairs[matchedPairs.length - 1].stop1_name;
    const name = firstName === lastName ? firstName : `${firstName} ➔ ${lastName}`;
    return {
      name,
      matchedCount: matchedPairs.length,
      samplePoints: matchedPairs.map((p) => [p.latitude, p.longitude]),
    };
  }

  return null;
};

/**
 * Main Evaluation Engine: runs comparison between active/scheduled trips across all route types
 */
const evaluateCrossConnections = async () => {
  const config = await getCrossConnectionConfig();
  const maxDistance = config.cross_connection_max_distance_meters;
  const minOverlapSeconds = config.cross_connection_min_overlap_minutes * 60;
  const headingTolerance = config.cross_connection_heading_tolerance_degrees;
  const expirationMs = config.cross_connection_match_expiration_minutes * 60 * 1000;
  const now = new Date();

  // 1. Fetch active candidate trips
  const activeTrips = await Trip.findAll({
    where: {
      status: { [Op.in]: ['Active', 'Delayed', 'Scheduled'] },
    },
    include: [
      {
        model: Route,
        as: 'route',
        include: [{ model: Stop, as: 'physical_stops', required: false }],
      },
      {
        model: Driver,
        as: 'driver',
        include: [{ model: DriverDetail, as: 'details' }],
      },
      {
        model: Vehicle,
        as: 'vehicle',
      },
    ],
  });

  // Extract valid GPS coordinates for each trip
  const tripLocations = [];
  for (const trip of activeTrips) {
    const loc = await getTripLatestLocation(trip);
    if (loc) {
      const { bearing, stops, segmentName } = getRouteBearingAndStops(trip.route);
      tripLocations.push({
        trip,
        location: loc,
        routeBearing: bearing,
        stops,
        segmentName,
        routeType: trip.route?.route_type || 'Regular',
      });
    }
  }

  const processedPairKeys = new Set();
  const matchedConnections = [];

  // 2. Compare pairs of trips
  for (let i = 0; i < tripLocations.length; i++) {
    for (let j = i + 1; j < tripLocations.length; j++) {
      const item1 = tripLocations[i];
      const item2 = tripLocations[j];

      // Avoid matching same vehicle or same driver
      if (item1.trip.vehicle_id && item1.trip.vehicle_id === item2.trip.vehicle_id) continue;
      if (item1.trip.driver_id && item1.trip.driver_id === item2.trip.driver_id) continue;

      // Ensure stable pairing order (smaller trip ID first)
      const [t1, t2] = item1.trip.id < item2.trip.id ? [item1, item2] : [item2, item1];
      const pairKey = `${t1.trip.id}_${t2.trip.id}`;
      processedPairKeys.add(pairKey);

      // Distance calculation
      const distance = distanceInMeters(
        t1.location.latitude,
        t1.location.longitude,
        t2.location.latitude,
        t2.location.longitude
      );

      // Condition 1: Distance within threshold
      if (distance > maxDistance) continue;

      // Condition 2: Direction / Heading check
      let sameDirection = false;

      // Check current GPS headings if both exist
      if (t1.location.heading != null && t2.location.heading != null) {
        const diff = angularDifference(t1.location.heading, t2.location.heading);
        if (diff <= headingTolerance) {
          sameDirection = true;
        }
      }

      // If headings are absent or ambiguous, check overall route bearings
      if (!sameDirection && t1.routeBearing != null && t2.routeBearing != null) {
        const routeDiff = angularDifference(t1.routeBearing, t2.routeBearing);
        if (routeDiff <= headingTolerance) {
          sameDirection = true;
        }
      }

      // Check origin & destination alignment
      if (!sameDirection && t1.trip.route && t2.trip.route) {
        if (
          t1.trip.route.origin_city &&
          t2.trip.route.origin_city &&
          t1.trip.route.origin_city.toLowerCase() === t2.trip.route.origin_city.toLowerCase() &&
          t1.trip.route.destination_city &&
          t2.trip.route.destination_city &&
          t1.trip.route.destination_city.toLowerCase() === t2.trip.route.destination_city.toLowerCase()
        ) {
          sameDirection = true;
        }
      }

      if (!sameDirection) continue;

      // Condition 3: Common route segment identification
      const sharedSegment = findSharedRouteSegment(t1.stops, t2.stops, maxDistance * 2);
      const segmentDisplayName = sharedSegment ? sharedSegment.name : `${t1.trip.route?.route_name || 'Route 1'} & ${t2.trip.route?.route_name || 'Route 2'}`;

      // Check if there is an existing record
      let connection = await CrossConnection.findOne({
        where: {
          trip1_id: t1.trip.id,
          trip2_id: t2.trip.id,
          status: 'Active',
        },
      });

      if (!connection) {
        // Create initial connection record
        const connectionCode = `CC-${t1.trip.id}-${t2.trip.id}-${Date.now().toString(36).toUpperCase()}`;
        connection = await CrossConnection.create({
          connection_code: connectionCode,
          trip1_id: t1.trip.id,
          trip2_id: t2.trip.id,
          vehicle1_id: t1.trip.vehicle_id,
          vehicle2_id: t2.trip.vehicle_id,
          driver1_id: t1.trip.driver_id,
          driver2_id: t2.trip.driver_id,
          route_type1: t1.routeType,
          route_type2: t2.routeType,
          current_distance_meters: Math.round(distance),
          min_distance_meters: Math.round(distance),
          overlap_duration_seconds: 0,
          overlap_started_at: now,
          last_overlap_at: now,
          shared_segment_name: segmentDisplayName,
          shared_segment_details: {
            sharedSegment,
            location1: t1.location,
            location2: t2.location,
            bearing1: t1.location.heading || t1.routeBearing,
            bearing2: t2.location.heading || t2.routeBearing,
          },
          status: 'Active',
          notes: `Initial match detected within ${Math.round(distance)}m threshold`,
        });
      } else {
        // Accumulate overlap duration
        const lastOverlap = new Date(connection.last_overlap_at).getTime();
        const deltaSeconds = Math.max(0, Math.min(300, Math.round((now.getTime() - lastOverlap) / 1000)));
        const newDuration = (connection.overlap_duration_seconds || 0) + (deltaSeconds > 0 ? deltaSeconds : 10);
        const minDistance = connection.min_distance_meters
          ? Math.min(Number(connection.min_distance_meters), distance)
          : distance;

        await connection.update({
          current_distance_meters: Math.round(distance),
          min_distance_meters: Math.round(minDistance),
          overlap_duration_seconds: newDuration,
          last_overlap_at: now,
          vehicle1_id: t1.trip.vehicle_id || connection.vehicle1_id,
          vehicle2_id: t2.trip.vehicle_id || connection.vehicle2_id,
          driver1_id: t1.trip.driver_id || connection.driver1_id,
          driver2_id: t2.trip.driver_id || connection.driver2_id,
          shared_segment_name: segmentDisplayName,
          shared_segment_details: {
            sharedSegment,
            location1: t1.location,
            location2: t2.location,
            bearing1: t1.location.heading || t1.routeBearing,
            bearing2: t2.location.heading || t2.routeBearing,
          },
        });
      }

      matchedConnections.push(connection);
    }
  }

  // 3. Mark stale or completed active cross connections
  const activeConnections = await CrossConnection.findAll({
    where: { status: 'Active' },
    include: [
      { model: Trip, as: 'trip1', attributes: ['id', 'status'] },
      { model: Trip, as: 'trip2', attributes: ['id', 'status'] },
    ],
  });

  for (const conn of activeConnections) {
    const pairKey = `${conn.trip1_id}_${conn.trip2_id}`;
    const trip1Completed = ['Completed', 'Cancelled'].includes(conn.trip1?.status);
    const trip2Completed = ['Completed', 'Cancelled'].includes(conn.trip2?.status);

    if (trip1Completed || trip2Completed) {
      await conn.update({
        status: 'Completed',
        notes: `Trip ${trip1Completed ? conn.trip1_id : conn.trip2_id} finished`,
      });
    } else if (!processedPairKeys.has(pairKey)) {
      // Not currently matching this cycle
      const lastOverlap = new Date(conn.last_overlap_at).getTime();
      if (now.getTime() - lastOverlap > expirationMs) {
        await conn.update({
          status: 'No Longer Matching',
          notes: `Vehicles separated or out of range for more than ${config.cross_connection_match_expiration_minutes} minutes`,
        });
      }
    }
  }

  return {
    evaluatedCount: tripLocations.length,
    activeMatchesCount: matchedConnections.length,
    matchedConnections,
  };
};

module.exports = {
  distanceInMeters,
  calculateBearing,
  angularDifference,
  getCrossConnectionConfig,
  getTripLatestLocation,
  findSharedRouteSegment,
  evaluateCrossConnections,
};
