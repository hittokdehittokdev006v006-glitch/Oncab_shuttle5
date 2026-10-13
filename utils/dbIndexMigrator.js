'use strict';

const sequelize = require('../config/database');

const ensureTripsIndex = async () => {
  try {
    const [indexes] = await sequelize.query('SHOW INDEX FROM trips');
    const singleScheduleCodeIndexes = new Set();
    const mapKeyToCols = {};

    for (const idx of indexes) {
      if (!mapKeyToCols[idx.Key_name]) {
        mapKeyToCols[idx.Key_name] = [];
      }
      mapKeyToCols[idx.Key_name].push({ col: idx.Column_name, non_unique: idx.Non_unique });
    }

    for (const [keyName, cols] of Object.entries(mapKeyToCols)) {
      if (keyName === 'PRIMARY') continue;
      const isUnique = cols[0].non_unique === 0;
      if (isUnique && cols.length === 1 && cols[0].col === 'schedule_code') {
        singleScheduleCodeIndexes.add(keyName);
      }
    }

    for (const indexName of singleScheduleCodeIndexes) {
      console.log(`Dropping single-column unique index on schedule_code: ${indexName}`);
      await sequelize.query(`ALTER TABLE trips DROP INDEX \`${indexName}\``);
    }

    let hasCompositeUnique = false;
    for (const [keyName, cols] of Object.entries(mapKeyToCols)) {
      const isUnique = cols[0].non_unique === 0;
      if (isUnique && cols.length === 2) {
        const colNames = cols.map((c) => c.col);
        if (colNames.includes('schedule_code') && colNames.includes('trip_date')) {
          hasCompositeUnique = true;
        }
      }
    }

    if (!hasCompositeUnique) {
      console.log('Adding composite unique index on trips (schedule_code, trip_date)');
      await sequelize.query('ALTER TABLE trips ADD UNIQUE INDEX `unique_schedule_code_trip_date` (`schedule_code`, `trip_date`)');
    }
  } catch (err) {
    console.error('ensureTripsIndex error:', err.message);
  }
};

const ensureTripLocationsTable = async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`trip_locations\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`trip_id\` INT UNSIGNED NOT NULL,
        \`driver_id\` INT UNSIGNED NOT NULL,
        \`vehicle_id\` INT UNSIGNED DEFAULT NULL,
        \`latitude\` DECIMAL(10, 7) NOT NULL,
        \`longitude\` DECIMAL(10, 7) NOT NULL,
        \`speed_kmh\` DECIMAL(7, 2) DEFAULT NULL,
        \`heading\` DECIMAL(6, 2) DEFAULT NULL,
        \`accuracy\` DECIMAL(6, 2) DEFAULT NULL,
        \`battery_level\` DECIMAL(5, 2) DEFAULT NULL,
        \`recorded_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_trip_locations_trip_recorded\` (\`trip_id\`, \`recorded_at\`),
        KEY \`idx_trip_locations_recorded_at\` (\`recorded_at\`),
        KEY \`idx_trip_locations_driver_id\` (\`driver_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  } catch (err) {
    console.error('ensureTripLocationsTable error:', err.message);
  }
};

module.exports = { ensureTripsIndex, ensureTripLocationsTable };
