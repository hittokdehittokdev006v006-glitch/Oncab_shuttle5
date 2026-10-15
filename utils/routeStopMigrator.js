'use strict';

const sequelize = require('../config/database');
const RouteStop = require('../models/RouteStop');

let syncPromise;

async function syncRouteStopsTable() {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    // Model.sync() without alter:true does not update an existing table schema.
    await RouteStop.sync();

    const [columns] = await sequelize.query(
      "SHOW COLUMNS FROM `route_stops` LIKE 'travel_time_minutes'"
    );
    if (!columns.length) {
      await sequelize.query(`
        ALTER TABLE \`route_stops\`
        ADD COLUMN \`travel_time_minutes\` INT UNSIGNED NOT NULL DEFAULT 0
        COMMENT 'Minutes from the previous route stop; zero for the first stop'
      `);
    }

    await sequelize.query(`
      INSERT IGNORE INTO route_stops (route_id, stop_id, stop_sequence, pickup_allowed, dropoff_allowed, status, created_at, updated_at)
      SELECT route_id, id, IFNULL(stop_sequence, 1), 1, 1, 'Active', NOW(), NOW()
      FROM stops
      WHERE route_id IS NOT NULL AND route_id > 0;
    `);
  })().catch((err) => {
    syncPromise = null;
    console.error('[RouteStopMigrator] Failed to sync route_stops:', err.message);
    throw err;
  });

  return syncPromise;
}

module.exports = { syncRouteStopsTable };
