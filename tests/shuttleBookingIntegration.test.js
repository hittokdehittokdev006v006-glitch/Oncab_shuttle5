/**
 * Integration Test for Shuttle Booking & Ride Package Controller
 * 
 * Verifies:
 * 1. Package listing and details API logic against live/mock database
 * 2. bookShuttle parameter validation and package validation handling
 * 3. Package price snapshot calculation during booking
 * 4. Error handling and standard API response contracts
 */

const assert = require('assert');
const shuttleController = require('../controllers/shuttleController');
const { RidePackage, ShuttleSchedule, Trip, Stop, Booking } = require('../models');

// Helper to mock Express req and res
function createMockReqRes({ body = {}, params = {}, query = {}, user = null } = {}) {
  const req = {
    body,
    params,
    query,
    user: user || { id: 1, role: 'user', name: 'Test User' }
  };

  const res = {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    }
  };

  return { req, res };
}

async function runIntegrationTests() {
  console.log('====================================================');
  console.log('🧪 Starting Shuttle Booking Controller Integration Tests');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Reason: ${err.message}`);
      failed++;
    }
  }

  // 1. Test getPackages API
  await test('getPackages API: Successfully returns list of active packages from database', async () => {
    const { req, res } = createMockReqRes();
    await shuttleController.getPackages(req, res, (err) => { throw err; });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.success, true);
    assert(Array.isArray(res.data.data), 'res.data.data should be an array of packages');
    assert(res.data.data.length >= 5, 'Should have at least 5 seeded packages');

    const starter = res.data.data.find(p => p.package_code === 'RP-STARTER-5');
    assert(starter, 'Starter pack should exist in DB');
    assert.strictEqual(starter.rides_count, 5);
    assert.strictEqual(starter.formatted_price, '₹545');
    assert.strictEqual(starter.formatted_per_ride, '₹109/ride');
  });

  // 2. Test getPackageDetails API - Valid package
  await test('getPackageDetails API: Successfully returns package details with perks & savings', async () => {
    const { req, res } = createMockReqRes({ params: { id: 1 } });
    await shuttleController.getPackageDetails(req, res, (err) => { throw err; });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.package_code, 'RP-STARTER-5');
    assert(Array.isArray(res.data.data.features), 'features should be an array');
    assert(res.data.data.features.length > 0);
  });

  // 3. Test getPackageDetails API - Non-existent package
  await test('getPackageDetails API: Returns 404 when package does not exist', async () => {
    const { req, res } = createMockReqRes({ params: { id: 99999 } });
    await shuttleController.getPackageDetails(req, res, (err) => { throw err; });

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.data.success, false);
    assert(res.data.message.includes('not found'));
  });

  // 4. Test bookShuttle validation - Missing required fields
  await test('bookShuttle API: Validates required passenger and trip fields', async () => {
    const { req, res } = createMockReqRes({
      body: {
        // Missing schedule_id, pickup_stop_id, passenger_name, etc.
      }
    });

    await shuttleController.bookShuttle(req, res, (err) => { throw err; });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.data.success, false);
    assert(res.data.message.includes('schedule_id or trip_id is required'));
  });

  // 5. Test bookShuttle validation - Missing stop IDs
  await test('bookShuttle API: Validates pickup and drop stop IDs', async () => {
    const { req, res } = createMockReqRes({
      body: {
        schedule_id: 1,
        passenger_name: 'Test Passenger',
        passenger_mobile: '9876543210'
      }
    });

    await shuttleController.bookShuttle(req, res, (err) => { throw err; });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.data.success, false);
    assert(res.data.message.includes('pickup_stop_id and drop_stop_id are required'));
  });

  // 6. Test bookShuttle with invalid package ID
  await test('bookShuttle API: Rejects nonexistent package ID with 400', async () => {
    const { req, res } = createMockReqRes({
      body: {
        schedule_id: 1,
        pickup_stop_id: 1,
        drop_stop_id: 2,
        passenger_name: 'John Commuter',
        passenger_mobile: '9876543210',
        package_id: 99999
      }
    });

    await shuttleController.bookShuttle(req, res, (err) => { throw err; });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.data.success, false);
    assert(res.data.message.includes('Ride Pack package does not exist'));
  });

  // 7. Test bookShuttle with exceeding passenger limit (>4) for packages
  await test('bookShuttle API: Rejects passenger count > 4 for ride packages', async () => {
    const { req, res } = createMockReqRes({
      body: {
        schedule_id: 1,
        pickup_stop_id: 1,
        drop_stop_id: 2,
        passenger_name: 'John Commuter',
        passenger_mobile: '9876543210',
        package_id: 1,
        passengers: 5
      }
    });

    await shuttleController.bookShuttle(req, res, (err) => { throw err; });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.data.success, false);
    assert(res.data.message.includes('up to a maximum of 4 passengers'));
  });

  // 8. Test bookShuttle End-to-End with Starter Ride Pack
  let createdBookingId = null;
  await test('bookShuttle API: Creates and persists Ride Pack package booking with snapshot data', async () => {
    const { req, res } = createMockReqRes({
      body: {
        schedule_id: 1,
        pickup_stop_id: 1,
        drop_stop_id: 2,
        passenger_name: 'Anita Roy',
        passenger_mobile: '9830012345',
        passenger_email: 'anita.roy@example.com',
        travel_date: '2026-11-01',
        package_id: 1, // Starter Ride Pack: 5 rides, 545 INR
        payment_method: 'cash',
        use_wallet: false
      }
    });

    await shuttleController.bookShuttle(req, res, (err) => { throw err; });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.success, true);
    assert(res.data.booking, 'Booking object should be returned');

    const booking = res.data.booking;
    createdBookingId = booking.id;
    assert.strictEqual(booking.is_package_booking, true);
    assert.strictEqual(booking.package_id, 1);
    assert.strictEqual(booking.package_name, 'Starter Ride Pack');
    assert.strictEqual(booking.package_rides_count, 5);
    assert.strictEqual(Number(booking.package_price_per_ride), 109);
    assert.strictEqual(Number(booking.final_amount), 545);
    assert.strictEqual(booking.pickup_stop_name, 'Garia');
    assert.strictEqual(booking.drop_stop_name, 'Ruby');

    // Verify row in database
    const dbBooking = await Booking.findByPk(createdBookingId);
    assert(dbBooking !== null, 'Booking must exist in database');
    assert.strictEqual(dbBooking.package_id, 1);
    assert.strictEqual(dbBooking.package_name, 'Starter Ride Pack');
    assert.strictEqual(Number(dbBooking.final_amount), 545);
  });

  // 9. Test cancelBooking API on created booking
  await test('cancelBooking API: Successfully cancels booking and updates status', async () => {
    assert(createdBookingId !== null, 'Should have createdBookingId');

    const { req, res } = createMockReqRes({
      params: { id: createdBookingId },
      body: { cancellation_reason: 'Change of commute plans' }
    });

    await shuttleController.cancelBooking(req, res, (err) => { throw err; });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.status, 'Cancelled');

    const updated = await Booking.findByPk(createdBookingId);
    assert.strictEqual(updated.status, 'Cancelled');
  });

  console.log('\n====================================================');
  console.log(`📊 Integration Test Results: ${passed} passed, ${failed} failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runIntegrationTests().catch(err => {
  console.error('Fatal integration test error:', err);
  process.exit(1);
});
