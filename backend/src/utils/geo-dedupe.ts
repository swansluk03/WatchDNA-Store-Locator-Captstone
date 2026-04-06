import { normalizeCountry } from './country';

/**
 * Last-resort pure-proximity merge radius (m). Intentionally tight — only meant to absorb geocoding
 * drift between data sources for the exact same building. 75 m is enough for any real drift while
 * preventing neighbouring stores in a shopping centre from collapsing into one record.
 */
export const PROXIMITY_MERGE_MAX_METERS = 75;

/**
 * Max distance (m) allowed when an address fingerprint exactly matches (same normalised line1 + city +
 * country). Accepts slight geocoding provider disagreement but rejects "23 High St" in different parts
 * of the same city.
 */
export const ADDRESS_FP_EXACT_MAX_METERS = 300;

/**
 * Max distance (m) allowed when one address fingerprint contains the other (e.g. "marinamall" inside
 * "marinamall unit 4"). Tighter than the exact match because containment is a weaker signal.
 */
export const ADDRESS_FP_CONTAIN_MAX_METERS = 150;

const EARTH_RADIUS_M = 6371000;

/**
 * Great-circle distance between two WGS84 points in metres.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Approximate latitude span (degrees) for a north–south distance in metres.
 */
export function metersToLatitudeDelta(meters: number): number {
  return meters / 111_320;
}

/**
 * Approximate longitude span (degrees) for an east–west distance at a given latitude.
 */
export function metersToLongitudeDelta(meters: number, latitudeDeg: number): number {
  const cosLat = Math.cos((latitudeDeg * Math.PI) / 180);
  const denom = 111_320 * Math.max(Math.abs(cosLat), 0.01);
  return meters / denom;
}

export type LatLonBoundingBox = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

/**
 * Axis-aligned bounding box containing all points within `maxMeters` of (lat, lon).
 */
export function boundingBoxForRadiusMeters(
  lat: number,
  lon: number,
  maxMeters: number
): LatLonBoundingBox {
  const dLat = metersToLatitudeDelta(maxMeters);
  const dLon = metersToLongitudeDelta(maxMeters, lat);
  return {
    latMin: lat - dLat,
    latMax: lat + dLat,
    lonMin: lon - dLon,
    lonMax: lon + dLon,
  };
}

export function countriesMatchForDedupe(a: string, b: string): boolean {
  return normalizeCountry(a) === normalizeCountry(b);
}

export type GeoPoint = { latitude: number; longitude: number };

/**
 * Among candidates, return the closest to (lat, lon) if within maxMeters; otherwise null.
 */
export function pickNearestWithin<T extends GeoPoint>(
  candidates: T[],
  lat: number,
  lon: number,
  maxMeters: number
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = haversineDistanceMeters(lat, lon, c.latitude, c.longitude);
    if (d <= maxMeters && d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Coordinates unsuitable for proximity dedupe (bad scraper placeholders).
 */
export function isUnusableScraperCoordinate(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return true;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return true;
  if (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) return true;
  return false;
}
