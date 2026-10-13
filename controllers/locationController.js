'use strict';

const { hasRole } = require('../utils/roles');
const { Op } = require('sequelize');
const { Vehicle, DriverDetail, Trip, Route, Stop, Driver, TripLocation } = require('../models');

const distanceInMeters = (latitude1, longitude1, latitude2, longitude2) => {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(latitude2 - latitude1);
  const longitudeDelta = radians(longitude2 - longitude1);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitude1)) * Math.cos(radians(latitude2)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const findNearestStop = (latitude, longitude, stops) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !stops.length) return null;
  return stops.reduce((nearest, stop, index) => {
    const distance = distanceInMeters(latitude, longitude, Number(stop.latitude), Number(stop.longitude));
    return !nearest || distance < nearest.distance_meters
      ? { stop_id: stop.id, stop_name: stop.stop_name, stop_sequence: stop.stop_sequence, distance_meters: Math.round(distance), route_index: index }
      : nearest;
  }, null);
};

exports.dashboard = async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const isOwner = hasRole(req.user, 'owner');
    const [vehicles, ownedDrivers] = await Promise.all([
      Vehicle.findAll({
        where: isOwner ? { owner_id: req.user.id } : {},
        attributes: ['id', 'registration_number', 'company_model', 'status', 'latitude', 'longitude', 'driver_id', 'bus_type_id', 'owner_id'],
        include: [{
          model: Driver,
          as: 'driver',
          attributes: ['id', 'name', 'mobile', 'online_status', 'owner_id'],
          include: [{ model: DriverDetail, as: 'details', attributes: ['latitude', 'longitude', 'location_speed_kmh', 'location_heading', 'location_trip_id', 'updated_at'] }],
        }],
        order: [['registration_number', 'ASC']],
      }),
      isOwner ? Driver.findAll({ attributes: ['id'], where: { owner_id: req.user.id }, raw: true }) : Promise.resolve([]),
    ]);
    const ownedVehicleIds = vehicles.map((vehicle) => Number(vehicle.id));
    const ownedDriverIds = ownedDrivers.map((driver) => Number(driver.id));
    const assignmentConditions = [
      ...(ownedVehicleIds.length ? [{ vehicle_id: { [Op.in]: ownedVehicleIds } }] : []),
      ...(ownedDriverIds.length ? [{ driver_id: { [Op.in]: ownedDriverIds } }] : []),
    ];
    const tripWhere = {
      status: { [Op.in]: ['Scheduled', 'Active', 'Delayed'] },
      [Op.or]: [{ trip_date: null }, { trip_date: { [Op.gte]: today } }],
      ...(isOwner ? { [Op.and]: [{ [Op.or]: assignmentConditions.length ? assignmentConditions : [{ id: { [Op.in]: [] } }] }] } : {}),
    };
    const trips = await Trip.findAll({
      where: tripWhere,
      include: [
        { model: Route, as: 'route', include: [{ model: Stop, as: 'stops', attributes: ['id', 'stop_name', 'latitude', 'longitude', 'stop_sequence'], required: false }] },
        {
          model: Driver,
          as: 'driver',
          attributes: ['id', 'name', 'mobile'],
          required: false,
          include: [{ model: DriverDetail, as: 'details', attributes: ['latitude', 'longitude', 'location_speed_kmh', 'location_heading', 'location_trip_id', 'updated_at'] }],
        },
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'registration_number'], required: false },
      ],
      order: [['trip_date', 'ASC'], ['departure_time', 'ASC']],
    });
    const routeIds = [...new Set(trips.map((trip) => Number(trip.route_id)))];
    const routes = await Route.findAll({
      where: isOwner ? { id: { [Op.in]: routeIds } } : {},
      attributes: ['id', 'route_name', 'route_code', 'origin_city', 'destination_city', 'status'],
      include: [{ model: Stop, as: 'stops', attributes: ['id', 'stop_name', 'latitude', 'longitude', 'stop_sequence'], required: false }],
      order: [['route_name', 'ASC']],
    });

    const serializedTrips = trips.map((trip) => {
      const data = trip.toJSON();
      data.route?.stops?.sort((a, b) => a.stop_sequence - b.stop_sequence);
      return data;
    });

    const busData = vehicles.map((vehicleModel) => {
      const vehicle = vehicleModel.toJSON();
      const vehicleDetail = vehicle.driver?.details;
      const associatedTrips = serializedTrips.filter((trip) => Number(trip.vehicle_id) === Number(vehicle.id)
        || (vehicle.driver?.id && Number(trip.driver_id) === Number(vehicle.driver.id))
        || (vehicleDetail?.location_trip_id && Number(trip.id) === Number(vehicleDetail.location_trip_id)));
      const currentTrip = associatedTrips.find((trip) => ['Active', 'Delayed'].includes(trip.status)) || null;
      const upcomingTrip = associatedTrips.find((trip) => trip.status === 'Scheduled') || null;
      const detail = currentTrip?.driver?.details || vehicleDetail;
      const rawLatitude = detail?.latitude != null ? detail.latitude : vehicle.latitude;
      const rawLongitude = detail?.longitude != null ? detail.longitude : vehicle.longitude;
      const hasCoordinates = rawLatitude != null && rawLongitude != null && rawLatitude !== '' && rawLongitude !== '';
      const latitude = hasCoordinates ? Number(rawLatitude) : NaN;
      const longitude = hasCoordinates ? Number(rawLongitude) : NaN;
      const updatedAt = detail?.updated_at || null;
      const gpsAgeSeconds = updatedAt ? Math.max(0, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 1000)) : null;
      const positionIsValid = Number.isFinite(latitude) && Number.isFinite(longitude)
        && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
      const gpsFresh = positionIsValid && gpsAgeSeconds !== null && gpsAgeSeconds <= 120;
      const routeStops = (currentTrip?.route?.stops || upcomingTrip?.route?.stops || [])
        .filter((stop) => stop.latitude != null && stop.longitude != null
          && Number.isFinite(Number(stop.latitude)) && Number.isFinite(Number(stop.longitude))
          && Math.abs(Number(stop.latitude)) <= 90 && Math.abs(Number(stop.longitude)) <= 180);
      const nearestStop = currentTrip && positionIsValid ? findNearestStop(latitude, longitude, routeStops) : null;
      const trackingStatus = vehicle.status !== 'Active'
        ? 'Inactive'
        : currentTrip
          ? gpsFresh ? 'Live' : positionIsValid ? 'Stale' : 'No GPS'
          : upcomingTrip ? 'Upcoming' : gpsFresh ? 'Available' : 'Offline';

      return {
        id: vehicle.id,
        registration_number: vehicle.registration_number,
        model: vehicle.company_model,
        vehicle_status: vehicle.status,
        tracking_status: trackingStatus,
        driver: (currentTrip?.driver || vehicle.driver) ? {
          id: (currentTrip?.driver || vehicle.driver).id,
          name: (currentTrip?.driver || vehicle.driver).name,
          mobile: (currentTrip?.driver || vehicle.driver).mobile,
          online_status: (currentTrip?.driver || vehicle.driver).online_status || null,
        } : null,
        location: positionIsValid ? {
          latitude,
          longitude,
          speed_kmh: detail?.location_speed_kmh == null ? null : Number(detail.location_speed_kmh),
          heading: detail?.location_heading == null ? null : Number(detail.location_heading),
          updated_at: updatedAt,
          age_seconds: gpsAgeSeconds,
          is_live: gpsFresh,
        } : null,
        current_trip: currentTrip,
        upcoming_trip: upcomingTrip,
        nearest_stop: nearestStop,
        stops_passed_estimate: nearestStop ? nearestStop.route_index : 0,
      };
    });

    const routesWithStatus = routes.map((routeModel) => {
      const route = routeModel.toJSON();
      route.stops?.sort((a, b) => a.stop_sequence - b.stop_sequence);
      const routeTrips = serializedTrips.filter((trip) => Number(trip.route_id) === Number(route.id));
      const activeCount = busData.filter((bus) => Number(bus.current_trip?.route_id) === Number(route.id)).length;
      return {
        ...route,
        active_buses: activeCount,
        upcoming_trips: routeTrips.filter((trip) => trip.status === 'Scheduled').length,
        trip_status: activeCount ? 'In progress' : routeTrips.some((trip) => trip.status === 'Scheduled') ? 'Upcoming' : 'No active trips',
      };
    });

    res.json({
      success: true,
      data: {
        generated_at: new Date().toISOString(),
        buses: busData,
        routes: routesWithStatus,
        summary: {
          total: busData.length,
          live: busData.filter((bus) => bus.tracking_status === 'Live').length,
          upcoming: busData.filter((bus) => bus.tracking_status === 'Upcoming').length,
          offline: busData.filter((bus) => ['Offline', 'Stale', 'No GPS'].includes(bus.tracking_status)).length,
          inactive: busData.filter((bus) => bus.tracking_status === 'Inactive').length,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Trip Driver Location History List (Past 48 Hours)
 * Supports routewise, buswise, timewise, and driverwise filtering
 * GET /api2/locations/history
 */
exports.getHistoryList = async (req, res, next) => {
  try {
    const isOwner = hasRole(req.user, 'owner');
    const {
      route_id,
      vehicle_id,
      driver_id,
      date,
      from_date,
      to_date,
      time_slot,
      status,
      search,
      page = 1,
      limit = 50,
    } = req.query;

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

    // Two days (48 hours) retention window
    const cutoffDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const cutoffDateStr = cutoffDate.toISOString().slice(0, 10);

    const tripWhere = {};

    const retentionConditions = [
      { started_at: { [Op.gte]: cutoffDate } },
      { trip_date: { [Op.gte]: cutoffDateStr } },
      { status: 'Active' },
    ];

    if (date) {
      tripWhere.trip_date = date;
    } else if (from_date || to_date) {
      const dateRange = {};
      if (from_date) dateRange[Op.gte] = from_date;
      if (to_date) dateRange[Op.lte] = to_date;
      tripWhere.trip_date = dateRange;
    } else {
      tripWhere[Op.or] = retentionConditions;
    }

    if (route_id) {
      tripWhere.route_id = Number(route_id);
    }
    if (vehicle_id) {
      tripWhere.vehicle_id = Number(vehicle_id);
    }
    if (driver_id) {
      tripWhere.driver_id = Number(driver_id);
    }
    if (status && status !== 'all') {
      tripWhere.status = status;
    }

    if (time_slot) {
      if (time_slot === 'morning') {
        tripWhere.departure_time = { [Op.between]: ['06:00:00', '11:59:59'] };
      } else if (time_slot === 'afternoon') {
        tripWhere.departure_time = { [Op.between]: ['12:00:00', '17:59:59'] };
      } else if (time_slot === 'evening') {
        tripWhere.departure_time = { [Op.between]: ['18:00:00', '23:59:59'] };
      } else if (time_slot === 'night') {
        tripWhere.departure_time = { [Op.between]: ['00:00:00', '05:59:59'] };
      }
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      tripWhere[Op.and] = [
        ...(tripWhere[Op.and] || []),
        {
          [Op.or]: [
            { schedule_code: { [Op.like]: q } },
          ],
        },
      ];
    }

    const vehicleInclude = {
      model: Vehicle,
      as: 'vehicle',
      attributes: ['id', 'registration_number', 'company_model', 'status', 'owner_id'],
      where: isOwner ? { owner_id: req.user.id } : undefined,
      required: isOwner,
    };

    const driverInclude = {
      model: Driver,
      as: 'driver',
      attributes: ['id', 'name', 'mobile', 'owner_id'],
      required: false,
    };

    const routeInclude = {
      model: Route,
      as: 'route',
      attributes: ['id', 'route_name', 'route_code', 'origin_city', 'destination_city'],
      required: false,
    };

    const { count, rows: trips } = await Trip.findAndCountAll({
      where: tripWhere,
      include: [routeInclude, vehicleInclude, driverInclude],
      order: [
        ['started_at', 'DESC'],
        ['trip_date', 'DESC'],
        ['departure_time', 'DESC'],
      ],
      limit: l,
      offset: (p - 1) * l,
    });

    const tripIds = trips.map((t) => t.id);

    let locationStatsMap = {};
    if (tripIds.length > 0) {
      try {
        const stats = await TripLocation.findAll({
          attributes: [
            'trip_id',
            [TripLocation.sequelize.fn('COUNT', TripLocation.sequelize.col('id')), 'total_points'],
            [TripLocation.sequelize.fn('MIN', TripLocation.sequelize.col('recorded_at')), 'first_ping'],
            [TripLocation.sequelize.fn('MAX', TripLocation.sequelize.col('recorded_at')), 'latest_ping'],
            [TripLocation.sequelize.fn('MAX', TripLocation.sequelize.col('speed_kmh')), 'max_speed'],
            [TripLocation.sequelize.fn('AVG', TripLocation.sequelize.col('speed_kmh')), 'avg_speed'],
          ],
          where: { trip_id: { [Op.in]: tripIds } },
          group: ['trip_id'],
          raw: true,
        });

        for (const s of stats) {
          locationStatsMap[s.trip_id] = {
            total_points: parseInt(s.total_points, 10) || 0,
            first_ping: s.first_ping,
            latest_ping: s.latest_ping,
            max_speed_kmh: s.max_speed ? Number(Number(s.max_speed).toFixed(1)) : 0,
            avg_speed_kmh: s.avg_speed ? Number(Number(s.avg_speed).toFixed(1)) : 0,
          };
        }
      } catch (statErr) {
        console.warn('Location stats query error:', statErr.message);
      }
    }

    const [allRoutes, allVehicles, allDrivers] = await Promise.all([
      Route.findAll({
        attributes: ['id', 'route_name', 'route_code', 'origin_city', 'destination_city'],
        order: [['route_name', 'ASC']],
      }),
      Vehicle.findAll({
        where: isOwner ? { owner_id: req.user.id } : {},
        attributes: ['id', 'registration_number', 'company_model'],
        order: [['registration_number', 'ASC']],
      }),
      Driver.findAll({
        where: isOwner ? { owner_id: req.user.id } : {},
        attributes: ['id', 'name', 'mobile'],
        order: [['name', 'ASC']],
      }),
    ]);

    const serializedTrips = trips.map((trip) => {
      const data = trip.toJSON();
      const st = locationStatsMap[trip.id] || {
        total_points: 0,
        first_ping: null,
        latest_ping: null,
        max_speed_kmh: 0,
        avg_speed_kmh: 0,
      };
      return {
        ...data,
        location_stats: st,
      };
    });

    res.json({
      success: true,
      data: {
        trips: serializedTrips,
        pagination: {
          total: count,
          page: p,
          limit: l,
          pages: Math.ceil(count / l),
        },
        filters: {
          routes: allRoutes,
          vehicles: allVehicles,
          drivers: allDrivers,
          retention_hours: 48,
          cutoff_date: cutoffDate.toISOString(),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Trip GPS Breadcrumb History
 * GET /api2/locations/trips/:id
 */
exports.getTripLocationHistory = async (req, res, next) => {
  try {
    const tripId = req.params.id;
    const isOwner = hasRole(req.user, 'owner');

    const trip = await Trip.findOne({
      where: { id: tripId },
      include: [
        { model: Driver, as: 'driver', attributes: ['id', 'name', 'mobile', 'owner_id'] },
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'registration_number', 'company_model', 'owner_id'] },
        {
          model: Route,
          as: 'route',
          attributes: ['id', 'route_name', 'route_code', 'origin_city', 'destination_city'],
          include: [{ model: Stop, as: 'stops', attributes: ['id', 'stop_name', 'latitude', 'longitude', 'stop_sequence'] }],
        },
      ],
    });

    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found' });
    }

    if (isOwner && trip.vehicle?.owner_id !== req.user.id && trip.driver?.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to trip' });
    }

    const { limit = 2000 } = req.query;
    const locations = await TripLocation.findAll({
      where: { trip_id: tripId },
      order: [['recorded_at', 'ASC']],
      limit: Math.min(5000, Math.max(1, parseInt(limit, 10) || 2000)),
      attributes: ['id', 'latitude', 'longitude', 'speed_kmh', 'heading', 'accuracy', 'battery_level', 'recorded_at'],
    });

    const routeData = trip.route ? trip.route.toJSON() : null;
    if (routeData?.stops) {
      routeData.stops.sort((a, b) => a.stop_sequence - b.stop_sequence);
    }

    res.json({
      success: true,
      data: {
        trip_id: trip.id,
        schedule_code: trip.schedule_code,
        status: trip.status,
        trip_date: trip.trip_date,
        departure_time: trip.departure_time,
        started_at: trip.started_at,
        completed_at: trip.completed_at,
        driver: trip.driver,
        vehicle: trip.vehicle,
        route: routeData,
        total_points: locations.length,
        locations,
      },
    });
  } catch (err) {
    next(err);
  }
};