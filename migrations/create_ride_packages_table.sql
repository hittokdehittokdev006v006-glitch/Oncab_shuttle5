-- Migration: Create Ride Packages Table and Add Package Fields to Bookings
-- Supports fixed-price packages in Shuttle Booking (City Flow -> Ride Pack)

CREATE TABLE IF NOT EXISTS `ride_packages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `package_code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `package_type` ENUM('single_trip', 'fixed_bundle', 'daily', 'weekly', 'monthly', 'quarterly', 'annual') NOT NULL DEFAULT 'fixed_bundle',
  `rides_count` INT UNSIGNED NOT NULL DEFAULT 10,
  `validity_days` INT UNSIGNED NOT NULL DEFAULT 30,
  `price_per_ride` DECIMAL(10, 2) NOT NULL,
  `total_price` DECIMAL(10, 2) NOT NULL,
  `original_price` DECIMAL(10, 2) DEFAULT NULL,
  `discount_percentage` DECIMAL(5, 2) DEFAULT 0.00,
  `route_id` BIGINT UNSIGNED DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `features` JSON DEFAULT NULL,
  `badge_text` VARCHAR(50) DEFAULT NULL,
  `is_popular` TINYINT(1) DEFAULT 0,
  `status` ENUM('Active', 'Inactive') DEFAULT 'Active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_ride_packages_code` (`package_code`),
  KEY `idx_ride_packages_status` (`status`),
  KEY `idx_ride_packages_route_id` (`route_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add package snapshot & location fields to bookings table if not existing
ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `package_id` BIGINT UNSIGNED DEFAULT NULL AFTER `final_amount`,
  ADD COLUMN IF NOT EXISTS `package_name` VARCHAR(100) DEFAULT NULL AFTER `package_id`,
  ADD COLUMN IF NOT EXISTS `package_price_snapshot` DECIMAL(10, 2) DEFAULT NULL AFTER `package_name`,
  ADD COLUMN IF NOT EXISTS `package_rides_count` INT UNSIGNED DEFAULT NULL AFTER `package_price_snapshot`,
  ADD COLUMN IF NOT EXISTS `package_price_per_ride` DECIMAL(10, 2) DEFAULT NULL AFTER `package_rides_count`,
  ADD COLUMN IF NOT EXISTS `is_package_booking` TINYINT(1) DEFAULT 0 AFTER `package_price_per_ride`,
  ADD COLUMN IF NOT EXISTS `pickup_stop_name` VARCHAR(150) DEFAULT NULL AFTER `is_package_booking`,
  ADD COLUMN IF NOT EXISTS `drop_stop_name` VARCHAR(150) DEFAULT NULL AFTER `pickup_stop_name`,
  ADD COLUMN IF NOT EXISTS `departure_time` TIME DEFAULT NULL AFTER `drop_stop_name`,
  ADD COLUMN IF NOT EXISTS `arrival_time` TIME DEFAULT NULL AFTER `departure_time`;

-- Add package snapshot & location fields to shuttle_bookings table if not existing
ALTER TABLE `shuttle_bookings`
  ADD COLUMN IF NOT EXISTS `pickup_stop_name` VARCHAR(150) DEFAULT NULL AFTER `total_amount`,
  ADD COLUMN IF NOT EXISTS `drop_stop_name` VARCHAR(150) DEFAULT NULL AFTER `pickup_stop_name`,
  ADD COLUMN IF NOT EXISTS `package_id` BIGINT UNSIGNED DEFAULT NULL AFTER `drop_stop_name`,
  ADD COLUMN IF NOT EXISTS `package_name` VARCHAR(100) DEFAULT NULL AFTER `package_id`,
  ADD COLUMN IF NOT EXISTS `package_price_snapshot` DECIMAL(10, 2) DEFAULT NULL AFTER `package_name`,
  ADD COLUMN IF NOT EXISTS `package_rides_count` INT UNSIGNED DEFAULT NULL AFTER `package_price_snapshot`,
  ADD COLUMN IF NOT EXISTS `package_price_per_ride` DECIMAL(10, 2) DEFAULT NULL AFTER `package_rides_count`,
  ADD COLUMN IF NOT EXISTS `is_package_booking` TINYINT(1) DEFAULT 0 AFTER `package_price_per_ride`;

-- Seed standard Ride Pack packages
INSERT INTO `ride_packages` (`package_code`, `name`, `package_type`, `rides_count`, `validity_days`, `price_per_ride`, `total_price`, `original_price`, `discount_percentage`, `route_id`, `description`, `features`, `badge_text`, `is_popular`, `status`, `created_at`, `updated_at`)
VALUES
('RP-STARTER-5', 'Starter Ride Pack', 'fixed_bundle', 5, 14, 109.00, 545.00, 745.00, 26.85, NULL, 'Great for hybrid commuters testing shuttle convenience with low upfront cost.', '["5 Guaranteed AC Seats", "14 Days Validity", "Free Reschedule up to 15m prior", "Zero Cancellation Fee"]', 'TRIAL PACK', 0, 'Active', NOW(), NOW()),
('RP-WEEKLY-10', 'Weekly Commuter Pack', 'weekly', 10, 30, 99.00, 990.00, 1490.00, 33.56, NULL, 'Ideal for 5 days of round-trip office travel per week with guaranteed savings.', '["10 Guaranteed AC Seats", "30 Days Validity", "Save ₹50 per ride", "Priority Boarding Pass with QR", "Flexible Timings"]', 'MOST POPULAR', 1, 'Active', NOW(), NOW()),
('RP-MONTHLY-30', 'Monthly Freedom Pack', 'monthly', 30, 45, 85.00, 2550.00, 4470.00, 42.95, NULL, 'Our best value commuter plan! Save over 40% on daily office shuttle commute.', '["30 Guaranteed AC Seats", "45 Days Extended Validity", "Lowest Per-Ride Fare (₹85)", "Instant Boarding Pass", "Zero Rescheduling Fees"]', 'BEST VALUE', 1, 'Active', NOW(), NOW()),
('RP-FLEXI-15', 'Flexi Commuter Pack', 'fixed_bundle', 15, 60, 95.00, 1425.00, 2235.00, 36.24, NULL, '60-day extended validity designed for flexible hybrid 2-3 days weekly commuters.', '["15 Guaranteed AC Seats", "60 Days Extended Validity", "Travel Any Day", "Transferable & Reschedulable"]', 'FLEXIBLE', 0, 'Active', NOW(), NOW()),
('RP-CORP-44', 'Corporate Executive Pass', 'monthly', 44, 60, 79.00, 3476.00, 6556.00, 46.98, NULL, 'Dedicated monthly round-trip package with deepest discount for daily office commuters.', '["44 Guaranteed AC Seats", "Deepest Discount (47% OFF)", "Valid for 60 Days", "Dedicated Priority Support", "Unlimited Free Reschedules"]', 'MAX SAVINGS', 0, 'Active', NOW(), NOW())
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `rides_count` = VALUES(`rides_count`),
  `validity_days` = VALUES(`validity_days`),
  `price_per_ride` = VALUES(`price_per_ride`),
  `total_price` = VALUES(`total_price`),
  `original_price` = VALUES(`original_price`),
  `discount_percentage` = VALUES(`discount_percentage`),
  `features` = VALUES(`features`),
  `badge_text` = VALUES(`badge_text`),
  `updated_at` = NOW();
