-- Owner Settlements Table & TDS Configuration Migration
-- Run to create settlements schema, configure default TDS, and seed permissions

CREATE TABLE IF NOT EXISTS `owner_settlements` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `settlement_code` VARCHAR(50) NOT NULL,
  `owner_id` INT UNSIGNED NOT NULL,
  `owner_name` VARCHAR(150) NOT NULL,
  `owner_mobile` VARCHAR(25) DEFAULT NULL,
  `owner_email` VARCHAR(150) DEFAULT NULL,
  `vehicle_id` INT UNSIGNED DEFAULT NULL,
  `vehicle_number` VARCHAR(35) NOT NULL,
  `requested_amount` DECIMAL(10, 2) NOT NULL,
  `tds_percentage` DECIMAL(5, 2) NOT NULL DEFAULT '0.00',
  `tds_amount` DECIMAL(10, 2) NOT NULL DEFAULT '0.00',
  `net_payable_amount` DECIMAL(10, 2) NOT NULL DEFAULT '0.00',
  `account_number` VARCHAR(50) NOT NULL,
  `bank_name` VARCHAR(150) NOT NULL,
  `ifsc_code` VARCHAR(20) NOT NULL,
  `account_holder_name` VARCHAR(150) DEFAULT NULL,
  `upi_id` VARCHAR(100) DEFAULT NULL,
  `owner_notes` TEXT DEFAULT NULL,
  `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  `utr_number` VARCHAR(100) DEFAULT NULL,
  `admin_note` TEXT DEFAULT NULL,
  `processed_by` INT UNSIGNED DEFAULT NULL,
  `processed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_settlement_code` (`settlement_code`),
  KEY `idx_owner_settlements_owner_id` (`owner_id`),
  KEY `idx_owner_settlements_status` (`status`),
  KEY `idx_owner_settlements_vehicle` (`vehicle_id`),
  KEY `idx_owner_settlements_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1. Seed Configurable TDS percentage in Admin Settings (default 2.00%)
INSERT INTO `system_settings` (`key`, `value`, `type`, `group`, `label`, `description`, `is_public`, `created_at`, `updated_at`)
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
ON DUPLICATE KEY UPDATE `updated_at` = NOW();

-- 2. Register Settlement Permissions
INSERT INTO `permissions` (`name`, `display_name`, `module`, `action`, `description`, `created_at`, `updated_at`) VALUES
  ('settlements.read', 'View Settlements', 'settlements', 'read', 'View owner payout settlements and history', NOW(), NOW()),
  ('settlements.create', 'Request Settlement', 'settlements', 'create', 'Submit new settlement payout request', NOW(), NOW()),
  ('settlements.manage', 'Manage Settlements', 'settlements', 'manage', 'Approve, reject, or delete settlement requests', NOW(), NOW())
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `module` = VALUES(`module`),
  `action` = VALUES(`action`),
  `description` = VALUES(`description`),
  `updated_at` = NOW();

-- 3. Assign ALL settlement permissions to Admin
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`, `created_at`, `updated_at`)
SELECT r.id, p.id, NOW(), NOW()
FROM `roles` r
JOIN `permissions` p ON p.name IN ('settlements.read', 'settlements.create', 'settlements.manage')
WHERE r.id = 1 OR LOWER(r.name) = 'admin';

-- 4. Assign settlement permissions to Owner
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`, `created_at`, `updated_at`)
SELECT r.id, p.id, NOW(), NOW()
FROM `roles` r
JOIN `permissions` p ON p.name IN ('settlements.read', 'settlements.create')
WHERE LOWER(r.name) = 'owner';
