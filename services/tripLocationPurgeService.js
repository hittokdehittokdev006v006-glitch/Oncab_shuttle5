'use strict';

const { Op } = require('sequelize');
const { TripLocation } = require('../models');

/**
 * Default retention period: 48 hours (2 days)
 * Configurable via process.env.TRIP_LOCATION_RETENTION_HOURS
 */
const RETENTION_HOURS = parseInt(process.env.TRIP_LOCATION_RETENTION_HOURS || '48', 10);

/**
 * Purge trip location records older than RETENTION_HOURS (at least 2 days old)
 * @param {number} [hours=RETENTION_HOURS] - Hours of history to retain (default: 48)
 * @returns {Promise<{ success: boolean, deletedCount: number, cutoffDate: Date }>}
 */
const purgeOldTripLocations = async (hours = RETENTION_HOURS) => {
  const retentionHours = Math.max(1, Number(hours) || 48);
  const cutoffDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

  try {
    const deletedCount = await TripLocation.destroy({
      where: {
        recorded_at: {
          [Op.lt]: cutoffDate,
        },
      },
    });

    if (deletedCount > 0) {
      console.log(`[TripLocationPurge] ✅ Successfully deleted ${deletedCount} location record(s) older than ${retentionHours} hours (cutoff: ${cutoffDate.toISOString()})`);
    }

    return {
      success: true,
      deletedCount,
      cutoffDate,
      retentionHours,
    };
  } catch (error) {
    // If the table doesn't exist yet or connection fails during startup, log warning without crashing
    console.warn(`[TripLocationPurge] ⚠️ Purge skipped or failed: ${error.message}`);
    return {
      success: false,
      deletedCount: 0,
      cutoffDate,
      retentionHours,
      error: error.message,
    };
  }
};

let purgeIntervalId = null;

/**
 * Start recurring background purge job
 * @param {Object} [options]
 * @param {number} [options.intervalMs=3600000] - Frequency in ms (default: 1 hour)
 * @param {number} [options.initialDelayMs=15000] - Delay before first run (default: 15 seconds)
 */
const startTripLocationPurgeJob = ({
  intervalMs = 60 * 60 * 1000,
  initialDelayMs = 15 * 1000,
} = {}) => {
  if (purgeIntervalId) {
    clearInterval(purgeIntervalId);
  }

  // Initial delayed run after server startup
  const initialTimeout = setTimeout(() => {
    purgeOldTripLocations().catch((err) => {
      console.warn('[TripLocationPurge] Initial purge error:', err.message);
    });
  }, initialDelayMs);

  if (typeof initialTimeout.unref === 'function') {
    initialTimeout.unref();
  }

  // Recurring interval (default: every 1 hour)
  purgeIntervalId = setInterval(() => {
    purgeOldTripLocations().catch((err) => {
      console.warn('[TripLocationPurge] Scheduled purge error:', err.message);
    });
  }, intervalMs);

  if (typeof purgeIntervalId.unref === 'function') {
    purgeIntervalId.unref();
  }

  console.log(`[TripLocationPurge] ⏱️ Background auto-purge registered (runs every ${Math.round(intervalMs / 60000)} mins, retains >= ${RETENTION_HOURS} hours)`);
};

/**
 * Stop recurring background purge job (useful for graceful shutdown/tests)
 */
const stopTripLocationPurgeJob = () => {
  if (purgeIntervalId) {
    clearInterval(purgeIntervalId);
    purgeIntervalId = null;
    console.log('[TripLocationPurge] 🛑 Background auto-purge stopped');
  }
};

module.exports = {
  RETENTION_HOURS,
  purgeOldTripLocations,
  startTripLocationPurgeJob,
  stopTripLocationPurgeJob,
};
