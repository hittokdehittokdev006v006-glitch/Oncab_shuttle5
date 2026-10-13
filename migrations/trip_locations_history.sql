-- Migration: Create trip_locations table for per-trip driver GPS breadcrumb tracking
-- Retains at least 2 days (48 hours) of location data, with auto-purge support.
-- Compatible with MySQL 5.7+ and MySQL 8.0+

CREATE TABLE IF NOT EXISTS `trip_locations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `trip_id` INT UNSIGNED NOT NULL COMMENT 'Foreign key to trips.id',
  `driver_id` INT UNSIGNED NOT NULL COMMENT 'Foreign key to drivers.id',
  `vehicle_id` INT UNSIGNED DEFAULT NULL COMMENT 'Foreign key to vehicles.id (if known)',
  `latitude` DECIMAL(10, 7) NOT NULL COMMENT 'GPS Latitude',
  `longitude` DECIMAL(10, 7) NOT NULL COMMENT 'GPS Longitude',
  `speed_kmh` DECIMAL(7, 2) DEFAULT NULL COMMENT 'Speed in km/h',
  `heading` DECIMAL(6, 2) DEFAULT NULL COMMENT 'Bearing / Heading angle in degrees 0-360',
  `accuracy` DECIMAL(6, 2) DEFAULT NULL COMMENT 'Horizontal accuracy in meters',
  `battery_level` DECIMAL(5, 2) DEFAULT NULL COMMENT 'Device battery level %',
  `recorded_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp when location was captured',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_trip_locations_trip_recorded` (`trip_id`, `recorded_at`),
  KEY `idx_trip_locations_recorded_at` (`recorded_at`),
  KEY `idx_trip_locations_driver_id` (`driver_id`),
  CONSTRAINT `fk_trip_locations_trip` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_trip_locations_driver` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional MySQL Server-level Auto-Purge Event
-- (Works automatically if MySQL event_scheduler is enabled on server: SET GLOBAL event_scheduler = ON;)
-- Note: The Node.js application also runs an hourly background purge service for 100% redundancy.
DROP EVENT IF EXISTS `evt_purge_trip_locations_older_than_2_days`;

DELIMITER $$
CREATE EVENT IF NOT EXISTS `evt_purge_trip_locations_older_than_2_days`
ON SCHEDULE EVERY 1 HOUR
STARTS CURRENT_TIMESTAMP
COMMENT 'Purges trip location breadcrumbs older than 2 days (48 hours)'
DO
BEGIN
  DELETE FROM `trip_locations`
  WHERE `recorded_at` < DATE_SUB(NOW(), INTERVAL 2 DAY);
END$$
DELIMITER ;
