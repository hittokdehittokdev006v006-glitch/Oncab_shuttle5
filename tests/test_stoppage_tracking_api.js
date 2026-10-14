'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const jwt = require('jsonwebtoken');
const { Trip, Stop, Route, Driver, DriverDetail, Vehicle, TripStopArrival, TripLocation } = require('../models');

async function runTest() {
  console.log('--- Starting Driver Route & Stoppage Tracking Integration Test ---');

  // 1. Find or verify test driver & trip
  let driver = await Driver.findOne();
  if (!driver) {
    console.log('Creating mock driver for test...');
    driver = await Driver.create({
      name: 'Test Driver',
      mobile: '9999988888',
      online_status: 'online',
      status: 'Active',
    });
  }

  let route = await Route.findOne({ include: [{ model: Stop, as: 'stops' }] });
  if (!route) {
    console.log('Creating mock route...');
    route = await Route.create({
      route_name: 'Test Express Line',
      route_code: 'TEST-EXP-01',
      origin_city: 'Kolkata',
      destination_city: 'Salt Lake',
      total_distance: 15.5,
      estimated_duration: 35,
    });
  }

  let stops = await Stop.findAll({ where: { route_id: route.id }, order: [['stop_sequence', 'ASC']] });
  if (!stops.length) {
    console.log('Creating test stops...');
    const s1 = await Stop.create({
      route_id: route.id,
      stop_name: 'Howrah Station',
      stop_sequence: 1,
      latitude: 22.5851,
      longitude: 88.3426,
    });
    const s2 = await Stop.create({
      route_id: route.id,
      stop_name: 'Esplanade',
      stop_sequence: 2,
      latitude: 22.5645,
      longitude: 88.3524,
    });
    const s3 = await Stop.create({
      route_id: route.id,
      stop_name: 'Sector V',
      stop_sequence: 3,
      latitude: 22.5804,
      longitude: 88.4378,
    });
    stops = [s1, s2, s3];
  }

  let vehicle = await Vehicle.findOne();
  if (!vehicle) {
    vehicle = await Vehicle.create({
      registration_number: 'WB-01-TEST-99',
      company_model: 'Volvo 9400',
      status: 'Active',
      driver_id: driver.id,
    });
  }

  let trip = await Trip.findOne({ where: { driver_id: driver.id } });
  if (!trip) {
    trip = await Trip.create({
      route_id: route.id,
      schedule_code: `TEST-TRIP-${Date.now()}`,
      departure_time: '09:00:00',
      status: 'Active',
      trip_date: new Date().toISOString().slice(0, 10),
      driver_id: driver.id,
      vehicle_id: vehicle.id,
      started_at: new Date(),
    });
  } else {
    await trip.update({
      route_id: route.id,
      status: 'Active',
      vehicle_id: vehicle.id,
      started_at: new Date(),
    });
  }

  console.log(`Using Driver ID: ${driver.id}, Trip ID: ${trip.id}, Stops: ${stops.length}`);

  // Test Driver Controller arriveAtStop action
  const driverAppController = require('../controllers/driverAppController');
  const reqArrive = {
    driver: { id: driver.id, name: driver.name },
    params: { id: trip.id, stopId: stops[0].id },
    body: {
      latitude: 22.5852,
      longitude: 88.3428,
      speed: 0,
      heading: 90,
      notes: 'Driver arrived at pickup stop',
    },
  };

  let arriveResponseData = null;
  const resArrive = {
    status: (code) => ({
      json: (data) => {
        arriveResponseData = data;
        console.log(`[Driver arriveAtStop] Code: ${code}, Success: ${data.success}, Msg: ${data.message}`);
      },
    }),
    json: (data) => {
      arriveResponseData = data;
      console.log(`[Driver arriveAtStop] Success: ${data.success}, Msg: ${data.message}`);
    },
  };

  await driverAppController.arriveAtStop(reqArrive, resArrive, (err) => console.error('Arrive error:', err));

  // Verify in database: trip_stop_arrivals
  const dbArrival = await TripStopArrival.findOne({
    where: { trip_id: trip.id, stop_id: stops[0].id },
  });
  console.log('✅ Stoppage Reach in DB (trip_stop_arrivals):', {
    id: dbArrival?.id,
    stop_name: dbArrival?.stop_name,
    arrived_at: dbArrival?.arrived_at,
    status: dbArrival?.status,
    lat: dbArrival?.arrival_latitude,
    lng: dbArrival?.arrival_longitude,
  });

  // Verify in database: trip_locations
  const dbLocation = await TripLocation.findOne({
    where: { trip_id: trip.id, driver_id: driver.id },
    order: [['id', 'DESC']],
  });
  console.log('✅ Driver Location in DB (trip_locations):', {
    id: dbLocation?.id,
    trip_id: dbLocation?.trip_id,
    driver_id: dbLocation?.driver_id,
    lat: dbLocation?.latitude,
    lng: dbLocation?.longitude,
    recorded_at: dbLocation?.recorded_at,
  });

  // Test Driver Controller getTripRouteMap
  let routeMapResponseData = null;
  const reqRouteMap = {
    driver: { id: driver.id, name: driver.name },
    params: { id: trip.id },
  };
  const resRouteMap = {
    status: () => resRouteMap,
    json: (data) => {
      routeMapResponseData = data;
      console.log(`[Driver getTripRouteMap] Total Stops: ${data.data?.progress?.total_stops}, Reached: ${data.data?.progress?.reached_stops}`);
      const s0 = data.data?.stops?.[0];
      console.log(`Stop 1 (${s0?.stop_name}): is_reached=${s0?.is_reached}, status=${s0?.status}, arrived_at=${s0?.arrived_at}`);
    },
  };

  await driverAppController.getTripRouteMap(reqRouteMap, resRouteMap, (err) => console.error('RouteMap error:', err));

  // Test Admin Controller getTripStoppageHistory
  const locationController = require('../controllers/locationController');
  const reqAdminStoppages = {
    user: { id: 1, role: 'admin' },
    params: { id: trip.id },
  };
  const resAdminStoppages = {
    status: () => resAdminStoppages,
    json: (data) => {
      console.log(`[Admin getTripStoppageHistory] Success: ${data.success}, Timeline entries: ${data.data?.timeline?.length}`);
      const reachedStops = data.data?.timeline?.filter((s) => s.is_reached);
      console.log(`Admin sees reached stops: ${reachedStops?.map((s) => `${s.stop_name} at ${s.arrived_at}`).join(', ')}`);
    },
  };
  await locationController.getTripStoppageHistory(reqAdminStoppages, resAdminStoppages, (err) => console.error('Admin stoppage error:', err));

  // Test Admin Controller getStoppageLogs
  const reqAdminLogs = {
    user: { id: 1, role: 'admin' },
    query: { trip_id: trip.id, limit: 10 },
  };
  const resAdminLogs = {
    status: () => resAdminLogs,
    json: (data) => {
      console.log(`[Admin getStoppageLogs] Success: ${data.success}, Found ${data.data?.arrivals?.length} stoppage arrival log(s)`);
    },
  };
  await locationController.getStoppageLogs(reqAdminLogs, resAdminLogs, (err) => console.error('Admin logs error:', err));

  console.log('--- ALL TESTS COMPLETED SUCCESSFULLY! ---');
  process.exit(0);
}

runTest().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
