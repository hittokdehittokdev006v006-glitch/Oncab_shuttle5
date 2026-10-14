-- Migration: Create trip_stop_arrivals table for recording driver stop arrival timestamps
-- Records exact time driver reaches each stoppage on an active trip

CREATE TABLE IF NOT EXISTS `trip_stop_arrivals` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `trip_id` INT UNSIGNED NOT NULL COMMENT 'Foreign key to trips.id',
  `stop_id` INT UNSIGNED NOT NULL COMMENT 'Foreign key to stops.id',
  `driver_id` INT UNSIGNED NOT NULL COMMENT 'Foreign key to drivers.id',
  `vehicle_id` INT UNSIGNED DEFAULT NULL COMMENT 'Foreign key to vehicles.id (if known)',
  `stop_sequence` INT NOT NULL DEFAULT 1 COMMENT 'Sequence number of the stop along the route',
  `stop_name` VARCHAR(255) DEFAULT NULL COMMENT 'Cached stop name',
  `scheduled_arrival_time` TIME DEFAULT NULL COMMENT 'Scheduled arrival time for reference',
  `arrived_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp when driver reached this stoppage',
  `completed_at` DATETIME DEFAULT NULL COMMENT 'Timestamp when driver departed / completed this stoppage',
  `status` ENUM('ARRIVED', 'COMPLETED', 'SKIPPED') NOT NULL DEFAULT 'ARRIVED' COMMENT 'Status of this stoppage event',
  `arrival_latitude` DECIMAL(10, 7) DEFAULT NULL COMMENT 'GPS latitude at time of arrival confirmation',
  `arrival_longitude` DECIMAL(10, 7) DEFAULT NULL COMMENT 'GPS longitude at time of arrival confirmation',
  `passengers_boarded` INT NOT NULL DEFAULT 0 COMMENT 'Number of passengers boarded at this stop',
  `passengers_pending` INT NOT NULL DEFAULT 0 COMMENT 'Number of passengers still pending at this stop',
  `passengers_no_show` INT NOT NULL DEFAULT 0 COMMENT 'Number of passengers marked no-show at this stop',
  `notes` TEXT DEFAULT NULL COMMENT 'Optional notes or comments from driver/operator',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_trip_stop` (`trip_id`, `stop_id`),
  KEY `idx_trip_stop_arrived_at` (`arrived_at`),
  KEY `idx_trip_stop_driver` (`driver_id`),
  KEY `idx_trip_stop_vehicle` (`vehicle_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
