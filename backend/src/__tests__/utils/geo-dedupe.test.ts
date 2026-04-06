import { describe, it, expect } from 'vitest';
import {
  boundingBoxForRadiusMeters,
  countriesMatchForDedupe,
  haversineDistanceMeters,
  isUnusableScraperCoordinate,
  metersToLatitudeDelta,
  pickNearestWithin,
  PROXIMITY_MERGE_MAX_METERS,
} from '../../utils/geo-dedupe';

describe('geo-dedupe', () => {
  it('haversineDistanceMeters is ~0 for identical points', () => {
    expect(haversineDistanceMeters(48.8566, 2.3522, 48.8566, 2.3522)).toBeLessThan(1);
  });

  it('haversineDistanceMeters matches known short span (~1 km order)', () => {
    const d = haversineDistanceMeters(48.8566, 2.3522, 48.8656, 2.3522);
    expect(d).toBeGreaterThan(900);
    expect(d).toBeLessThan(1100);
  });

  it('boundingBoxForRadiusMeters contains origin', () => {
    const lat = 40.7128;
    const lon = -74.006;
    const box = boundingBoxForRadiusMeters(lat, lon, 200);
    expect(box.latMin).toBeLessThanOrEqual(lat);
    expect(box.latMax).toBeGreaterThanOrEqual(lat);
    expect(box.lonMin).toBeLessThanOrEqual(lon);
    expect(box.lonMax).toBeGreaterThanOrEqual(lon);
  });

  it('metersToLatitudeDelta(111320) is about 1 degree', () => {
    expect(metersToLatitudeDelta(111_320)).toBeCloseTo(1, 1);
  });

  it('pickNearestWithin chooses closest under cap', () => {
    const refLat = 48.8566;
    const refLon = 2.3522;
    const candidates = [
      { latitude: refLat + 0.002, longitude: refLon, id: 'far' },
      { latitude: refLat + 0.00005, longitude: refLon, id: 'near' },
    ];
    const best = pickNearestWithin(candidates, refLat, refLon, 200);
    expect(best?.id).toBe('near');
  });

  it('pickNearestWithin returns null when all candidates exceed maxMeters', () => {
    const refLat = 48.8566;
    const refLon = 2.3522;
    const candidates = [{ latitude: refLat + 1, longitude: refLon, id: 'way' }];
    expect(pickNearestWithin(candidates, refLat, refLon, 100)).toBeNull();
  });

  it('isUnusableScraperCoordinate rejects NaN and 0,0', () => {
    expect(isUnusableScraperCoordinate(NaN, 1)).toBe(true);
    expect(isUnusableScraperCoordinate(0, 0)).toBe(true);
    expect(isUnusableScraperCoordinate(48.8566, 2.3522)).toBe(false);
  });

  it('countriesMatchForDedupe uses canonical country normalization', () => {
    expect(countriesMatchForDedupe('USA', 'United States')).toBe(true);
    expect(countriesMatchForDedupe('France', 'Germany')).toBe(false);
  });

  it('PROXIMITY_MERGE_MAX_METERS is a reasonable mall / geocode-drift radius', () => {
    expect(PROXIMITY_MERGE_MAX_METERS).toBeGreaterThanOrEqual(150);
    expect(PROXIMITY_MERGE_MAX_METERS).toBeLessThanOrEqual(800);
  });
});
