'use strict';

const {
  distanceInMeters,
  calculateBearing,
  angularDifference,
  findSharedRouteSegment,
} = require('../services/crossConnectionService');

describe('Cross Connection Geo & Matching Logic', () => {
  describe('distanceInMeters', () => {
    test('returns 0 for identical points', () => {
      const dist = distanceInMeters(22.5726, 88.3639, 22.5726, 88.3639);
      expect(dist).toBe(0);
    });

    test('calculates accurate distance between Kolkata and Howrah (~4km)', () => {
      // Esplanade: 22.5697, 88.3516
      // Howrah Station: 22.5830, 88.3426
      const dist = distanceInMeters(22.5697, 88.3516, 22.5830, 88.3426);
      expect(dist).toBeGreaterThan(1500);
      expect(dist).toBeLessThan(3000);
    });

    test('handles null or undefined coordinates gracefully', () => {
      expect(distanceInMeters(null, 88.35, 22.56, 88.35)).toBe(Infinity);
      expect(distanceInMeters(22.56, undefined, 22.56, 88.35)).toBe(Infinity);
    });
  });

  describe('calculateBearing and angularDifference', () => {
    test('calculates correct heading/bearing heading north', () => {
      // Due North: lat increases, lon constant
      const bearing = calculateBearing(22.0, 88.0, 23.0, 88.0);
      expect(Math.round(bearing)).toBe(0);
    });

    test('calculates correct heading heading east', () => {
      // Due East: lat constant, lon increases
      const bearing = calculateBearing(22.0, 88.0, 22.0, 89.0);
      expect(Math.round(bearing)).toBe(90);
    });

    test('determines angular difference correctly', () => {
      // 10 deg and 30 deg -> 20 deg diff (same direction)
      expect(angularDifference(10, 30)).toBe(20);

      // 350 deg and 10 deg -> 20 deg diff across 0/360 boundary
      expect(angularDifference(350, 10)).toBe(20);

      // Opposite directions: 10 deg and 190 deg -> 180 deg diff
      expect(angularDifference(10, 190)).toBe(180);
    });
  });

  describe('findSharedRouteSegment', () => {
    test('identifies matching shared segment when stops overlap', () => {
      const route1Stops = [
        { stop_name: 'Gariahat', latitude: 22.5186, longitude: 88.3656 },
        { stop_name: 'Park Circus', latitude: 22.5414, longitude: 88.3686 },
        { stop_name: 'Esplanade', latitude: 22.5697, longitude: 88.3516 },
      ];
      const route2Stops = [
        { stop_name: 'Jadavpur', latitude: 22.4988, longitude: 88.3718 },
        { stop_name: 'Park Circus Seven Point', latitude: 22.5418, longitude: 88.3689 }, // within ~100m of Park Circus
        { stop_name: 'Esplanade Metro', latitude: 22.5699, longitude: 88.3518 }, // within ~50m of Esplanade
      ];

      const shared = findSharedRouteSegment(route1Stops, route2Stops, 500);
      expect(shared).not.toBeNull();
      expect(shared.matchedCount).toBe(2);
      expect(shared.name).toContain('Park Circus');
    });

    test('returns null when routes have no overlapping stops within threshold', () => {
      const routeA = [
        { stop_name: 'Airport Gate 1', latitude: 22.6544, longitude: 88.4467 },
      ];
      const routeB = [
        { stop_name: 'Behala Chowrasta', latitude: 22.4965, longitude: 88.3129 },
      ];

      const shared = findSharedRouteSegment(routeA, routeB, 500);
      expect(shared).toBeNull();
    });
  });
});
