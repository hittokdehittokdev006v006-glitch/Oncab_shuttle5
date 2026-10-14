'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Booking, Trip, Route, Stop, Driver, DriverDetail, Vehicle, TripStopArrival, TripLocation } = require('../models');
const busController = require('../controllers/busController');

async function testPassengerTracking() {
  console.log('--- Testing Passenger / User Bus Tracking API ---');

  let trip = await Trip.findByPk(2, { include: [{ model: Route, as: 'route' }] });
  if (!trip) {
    trip = await Trip.findOne({ include: [{ model: Route, as: 'route' }] });
  }

  let booking = await Booking.findOne({
    where: { trip_id: trip.id },
  });

  if (!booking) {
    console.log(`Creating test booking for Trip ${trip.id}...`);
    const stops = await Stop.findAll({ where: { route_id: trip.route_id } });
    booking = await Booking.create({
      booking_reference: 'TEST-BK-' + Date.now(),
      boarding_pass_code: 'BP-TEST-' + Math.floor(Math.random() * 10000),
      passenger_name: 'Test Passenger',
      passenger_mobile: '9876543210',
      travel_date: '2026-10-14',
      seat_numbers: '["1A"]',
      total_seats: 1,
      total_fare: 50.00,
      final_amount: 50.00,
      payment_status: 'paid',
      booking_status: 'confirmed',
      boarding_status: 'not_boarded',
      trip_id: trip.id,
      origin_stop_id: stops[0]?.id || 1,
      destination_stop_id: stops[stops.length - 1]?.id || 2,
    });
  }

  let reloadedBooking = await Booking.findOne({ where: { booking_reference: booking.booking_reference } });
  console.log(`Found/Created Booking ID: ${reloadedBooking.id}, Ref: ${reloadedBooking.booking_reference}, Pass: ${reloadedBooking.boarding_pass_code}`);

  // Test 1: Track by booking_id
  const req1 = { query: { booking_id: reloadedBooking.id }, body: {}, params: {} };
  const res1 = {
    status(code) { this.statusCode = code; return this; },
    json(payload) {
      console.log(`\n[Test 1 Response Code: ${this.statusCode || 200}] Success: ${payload.success}`);
      console.log('Timing & Distance:', payload.data?.timing_and_distance);
      console.log('Pickup Stop:', payload.data?.pickup_stop?.stop_name, 'Reached?', payload.data?.pickup_stop?.is_reached);
      console.log('Route Stoppages Count:', payload.data?.route_stoppages?.total_stops, 'Reached:', payload.data?.route_stoppages?.reached_stops);
      console.log('Stoppages Details:', payload.data?.route_stoppages?.stops);
    }
  };
  await busController.trackBooking(req1, res1, (err) => console.error('Test 1 Err:', err));

  // Test 2: Track by boarding_pass_code
  const req2 = { query: { boarding_pass_code: booking.boarding_pass_code }, body: {}, params: {} };
  const res2 = {
    status(code) { this.statusCode = code; return this; },
    json(payload) {
      console.log(`\n[Test 2 Response Code: ${this.statusCode || 200}] Track by Boarding Pass Code: ${payload.data?.booking?.boarding_pass_code}`);
    }
  };
  await busController.trackBooking(req2, res2, (err) => console.error('Test 2 Err:', err));

  console.log('\n--- Passenger Tracking API Test Complete ---');
}

testPassengerTracking()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
