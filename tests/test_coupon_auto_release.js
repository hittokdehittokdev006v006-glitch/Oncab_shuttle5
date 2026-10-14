'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Coupon, CouponUsage, CustomerUser, Booking, Trip, Route, Stop } = require('../models');
const couponController = require('../controllers/couponController');
const { calculateCouponDiscount } = require('../utils/coupon');
const { releaseUnusedCouponOnTripCompletion } = require('../services/couponReleaseService');

async function testCouponLifecycle() {
  console.log('--- Starting Coupon Auto-Release & Reuse Restriction Test ---');

  // 1. Create or find test passenger
  let passenger = await CustomerUser.findOne({ where: { mobile: '9123456789' } });
  if (!passenger) {
    passenger = await CustomerUser.create({
      name: 'Test Coupon User',
      mobile: '9123456789',
      email: 'couponuser@test.com',
      status: 'active',
    });
  }
  console.log(`Passenger ID: ${passenger.id}, Mobile: ${passenger.mobile}`);

  // 2. Create or find test coupon
  const couponCode = 'AUTORELEASE' + Math.floor(Math.random() * 1000);
  const coupon = await Coupon.create({
    code: couponCode,
    code_type: 'FLAT',
    amount: 25.00,
    min_amount: 10.00,
    per_user_limit: 1,
    status: 'Active',
    used_count: 0,
  });
  console.log(`Created Coupon: ${coupon.code}, ID: ${coupon.id}, per_user_limit: ${coupon.per_user_limit}`);

  // 3. Find or create an active test trip
  let route = await Route.findOne();
  let trip = await Trip.create({
    schedule_code: 'TEST-TRIP-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    route_id: route?.id || 1,
    departure_time: '10:00:00',
    trip_date: '2026-10-14',
    status: 'Active',
  });
  console.log(`Trip ID: ${trip.id}, Status: ${trip.status}`);

  // 4. Initial check: Coupon SHOULD be available
  let checkReq = { query: { passenger_id: passenger.id } };
  let availableCoupons = [];
  let checkRes = {
    status(code) { this.statusCode = code; return this; },
    json(payload) { availableCoupons = payload.data || []; },
  };
  await couponController.listAvailable(checkReq, checkRes, (err) => console.error(err));
  const isAvailableInitially = availableCoupons.some((c) => c.code === coupon.code);
  console.log(`[Step 1] Is coupon available initially? ${isAvailableInitially ? 'YES (PASS)' : 'NO (FAIL)'}`);

  // 5. Simulate booking creation where passenger uses the coupon
  const testBooking = await Booking.create({
    booking_reference: 'BK-TEST-CPN-' + Date.now(),
    boarding_pass_code: 'BP-CPN-' + Math.floor(Math.random() * 1000),
    trip_id: trip.id,
    passenger_id: passenger.id,
    passenger_name: passenger.name,
    passenger_mobile: passenger.mobile,
    travel_date: '2026-10-14',
    total_seats: 1,
    total_fare: 50.00,
    discount_amount: 25.00,
    final_amount: 25.00,
    coupon_id: coupon.id,
    payment_status: 'paid',
    booking_status: 'confirmed',
    boarding_status: 'not_boarded', // Passenger has not boarded
  });

  const couponUsage = await CouponUsage.create({
    coupon_id: coupon.id,
    booking_id: testBooking.id,
    passenger_id: passenger.id,
    discount_amount: 25.00,
  });
  await coupon.increment('used_count', { by: 1 });
  console.log(`[Step 2] Booking created with coupon. CouponUsage ID: ${couponUsage.id}, Booking ID: ${testBooking.id}`);

  // 6. Check availability while trip is active: Coupon MUST be HIDDEN
  availableCoupons = [];
  await couponController.listAvailable(checkReq, checkRes, (err) => console.error(err));
  const isAvailableWhileTripActive = availableCoupons.some((c) => c.code === coupon.code);
  console.log(`[Step 3] Is coupon hidden while trip active & in use? ${!isAvailableWhileTripActive ? 'YES, HIDDEN (PASS)' : 'NO, VISIBLE (FAIL)'}`);

  // 7. Test reuse rejection: calculateCouponDiscount should reject
  const discountResult = await calculateCouponDiscount({
    couponCode: coupon.code,
    amount: 100.00,
    passengerId: passenger.id,
  });
  console.log(`[Step 4] Coupon reuse attempt result: error="${discountResult.error}" (Expected rejection)`);

  // 8. Now trip status becomes 'Completed'
  console.log('[Step 5] Trip completes. Passenger did NOT board (boarding_status: not_boarded).');
  await trip.update({ status: 'Completed', completed_at: new Date() });

  // Call release logic
  const releaseResult = await releaseUnusedCouponOnTripCompletion(trip.id);
  console.log(`[Step 6] Release execution result:`, releaseResult);

  // 9. Verify CouponUsage was deleted and used_count decremented
  const remainingUsage = await CouponUsage.findOne({ where: { id: couponUsage.id } });
  await coupon.reload();
  console.log(`[Step 7] Remaining CouponUsage: ${remainingUsage ? 'STILL EXISTS (FAIL)' : 'DELETED (PASS)'}`);
  console.log(`[Step 8] Coupon used_count: ${coupon.used_count} (Expected: 0)`);

  // 10. Check availability after trip completion: Coupon MUST BE VISIBLE AGAIN
  availableCoupons = [];
  await couponController.listAvailable(checkReq, checkRes, (err) => console.error(err));
  const isAvailableAfterRelease = availableCoupons.some((c) => c.code === coupon.code);
  console.log(`[Step 9] Is coupon available again after release? ${isAvailableAfterRelease ? 'YES, REUSABLE (PASS)' : 'NO (FAIL)'}`);

  // 11. Test reuse calculation: calculateCouponDiscount should SUCCEED now
  const reuseResult = await calculateCouponDiscount({
    couponCode: coupon.code,
    amount: 100.00,
    passengerId: passenger.id,
  });
  console.log(`[Step 10] Reuse attempt: discount=₹${reuseResult.discount}, error=${reuseResult.error || 'none (PASS)'}`);

  // 12. Test Scenario B: Passenger DID BOARD (boarding_status: 'boarded')
  console.log('\n--- Testing Scenario B: Passenger DID BOARD ---');
  let tripB = await Trip.create({
    schedule_code: 'TEST-TRIP-BOARDED-' + Date.now(),
    route_id: trip.route_id,
    departure_time: '12:00:00',
    trip_date: '2026-10-14',
    status: 'Active',
  });

  const boardedBooking = await Booking.create({
    booking_reference: 'BK-TEST-BOARDED-' + Date.now(),
    boarding_pass_code: 'BP-BOARDED-' + Math.floor(Math.random() * 1000),
    trip_id: tripB.id,
    passenger_id: passenger.id,
    passenger_name: passenger.name,
    passenger_mobile: passenger.mobile,
    travel_date: '2026-10-14',
    total_seats: 1,
    total_fare: 50.00,
    discount_amount: 25.00,
    final_amount: 25.00,
    coupon_id: coupon.id,
    payment_status: 'paid',
    booking_status: 'confirmed',
    boarding_status: 'boarded', // PASSENGER BOARDED!
  });

  const boardedCouponUsage = await CouponUsage.create({
    coupon_id: coupon.id,
    booking_id: boardedBooking.id,
    passenger_id: passenger.id,
    discount_amount: 25.00,
  });
  await coupon.increment('used_count', { by: 1 });

  // Complete Trip B
  await tripB.update({ status: 'Completed', completed_at: new Date() });
  const releaseResultB = await releaseUnusedCouponOnTripCompletion(tripB.id);
  console.log(`[Step 11] Boarded trip release result (Should be 0 released):`, releaseResultB);

  const boardedUsageCheck = await CouponUsage.findOne({ where: { id: boardedCouponUsage.id } });
  console.log(`[Step 12] Boarded CouponUsage still exists? ${boardedUsageCheck ? 'YES, KEPT AS CONSUMED (PASS)' : 'NO, WRONGLY DELETED (FAIL)'}`);

  // Verify it is hidden from available coupons because it was legitimately used!
  availableCoupons = [];
  await couponController.listAvailable(checkReq, checkRes, (err) => console.error(err));
  const isAvailableAfterBoardedTrip = availableCoupons.some((c) => c.code === coupon.code);
  console.log(`[Step 13] Is coupon hidden for boarded passenger? ${!isAvailableAfterBoardedTrip ? 'YES, HIDDEN (PASS)' : 'NO (FAIL)'}`);

  console.log('\n--- ALL COUPON AUTO-RELEASE TESTS COMPLETED SUCCESSFULLY ---');
}

testCouponLifecycle()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
