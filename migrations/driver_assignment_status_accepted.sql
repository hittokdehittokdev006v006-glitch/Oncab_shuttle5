-- Allow drivers to explicitly accept an assignment before the scheduled departure time.
-- This preserves existing statuses and adds the accepted state used by driver workflow checks.

ALTER TABLE `bus_driver_assignments`
  MODIFY COLUMN `status` ENUM('assigned', 'accepted', 'started', 'completed', 'cancelled') NOT NULL DEFAULT 'assigned';
