/**
 * Frontend geographic and trip completion radius utilities
 */

export const COMPLETION_RADIUS_METERS = 150;

/**
 * Calculates straight-line distance in meters between two GPS coordinates using the Haversine formula.
 */
export const calcHaversineDistanceMeters = (
  lat1: number | string | null | undefined,
  lon1: number | string | null | undefined,
  lat2: number | string | null | undefined,
  lon2: number | string | null | undefined
): number => {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const pLat1 = typeof lat1 === 'number' ? lat1 : parseFloat(lat1);
  const pLon1 = typeof lon1 === 'number' ? lon1 : parseFloat(lon1);
  const pLat2 = typeof lat2 === 'number' ? lat2 : parseFloat(lat2);
  const pLon2 = typeof lon2 === 'number' ? lon2 : parseFloat(lon2);

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

export interface ProximityResult {
  isWithin: boolean;
  rawDistanceMeters: number;
  effectiveDistanceMeters: number;
  accuracyBuffer: number;
}

/**
 * Checks if a driver's GPS location is within the permitted radius of a stop,
 * taking into account device GPS accuracy gracefully.
 */
export const checkProximityToStop = (
  driverLat: number | string | null | undefined,
  driverLng: number | string | null | undefined,
  stopLat: number | string | null | undefined,
  stopLng: number | string | null | undefined,
  radiusMeters: number = COMPLETION_RADIUS_METERS,
  accuracy: number | null | undefined = null
): ProximityResult => {
  const rawDistance = calcHaversineDistanceMeters(driverLat, driverLng, stopLat, stopLng);
  if (!Number.isFinite(rawDistance)) {
    return { isWithin: false, rawDistanceMeters: Infinity, effectiveDistanceMeters: Infinity, accuracyBuffer: 0 };
  }

  // Gracefully handle GPS inaccuracy by allowing a modest accuracy buffer (up to 25 meters)
  const parsedAccuracy = accuracy != null && Number.isFinite(Number(accuracy)) && Number(accuracy) > 0 ? Number(accuracy) : 0;
  const accuracyBuffer = Math.min(parsedAccuracy, 25);
  const effectiveDistance = Math.max(0, rawDistance - accuracyBuffer);

  return {
    isWithin: effectiveDistance <= radiusMeters,
    rawDistanceMeters: rawDistance,
    effectiveDistanceMeters: effectiveDistance,
    accuracyBuffer,
  };
};

/**
 * Format meters nicely into human readable distance string (e.g. "85 m", "1.4 km").
 */
export const formatDistance = (meters: number | null | undefined): string => {
  if (meters == null || !Number.isFinite(meters) || meters === Infinity) return 'Unknown distance';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
};
