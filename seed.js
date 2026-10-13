'use strict';

require('dotenv').config();
const { sequelize, Role, Permission, AdminUser, BusType, SystemSetting } = require('./models');

const seedDatabase = async () => {
  try {
    await sequelize.authenticate();
    console.log('Connected to MySQL database.');

    // 1. Permissions list
    const permissionsData = [
      { name: 'dashboard.read', display_name: 'View Dashboard', module: 'dashboard', action: 'read' },
      { name: 'users.read', display_name: 'View Users', module: 'users', action: 'read' },
      { name: 'users.create', display_name: 'Create Users', module: 'users', action: 'create' },
      { name: 'users.update', display_name: 'Update Users', module: 'users', action: 'update' },
      { name: 'users.delete', display_name: 'Delete Users', module: 'users', action: 'delete' },

      { name: 'roles.read', display_name: 'View Roles', module: 'roles', action: 'read' },
      { name: 'roles.manage', display_name: 'Manage Roles', module: 'roles', action: 'manage' },

      { name: 'drivers.read', display_name: 'View Drivers', module: 'drivers', action: 'read' },
      { name: 'drivers.create', display_name: 'Create Drivers', module: 'drivers', action: 'create' },
      { name: 'drivers.update', display_name: 'Update Drivers', module: 'drivers', action: 'update' },
      { name: 'drivers.delete', display_name: 'Delete Drivers', module: 'drivers', action: 'delete' },

      { name: 'passengers.read', display_name: 'View Passengers', module: 'passengers', action: 'read' },
      { name: 'passengers.create', display_name: 'Create Passengers', module: 'passengers', action: 'create' },
      { name: 'passengers.update', display_name: 'Update Passengers', module: 'passengers', action: 'update' },
      { name: 'passengers.delete', display_name: 'Deactivate Passengers', module: 'passengers', action: 'delete' },

      { name: 'vehicles.read', display_name: 'View Vehicles', module: 'vehicles', action: 'read' },
      { name: 'vehicles.manage', display_name: 'Manage Vehicles', module: 'vehicles', action: 'manage' },

      { name: 'routes.read', display_name: 'View Routes', module: 'routes', action: 'read' },
      { name: 'routes.manage', display_name: 'Manage Routes', module: 'routes', action: 'manage' },

      { name: 'trips.read', display_name: 'View Trips', module: 'trips', action: 'read' },
      { name: 'trips.manage', display_name: 'Manage Trips', module: 'trips', action: 'manage' },
      { name: 'locations.read', display_name: 'View Live Locations', module: 'locations', action: 'read' },
      { name: 'rates.read', display_name: 'View Rate Charts', module: 'rates', action: 'read' },
      { name: 'rates.manage', display_name: 'Manage Rate Charts', module: 'rates', action: 'manage' },

      { name: 'schedules.read', display_name: 'View Scheduled Trips', module: 'schedules', action: 'read' },
      { name: 'schedules.manage', display_name: 'Manage Scheduled Trips', module: 'schedules', action: 'manage' },

      { name: 'bookings.read', display_name: 'View Bookings', module: 'bookings', action: 'read' },
      { name: 'bookings.manage', display_name: 'Manage Bookings', module: 'bookings', action: 'manage' },

      { name: 'passes.read', display_name: 'View Passes', module: 'passes', action: 'read' },
      { name: 'passes.manage', display_name: 'Manage Passes', module: 'passes', action: 'manage' },
      { name: 'coupons.read', display_name: 'View Coupons', module: 'coupons', action: 'read' },
      { name: 'coupons.manage', display_name: 'Manage Coupons', module: 'coupons', action: 'manage' },

      { name: 'payments.read', display_name: 'View Payments', module: 'payments', action: 'read' },
      { name: 'payments.manage', display_name: 'Manage Payments', module: 'payments', action: 'manage' },

      { name: 'refunds.read', display_name: 'View Refunds', module: 'refunds', action: 'read' },
      { name: 'refunds.process', display_name: 'Process Refunds', module: 'refunds', action: 'manage' },

      { name: 'reports.read', display_name: 'View Reports', module: 'reports', action: 'read' },
      { name: 'audit_logs.read', display_name: 'View Audit Logs', module: 'audit_logs', action: 'read' },
      { name: 'notifications.read', display_name: 'View Notifications', module: 'notifications', action: 'read' },
      { name: 'notifications.manage', display_name: 'Manage Notifications', module: 'notifications', action: 'manage' },
      { name: 'banners.read', display_name: 'View Banners', module: 'banners', action: 'read' },
      { name: 'banners.manage', display_name: 'Manage Banners', module: 'banners', action: 'manage' },
      { name: 'settings.manage', display_name: 'Manage Settings', module: 'settings', action: 'manage' },
    ];

    console.log('Seeding permissions...');
    const permissions = [];
    for (const p of permissionsData) {
      const [perm] = await Permission.findOrCreate({
        where: { name: p.name },
        defaults: p,
      });
      permissions.push(perm);
    }

    // 2. Roles
    console.log('Seeding roles...');
    const [adminRole] = await Role.findOrCreate({
      where: { name: 'admin' },
      defaults: {
        name: 'admin',
        display_name: 'Super Administrator',
        description: 'Complete system access to all resources and settings',
        is_active: true,
      },
    });

    const [operatorRole] = await Role.findOrCreate({
      where: { name: 'operator' },
      defaults: {
        name: 'operator',
        display_name: 'Fleet Operator',
        description: 'Daily operational management for trips, fleet, and bookings',
        is_active: true,
      },
    });

    const [accountantRole] = await Role.findOrCreate({
      where: { name: 'accountant' },
      defaults: {
        name: 'accountant',
        display_name: 'Accountant',
        description: 'Finance, booking, passenger and reporting access',
        is_active: true,
      },
    });

    const [ownerRole] = await Role.findOrCreate({
      where: { name: 'owner' },
      defaults: {
        name: 'owner',
        display_name: 'Owner',
        description: 'Fleet owner access to own vehicles, drivers, and fleet dashboard',
        is_active: true,
      },
    });

    // Assign all permissions to admin
    await adminRole.setPermissions(permissions);

    // Assign operational permissions to operator
    const operatorPerms = permissions.filter(p => 
      !['roles.manage', 'settings.manage', 'users.delete'].includes(p.name)
    );
    await operatorRole.setPermissions(operatorPerms);

    const accountantPermissionNames = new Set([
      'dashboard.read',
      'passengers.read',
      'bookings.read',
      'passes.read',
      'coupons.read',
      'payments.read',
      'refunds.read',
      'refunds.process',
      'reports.read',
      'audit_logs.read',
    ]);
    await accountantRole.setPermissions(permissions.filter((permission) => accountantPermissionNames.has(permission.name)));

    const ownerPermissionNames = new Set([
      'dashboard.read',
      'drivers.read',
      'drivers.create',
      'drivers.update',
      'vehicles.read',
      'vehicles.manage',
      'locations.read',
      'trips.read',
      'trips.manage',
      'schedules.read',
      'bookings.read',
      'reports.read',
    ]);
    await ownerRole.setPermissions(permissions.filter((permission) => ownerPermissionNames.has(permission.name)));

    // 3. Create Default Super Admin User
    console.log('Seeding admin user...');
    let adminUser = await AdminUser.findOne({ where: { email: 'admin@oncabshuttle.com' } });
    if (!adminUser) {
      adminUser = await AdminUser.create({
        name: 'System Administrator',
        email: 'admin@oncabshuttle.com',
        password: 'Admin@1234',
        phone: '+91 98765 00001',
        role_id: adminRole.id,
        is_active: true,
      });
      console.log('✅ Admin user created: admin@oncabshuttle.com / Admin@1234');
    } else {
      adminUser.password = 'Admin@1234';
      adminUser.role_id = adminRole.id;
      adminUser.is_active = true;
      await adminUser.save();
      console.log('✅ Admin user updated: admin@oncabshuttle.com / Admin@1234');
    }

    // Create an operator user
    let operatorUser = await AdminUser.findOne({ where: { email: 'operator@oncabshuttle.com' } });
    if (!operatorUser) {
      operatorUser = await AdminUser.create({
        name: 'Fleet Dispatcher',
        email: 'operator@oncabshuttle.com',
        password: 'Operator@1234',
        phone: '+91 98765 00002',
        role_id: operatorRole.id,
        is_active: true,
      });
      console.log('✅ Operator user created: operator@oncabshuttle.com / Operator@1234');
    }

    let ownerUser = await AdminUser.findOne({ where: { email: 'owner@oncabshuttle.com' } });
    if (!ownerUser) {
      ownerUser = await AdminUser.create({
        name: 'Fleet Owner',
        email: 'owner@oncabshuttle.com',
        password: 'Owner@1234',
        phone: '+91 98765 00003',
        role_id: ownerRole.id,
        is_active: true,
      });
      console.log('✅ Owner user created: owner@oncabshuttle.com / Owner@1234');
    }

    // 4. Default Bus Types
    console.log('Seeding bus types...');
    const busTypes = [
      { name: 'Mini Shuttle 14-Seater', code: 'MINI-14', total_seats: 14, seat_rows: 7, seat_columns: 2, has_ac: true, description: 'Comfortable air-conditioned commuter van' },
      { name: 'Standard Coach 24-Seater', code: 'STD-24', total_seats: 24, seat_rows: 6, seat_columns: 4, has_ac: true, description: 'Medium capacity executive shuttle' },
      { name: 'Deluxe Bus 40-Seater', code: 'DLX-40', total_seats: 40, seat_rows: 10, seat_columns: 4, has_ac: true, description: 'Full size intercity deluxe coach' },
    ];
    for (const bt of busTypes) {
      await BusType.findOrCreate({ where: { code: bt.code }, defaults: bt });
    }

    // 5. Default System Settings
    console.log('Seeding system settings...');
    const defaultSettings = [
      { key: 'site_name', value: 'OncabShuttle Express', group: 'general' },
      { key: 'support_email', value: 'support@oncabshuttle.com', group: 'general' },
      { key: 'support_phone', value: '+91 98765 43210', group: 'general' },
      { key: 'currency', value: 'INR', group: 'general' },
      { key: 'currency_symbol', value: '₹', group: 'general' },
      { key: 'cancellation_fee_percentage', value: '10', group: 'booking' },
      { key: 'allow_cancellation_hours', value: '2', group: 'booking' },
      { key: 'max_advance_booking_days', value: '30', group: 'booking' },
      { key: 'payment_gateway', value: 'payu', group: 'payment' },
      { key: 'sms_gateway_enabled', value: 'true', group: 'notifications' },
      { key: 'email_alerts_enabled', value: 'true', group: 'notifications' },
    ];
    for (const s of defaultSettings) {
      await SystemSetting.findOrCreate({ where: { key: s.key }, defaults: s });
    }

    console.log('🎉 Seed complete! Default login credentials:');
    console.log('👉 Admin:    admin@oncabshuttle.com    / Admin@1234');
    console.log('👉 Operator: operator@oncabshuttle.com / Operator@1234');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeder error:', err);
    process.exit(1);
  }
};

seedDatabase();
