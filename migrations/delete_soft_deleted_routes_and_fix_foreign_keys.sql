-- ==============================================================================
-- Migration: Permanently Delete Soft-Deleted Routes and Fix Booking Foreign Keys
-- Database: fix_oncab_shuttle_dev
-- ==============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Fix Foreign Key Constraints
-- Trips: cascade delete when the parent route is deleted
ALTER TABLE `trips`
  DROP FOREIGN KEY `trips_ibfk_1`;

ALTER TABLE `trips`
  ADD CONSTRAINT `trips_ibfk_1` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Bookings: cascade delete when the trip is deleted, set origin/destination stop to NULL if a stop is deleted
ALTER TABLE `bookings`
  DROP FOREIGN KEY `bookings_ibfk_1`,
  DROP FOREIGN KEY `bookings_ibfk_3`,
  DROP FOREIGN KEY `bookings_ibfk_4`;

ALTER TABLE `bookings`
  ADD CONSTRAINT `bookings_ibfk_1` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `bookings_ibfk_3` FOREIGN KEY (`origin_stop_id`) REFERENCES `stops` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `bookings_ibfk_4` FOREIGN KEY (`destination_stop_id`) REFERENCES `stops` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Payments: cascade delete when the parent booking is deleted
ALTER TABLE `payments`
  DROP FOREIGN KEY `payments_ibfk_1`;

ALTER TABLE `payments`
  ADD CONSTRAINT `payments_ibfk_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Refunds: cascade delete when the parent booking is deleted
ALTER TABLE `refunds`
  DROP FOREIGN KEY `refunds_ibfk_1`;

ALTER TABLE `refunds`
  ADD CONSTRAINT `refunds_ibfk_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Clean Up Dependent Child Records for Soft-Deleted Routes
-- (A) Delete coupon usages associated with bookings on soft-deleted routes
DELETE cu FROM `coupon_usages` cu
INNER JOIN `bookings` b ON cu.booking_id = b.id
INNER JOIN `trips` t ON b.trip_id = t.id
INNER JOIN `routes` r ON t.route_id = r.id
WHERE r.deleted_at IS NOT NULL;

-- (B) Delete refunds associated with bookings on soft-deleted routes
DELETE ref FROM `refunds` ref
INNER JOIN `bookings` b ON ref.booking_id = b.id
INNER JOIN `trips` t ON b.trip_id = t.id
INNER JOIN `routes` r ON t.route_id = r.id
WHERE r.deleted_at IS NOT NULL;

-- (C) Delete payments associated with bookings on soft-deleted routes
DELETE p FROM `payments` p
INNER JOIN `bookings` b ON p.booking_id = b.id
INNER JOIN `trips` t ON b.trip_id = t.id
INNER JOIN `routes` r ON t.route_id = r.id
WHERE r.deleted_at IS NOT NULL;

-- (D) Delete bookings associated with trips or stops on soft-deleted routes
DELETE b FROM `bookings` b
INNER JOIN `trips` t ON b.trip_id = t.id
INNER JOIN `routes` r ON t.route_id = r.id
WHERE r.deleted_at IS NOT NULL;

DELETE b FROM `bookings` b
INNER JOIN `stops` s ON b.origin_stop_id = s.id
INNER JOIN `routes` r ON s.route_id = r.id
WHERE r.deleted_at IS NOT NULL;

DELETE b FROM `bookings` b
INNER JOIN `stops` s ON b.destination_stop_id = s.id
INNER JOIN `routes` r ON s.route_id = r.id
WHERE r.deleted_at IS NOT NULL;

-- (E) Delete trips on soft-deleted routes
DELETE t FROM `trips` t
INNER JOIN `routes` r ON t.route_id = r.id
WHERE r.deleted_at IS NOT NULL;

-- (F) Delete rate charts on soft-deleted routes
DELETE rc FROM `rate_charts` rc
INNER JOIN `routes` r ON rc.route_id = r.id
WHERE r.deleted_at IS NOT NULL;

-- (G) Delete route stops on soft-deleted routes
DELETE rs FROM `route_stops` rs
INNER JOIN `routes` r ON rs.route_id = r.id
WHERE r.deleted_at IS NOT NULL;

-- (H) Delete stops on soft-deleted routes
DELETE s FROM `stops` s
INNER JOIN `routes` r ON s.route_id = r.id
WHERE r.deleted_at IS NOT NULL;

-- 3. Permanently Delete Soft-Deleted Routes
DELETE FROM `routes` WHERE deleted_at IS NOT NULL;

SET FOREIGN_KEY_CHECKS = 1;
