-- Complete System Permissions Catalog & Default Role Matrix
-- Ensures all pages and module actions have registered permissions

INSERT INTO `permissions` (`name`, `display_name`, `module`, `action`, `description`, `created_at`, `updated_at`) VALUES
  ('dashboard.read', 'View Dashboard', 'dashboard', 'read', 'Access dashboard metrics and overview', NOW(), NOW()),
  ('users.read', 'View Users', 'users', 'read', 'View system users list and details', NOW(), NOW()),
  ('users.create', 'Create Users', 'users', 'create', 'Create new system users', NOW(), NOW()),
  ('users.update', 'Update Users', 'users', 'update', 'Edit existing user accounts', NOW(), NOW()),
  ('users.delete', 'Delete Users', 'users', 'delete', 'Delete or deactivate user accounts', NOW(), NOW()),
  ('users.manage', 'Manage Users', 'users', 'manage', 'Full access to user administration', NOW(), NOW()),
  ('roles.read', 'View Roles', 'roles', 'read', 'View roles and permission matrices', NOW(), NOW()),
  ('roles.manage', 'Manage Roles', 'roles', 'manage', 'Create and assign permissions to roles', NOW(), NOW()),
  ('drivers.read', 'View Drivers', 'drivers', 'read', 'View driver profiles and fleet rosters', NOW(), NOW()),
  ('drivers.create', 'Create Drivers', 'drivers', 'create', 'Add new drivers', NOW(), NOW()),
  ('drivers.update', 'Update Drivers', 'drivers', 'update', 'Edit driver details', NOW(), NOW()),
  ('drivers.delete', 'Delete Drivers', 'drivers', 'delete', 'Delete or block drivers', NOW(), NOW()),
  ('drivers.manage', 'Manage Drivers', 'drivers', 'manage', 'Full driver management', NOW(), NOW()),
  ('vehicles.read', 'View Vehicles', 'vehicles', 'read', 'View fleet buses and documents', NOW(), NOW()),
  ('vehicles.manage', 'Manage Vehicles', 'vehicles', 'manage', 'Create, edit, and assign vehicles', NOW(), NOW()),
  ('routes.read', 'View Routes', 'routes', 'read', 'View transit routes and stops', NOW(), NOW()),
  ('routes.manage', 'Manage Routes', 'routes', 'manage', 'Create, edit, and configure routes', NOW(), NOW()),
  ('stops.read', 'View Stops & Stations', 'stops', 'read', 'View bus stops and stations', NOW(), NOW()),
  ('stops.manage', 'Manage Stops', 'stops', 'manage', 'Create and configure bus stops', NOW(), NOW()),
  ('trips.read', 'View Trips', 'trips', 'read', 'View operational trips and rosters', NOW(), NOW()),
  ('trips.manage', 'Manage Trips', 'trips', 'manage', 'Create, assign, and control trips', NOW(), NOW()),
  ('schedules.read', 'View Scheduled Trips', 'schedules', 'read', 'View future schedule timetables', NOW(), NOW()),
  ('schedules.manage', 'Manage Schedules', 'schedules', 'manage', 'Generate and modify trip schedules', NOW(), NOW()),
  ('locations.read', 'View Live Tracking', 'locations', 'read', 'View live bus GPS map and history', NOW(), NOW()),
  ('locations.manage', 'Manage Tracking', 'locations', 'manage', 'Configure location tracking', NOW(), NOW()),
  ('rates.read', 'View Rate Charts', 'rates', 'read', 'View fare pricing matrices', NOW(), NOW()),
  ('rates.manage', 'Manage Rate Charts', 'rates', 'manage', 'Configure route fare charts', NOW(), NOW()),
  ('passengers.read', 'View Passengers', 'passengers', 'read', 'View registered customer passenger accounts', NOW(), NOW()),
  ('passengers.create', 'Create Passengers', 'passengers', 'create', 'Register passengers', NOW(), NOW()),
  ('passengers.update', 'Update Passengers', 'passengers', 'update', 'Edit passenger profiles', NOW(), NOW()),
  ('passengers.delete', 'Deactivate Passengers', 'passengers', 'delete', 'Block or delete passengers', NOW(), NOW()),
  ('passengers.manage', 'Manage Passengers', 'passengers', 'manage', 'Full passenger customer management', NOW(), NOW()),
  ('bookings.read', 'View Bookings', 'bookings', 'read', 'View ticket bookings and boarding lists', NOW(), NOW()),
  ('bookings.manage', 'Manage Bookings', 'bookings', 'manage', 'Create, update, and manage seat reservations', NOW(), NOW()),
  ('passes.read', 'View Shuttle Passes', 'passes', 'read', 'View passenger commuter passes', NOW(), NOW()),
  ('passes.manage', 'Manage Passes', 'passes', 'manage', 'Create and issue shuttle passes', NOW(), NOW()),
  ('coupons.read', 'View Coupons', 'coupons', 'read', 'View promotional discount coupons', NOW(), NOW()),
  ('coupons.manage', 'Manage Coupons', 'coupons', 'manage', 'Create and configure coupon codes', NOW(), NOW()),
  ('payments.read', 'View Payments', 'payments', 'read', 'View gateway payment transactions', NOW(), NOW()),
  ('payments.manage', 'Manage Payments', 'payments', 'manage', 'Manage payment reconciliations', NOW(), NOW()),
  ('refunds.read', 'View Refunds', 'refunds', 'read', 'View cancellation refund requests', NOW(), NOW()),
  ('refunds.process', 'Process Refunds', 'refunds', 'manage', 'Approve and initiate gateway refunds', NOW(), NOW()),
  ('refunds.manage', 'Manage Refunds', 'refunds', 'manage', 'Full control over refund policies and logs', NOW(), NOW()),
  ('webhooks.read', 'View PayU Webhooks', 'webhooks', 'read', 'View payment gateway webhook audit events', NOW(), NOW()),
  ('reports.read', 'View Reports & Analytics', 'reports', 'read', 'Access revenue, driver, and operator reports', NOW(), NOW()),
  ('reports.manage', 'Manage Reports', 'reports', 'manage', 'Export and configure analytics reports', NOW(), NOW()),
  ('audit_logs.read', 'View Audit Logs', 'audit_logs', 'read', 'View administrative activity trail', NOW(), NOW()),
  ('notifications.read', 'View Notifications', 'notifications', 'read', 'View system broadcast notifications', NOW(), NOW()),
  ('notifications.manage', 'Manage Notifications', 'notifications', 'manage', 'Create and dispatch notifications', NOW(), NOW()),
  ('banners.read', 'View Banners', 'banners', 'read', 'View promo banners and videos', NOW(), NOW()),
  ('banners.manage', 'Manage Banners', 'banners', 'manage', 'Upload and configure promotional banners', NOW(), NOW()),
  ('owner_requests.read', 'View Approval Requests', 'owner_requests', 'read', 'View fleet addition & update requests', NOW(), NOW()),
  ('owner_requests.manage', 'Manage Approval Requests', 'owner_requests', 'manage', 'Approve or reject fleet change requests', NOW(), NOW()),
  ('owner_kyc.read', 'View Owner KYC & Bank', 'owner_kyc', 'read', 'View operator Aadhaar, PAN, and Bank details', NOW(), NOW()),
  ('owner_kyc.manage', 'Manage Owner KYC & Bank', 'owner_kyc', 'manage', 'Verify and review operator bank submissions', NOW(), NOW()),
  ('settings.read', 'View System Settings', 'settings', 'read', 'View application configuration', NOW(), NOW()),
  ('settings.manage', 'Manage System Settings', 'settings', 'manage', 'Update system-wide settings and parameters', NOW(), NOW())
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `module` = VALUES(`module`),
  `action` = VALUES(`action`),
  `description` = VALUES(`description`),
  `updated_at` = NOW();

-- Assign ALL permissions to Admin role (ID = 1 or name = 'admin')
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `r`.`id`, `p`.`id`
FROM `roles` `r`
CROSS JOIN `permissions` `p`
WHERE `r`.`name` = 'admin' OR `r`.`id` = 1;

-- Assign essential operator permissions to Owner role
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `r`.`id`, `p`.`id`
FROM `roles` `r`
JOIN `permissions` `p` ON `p`.`name` IN (
  'dashboard.read',
  'drivers.read',
  'drivers.create',
  'drivers.update',
  'drivers.manage',
  'vehicles.read',
  'vehicles.manage',
  'routes.read',
  'stops.read',
  'trips.read',
  'trips.manage',
  'schedules.read',
  'schedules.manage',
  'locations.read',
  'rates.read',
  'bookings.read',
  'reports.read',
  'notifications.read',
  'banners.read',
  'owner_requests.read',
  'owner_requests.manage',
  'owner_kyc.read',
  'owner_kyc.manage'
)
WHERE `r`.`name` = 'owner';
