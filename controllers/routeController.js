'use strict';

const { Op } = require('sequelize');
const { Route, Stop, RouteStop, sequelize } = require('../models');
const { logAction } = require('../middleware/auditLog');
const { syncRouteStopsTable } = require('../utils/routeStopMigrator');

const buildPagination = (page, limit) => {
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit) || 15));
  return { offset: (p - 1) * l, limit: l, page: p };
};

const getSegmentDurationTotal = (stops) => stops
  .slice(1)
  .reduce((total, stop) => total + Math.max(0, parseInt(stop.travel_time_minutes, 10) || 0), 0);

const includesSegmentDurations = (stops) => Array.isArray(stops)
  && stops.slice(1).some((stop) => stop.travel_time_minutes !== undefined && stop.travel_time_minutes !== null && stop.travel_time_minutes !== '');

/**
 * Helper to fetch ordered stops for a route using route_stops mapping with fallback to legacy stops
 */
async function fetchOrderedStopsForRoute(routeId, transaction = null) {
  await syncRouteStopsTable();
  const routeStops = await RouteStop.findAll({
    where: { route_id: routeId },
    include: [{ model: Stop, as: 'stop' }],
    order: [['stop_sequence', 'ASC']],
    transaction,
  });

  if (routeStops && routeStops.length > 0) {
    return routeStops.map((rs) => {
      const s = rs.stop ? rs.stop.toJSON() : {};
      return {
        stop_id: rs.stop_id,
        id: rs.stop_id,
        stop_name: s.stop_name,
        name: s.stop_name,
        stop_code: s.stop_code,
        stop_sequence: rs.stop_sequence,
        travel_time_minutes: Number(rs.travel_time_minutes) || 0,
        latitude: s.latitude ? parseFloat(s.latitude) : null,
        longitude: s.longitude ? parseFloat(s.longitude) : null,
        address: s.address,
        landmark: s.landmark,
        pickup_allowed: rs.pickup_allowed,
        dropoff_allowed: rs.dropoff_allowed,
        status: rs.status,
      };
    });
  }

  // Fallback to legacy stops table where route_id is stored directly
  const legacyStops = await Stop.findAll({
    where: { route_id: routeId },
    order: [['stop_sequence', 'ASC']],
    transaction,
  });

  return legacyStops.map((s) => ({
    stop_id: s.id,
    id: s.id,
    stop_name: s.stop_name,
    name: s.stop_name,
    stop_code: s.stop_code,
    stop_sequence: s.stop_sequence || 1,
    latitude: s.latitude ? parseFloat(s.latitude) : null,
    longitude: s.longitude ? parseFloat(s.longitude) : null,
    address: s.address,
    landmark: s.landmark,
    pickup_allowed: true,
    dropoff_allowed: true,
    status: s.status,
  }));
}

// ── 1. List Routes (Admin Overview) ────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { page, limit, search, status } = req.query;
    const { offset, limit: lim, page: p } = buildPagination(page, limit);
    const where = {};
    if (search) {
      where[Op.or] = [
        { route_name: { [Op.like]: `%${search}%` } },
        { route_code: { [Op.like]: `%${search}%` } },
        { origin_city: { [Op.like]: `%${search}%` } },
        { destination_city: { [Op.like]: `%${search}%` } },
      ];
    }
    if (status) where.status = status;

    const { count, rows } = await Route.findAndCountAll({
      where,
      offset,
      limit: lim,
      order: [['created_at', 'DESC']],
    });

    const formattedRoutes = await Promise.all(
      rows.map(async (route) => {
        const stops = await fetchOrderedStopsForRoute(route.id);
        const item = route.toJSON();
        return {
          id: item.id,
          route_code: item.route_code,
          route_name: item.route_name,
          origin_city: item.origin_city,
          destination_city: item.destination_city,
          stops_count: stops.length,
          total_distance: item.total_distance,
          estimated_duration: item.estimated_duration,
          description: item.description,
          status: item.status,
          stops,
          created_at: item.created_at,
          updated_at: item.updated_at,
        };
      })
    );

    res.json({
      success: true,
      data: formattedRoutes,
      pagination: { total: count, page: p, limit: lim, pages: Math.ceil(count / lim) },
    });
  } catch (err) {
    next(err);
  }
};

// ── 2. Get Single Route Details ───────────────────────────────────────
exports.show = async (req, res, next) => {
  try {
    const route = await Route.findByPk(req.params.id);
    if (!route) return res.status(404).json({ success: false, message: 'Route not found' });

    const stops = await fetchOrderedStopsForRoute(route.id);
    const item = route.toJSON();

    res.json({
      success: true,
      data: {
        id: item.id,
        route_code: item.route_code,
        route_name: item.route_name,
        origin_city: item.origin_city,
        destination_city: item.destination_city,
        stops_count: stops.length,
        total_distance: item.total_distance,
        estimated_duration: item.estimated_duration,
        description: item.description,
        status: item.status,
        stops,
        created_at: item.created_at,
        updated_at: item.updated_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── 3. Create Route (With Inline / Reused Physical Stops) ─────────────
exports.create = async (req, res, next) => {
  try {
    await syncRouteStopsTable();
    const body = req.body || {};
    const { route_name, route_code, origin_city, destination_city, total_distance, estimated_duration, description, status, stops } = body;

    if (!route_name || !route_code || !origin_city || !destination_city) {
      return res.status(400).json({ success: false, message: 'route_name, route_code, origin_city, and destination_city are required' });
    }

    const exists = await Route.findOne({ where: { route_code: String(route_code).trim() } });
    if (exists) return res.status(409).json({ success: false, message: 'Route code already exists' });

    const route = await sequelize.transaction(async (transaction) => {
      const createdRoute = await Route.create(
        {
          route_name: String(route_name).trim(),
          route_code: String(route_code).trim(),
          origin_city: String(origin_city).trim(),
          destination_city: String(destination_city).trim(),
          total_distance: total_distance || 0,
          estimated_duration: includesSegmentDurations(stops) ? getSegmentDurationTotal(stops) : (estimated_duration || 0),
          description: description || null,
          status: status || 'Active',
        },
        { transaction }
      );

      if (Array.isArray(stops) && stops.length > 0) {
        for (let i = 0; i < stops.length; i++) {
          const stopInput = stops[i];
          let physicalStopId = stopInput.stop_id || stopInput.id;

          if (!physicalStopId && stopInput.stop_name) {
            // Create new physical stop
            const newPhysicalStop = await Stop.create(
              {
                route_id: createdRoute.id,
                stop_name: String(stopInput.stop_name).trim(),
                stop_code: stopInput.stop_code || null,
                stop_sequence: i + 1,
                latitude: stopInput.latitude ? parseFloat(stopInput.latitude) : null,
                longitude: stopInput.longitude ? parseFloat(stopInput.longitude) : null,
                address: stopInput.address || null,
                landmark: stopInput.landmark || null,
                status: 'Active',
              },
              { transaction }
            );
            physicalStopId = newPhysicalStop.id;
          }

          if (physicalStopId) {
            await RouteStop.create(
              {
                route_id: createdRoute.id,
                stop_id: physicalStopId,
                stop_sequence: i + 1, // Auto sequence 1, 2, 3...
                travel_time_minutes: i === 0 ? 0 : Math.max(0, parseInt(stopInput.travel_time_minutes, 10) || 0),
                pickup_allowed: stopInput.pickup_allowed !== false,
                dropoff_allowed: stopInput.dropoff_allowed !== false,
                status: 'Active',
              },
              { transaction }
            );
          }
        }
      }

      return createdRoute;
    });

    await logAction({
      userId: req.user?.id,
      userType: req.user?.role?.name,
      userName: req.user?.name,
      action: 'create',
      module: 'routes',
      entityType: 'Route',
      entityId: route.id,
      newValues: { route_name, route_code },
      ipAddress: req.ip,
      description: `Created route ${route_name}`,
    });

    const orderedStops = await fetchOrderedStopsForRoute(route.id);
    res.status(201).json({
      success: true,
      message: 'Route created successfully',
      data: { ...route.toJSON(), stops: orderedStops },
    });
  } catch (err) {
    next(err);
  }
};

// ── 4. Update Route (Re-sync RouteStop Sequences) ────────────────────
exports.update = async (req, res, next) => {
  try {
    await syncRouteStopsTable();
    const route = await Route.findByPk(req.params.id);
    if (!route) return res.status(404).json({ success: false, message: 'Route not found' });

    const body = req.body || {};
    const { stops, ...routeFields } = body;
    if (includesSegmentDurations(stops)) {
      routeFields.estimated_duration = getSegmentDurationTotal(stops);
    }

    await sequelize.transaction(async (transaction) => {
      await route.update(routeFields, { transaction });

      if (Array.isArray(stops)) {
        // Clear old route_stops links for this route
        await RouteStop.destroy({ where: { route_id: route.id }, transaction });

        for (let i = 0; i < stops.length; i++) {
          const stopInput = stops[i];
          let physicalStopId = stopInput.stop_id || stopInput.id;

          if (!physicalStopId && stopInput.stop_name) {
            const newPhysicalStop = await Stop.create(
              {
                route_id: route.id,
                stop_name: String(stopInput.stop_name).trim(),
                stop_code: stopInput.stop_code || null,
                stop_sequence: i + 1,
                latitude: stopInput.latitude ? parseFloat(stopInput.latitude) : null,
                longitude: stopInput.longitude ? parseFloat(stopInput.longitude) : null,
                address: stopInput.address || null,
                landmark: stopInput.landmark || null,
                status: 'Active',
              },
              { transaction }
            );
            physicalStopId = newPhysicalStop.id;
          }

          if (physicalStopId) {
            await RouteStop.create(
              {
                route_id: route.id,
                stop_id: physicalStopId,
                stop_sequence: i + 1, // Recalculated 1..N
                travel_time_minutes: i === 0 ? 0 : Math.max(0, parseInt(stopInput.travel_time_minutes, 10) || 0),
                pickup_allowed: stopInput.pickup_allowed !== false,
                dropoff_allowed: stopInput.dropoff_allowed !== false,
                status: 'Active',
              },
              { transaction }
            );
          }
        }
      }
    });

    const orderedStops = await fetchOrderedStopsForRoute(route.id);
    res.json({
      success: true,
      message: 'Route updated successfully',
      data: { ...route.toJSON(), stops: orderedStops },
    });
  } catch (err) {
    next(err);
  }
};

// ── 5. Duplicate Route (Clone Route & Copy RouteStops) ────────────────
exports.duplicate = async (req, res, next) => {
  try {
    const origRoute = await Route.findByPk(req.params.id);
    if (!origRoute) return res.status(404).json({ success: false, message: 'Source route not found' });

    const body = req.body || {};
    const origStops = await fetchOrderedStopsForRoute(origRoute.id);
    const timestamp = Math.floor(Date.now() / 1000);
    const newRouteCode = body.route_code || `${origRoute.route_code}-COPY-${timestamp}`;
    const newRouteName = body.route_name || `${origRoute.route_name} (Copy)`;

    const duplicatedRoute = await sequelize.transaction(async (transaction) => {
      const created = await Route.create(
        {
          route_name: String(newRouteName).trim(),
          route_code: String(newRouteCode).trim(),
          origin_city: origRoute.origin_city,
          destination_city: origRoute.destination_city,
          total_distance: origRoute.total_distance,
          estimated_duration: origRoute.estimated_duration,
          description: origRoute.description,
          status: 'Draft',
        },
        { transaction }
      );

      for (let i = 0; i < origStops.length; i++) {
        const s = origStops[i];
        await RouteStop.create(
          {
            route_id: created.id,
            stop_id: s.stop_id || s.id,
            stop_sequence: i + 1,
            travel_time_minutes: Number(s.travel_time_minutes) || 0,
            pickup_allowed: s.pickup_allowed !== false,
            dropoff_allowed: s.dropoff_allowed !== false,
            status: 'Active',
          },
          { transaction }
        );
      }

      return created;
    });

    const orderedStops = await fetchOrderedStopsForRoute(duplicatedRoute.id);
    res.status(201).json({
      success: true,
      message: 'Route duplicated successfully',
      data: { ...duplicatedRoute.toJSON(), stops: orderedStops },
    });
  } catch (err) {
    next(err);
  }
};

// ── 6. Create Reverse Route (Automated Return Direction) ──────────────
exports.reverse = async (req, res, next) => {
  try {
    const origRoute = await Route.findByPk(req.params.id);
    if (!origRoute) return res.status(404).json({ success: false, message: 'Source route not found' });

    const body = req.body || {};
    const origStops = await fetchOrderedStopsForRoute(origRoute.id);
    if (origStops.length < 2) {
      return res.status(400).json({ success: false, message: 'Route must have at least 2 stops to reverse' });
    }

    const reversedStops = [...origStops].reverse();
    const timestamp = Math.floor(Date.now() / 1000);
    const newRouteCode = body.route_code || `${origRoute.route_code}-REV-${timestamp}`;
    const newRouteName = body.route_name || `${origRoute.destination_city} → ${origRoute.origin_city}`;

    const reverseRoute = await sequelize.transaction(async (transaction) => {
      const created = await Route.create(
        {
          route_name: String(newRouteName).trim(),
          route_code: String(newRouteCode).trim(),
          origin_city: origRoute.destination_city,
          destination_city: origRoute.origin_city,
          total_distance: origRoute.total_distance,
          estimated_duration: origRoute.estimated_duration,
          description: `Reverse route of ${origRoute.route_name}`,
          status: 'Active',
        },
        { transaction }
      );

      for (let i = 0; i < reversedStops.length; i++) {
        const s = reversedStops[i];
        await RouteStop.create(
          {
            route_id: created.id,
            stop_id: s.stop_id || s.id,
            stop_sequence: i + 1, // Reversed 1..N
            travel_time_minutes: i === 0 ? 0 : (Number(reversedStops[i - 1].travel_time_minutes) || 0),
            pickup_allowed: s.pickup_allowed !== false,
            dropoff_allowed: s.dropoff_allowed !== false,
            status: 'Active',
          },
          { transaction }
        );
      }

      return created;
    });

    const orderedStops = await fetchOrderedStopsForRoute(reverseRoute.id);
    res.status(201).json({
      success: true,
      message: 'Reverse route created successfully',
      data: { ...reverseRoute.toJSON(), stops: orderedStops },
    });
  } catch (err) {
    next(err);
  }
};

// ── 7. Remove Stop from Route (Deletes RouteStop Link Only) ────────────
exports.deleteStop = async (req, res, next) => {
  try {
    const routeId = Number(req.params.id);
    const stopId = Number(req.params.stopId);

    const routeStop = await RouteStop.findOne({ where: { route_id: routeId, stop_id: stopId } });
    if (!routeStop) {
      return res.status(404).json({ success: false, message: 'Stop association not found for this route' });
    }

    await sequelize.transaction(async (transaction) => {
      // 1. Delete link
      await routeStop.destroy({ transaction });

      // 2. Recalculate remaining sequences 1..N
      const remainingRouteStops = await RouteStop.findAll({
        where: { route_id: routeId },
        order: [['stop_sequence', 'ASC']],
        transaction,
      });

      for (let i = 0; i < remainingRouteStops.length; i++) {
        await remainingRouteStops[i].update({ stop_sequence: i + 1 }, { transaction });
      }
    });

    const updatedStops = await fetchOrderedStopsForRoute(routeId);
    res.json({
      success: true,
      message: 'Stop removed from route successfully. Physical stop record preserved.',
      data: { route_id: routeId, stops: updatedStops },
    });
  } catch (err) {
    next(err);
  }
};

// ── 8. Delete Entire Route ─────────────────────────────────────────────
exports.destroy = async (req, res, next) => {
  try {
    const route = await Route.findByPk(req.params.id);
    if (!route) return res.status(404).json({ success: false, message: 'Route not found' });

    await sequelize.transaction(async (transaction) => {
      await RouteStop.destroy({ where: { route_id: route.id }, transaction });
      await route.destroy({ transaction });
    });

    res.json({ success: true, message: 'Route deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ── Legacy Compatibility Wrappers ──────────────────────────────────────
exports.addStop = exports.create;
exports.updateStop = exports.update;
