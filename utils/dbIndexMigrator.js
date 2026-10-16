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

const ensureTripStopArrivalsTable = async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`trip_stop_arrivals\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`trip_id\` INT UNSIGNED NOT NULL,
        \`stop_id\` INT UNSIGNED NOT NULL,
        \`driver_id\` INT UNSIGNED NOT NULL,
        \`vehicle_id\` INT UNSIGNED DEFAULT NULL,
        \`stop_sequence\` INT NOT NULL DEFAULT 1,
        \`stop_name\` VARCHAR(255) DEFAULT NULL,
        \`scheduled_arrival_time\` TIME DEFAULT NULL,
        \`arrived_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`completed_at\` DATETIME DEFAULT NULL,
        \`status\` ENUM('ARRIVED', 'COMPLETED', 'SKIPPED') NOT NULL DEFAULT 'ARRIVED',
        \`arrival_latitude\` DECIMAL(10, 7) DEFAULT NULL,
        \`arrival_longitude\` DECIMAL(10, 7) DEFAULT NULL,
        \`passengers_boarded\` INT NOT NULL DEFAULT 0,
        \`passengers_pending\` INT NOT NULL DEFAULT 0,
        \`passengers_no_show\` INT NOT NULL DEFAULT 0,
        \`notes\` TEXT DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`unique_trip_stop\` (\`trip_id\`, \`stop_id\`),
        KEY \`idx_trip_stop_arrived_at\` (\`arrived_at\`),
        KEY \`idx_trip_stop_driver\` (\`driver_id\`),
        KEY \`idx_trip_stop_vehicle\` (\`vehicle_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  } catch (err) {
    console.error('ensureTripStopArrivalsTable error:', err.message);
  }
};

const ensureOwnerKycTable = async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`owner_kycs\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`owner_id\` INT UNSIGNED NOT NULL,
        \`owner_name\` VARCHAR(150) NOT NULL,
        \`owner_email\` VARCHAR(150) NOT NULL,
        \`owner_mobile\` VARCHAR(25) NOT NULL,
        \`vehicle_id\` INT UNSIGNED DEFAULT NULL,
        \`vehicle_number\` VARCHAR(35) DEFAULT NULL,
        \`aadhaar_number\` VARCHAR(20) NOT NULL,
        \`pan_number\` VARCHAR(20) NOT NULL,
        \`bank_name\` VARCHAR(150) NOT NULL,
        \`account_holder_name\` VARCHAR(150) NOT NULL,
        \`account_number\` VARCHAR(50) NOT NULL,
        \`ifsc_code\` VARCHAR(20) NOT NULL,
        \`upi_id\` VARCHAR(100) DEFAULT NULL,
        \`status\` ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
        \`admin_note\` TEXT DEFAULT NULL,
        \`verified_by\` INT UNSIGNED DEFAULT NULL,
        \`verified_at\` DATETIME DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_owner_kycs_owner_id\` (\`owner_id\`),
        KEY \`idx_owner_kycs_status\` (\`status\`),
        KEY \`idx_owner_kycs_vehicle_id\` (\`vehicle_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  } catch (err) {
    console.error('ensureOwnerKycTable error:', err.message);
  }
};

const ensureOwnerSettlementsTable = async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`owner_settlements\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`settlement_code\` VARCHAR(50) NOT NULL,
        \`owner_id\` INT UNSIGNED NOT NULL,
        \`owner_name\` VARCHAR(150) NOT NULL,
        \`owner_mobile\` VARCHAR(25) DEFAULT NULL,
        \`owner_email\` VARCHAR(150) DEFAULT NULL,
        \`vehicle_id\` INT UNSIGNED DEFAULT NULL,
        \`vehicle_number\` VARCHAR(35) NOT NULL,
        \`requested_amount\` DECIMAL(10, 2) NOT NULL,
        \`tds_percentage\` DECIMAL(5, 2) NOT NULL DEFAULT '0.00',
        \`tds_amount\` DECIMAL(10, 2) NOT NULL DEFAULT '0.00',
        \`net_payable_amount\` DECIMAL(10, 2) NOT NULL DEFAULT '0.00',
        \`account_number\` VARCHAR(50) NOT NULL,
        \`bank_name\` VARCHAR(150) NOT NULL,
        \`ifsc_code\` VARCHAR(20) NOT NULL,
        \`account_holder_name\` VARCHAR(150) DEFAULT NULL,
        \`upi_id\` VARCHAR(100) DEFAULT NULL,
        \`owner_notes\` TEXT DEFAULT NULL,
        \`status\` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
        \`utr_number\` VARCHAR(100) DEFAULT NULL,
        \`admin_note\` TEXT DEFAULT NULL,
        \`processed_by\` INT UNSIGNED DEFAULT NULL,
        \`processed_at\` DATETIME DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`unique_settlement_code\` (\`settlement_code\`),
        KEY \`idx_owner_settlements_owner_id\` (\`owner_id\`),
        KEY \`idx_owner_settlements_status\` (\`status\`),
        KEY \`idx_owner_settlements_vehicle\` (\`vehicle_id\`),
        KEY \`idx_owner_settlements_created_at\` (\`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Ensure default TDS percentage setting in system_settings
    await sequelize.query(`
      INSERT INTO \`system_settings\` (\`key\`, \`value\`, \`type\`, \`group\`, \`label\`, \`description\`, \`is_public\`, \`created_at\`, \`updated_at\`)
      VALUES (
        'owner_settlement_tds_percentage',
        '2.00',
        'number',
        'settlement',
        'Owner Settlement TDS Percentage (%)',
        'Statutory Tax Deducted at Source (TDS) percentage automatically applied to owner ticket fare settlements (Section 194C/194O)',
        1,
        NOW(),
        NOW()
      )
      ON DUPLICATE KEY UPDATE \`updated_at\` = NOW();
    `);

    // Ensure default Bus Type Trip Rates in system_settings
    await sequelize.query(`
      INSERT INTO \`system_settings\` (\`key\`, \`value\`, \`type\`, \`group\`, \`label\`, \`description\`, \`is_public\`, \`created_at\`, \`updated_at\`)
      VALUES (
        'owner_trip_rates_by_bus_type',
        '{"bus":3000,"traveller":1900}',
        'json',
        'settlement',
        'Owner Trip Rates by Bus Type',
        'Per-trip payout amount by vehicle/bus type (e.g. bus: 3000, traveller: 1900)',
        1,
        NOW(),
        NOW()
      )
      ON DUPLICATE KEY UPDATE \`updated_at\` = NOW();
    `);
    console.log('[ensureOwnerSettlementsTable] Table, TDS setting, and trip rates synchronized.');
  } catch (err) {
    console.error('ensureOwnerSettlementsTable error:', err.message);
  }
};

const ensureDefaultPermissions = async () => {
  try {
    const permissions = [
      // Dashboard
      ['dashboard.read', 'View Dashboard', 'dashboard', 'read', 'Access dashboard metrics and overview'],

      // Users
      ['users.read', 'View Users', 'users', 'read', 'View system users list and details'],
      ['users.create', 'Create Users', 'users', 'create', 'Create new system users'],
      ['users.update', 'Update Users', 'users', 'update', 'Edit existing user accounts'],
      ['users.delete', 'Delete Users', 'users', 'delete', 'Delete or deactivate user accounts'],
      ['users.manage', 'Manage Users', 'users', 'manage', 'Full access to user administration'],

      // Roles
      ['roles.read', 'View Roles', 'roles', 'read', 'View roles and permission matrices'],
      ['roles.manage', 'Manage Roles', 'roles', 'manage', 'Create and assign permissions to roles'],

      // Approval Requests (Owner Requests)
      ['owner_requests.read', 'View Approval Requests', 'owner_requests', 'read', 'View fleet addition & update requests'],
      ['owner_requests.manage', 'Manage Approval Requests', 'owner_requests', 'manage', 'Approve or reject fleet change requests'],

      // Owner KYC & Bank
      ['owner_kyc.read', 'View Owner KYC & Bank', 'owner_kyc', 'read', 'View operator Aadhaar, PAN, and Bank details'],
      ['owner_kyc.manage', 'Manage Owner KYC & Bank', 'owner_kyc', 'manage', 'Verify and review operator bank submissions'],

      // Owner Settlements
      ['settlements.read', 'View Settlements', 'settlements', 'read', 'View owner payout settlements and history'],
      ['settlements.create', 'Request Settlement', 'settlements', 'create', 'Submit new settlement payout request'],
      ['settlements.manage', 'Manage Settlements', 'settlements', 'manage', 'Approve, reject, or delete settlement requests'],

      // Drivers
      ['drivers.read', 'View Drivers', 'drivers', 'read', 'View driver profiles and fleet rosters'],
      ['drivers.create', 'Create Drivers', 'drivers', 'create', 'Add new drivers'],
      ['drivers.update', 'Update Drivers', 'drivers', 'update', 'Edit driver details'],
      ['drivers.delete', 'Delete Drivers', 'drivers', 'delete', 'Delete or block drivers'],
      ['drivers.manage', 'Manage Drivers', 'drivers', 'manage', 'Full driver management'],

      // Vehicles
      ['vehicles.read', 'View Vehicles', 'vehicles', 'read', 'View fleet buses and documents'],
      ['vehicles.manage', 'Manage Vehicles', 'vehicles', 'manage', 'Create, edit, and assign vehicles'],

      // Routes
      ['routes.read', 'View Routes', 'routes', 'read', 'View transit routes and stops'],
      ['routes.manage', 'Manage Routes', 'routes', 'manage', 'Create, edit, and configure routes'],

      // Stops
      ['stops.read', 'View Stops & Stations', 'stops', 'read', 'View bus stops and stations'],
      ['stops.manage', 'Manage Stops', 'stops', 'manage', 'Create and configure bus stops'],

      // Trips
      ['trips.read', 'View Trips', 'trips', 'read', 'View operational trips and rosters'],
      ['trips.manage', 'Manage Trips', 'trips', 'manage', 'Create, assign, and control trips'],

      // Schedules
      ['schedules.read', 'View Scheduled Trips', 'schedules', 'read', 'View future schedule timetables'],
      ['schedules.manage', 'Manage Schedules', 'schedules', 'manage', 'Generate and modify trip schedules'],

      // Locations
      ['locations.read', 'View Live Tracking', 'locations', 'read', 'View live bus GPS map and history'],
      ['locations.manage', 'Manage Tracking', 'locations', 'manage', 'Configure location tracking'],

      // Rates
      ['rates.read', 'View Rate Charts', 'rates', 'read', 'View fare pricing matrices'],
      ['rates.manage', 'Manage Rate Charts', 'rates', 'manage', 'Configure route fare charts'],

      // Passengers
      ['passengers.read', 'View Passengers', 'passengers', 'read', 'View registered customer passenger accounts'],
      ['passengers.create', 'Create Passengers', 'passengers', 'create', 'Register passengers'],
      ['passengers.update', 'Update Passengers', 'passengers', 'update', 'Edit passenger profiles'],
      ['passengers.delete', 'Deactivate Passengers', 'passengers', 'delete', 'Block or delete passengers'],
      ['passengers.manage', 'Manage Passengers', 'passengers', 'manage', 'Full passenger customer management'],

      // Bookings
      ['bookings.read', 'View Bookings', 'bookings', 'read', 'View ticket bookings and boarding lists'],
      ['bookings.manage', 'Manage Bookings', 'bookings', 'manage', 'Create, update, and manage seat reservations'],

      // Passes
      ['passes.read', 'View Shuttle Passes', 'passes', 'read', 'View passenger commuter passes'],
      ['passes.manage', 'Manage Passes', 'passes', 'manage', 'Create and issue shuttle passes'],

      // Coupons
      ['coupons.read', 'View Coupons', 'coupons', 'read', 'View promotional discount coupons'],
      ['coupons.manage', 'Manage Coupons', 'coupons', 'manage', 'Create and configure coupon codes'],

      // Payments
      ['payments.read', 'View Payments', 'payments', 'read', 'View gateway payment transactions'],
      ['payments.manage', 'Manage Payments', 'payments', 'manage', 'Manage payment reconciliations'],

      // Refunds
      ['refunds.read', 'View Refunds', 'refunds', 'read', 'View cancellation refund requests'],
      ['refunds.process', 'Process Refunds', 'refunds', 'manage', 'Approve and initiate gateway refunds'],
      ['refunds.manage', 'Manage Refunds', 'refunds', 'manage', 'Full control over refund policies and logs'],

      // Webhooks
      ['webhooks.read', 'View PayU Webhooks', 'webhooks', 'read', 'View payment gateway webhook audit events'],

      // Reports
      ['reports.read', 'View Reports & Analytics', 'reports', 'read', 'Access revenue, driver, and operator reports'],
      ['reports.manage', 'Manage Reports', 'reports', 'manage', 'Export and configure analytics reports'],

      // Audit Logs
      ['audit_logs.read', 'View Audit Logs', 'audit_logs', 'read', 'View administrative activity trail'],

      // Notifications
      ['notifications.read', 'View Notifications', 'notifications', 'read', 'View system broadcast notifications'],
      ['notifications.manage', 'Manage Notifications', 'notifications', 'manage', 'Create and dispatch notifications'],

      // Banners
      ['banners.read', 'View Banners', 'banners', 'read', 'View promo banners and videos'],
      ['banners.manage', 'Manage Banners', 'banners', 'manage', 'Upload and configure promotional banners'],

      // Settings
      ['settings.read', 'View System Settings', 'settings', 'read', 'View application configuration'],
      ['settings.manage', 'Manage System Settings', 'settings', 'manage', 'Update system-wide settings and parameters'],
    ];

    const valuesClause = permissions.map(
      ([name, display_name, module, action, description]) =>
        `(${sequelize.escape(name)}, ${sequelize.escape(display_name)}, ${sequelize.escape(module)}, ${sequelize.escape(action)}, ${sequelize.escape(description)}, NOW(), NOW())`
    ).join(',\n');

    await sequelize.query(`
      INSERT INTO \`permissions\` (\`name\`, \`display_name\`, \`module\`, \`action\`, \`description\`, \`created_at\`, \`updated_at\`)
      VALUES ${valuesClause}
      ON DUPLICATE KEY UPDATE
        \`display_name\` = VALUES(\`display_name\`),
        \`module\` = VALUES(\`module\`),
        \`action\` = VALUES(\`action\`),
        \`description\` = VALUES(\`description\`),
        \`updated_at\` = NOW();
    `);

    // Assign ALL permissions to Admin (id = 1 or name = 'admin')
    await sequelize.query(`
      INSERT IGNORE INTO \`role_permissions\` (\`role_id\`, \`permission_id\`, \`created_at\`, \`updated_at\`)
      SELECT r.id, p.id, NOW(), NOW()
      FROM \`roles\` r
      CROSS JOIN \`permissions\` p
      WHERE r.id = 1 OR LOWER(r.name) = 'admin';
    `);

    // Assign essential operator & owner permissions to Owner role (name = 'owner' or name = 'Owner')
    const ownerPermNames = [
      'dashboard.read',
      'drivers.read', 'drivers.create', 'drivers.update', 'drivers.delete', 'drivers.manage',
      'vehicles.read', 'vehicles.manage',
      'routes.read',
      'stops.read',
      'trips.read', 'trips.manage',
      'schedules.read', 'schedules.manage',
      'locations.read', 'locations.manage',
      'rates.read',
      'passengers.read',
      'bookings.read', 'bookings.manage',
      'reports.read',
      'notifications.read',
      'banners.read',
      'owner_requests.read', 'owner_requests.manage',
      'owner_kyc.read', 'owner_kyc.manage',
      'settlements.read', 'settlements.create'
    ];

    const escapedOwnerPerms = ownerPermNames.map((p) => sequelize.escape(p)).join(',');

    await sequelize.query(`
      INSERT IGNORE INTO \`role_permissions\` (\`role_id\`, \`permission_id\`, \`created_at\`, \`updated_at\`)
      SELECT r.id, p.id, NOW(), NOW()
      FROM \`roles\` r
      JOIN \`permissions\` p ON p.name IN (${escapedOwnerPerms})
      WHERE LOWER(r.name) = 'owner';
    `);

    console.log('[ensureDefaultPermissions] System permissions catalog and role mappings synchronized.');
  } catch (err) {
    console.error('ensureDefaultPermissions error:', err.message);
  }
};

module.exports = {
  ensureTripsIndex,
  ensureTripLocationsTable,
  ensureTripStopArrivalsTable,
  ensureOwnerKycTable,
  ensureOwnerSettlementsTable,
  ensureDefaultPermissions,
};
