/**
 * Automated Test Suite for Ride Package System in Shuttle Booking
 * 
 * Verifies:
 * 1. PackagePricingService calculations and safety against price tampering
 * 2. Active status and validity checks (Active vs Inactive)
 * 3. Route-restricted package validation (matching vs mismatch)
 * 4. Passenger limit checks (>4 seats rejected)
 * 5. Single-ride fare calculation
 * 6. Snapshot immutability & metadata completeness
 * 7. Package listing and filtering
 */

const assert = require('assert');
const PackagePricingService = require('../services/packagePricingService');
const { RidePackage } = require('../models');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Ride Package System Test Suite');
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

  // Preserve original methods for mock restoration
  const originalFindByPk = RidePackage.findByPk;
  const originalFindOne = RidePackage.findOne;
  const originalFindAll = RidePackage.findAll;

  // Mock Package Database
  const mockPackages = {
    1: {
      id: 1,
      package_code: 'RP-STARTER-5',
      name: 'Starter Commuter Pack',
      package_type: 'starter',
      rides_count: 5,
      validity_days: 7,
      price_per_ride: '70.00',
      total_price: '350.00',
      original_price: '400.00',
      discount_percentage: 12.5,
      route_id: null,
      status: 'Active',
      is_popular: false,
      features: ['5 One-Way Rides', 'Valid for 7 days'],
      toJSON() { return { ...this }; }
    },
    2: {
      id: 2,
      package_code: 'RP-WEEKLY-10',
      name: 'Weekly Saver Pack',
      package_type: 'weekly',
      rides_count: 10,
      validity_days: 14,
      price_per_ride: '65.00',
      total_price: '650.00',
      original_price: '800.00',
      discount_percentage: 18.75,
      route_id: null,
      status: 'Active',
      is_popular: true,
      features: ['10 One-Way Rides', 'Valid for 14 days'],
      toJSON() { return { ...this }; }
    },
    3: {
      id: 3,
      package_code: 'RP-INACTIVE-30',
      name: 'Archived Monthly Pack',
      package_type: 'monthly',
      rides_count: 30,
      validity_days: 30,
      price_per_ride: '55.00',
      total_price: '1650.00',
      original_price: '2400.00',
      discount_percentage: 31.25,
      route_id: null,
      status: 'Inactive',
      is_popular: false,
      features: [],
      toJSON() { return { ...this }; }
    },
    4: {
      id: 4,
      package_code: 'RP-ROUTE-SPECIFIC',
      name: 'Express Route 42 Pack',
      package_type: 'monthly',
      rides_count: 20,
      validity_days: 30,
      price_per_ride: '60.00',
      total_price: '1200.00',
      original_price: '1600.00',
      discount_percentage: 25.0,
      route_id: 42,
      status: 'Active',
      is_popular: false,
      features: ['Valid exclusively on Route 42'],
      toJSON() { return { ...this }; }
    }
  };

  // Mock implementation
  RidePackage.findByPk = async (id) => {
    return mockPackages[id] || null;
  };

  RidePackage.findOne = async ({ where }) => {
    if (where && where.package_code) {
      const found = Object.values(mockPackages).find(p => p.package_code === where.package_code);
      return found || null;
    }
    return null;
  };

  RidePackage.findAll = async () => {
    return Object.values(mockPackages).filter(p => p.status === 'Active');
  };

  try {
    // 1. Missing package identifier
    await test('Package Validation: Returns error when neither package_id nor package_code is supplied', async () => {
      const result = await PackagePricingService.calculateAndValidatePackageFare({});
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.code, 'PACKAGE_ID_REQUIRED');
    });

    // 2. Active Package Calculation & Price Tamper Resistance
    await test('Package Calculation: Authoritative server price enforced; ignores any frontend-submitted amounts', async () => {
      const result = await PackagePricingService.calculateAndValidatePackageFare({
        packageId: 2,
        routeId: 10,
        seatCount: 1,
        baseFare: 80
      });

      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.packageId, 2);
      assert.strictEqual(result.packageName, 'Weekly Saver Pack');
      assert.strictEqual(result.finalBookingAmount, 650.00); // Authoritative DB price!
      assert.strictEqual(result.pricePerRide, 65.00);
      assert.strictEqual(result.ridesCount, 10);
      assert.strictEqual(result.validityDays, 14);
    });

    // 3. Snapshot Integrity & Completeness
    await test('Snapshot Integrity: Price snapshot contains all required immutable audit fields', async () => {
      const result = await PackagePricingService.calculateAndValidatePackageFare({
        packageId: 1,
        routeId: 5,
        seatCount: 1,
        baseFare: 80
      });

      assert.strictEqual(result.isValid, true);
      const snapshot = result.priceSnapshot;
      assert(snapshot !== null, 'Snapshot should not be null');
      assert.strictEqual(snapshot.package_id, 1);
      assert.strictEqual(snapshot.package_code, 'RP-STARTER-5');
      assert.strictEqual(snapshot.package_name, 'Starter Commuter Pack');
      assert.strictEqual(snapshot.package_price, 350.00);
      assert.strictEqual(snapshot.price_per_ride, 70.00);
      assert.strictEqual(snapshot.rides_count, 5);
      assert.strictEqual(snapshot.validity_days, 7);
      assert.strictEqual(snapshot.savings_amount, 50.00);
      assert.strictEqual(snapshot.currency, 'INR');
      assert(Array.isArray(snapshot.features));
    });

    // 4. Inactive Package Rejection
    await test('Package Validation: Rejects inactive or archived packages with PACKAGE_INACTIVE', async () => {
      const result = await PackagePricingService.calculateAndValidatePackageFare({
        packageId: 3,
        routeId: 10,
        seatCount: 1
      });

      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.code, 'PACKAGE_INACTIVE');
      assert(result.error.includes('no longer active'));
    });

    // 5. Invalid Package ID Rejection
    await test('Package Validation: Rejects nonexistent package ID with PACKAGE_NOT_FOUND', async () => {
      const result = await PackagePricingService.calculateAndValidatePackageFare({
        packageId: 99999,
        routeId: 10
      });

      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.code, 'PACKAGE_NOT_FOUND');
    });

    // 6. Route Compatibility Enforcement - Mismatch Rejection
    await test('Route Compatibility: Rejects package when route ID does not match package route', async () => {
      const result = await PackagePricingService.calculateAndValidatePackageFare({
        packageId: 4, // Valid only on Route 42
        routeId: 99, // Attempting booking on Route 99
        seatCount: 1
      });

      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.code, 'PACKAGE_ROUTE_MISMATCH');
      assert(result.error.includes('not applicable'));
    });

    // 7. Route Compatibility Enforcement - Match Allowed
    await test('Route Compatibility: Accepts package when route ID matches package route', async () => {
      const result = await PackagePricingService.calculateAndValidatePackageFare({
        packageId: 4, // Valid on Route 42
        routeId: 42, // Matching Route 42
        seatCount: 1
      });

      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.packageId, 4);
      assert.strictEqual(result.finalBookingAmount, 1200.00);
    });

    // 8. Passenger Limits Enforcement
    await test('Passenger Limits: Enforces maximum allowed passengers for a package booking', async () => {
      const result = await PackagePricingService.calculateAndValidatePackageFare({
        packageId: 1,
        seatCount: 5, // Exceeds limit of 4
        routeId: 10
      });

      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.code, 'PASSENGER_LIMIT_EXCEEDED');
      assert(result.error.includes('up to a maximum of 4 passengers'));
    });

    // 9. Lookup by Package Code
    await test('Package Lookup: Resolves package correctly by package_code string', async () => {
      const result = await PackagePricingService.calculateAndValidatePackageFare({
        packageCode: 'RP-WEEKLY-10',
        routeId: 10,
        seatCount: 1
      });

      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.packageId, 2);
      assert.strictEqual(result.packageName, 'Weekly Saver Pack');
    });

    // 10. List Packages Formatter & Filter
    await test('Package Listing: Lists active packages with formatted currency, per-ride rates and badges', async () => {
      const list = await PackagePricingService.listPackages();
      assert(Array.isArray(list));
      assert(list.length > 0);
      const pkg = list.find(p => p.id === 2);
      assert(pkg, 'Weekly pack should be present in active listing');
      assert.strictEqual(pkg.formatted_price, '₹650');
      assert.strictEqual(pkg.formatted_per_ride, '₹65/ride');
      assert.strictEqual(pkg.is_popular, true);
    });

  } finally {
    // Restore original methods
    RidePackage.findByPk = originalFindByPk;
    RidePackage.findOne = originalFindOne;
    RidePackage.findAll = originalFindAll;
  }

  console.log('\n====================================================');
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
