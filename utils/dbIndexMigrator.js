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

const ensureRidePackagesTable = async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`ride_packages\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`package_code\` VARCHAR(50) NOT NULL,
        \`name\` VARCHAR(100) NOT NULL,
        \`package_type\` ENUM('single_trip', 'fixed_bundle', 'daily', 'weekly', 'monthly', 'quarterly', 'annual') NOT NULL DEFAULT 'fixed_bundle',
        \`rides_count\` INT UNSIGNED NOT NULL DEFAULT 10,
        \`validity_days\` INT UNSIGNED NOT NULL DEFAULT 30,
        \`price_per_ride\` DECIMAL(10, 2) NOT NULL,
        \`total_price\` DECIMAL(10, 2) NOT NULL,
        \`original_price\` DECIMAL(10, 2) DEFAULT NULL,
        \`discount_percentage\` DECIMAL(5, 2) DEFAULT 0.00,
        \`route_id\` BIGINT UNSIGNED DEFAULT NULL,
        \`description\` TEXT DEFAULT NULL,
        \`features\` JSON DEFAULT NULL,
        \`badge_text\` VARCHAR(50) DEFAULT NULL,
        \`is_popular\` TINYINT(1) DEFAULT 0,
        \`status\` ENUM('Active', 'Inactive') DEFAULT 'Active',
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`deleted_at\` DATETIME DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_ride_packages_code\` (\`package_code\`),
        KEY \`idx_ride_packages_status\` (\`status\`),
        KEY \`idx_ride_packages_route_id\` (\`route_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Check count and seed if empty
    const [rows] = await sequelize.query('SELECT COUNT(*) as cnt FROM `ride_packages`');
    const count = rows && rows[0] ? Number(rows[0].cnt || rows[0].count || 0) : 0;
    if (count === 0) {
      await sequelize.query(`
        INSERT INTO \`ride_packages\` (\`package_code\`, \`name\`, \`package_type\`, \`rides_count\`, \`validity_days\`, \`price_per_ride\`, \`total_price\`, \`original_price\`, \`discount_percentage\`, \`description\`, \`features\`, \`badge_text\`, \`is_popular\`, \`status\`, \`created_at\`, \`updated_at\`)
        VALUES
        ('RP-STARTER-5', 'Starter Ride Pack', 'fixed_bundle', 5, 14, 109.00, 545.00, 745.00, 26.85, 'Great for hybrid commuters testing shuttle convenience with low upfront cost.', '["5 Guaranteed AC Seats", "14 Days Validity", "Free Reschedule up to 15m prior", "Zero Cancellation Fee"]', 'TRIAL PACK', 0, 'Active', NOW(), NOW()),
        ('RP-WEEKLY-10', 'Weekly Commuter Pack', 'weekly', 10, 30, 99.00, 990.00, 1490.00, 33.56, 'Ideal for 5 days of round-trip office travel per week with guaranteed savings.', '["10 Guaranteed AC Seats", "30 Days Validity", "Save ₹50 per ride", "Priority Boarding Pass with QR", "Flexible Timings"]', 'MOST POPULAR', 1, 'Active', NOW(), NOW()),
        ('RP-MONTHLY-30', 'Monthly Freedom Pack', 'monthly', 30, 45, 85.00, 2550.00, 4470.00, 42.95, 'Our best value commuter plan! Save over 40% on daily office shuttle commute.', '["30 Guaranteed AC Seats", "45 Days Extended Validity", "Lowest Per-Ride Fare (₹85)", "Instant Boarding Pass", "Zero Rescheduling Fees"]', 'BEST VALUE', 1, 'Active', NOW(), NOW()),
        ('RP-FLEXI-15', 'Flexi Commuter Pack', 'fixed_bundle', 15, 60, 95.00, 1425.00, 2235.00, 36.24, '60-day extended validity designed for flexible hybrid 2-3 days weekly commuters.', '["15 Guaranteed AC Seats", "60 Days Extended Validity", "Travel Any Day", "Transferable & Reschedulable"]', 'FLEXIBLE', 0, 'Active', NOW(), NOW()),
        ('RP-CORP-44', 'Corporate Executive Pass', 'monthly', 44, 60, 79.00, 3476.00, 6556.00, 46.98, 'Dedicated monthly round-trip package with deepest discount for daily office commuters.', '["44 Guaranteed AC Seats", "Deepest Discount (47% OFF)", "Valid for 60 Days", "Dedicated Priority Support", "Unlimited Free Reschedules"]', 'MAX SAVINGS', 0, 'Active', NOW(), NOW());
      `);
      console.log('[ensureRidePackagesTable] Default Ride Pack packages seeded successfully.');
    }
  } catch (err) {
    console.error('ensureRidePackagesTable error:', err.message);
  }
};

const ensureBookingPackageColumns = async () => {
  try {
    const [bookingCols] = await sequelize.query('SHOW COLUMNS FROM `bookings`');
    const existingBookingCols = new Set(bookingCols.map((c) => c.Field.toLowerCase()));

    const bookingColumnsToAdd = [
      { name: 'package_id', type: 'BIGINT UNSIGNED DEFAULT NULL' },
      { name: 'package_name', type: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'package_price_snapshot', type: 'DECIMAL(10, 2) DEFAULT NULL' },
      { name: 'package_rides_count', type: 'INT UNSIGNED DEFAULT NULL' },
      { name: 'package_price_per_ride', type: 'DECIMAL(10, 2) DEFAULT NULL' },
      { name: 'is_package_booking', type: 'TINYINT(1) DEFAULT 0' },
      { name: 'pickup_stop_name', type: 'VARCHAR(150) DEFAULT NULL' },
      { name: 'drop_stop_name', type: 'VARCHAR(150) DEFAULT NULL' },
      { name: 'departure_time', type: 'TIME DEFAULT NULL' },
      { name: 'arrival_time', type: 'TIME DEFAULT NULL' },
      { name: 'payu_mihpayid', type: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'package_purchase_id', type: 'BIGINT UNSIGNED DEFAULT NULL' },
      { name: 'idempotency_key', type: 'VARCHAR(100) DEFAULT NULL' },
    ];

    for (const col of bookingColumnsToAdd) {
      if (!existingBookingCols.has(col.name.toLowerCase())) {
        await sequelize.query(`ALTER TABLE \`bookings\` ADD COLUMN \`${col.name}\` ${col.type}`);
        console.log(`[ensureBookingPackageColumns] Added ${col.name} to bookings`);
      }
      const [bookingIndexes] = await sequelize.query("SHOW INDEX FROM `bookings` WHERE `Key_name` = 'idx_booking_passenger_idempotency'");
      if (!bookingIndexes.length) {
        await sequelize.query('CREATE UNIQUE INDEX `idx_booking_passenger_idempotency` ON `bookings` (`passenger_id`, `idempotency_key`)');
      }
    }

    const [tables] = await sequelize.query("SHOW TABLES LIKE 'shuttle_bookings'");
    if (tables && tables.length > 0) {
      const [shuttleCols] = await sequelize.query('SHOW COLUMNS FROM `shuttle_bookings`');
      const existingShuttleCols = new Set(shuttleCols.map((c) => c.Field.toLowerCase()));

      const shuttleColumnsToAdd = [
        { name: 'pickup_stop_name', type: 'VARCHAR(150) DEFAULT NULL' },
        { name: 'drop_stop_name', type: 'VARCHAR(150) DEFAULT NULL' },
        { name: 'package_id', type: 'BIGINT UNSIGNED DEFAULT NULL' },
        { name: 'package_name', type: 'VARCHAR(100) DEFAULT NULL' },
        { name: 'package_price_snapshot', type: 'DECIMAL(10, 2) DEFAULT NULL' },
        { name: 'package_rides_count', type: 'INT UNSIGNED DEFAULT NULL' },
        { name: 'package_price_per_ride', type: 'DECIMAL(10, 2) DEFAULT NULL' },
        { name: 'is_package_booking', type: 'TINYINT(1) DEFAULT 0' },
      ];

      for (const col of shuttleColumnsToAdd) {
        if (!existingShuttleCols.has(col.name.toLowerCase())) {
          await sequelize.query(`ALTER TABLE \`shuttle_bookings\` ADD COLUMN \`${col.name}\` ${col.type}`);
          console.log(`[ensureBookingPackageColumns] Added ${col.name} to shuttle_bookings`);
        }
      }
    }
  } catch (err) {
    console.error('ensureBookingPackageColumns error:', err.message);
  }
};

const ensurePassengerPackageTables = async () => {
  const [bookingCols] = await sequelize.query('SHOW COLUMNS FROM \`bookings\`');
  const existingBookingCols = new Set(bookingCols.map((column) => column.Field.toLowerCase()));
  for (const column of [
    { name: 'package_purchase_id', type: 'BIGINT UNSIGNED DEFAULT NULL' },
    { name: 'idempotency_key', type: 'VARCHAR(100) DEFAULT NULL' },
  ]) {
    if (!existingBookingCols.has(column.name)) {
      await sequelize.query(`ALTER TABLE \`bookings\` ADD COLUMN \`${column.name}\` ${column.type}`);
    }
  }
  const [bookingIndexes] = await sequelize.query("SHOW INDEX FROM `bookings` WHERE `Key_name` = 'idx_booking_passenger_idempotency'");
  if (!bookingIndexes.length) {
    await sequelize.query('CREATE UNIQUE INDEX `idx_booking_passenger_idempotency` ON `bookings` (`passenger_id`, `idempotency_key`)');
  }

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`passenger_package_purchases\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`passenger_id\` BIGINT UNSIGNED NOT NULL,
      \`package_id\` BIGINT UNSIGNED NOT NULL,
      \`route_id\` BIGINT UNSIGNED DEFAULT NULL,
      \`package_code\` VARCHAR(50) NOT NULL,
      \`package_name\` VARCHAR(100) NOT NULL,
      \`total_rides\` INT UNSIGNED NOT NULL,
      \`used_rides\` INT UNSIGNED NOT NULL DEFAULT 0,
      \`reserved_rides\` INT UNSIGNED NOT NULL DEFAULT 0,
      \`validity_days\` INT UNSIGNED NOT NULL,
      \`price_per_ride\` DECIMAL(10,2) NOT NULL,
      \`amount_paid\` DECIMAL(10,2) NOT NULL,
      \`payment_status\` ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
      \`status\` ENUM('pending_payment','active','exhausted','expired','cancelled','refunded') NOT NULL DEFAULT 'pending_payment',
      \`purchased_at\` DATETIME DEFAULT NULL,
      \`expires_at\` DATETIME DEFAULT NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`idx_package_purchases_passenger_status\` (\`passenger_id\`, \`status\`),
      KEY \`idx_package_purchases_expires_at\` (\`expires_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  const [purchaseCols] = await sequelize.query('SHOW COLUMNS FROM \`passenger_package_purchases\`');
  if (!purchaseCols.some((column) => column.Field.toLowerCase() === 'route_id')) {
    await sequelize.query('ALTER TABLE \`passenger_package_purchases\` ADD COLUMN \`route_id\` BIGINT UNSIGNED DEFAULT NULL AFTER \`package_id\`');
  }
  if (!purchaseCols.some((column) => column.Field.toLowerCase() === 'price_per_ride')) {
    await sequelize.query('ALTER TABLE \`passenger_package_purchases\` ADD COLUMN \`price_per_ride\` DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER \`validity_days\`');
  }
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`package_ride_usage\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`purchase_id\` BIGINT UNSIGNED NOT NULL,
      \`booking_id\` INT UNSIGNED NOT NULL,
      \`rides_count\` INT UNSIGNED NOT NULL,
      \`status\` ENUM('reserved','consumed','released') NOT NULL DEFAULT 'reserved',
      \`reserved_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`consumed_at\` DATETIME DEFAULT NULL,
      \`released_at\` DATETIME DEFAULT NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`idx_package_ride_usage_booking\` (\`booking_id\`),
      KEY \`idx_package_ride_usage_purchase_status\` (\`purchase_id\`, \`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  const [paymentCols] = await sequelize.query('SHOW COLUMNS FROM \`payments\`');
  if (!paymentCols.some((column) => column.Field.toLowerCase() === 'package_purchase_id')) {
    await sequelize.query('ALTER TABLE \`payments\` ADD COLUMN \`package_purchase_id\` BIGINT UNSIGNED DEFAULT NULL');
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

      // Ride Packages
      ['packages.read', 'View Ride Packages', 'packages', 'read', 'View fixed-price Ride Pack commuter packages'],
      ['packages.create', 'Create Ride Packages', 'packages', 'create', 'Create new Ride Pack package'],
      ['packages.update', 'Update Ride Packages', 'packages', 'update', 'Edit Ride Pack pricing and rules'],
      ['packages.delete', 'Delete Ride Packages', 'packages', 'delete', 'Archive Ride Pack package'],
      ['packages.manage', 'Manage Ride Packages', 'packages', 'manage', 'Full control over fixed-price packages'],

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

      // Cross Connection
      ['cross_connection.view', 'View Cross Connection', 'cross_connection', 'read', 'View the Cross Connection page and records'],
      ['cross_connection.view_details', 'View Cross Connection Details', 'cross_connection', 'read', 'View detailed trip and vehicle information for cross connections'],
      ['cross_connection.configure', 'Configure Cross Connection Thresholds', 'cross_connection', 'manage', 'Change distance, time thresholds and matching frequency'],
      ['cross_connection.export', 'Export Cross Connection Data', 'cross_connection', 'manage', 'Export cross-connection data records'],
      ['cross_connection.manage', 'Manage Cross Connection', 'cross_connection', 'manage', 'Manage matching settings, recalculate, and update records'],
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
      'packages.read',
      'reports.read',
      'notifications.read',
      'banners.read',
      'owner_requests.read', 'owner_requests.manage',
      'owner_kyc.read', 'owner_kyc.manage',
      'settlements.read', 'settlements.create',
      'cross_connection.view', 'cross_connection.view_details'
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



const ensureAdminSessionsTable = async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`admin_sessions\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` INT UNSIGNED NOT NULL,
        \`session_token\` VARCHAR(255) NOT NULL,
        \`refresh_token\` TEXT DEFAULT NULL,
        \`device_type\` VARCHAR(50) DEFAULT 'desktop',
        \`device_name\` VARCHAR(150) DEFAULT 'Unknown Device',
        \`browser\` VARCHAR(100) DEFAULT 'Unknown Browser',
        \`os\` VARCHAR(100) DEFAULT 'Unknown OS',
        \`screen_resolution\` VARCHAR(60) DEFAULT NULL,
        \`color_depth\` VARCHAR(30) DEFAULT NULL,
        \`pixel_ratio\` VARCHAR(20) DEFAULT NULL,
        \`ip_address\` VARCHAR(64) DEFAULT NULL,
        \`user_agent\` TEXT DEFAULT NULL,
        \`is_active\` TINYINT(1) DEFAULT 1,
        \`last_activity_at\` DATETIME NOT NULL,
        \`created_at\` DATETIME NOT NULL,
        \`updated_at\` DATETIME NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uniq_session_token\` (\`session_token\`),
        KEY \`idx_user_active\` (\`user_id\`, \`is_active\`),
        KEY \`idx_last_activity\` (\`last_activity_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('✅ admin_sessions table initialized');
  } catch (err) {
    console.error('ensureAdminSessionsTable error:', err.message);
  }
};

const ensureCrossConnectionsTable = async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`cross_connections\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`connection_code\` VARCHAR(50) NOT NULL,
        \`trip1_id\` INT UNSIGNED NOT NULL,
        \`trip2_id\` INT UNSIGNED NOT NULL,
        \`vehicle1_id\` INT UNSIGNED DEFAULT NULL,
        \`vehicle2_id\` INT UNSIGNED DEFAULT NULL,
        \`driver1_id\` INT UNSIGNED DEFAULT NULL,
        \`driver2_id\` INT UNSIGNED DEFAULT NULL,
        \`route_type1\` VARCHAR(50) DEFAULT 'Regular',
        \`route_type2\` VARCHAR(50) DEFAULT 'Regular',
        \`current_distance_meters\` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        \`min_distance_meters\` DECIMAL(10, 2) DEFAULT NULL,
        \`overlap_duration_seconds\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`overlap_started_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`last_overlap_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`shared_segment_name\` VARCHAR(255) DEFAULT NULL,
        \`shared_segment_details\` JSON DEFAULT NULL,
        \`status\` ENUM('Active', 'Completed', 'No Longer Matching')
          NOT NULL DEFAULT 'Active',
        \`notes\` TEXT DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uniq_connection_code\` (\`connection_code\`),
        KEY \`idx_cross_trip1\` (\`trip1_id\`),
        KEY \`idx_cross_trip2\` (\`trip2_id\`),
        KEY \`idx_cross_status\` (\`status\`),
        KEY \`idx_cross_last_overlap\` (\`last_overlap_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('✅ cross_connections table initialized');
  } catch (err) {
    console.error('ensureCrossConnectionsTable error:', err.message);
  }
};

module.exports = {
  ensureTripsIndex,
  ensureTripLocationsTable,
  ensureTripStopArrivalsTable,
  ensureOwnerKycTable,
  ensureOwnerSettlementsTable,
  ensureRidePackagesTable,
  ensureBookingPackageColumns,
  ensurePassengerPackageTables,
  ensureDefaultPermissions,
  ensureAdminSessionsTable,
  ensureCrossConnectionsTable,
};

