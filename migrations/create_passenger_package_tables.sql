CREATE TABLE IF NOT EXISTS `passenger_package_purchases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `passenger_id` BIGINT UNSIGNED NOT NULL,
  `package_id` BIGINT UNSIGNED NOT NULL,
  `route_id` BIGINT UNSIGNED DEFAULT NULL,
  `package_code` VARCHAR(50) NOT NULL,
  `package_name` VARCHAR(100) NOT NULL,
  `total_rides` INT UNSIGNED NOT NULL,
  `used_rides` INT UNSIGNED NOT NULL DEFAULT 0,
  `reserved_rides` INT UNSIGNED NOT NULL DEFAULT 0,
  `validity_days` INT UNSIGNED NOT NULL,
  `price_per_ride` DECIMAL(10, 2) NOT NULL,
  `amount_paid` DECIMAL(10, 2) NOT NULL,
  `payment_status` ENUM('pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
  `status` ENUM('pending_payment', 'active', 'exhausted', 'expired', 'cancelled', 'refunded') NOT NULL DEFAULT 'pending_payment',
  `purchased_at` DATETIME DEFAULT NULL,
  `expires_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_package_purchases_passenger_status` (`passenger_id`, `status`),
  KEY `idx_package_purchases_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `package_ride_usage` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `purchase_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` INT UNSIGNED NOT NULL,
  `rides_count` INT UNSIGNED NOT NULL,
  `status` ENUM('reserved', 'consumed', 'released') NOT NULL DEFAULT 'reserved',
  `reserved_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `consumed_at` DATETIME DEFAULT NULL,
  `released_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_package_ride_usage_booking` (`booking_id`),
  KEY `idx_package_ride_usage_purchase_status` (`purchase_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `package_purchase_id` BIGINT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `idempotency_key` VARCHAR(100) DEFAULT NULL;

CREATE UNIQUE INDEX `idx_booking_passenger_idempotency`
  ON `bookings` (`passenger_id`, `idempotency_key`);

ALTER TABLE `payments`
  ADD COLUMN IF NOT EXISTS `package_purchase_id` BIGINT UNSIGNED DEFAULT NULL;
