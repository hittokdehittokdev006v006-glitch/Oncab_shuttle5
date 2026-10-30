'use strict';

/**
 * Geographic utility functions for bus driver trip operations.
 */

const COMPLETION_RADIUS_METERS = 150;

/**
 * Calculates straight-line distance in meters between two GPS coordinates using the Haversine formula.
 *
 * @param {number|string} lat1
 * @param {number|string} lon1
 * @param {number|string} lat2
 * @param {number|string} lon2
 * @returns {number} Distance in meters (rounded to nearest integer), or Infinity if coordinates are invalid
 */
const calcHaversineDistanceMeters = (lat1, lon1, lat2, lon2) => {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const pLat1 = parseFloat(lat1);
  const pLon1 = parseFloat(lon1);
  const pLat2 = parseFloat(lat2);
  const pLon2 = parseFloat(lon2);
  if (!Number.isFinite(pLat1) || !Number.isFinite(pLon1) || !Number.isFinite(pLat2) || !Number.isFinite(pLon2)) {
    return Infinity;
  }
  if (Math.abs(pLat1) > 90 || Math.abs(pLat2) > 90 || Math.abs(pLon1) > 180 || Math.abs(pLon2) > 180) {
    return Infinity;
  }

  const R = 6371000; // Earth radius in meters
  const dLat = (pLat2 - pLat1) * Math.PI / 180;
  const dLon = (pLon2 - pLon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(pLat1 * Math.PI / 180) * Math.cos(pLat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
};

/**
 * Check if the driver is within the required radius of a stoppage.
 * Gracefully accounts for reported GPS device accuracy.
 *
 * @param {number|string} driverLat
 * @param {number|string} driverLng
 * @param {number|string} stopLat
 * @param {number|string} stopLng
 * @param {number} [radiusMeters=150]
 * @param {number} [accuracy=null]
 * @returns {{ isWithin: boolean, rawDistanceMeters: number, effectiveDistanceMeters: number }}
 */
const checkProximityToStop = (driverLat, driverLng, stopLat, stopLng, radiusMeters = COMPLETION_RADIUS_METERS, accuracy = null) => {
  const rawDistance = calcHaversineDistanceMeters(driverLat, driverLng, stopLat, stopLng);
  if (!Number.isFinite(rawDistance)) {
    return { isWithin: false, rawDistanceMeters: Infinity, effectiveDistanceMeters: Infinity };
  }

  // Gracefully handle GPS inaccuracy by allowing a modest accuracy buffer (up to 25 meters)
  const parsedAccuracy = accuracy != null && Number.isFinite(Number(accuracy)) && Number(accuracy) > 0 ? Number(accuracy) : 0;
  const accuracyBuffer = Math.min(parsedAccuracy, 25);
  const effectiveDistance = Math.max(0, rawDistance - accuracyBuffer);

  return {
    isWithin: effectiveDistance <= radiusMeters,
    rawDistanceMeters: rawDistance,
    effectiveDistanceMeters: effectiveDistance,
  };
};

/**
 * Get configured trip completion radius from system settings (in meters).
 * Defaults to COMPLETION_RADIUS_METERS (150m) if not configured.
 *
 * @returns {Promise<number>}
 */
const getCompletionRadiusMeters = async () => {
  try {
    const { SystemSetting } = require('../models');
    if (SystemSetting) {
      const setting = await SystemSetting.findOne({ where: { key: 'trip_completion_radius_meters' } });
      if (setting && setting.value) {
        const parsed = parseInt(setting.value, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }
  } catch (err) {
    // Fall back to default
  }
  return COMPLETION_RADIUS_METERS;
};

module.exports = {
  COMPLETION_RADIUS_METERS,
  calcHaversineDistanceMeters,
  checkProximityToStop,
  getCompletionRadiusMeters,
};
