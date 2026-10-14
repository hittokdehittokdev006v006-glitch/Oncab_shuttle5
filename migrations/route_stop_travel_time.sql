ALTER TABLE `route_stops`
  ADD COLUMN `travel_time_minutes` INT UNSIGNED NOT NULL DEFAULT 0
  COMMENT 'Minutes from the previous route stop; zero for the first stop';
