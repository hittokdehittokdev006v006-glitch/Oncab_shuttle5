'use strict';

const assert = require('assert');
const sequelize = require('../config/database');
const shuttleController = require('../controllers/shuttleController');

const packageRow = {
  id: 1,
  package_code: 'RP-STARTER-5',
  name: 'Starter Ride Pack',
  package_type: 'fixed_bundle',
  rides_count: 5,
  validity_days: 14,
  price_per_ride: '109.00',
  total_price: '545.00',
  original_price: '745.00',
  discount_percentage: '26.85',
  route_id: null,
  description: 'Starter package',
  features: '["Guaranteed AC Seats"]',
  badge_text: 'TRIAL PACK',
  is_popular: 0,
  status: 'Active',
  deleted_at: null,
};

const callGetPackages = async ({ query = {}, user } = {}) => {
  const req = { query, body: {}, user };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await shuttleController.getPackages(req, res, (error) => {
    throw error;
  });
  return res;
};

async function run() {
  const originalQuery = sequelize.query;
  const calls = [];
  sequelize.query = async (sql, options) => {
    calls.push({ sql, options });
    return [[packageRow]];
  };

  try {
    const adminResponse = await callGetPackages({ user: { id: 1 } });
    assert.strictEqual(adminResponse.statusCode, 200);
    assert.match(calls[0].sql, /SELECT\s+\*\s+FROM `ride_packages`/i);
    assert.doesNotMatch(calls[0].sql, /`status`\s*=/i);
    assert.deepStrictEqual(adminResponse.body.data[0].features, ['Guaranteed AC Seats']);
    assert.strictEqual(adminResponse.body.data[0].total_price, 545);

    await callGetPackages({ query: { route_id: '12' } });
    assert.match(calls[1].sql, /`status` = :status/);
    assert.match(calls[1].sql, /`route_id` = :routeId/);
    assert.deepStrictEqual(calls[1].options.replacements, { status: 'Active', routeId: 12 });

    console.log('Ride package listing controller tests passed');
  } finally {
    sequelize.query = originalQuery;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
