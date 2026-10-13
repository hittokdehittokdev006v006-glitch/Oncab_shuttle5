-- Migration: Create banners table and insert initial Image Banner and Video Banner
-- Compatible with MySQL 5.7+ and MySQL 8.0+

START TRANSACTION;

CREATE TABLE IF NOT EXISTS `banners` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(150) NOT NULL,
  `subtitle` VARCHAR(255) DEFAULT NULL,
  `banner_type` ENUM('image', 'video') NOT NULL DEFAULT 'image',
  `media_url` TEXT NOT NULL,
  `thumbnail_url` TEXT DEFAULT NULL,
  `video_type` ENUM('file', 'youtube', 'vimeo', 'external_url') DEFAULT 'file',
  `cta_title` VARCHAR(100) DEFAULT NULL,
  `cta_url` VARCHAR(255) DEFAULT NULL,
  `position` VARCHAR(50) DEFAULT 'home_top',
  `display_order` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `start_date` DATETIME DEFAULT NULL,
  `end_date` DATETIME DEFAULT NULL,
  `autoplay` TINYINT(1) DEFAULT 1,
  `is_muted` TINYINT(1) DEFAULT 1,
  `loop_video` TINYINT(1) DEFAULT 1,
  `show_controls` TINYINT(1) DEFAULT 1,
  `click_count` INT UNSIGNED DEFAULT 0,
  `view_count` INT UNSIGNED DEFAULT 0,
  `created_by` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_banners_type_active` (`banner_type`, `is_active`),
  KEY `idx_banners_position_order` (`position`, `display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Permissions for Banner Management
INSERT INTO `permissions` (`name`, `display_name`, `module`, `action`, `description`, `created_at`, `updated_at`) VALUES
  ('banners.read', 'View Banners', 'banners', 'read', 'View active and promotional banners in the admin panel', NOW(), NOW()),
  ('banners.manage', 'Manage Banners', 'banners', 'manage', 'Create, update, toggle and delete image and video banners', NOW(), NOW())
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `module` = VALUES(`module`),
  `action` = VALUES(`action`),
  `updated_at` = NOW();

-- Assign permissions to admin role
INSERT IGNORE INTO `role_permissions` (`created_at`, `updated_at`, `role_id`, `permission_id`)
SELECT NOW(), NOW(), `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`name` IN ('banners.read', 'banners.manage')
WHERE `roles`.`name` IN ('admin', 'operator');

-- Seed the two initial banners: One Image Banner and One Video Banner
INSERT INTO `banners` 
  (`id`, `title`, `subtitle`, `banner_type`, `media_url`, `thumbnail_url`, `video_type`, `cta_title`, `cta_url`, `position`, `display_order`, `is_active`, `autoplay`, `is_muted`, `loop_video`, `show_controls`, `created_at`, `updated_at`) 
VALUES
  (
    1,
    'Daily Commute Made Easy - Flat 20% Off Monthly Passes',
    'Skip the surge prices and crowded trains. Reserved AC seat on premier routes starting at ₹49/ride.',
    'image',
    'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=1400&q=80',
    'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=600&q=80',
    'file',
    'Explore Passes',
    '/passes',
    'home_top',
    1,
    1,
    1,
    1,
    1,
    1,
    NOW(),
    NOW()
  ),
  (
    2,
    'Experience Oncab Executive Shuttle Service',
    'Direct business-class shuttles with guaranteed seating, high-speed Wi-Fi, and live GPS tracking.',
    'video',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    'https://images.unsplash.com/photo-1570125909232-eb263c188f7e?auto=format&fit=crop&w=1200&q=80',
    'file',
    'Book Your Seat',
    '/trips',
    'home_top',
    2,
    1,
    1,
    1,
    1,
    1,
    NOW(),
    NOW()
  )
ON DUPLICATE KEY UPDATE
  `title` = VALUES(`title`),
  `subtitle` = VALUES(`subtitle`),
  `media_url` = VALUES(`media_url`),
  `thumbnail_url` = VALUES(`thumbnail_url`),
  `updated_at` = NOW();

COMMIT;
