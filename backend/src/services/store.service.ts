/**
 * Store data service — master store data access.
 * All reads and writes go directly to the PostgreSQL Location table.
 * The DB is the single source of truth; CSVs are audit/input artifacts only.
 */

import type { Prisma } from '@prisma/client';
import Papa from 'papaparse';
import prisma from '../lib/prisma';
import { parseRowToLocationData, locationToCSVRow, type LocationData } from '../utils/csv-to-location';
import { isRowCompleteForDb } from '../utils/row-completeness';
import {
  mergeLocationDataForManualImport,
  mergeLocationDataForUpdate,
} from '../utils/merge-location-update';
import { computeStableHandleFromRow, addressFingerprintLine1 } from '../utils/stable-handle';
import {
  boundingBoxForRadiusMeters,
  countriesMatchForDedupe,
  haversineDistanceMeters,
  isUnusableScraperCoordinate,
  namesSimilarForDedupe,
  normalizeNameForDedupe,
  pickNearestWithin,
  PROXIMITY_MERGE_MAX_METERS,
  PROXIMITY_MERGE_NAME_MATCH_MAX_METERS,
  ADDRESS_FP_EXACT_MAX_METERS,
  ADDRESS_FP_CONTAIN_MAX_METERS,
} from '../utils/geo-dedupe';
import { normalizeCountry } from '../utils/country';
import {
  dedupeAddressFingerprint,
  MIN_ADDRESS_FP_CONTAIN_LEN,
  safeAddressFingerprintContainment,
} from '../utils/address-dedupe';
import { logger } from '../utils/logger';
import { buildMasterExportWhere, type MasterExportFilters } from '../utils/master-export-filters';
import { legacyBrandTextFilterWhere } from '../utils/legacy-brand-filter';

/**
 * Rows per interactive transaction for {@link batchUpsertLocations} / resilient path.
 * Keep moderate so each transaction finishes within {@link LOCATION_UPSERT_TRANSACTION_OPTIONS}
 * on remote Postgres (e.g. Railway proxy); oversized batches hit Prisma's default 5s transaction
 * timeout and trigger per-row fallback (many more round trips).
 */
const BATCH_SIZE = 120;

/**
 * Interactive `prisma.$transaction` defaults are maxWait 2s / timeout 5s — too low for dozens of
 * upserts over the public internet. Longer timeout keeps batched work without falling back.
 */
const LOCATION_UPSERT_TRANSACTION_OPTIONS = {
  maxWait: 15_000,
  timeout: 120_000,
} as const;

/** How incoming rows merge with existing DB rows when `mergeOnUpdate` is true. */
export type BatchUpsertMergeKind = 'scraper' | 'manual';

type MergeRowFn = (
  existing: {
    brands: string | null;
    customBrands: string | null;
    phone: string | null;
  },
  incoming: LocationData
) => LocationData;

/** ~50 metres expressed as degrees of latitude — matches the tolerance in updateMasterRecords. */
const COORD_TOLERANCE_DEG = 0.00045;

/**
 * Rows that share the same 5dp rounded lat/lon lie within ~1–2 m; allow slack for float vs DB numeric.
 * Used only after the SQL filter already matched ROUND(..., 5) — not a wide proximity merge.
 */
const ROUNDED_COORD_MATCH_MAX_METERS = 25;

/** CSV-shaped row for completeness check from parsed LocationData. */
function csvRowFromLocationData(loc: LocationData): Record<string, string> {
  return {
    Name: loc.name,
    Phone: loc.phone ?? '',
    'Address Line 1': loc.addressLine1,
    'Address Line 2': loc.addressLine2 ?? '',
    City: loc.city,
    Country: loc.country,
    Latitude: String(loc.latitude),
    Longitude: String(loc.longitude),
  };
}

/**
 * After parseRowToLocationData, country/phone are canonical. Replace Handle with the geography hash
 * so two imports that only differ by country spelling or brand-supplied id still target one loc_* key
 * (computeStableHandleFromRow also normalizes country internally — this uses already-normalized fields).
 */
/** Minimal shape for name + address + coordinate dedupe alignment. */
type DedupePoint = {
  name: string;
  addressLine1: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
};

function toDedupePoint(row: LocationData): DedupePoint {
  return {
    name: row.name,
    addressLine1: row.addressLine1,
    city: row.city,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

/**
 * True when two address lines refer to the same place (normalized equality, fingerprint equality,
 * or safe containment on deduped / raw fingerprints).
 * Short lines (e.g. "1 A") align on exact trimmed case-insensitive equality even when under 4 chars.
 */
function addressesAlignForDedupe(aLine1: string, bLine1: string): boolean {
  const a = (aLine1 ?? '').trim().toLowerCase();
  const b = (bLine1 ?? '').trim().toLowerCase();
  if (a.length > 0 && b.length > 0 && a === b) return true;
  const inFp = dedupeAddressFingerprint(aLine1);
  const exFp = dedupeAddressFingerprint(bLine1);
  if (inFp.length > 0 && exFp.length > 0 && inFp === exFp) return true;
  if (inFp.length >= 6 && exFp.length >= 6) {
    if (safeAddressFingerprintContainment(inFp, exFp) || safeAddressFingerprintContainment(exFp, inFp)) {
      return true;
    }
  }
  const inRaw = addressFingerprintLine1(aLine1);
  const exRaw = addressFingerprintLine1(bLine1);
  if (inRaw.length > 0 && exRaw.length > 0 && inRaw === exRaw) return true;
  if (inRaw.length >= 6 && exRaw.length >= 6) {
    if (safeAddressFingerprintContainment(inRaw, exRaw) || safeAddressFingerprintContainment(exRaw, inRaw)) {
      return true;
    }
  }
  return false;
}

/**
 * Name + address alignment + distance cap (m). Used for fingerprint SQL paths with a caller-chosen
 * radius so {@link ADDRESS_FP_EXACT_MAX_METERS} / {@link ADDRESS_FP_CONTAIN_MAX_METERS} stay
 * consistent with {@link pickNearestWithin}.
 */
function dedupeTripletWithinMeters(a: DedupePoint, b: DedupePoint, maxMeters: number): boolean {
  if (!countriesMatchForDedupe(a.country, b.country)) return false;
  const nameOk =
    normalizeNameForDedupe(a.name) === normalizeNameForDedupe(b.name) ||
    namesSimilarForDedupe(a.name, b.name);
  if (!nameOk) return false;
  if (!addressesAlignForDedupe(a.addressLine1, b.addressLine1)) return false;
  if (
    isUnusableScraperCoordinate(a.latitude, a.longitude) ||
    isUnusableScraperCoordinate(b.latitude, b.longitude)
  ) {
    return false;
  }
  const d = haversineDistanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);
  return d <= maxMeters;
}

/**
 * Same physical store for scrape/CSV dedupe: similar name, similar address, and nearby coordinates.
 * Avoids merging different retailers in the same mall or block.
 */
function tripletAllowsMerge(a: DedupePoint, b: DedupePoint): boolean {
  return dedupeTripletWithinMeters(a, b, PROXIMITY_MERGE_NAME_MATCH_MAX_METERS);
}

/** Same country + usable coords + distance cap (no name/address checks). */
function sameCountryWithinMeters(
  lat: number,
  lon: number,
  incomingCountry: string,
  lat2: number,
  lon2: number,
  country2: string,
  maxMeters: number
): boolean {
  if (!countriesMatchForDedupe(incomingCountry, country2)) return false;
  if (isUnusableScraperCoordinate(lat, lon) || isUnusableScraperCoordinate(lat2, lon2)) return false;
  return haversineDistanceMeters(lat, lon, lat2, lon2) <= maxMeters;
}

/** Same city + country + {@link addressesAlignForDedupe} + distance (batch collapse without name match). */
function batchAddressAlignedWithinMeters(a: LocationData, b: LocationData, maxMeters: number): boolean {
  if (!countriesMatchForDedupe(a.country, b.country)) return false;
  if (a.city.trim().toLowerCase() !== b.city.trim().toLowerCase()) return false;
  if (!addressesAlignForDedupe(a.addressLine1, b.addressLine1)) return false;
  return sameCountryWithinMeters(
    a.latitude,
    a.longitude,
    a.country,
    b.latitude,
    b.longitude,
    b.country,
    maxMeters
  );
}

function applyStableHandleToCompleteParsedRow(loc: LocationData): LocationData {
  if (!isRowCompleteForDb(csvRowFromLocationData(loc))) return loc;
  try {
    const minimal: Record<string, string> = {
      'Address Line 1': loc.addressLine1,
      'Address Line 2': loc.addressLine2 ?? '',
      City: loc.city,
      Country: loc.country,
      Latitude: String(loc.latitude),
      Longitude: String(loc.longitude),
    };
    return { ...loc, handle: computeStableHandleFromRow(minimal) };
  } catch {
    return loc;
  }
}

/**
 * Nearest existing Location after coordinate / fingerprint SQL passes.
 *
 * - Pass A: exact normalized name + same city + full triplet + within 300 m.
 * - Pass B: similar name + same city + triplet rules at {@link ADDRESS_FP_CONTAIN_MAX_METERS} (150 m).
 * - Pass C: same country + within {@link PROXIMITY_MERGE_MAX_METERS} m (75 m) — no name/address agreement
 *   (last-resort pure proximity; runs only after A and B find nothing).
 */
async function findNearestLocationForDedupe(row: LocationData): Promise<ExistingLocationSnapshot | null> {
  const { latitude: lat, longitude: lon, country, name: incomingName, city: incomingCity } = row;
  if (isUnusableScraperCoordinate(lat, lon)) return null;

  const box = boundingBoxForRadiusMeters(lat, lon, PROXIMITY_MERGE_NAME_MATCH_MAX_METERS);
  const candidates = await prisma.location.findMany({
    where: {
      latitude: { gte: box.latMin, lte: box.latMax },
      longitude: { gte: box.lonMin, lte: box.lonMax },
    },
    select: {
      handle: true,
      name: true,
      brands: true,
      customBrands: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      stateProvinceRegion: true,
      country: true,
      postalCode: true,
      phone: true,
      website: true,
      email: true,
      latitude: true,
      longitude: true,
    },
  });

  const sameCountry = candidates.filter((c) => countriesMatchForDedupe(c.country, country));
  const incomingCityNorm = incomingCity.trim().toLowerCase();
  const incomingPoint = toDedupePoint(row);

  // Pass A: exact normalized name + same city + full triplet (incl. address alignment).
  const nameMatched = sameCountry.filter((c) => {
    if (normalizeNameForDedupe(c.name) !== normalizeNameForDedupe(incomingName)) return false;
    if (c.city.trim().toLowerCase() !== incomingCityNorm) return false;
    const p: DedupePoint = {
      name: c.name,
      addressLine1: c.addressLine1,
      city: c.city,
      country: c.country,
      latitude: c.latitude,
      longitude: c.longitude,
    };
    return tripletAllowsMerge(incomingPoint, p);
  });
  const nameNearest = pickNearestWithin(nameMatched, lat, lon, PROXIMITY_MERGE_NAME_MATCH_MAX_METERS);
  if (nameNearest) {
    logger.info(
      `[storeService] Name-match dedupe (${PROXIMITY_MERGE_NAME_MATCH_MAX_METERS}m, triplet): ` +
        `"${incomingName}" → existing "${nameNearest.name}" (${nameNearest.handle})`
    );
    const { latitude: _lat, longitude: _lon, ...snapshot } = nameNearest;
    return snapshot;
  }

  // Pass B: similar name + same city + full triplet (address rules match {@link addressesAlignForDedupe},
  // including raw vs deduped fingerprints — avoids dedupe-only containment pre-filter disagreeing with triplet).
  const similarMatched = sameCountry.filter((c) => {
    if (!namesSimilarForDedupe(incomingName, c.name)) return false;
    if (c.city.trim().toLowerCase() !== incomingCityNorm) return false;
    const p: DedupePoint = {
      name: c.name,
      addressLine1: c.addressLine1,
      city: c.city,
      country: c.country,
      latitude: c.latitude,
      longitude: c.longitude,
    };
    return dedupeTripletWithinMeters(incomingPoint, p, ADDRESS_FP_CONTAIN_MAX_METERS);
  });
  const similarNearest = pickNearestWithin(
    similarMatched,
    lat,
    lon,
    ADDRESS_FP_CONTAIN_MAX_METERS
  );
  if (similarNearest) {
    logger.info(
      `[storeService] Similar-name dedupe (triplet @ ${ADDRESS_FP_CONTAIN_MAX_METERS}m): ` +
        `"${incomingName}" → existing "${similarNearest.name}" (${similarNearest.handle})`
    );
    const { latitude: _lat, longitude: _lon, ...snapshot } = similarNearest;
    return snapshot;
  }

  const proximityOnly = sameCountry.filter((c) =>
    sameCountryWithinMeters(lat, lon, country, c.latitude, c.longitude, c.country, PROXIMITY_MERGE_MAX_METERS)
  );
  const proximityNearest = pickNearestWithin(proximityOnly, lat, lon, PROXIMITY_MERGE_MAX_METERS);
  if (proximityNearest) {
    logger.info(
      `[storeService] Proximity-only dedupe (${PROXIMITY_MERGE_MAX_METERS}m, same country): ` +
        `"${incomingName}" → existing "${proximityNearest.name}" (${proximityNearest.handle})`
    );
    const { latitude: _lat, longitude: _lon, ...snapshot } = proximityNearest;
    return snapshot;
  }

  return null;
}

export interface UpsertResult {
  upserted: number;
  skipped: number;
  created: number;
  updated: number;
  unchanged: number;
  newStores: string[];
  brandsChanged: string[];
  addressChanged: string[];
  infoChanged: string[];
  /** DB errors when failFast is false (per-row resilient import). */
  dbErrors?: string[];
  /** Count of rows that failed to upsert (resilient mode only). */
  failed?: number;
  /** Rows excluded by requireCompleteForDb before parse. */
  skippedIncomplete?: number;
  /**
   * Distinct Location.handle values written in this run (after remap / batch collapse).
   * Used for scoped Tier-C dedupe so only rows near or matching these need full consideration.
   */
  affectedHandles?: string[];
}

type ExistingLocationSnapshot = {
  handle: string;
  name: string;
  brands: string | null;
  customBrands: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateProvinceRegion: string | null;
  country: string;
  postalCode: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
};

/** Row shape from raw SQL (includes coords for nearest pick). */
type LocationMatchRow = ExistingLocationSnapshot & {
  latitude: number;
  longitude: number;
};

function matchRowToSnapshot(r: LocationMatchRow): ExistingLocationSnapshot {
  const { latitude: _la, longitude: _lo, ...snap } = r;
  return snap;
}

const existingSelect = {
  handle: true,
  name: true,
  brands: true,
  customBrands: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  stateProvinceRegion: true,
  country: true,
  postalCode: true,
  phone: true,
  website: true,
  email: true,
} as const;

/**
 * Existing row with same coordinates rounded to 5 dp and same country.
 * Name/address may drift vs the incoming row; pick the nearest true coordinate within a tight radius
 * (same rounding cell is ~1–2 m — see {@link ROUNDED_COORD_MATCH_MAX_METERS}).
 */
async function findByRoundedCoords(incoming: LocationData): Promise<ExistingLocationSnapshot | null> {
  const lat = incoming.latitude;
  const lon = incoming.longitude;
  if (isUnusableScraperCoordinate(lat, lon)) return null;
  const c = normalizeCountry(incoming.country);
  const rows = await prisma.$queryRaw<LocationMatchRow[]>`
    SELECT
      "handle", "name", "brands", "customBrands",
      "addressLine1", "addressLine2", "city", "stateProvinceRegion", "country",
      "postalCode", "phone", "website", "email",
      "latitude", "longitude"
    FROM "Location"
    WHERE ROUND("latitude"::numeric, 5) = ROUND(${lat}::double precision::numeric, 5)
      AND ROUND("longitude"::numeric, 5) = ROUND(${lon}::double precision::numeric, 5)
      AND "country" = ${c}
    ORDER BY "handle" ASC
    LIMIT 40
  `;
  if (rows.length === 0) return null;
  if (rows.length === 1) return matchRowToSnapshot(rows[0]);
  const nearest = pickNearestWithin(rows, lat, lon, ROUNDED_COORD_MATCH_MAX_METERS);
  return nearest ? matchRowToSnapshot(nearest) : null;
}

/**
 * Existing row with same normalized address line1 fingerprint + city + country as analyze-duplicate-locations.ts.
 * Rows are filtered by distance ≤ {@link ADDRESS_FP_EXACT_MAX_METERS} only (SQL already matched address + city;
 * name may differ, e.g. legal vs display name).
 */
async function findByAddressFingerprint(incoming: LocationData): Promise<ExistingLocationSnapshot | null> {
  const fpRaw = addressFingerprintLine1(incoming.addressLine1);
  const fpDeduped = dedupeAddressFingerprint(incoming.addressLine1);
  const lat = incoming.latitude;
  const lon = incoming.longitude;
  const city = incoming.city;
  const country = incoming.country;
  if (Math.max(fpRaw.length, fpDeduped.length) < 6 || isUnusableScraperCoordinate(lat, lon)) {
    return null;
  }
  const c = normalizeCountry(country);
  const cityNorm = city.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const rows = await prisma.$queryRaw<LocationMatchRow[]>`
    SELECT
      "handle", "name", "brands", "customBrands",
      "addressLine1", "addressLine2", "city", "stateProvinceRegion", "country",
      "postalCode", "phone", "website", "email",
      "latitude", "longitude"
    FROM "Location"
    WHERE (
        regexp_replace(lower(trim(COALESCE("addressLine1", ''))), '[^a-z0-9]', '', 'g') = ${fpRaw}
        OR regexp_replace(lower(trim(COALESCE("addressLine1", ''))), '[^a-z0-9]', '', 'g') = ${fpDeduped}
      )
      AND regexp_replace(lower(trim("city")), '[^a-z0-9]', '', 'g') = ${cityNorm}
      AND "country" = ${c}
    ORDER BY "handle" ASC
    LIMIT 40
  `;
  if (rows.length === 0) return null;
  const aligned = rows.filter((r) =>
    sameCountryWithinMeters(lat, lon, country, r.latitude, r.longitude, r.country, ADDRESS_FP_EXACT_MAX_METERS)
  );
  if (aligned.length === 0) return null;
  if (aligned.length === 1) return matchRowToSnapshot(aligned[0]);
  const nearest = pickNearestWithin(aligned, lat, lon, ADDRESS_FP_EXACT_MAX_METERS);
  return nearest ? matchRowToSnapshot(nearest) : null;
}

/**
 * Same city + country, and one address fingerprint contains the other (e.g. "marinamall" vs "marinamall18st").
 * Stricter than analyze "similar pairs"; requires min length to reduce false merges.
 * Requires name + address alignment and distance ≤ {@link ADDRESS_FP_CONTAIN_MAX_METERS} (aligned with
 * {@link pickNearestWithin} below, not the generic 300 m triplet cap).
 */
async function findByContainedFingerprint(incoming: LocationData): Promise<ExistingLocationSnapshot | null> {
  const fpRaw = addressFingerprintLine1(incoming.addressLine1);
  const fpDeduped = dedupeAddressFingerprint(incoming.addressLine1);
  const lat = incoming.latitude;
  const lon = incoming.longitude;
  const city = incoming.city;
  const country = incoming.country;
  if (
    Math.max(fpRaw.length, fpDeduped.length) < MIN_ADDRESS_FP_CONTAIN_LEN ||
    isUnusableScraperCoordinate(lat, lon)
  ) {
    return null;
  }
  const c = normalizeCountry(country);
  const cityNormContain = city.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const incomingPoint = toDedupePoint(incoming);
  const rows = await prisma.$queryRaw<LocationMatchRow[]>`
    SELECT
      "handle", "name", "brands", "customBrands",
      "addressLine1", "addressLine2", "city", "stateProvinceRegion", "country",
      "postalCode", "phone", "website", "email",
      "latitude", "longitude"
    FROM "Location"
    WHERE "country" = ${c}
      AND regexp_replace(lower(trim("city")), '[^a-z0-9]', '', 'g') = ${cityNormContain}
      AND length(regexp_replace(lower(trim(COALESCE("addressLine1", ''))), '[^a-z0-9]', '', 'g')) >= ${MIN_ADDRESS_FP_CONTAIN_LEN}
      AND (
        strpos(
          regexp_replace(lower(trim(COALESCE("addressLine1", ''))), '[^a-z0-9]', '', 'g'),
          ${fpRaw}
        ) > 0
        OR strpos(
          ${fpRaw},
          regexp_replace(lower(trim(COALESCE("addressLine1", ''))), '[^a-z0-9]', '', 'g')
        ) > 0
        OR strpos(
          regexp_replace(lower(trim(COALESCE("addressLine1", ''))), '[^a-z0-9]', '', 'g'),
          ${fpDeduped}
        ) > 0
        OR strpos(
          ${fpDeduped},
          regexp_replace(lower(trim(COALESCE("addressLine1", ''))), '[^a-z0-9]', '', 'g')
        ) > 0
      )
    ORDER BY "handle" ASC
    LIMIT 40
  `;
  if (rows.length === 0) return null;
  const filtered = rows.filter((r) => {
    const dbRaw = addressFingerprintLine1(r.addressLine1);
    const dbDed = dedupeAddressFingerprint(r.addressLine1);
    return (
      safeAddressFingerprintContainment(fpRaw, dbRaw) ||
      safeAddressFingerprintContainment(fpRaw, dbDed) ||
      safeAddressFingerprintContainment(fpDeduped, dbRaw) ||
      safeAddressFingerprintContainment(fpDeduped, dbDed)
    );
  });
  if (filtered.length === 0) return null;
  const aligned = filtered.filter((r) =>
    dedupeTripletWithinMeters(
      incomingPoint,
      {
        name: r.name,
        addressLine1: r.addressLine1,
        city: r.city,
        country: r.country,
        latitude: r.latitude,
        longitude: r.longitude,
      },
      ADDRESS_FP_CONTAIN_MAX_METERS
    )
  );
  if (aligned.length === 0) return null;
  if (aligned.length === 1) {
    const r = aligned[0];
    if (
      !isUnusableScraperCoordinate(lat, lon) &&
      !isUnusableScraperCoordinate(r.latitude, r.longitude) &&
      haversineDistanceMeters(lat, lon, r.latitude, r.longitude) > ADDRESS_FP_CONTAIN_MAX_METERS
    ) {
      return null;
    }
    return matchRowToSnapshot(r);
  }
  const nearest = pickNearestWithin(aligned, lat, lon, ADDRESS_FP_CONTAIN_MAX_METERS);
  return nearest ? matchRowToSnapshot(nearest) : null;
}

async function resolveExistingMatchForRow(
  row: LocationData,
  coordCache: Map<string, ExistingLocationSnapshot | null>,
  fpCache: Map<string, ExistingLocationSnapshot | null>
): Promise<ExistingLocationSnapshot | null> {
  const c = normalizeCountry(row.country);
  // Include name + deduped address so cache entries are not reused across different tenants at the
  // same rounded pin (wider key space than coords-only, but avoids incorrect merge suggestions).
  const coordKey = `${row.latitude.toFixed(5)}|${row.longitude.toFixed(5)}|${c}|${normalizeNameForDedupe(row.name)}|${dedupeAddressFingerprint(row.addressLine1)}`;
  if (!coordCache.has(coordKey)) {
    const hit = await findByRoundedCoords(row);
    coordCache.set(coordKey, hit);
  }
  const coordHit = coordCache.get(coordKey);
  if (coordHit) return coordHit;

  const fp = addressFingerprintLine1(row.addressLine1);
  const fpDed = dedupeAddressFingerprint(row.addressLine1);
  if (Math.max(fp.length, fpDed.length) >= 6) {
    const fpKey = `${fp}|${fpDed}|${row.city.trim().toLowerCase()}|${c}|${normalizeNameForDedupe(row.name)}`;
    if (!fpCache.has(fpKey)) {
      let hit = await findByAddressFingerprint(row);
      if (!hit) {
        hit = await findByContainedFingerprint(row);
      }
      fpCache.set(fpKey, hit);
    }
    const fpHit = fpCache.get(fpKey);
    if (fpHit) return fpHit;
  }

  return findNearestLocationForDedupe(row);
}

/**
 * Merge incoming rows in one batch that describe the same physical store.
 *
 * Union when any of:
 * - Same non-empty {@link LocationData.sourceStoreKey} (brand id)
 * - Same rounded coordinates (5 dp) + country (catches duplicate rows before name/address normalize)
 * - Same deduped address fingerprint + city + country (St vs Street, etc.)
 * - Same city + country + {@link addressesAlignForDedupe} within {@link ADDRESS_FP_EXACT_MAX_METERS} m
 *   (Main St vs Main Street in one batch without requiring name match)
 * - Full {@link tripletAllowsMerge} (name + address + proximity), same as DB-side dedupe
 */
function collapseBatchRowsByIdentity(
  rows: LocationData[],
  mergeOnUpdate: boolean,
  inDbHandles: Set<string>,
  mergeRow: MergeRowFn
): LocationData[] {
  if (rows.length <= 1 || !mergeOnUpdate) return rows;

  const n = rows.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  }
  function union(i: number, j: number) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
  }

  const countryKey = (r: LocationData) => normalizeCountry(r.country);
  const coordKey = (r: LocationData) =>
    `${r.latitude.toFixed(5)}|${r.longitude.toFixed(5)}|${countryKey(r)}`;
  const addrKey = (r: LocationData) =>
    `${dedupeAddressFingerprint(r.addressLine1)}|${r.city.trim().toLowerCase()}|${countryKey(r)}`;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!countriesMatchForDedupe(rows[i].country, rows[j].country)) continue;
      // Brand-supplied key match: trust the source that these are the same store even when
      // name/address/geo disagree (e.g. two scraper runs with different address formats).
      const keyI = rows[i].sourceStoreKey?.trim();
      const keyJ = rows[j].sourceStoreKey?.trim();
      if (keyI && keyJ && keyI === keyJ) {
        union(i, j);
        continue;
      }
      if (coordKey(rows[i]) === coordKey(rows[j])) {
        union(i, j);
        continue;
      }
      if (
        dedupeAddressFingerprint(rows[i].addressLine1).length >= 6 &&
        dedupeAddressFingerprint(rows[j].addressLine1).length >= 6 &&
        addrKey(rows[i]) === addrKey(rows[j])
      ) {
        union(i, j);
        continue;
      }
      if (
        batchAddressAlignedWithinMeters(rows[i], rows[j], ADDRESS_FP_EXACT_MAX_METERS)
      ) {
        union(i, j);
        continue;
      }
      if (tripletAllowsMerge(toDedupePoint(rows[i]), toDedupePoint(rows[j]))) union(i, j);
    }
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r)!.push(i);
  }

  const out: LocationData[] = [];
  for (const idxs of byRoot.values()) {
    if (idxs.length === 1) {
      out.push(rows[idxs[0]]);
      continue;
    }
    const sub = idxs.map((i) => rows[i]);
    const sortedHandles = sub.map((r) => r.handle).sort();
    const inDb = sortedHandles.filter((h) => inDbHandles.has(h));
    const canonical = inDb.length ? inDb[0] : sortedHandles[0];
    const ordered = sub.slice().sort((a, b) => a.handle.localeCompare(b.handle));
    let anchorIdx = ordered.findIndex((r) => r.handle === canonical);
    if (anchorIdx < 0) anchorIdx = 0;
    let folded: LocationData = { ...ordered[anchorIdx], handle: canonical };
    for (let k = 0; k < ordered.length; k++) {
      if (k === anchorIdx) continue;
      const r = ordered[k];
      const snap = { brands: folded.brands, customBrands: folded.customBrands, phone: folded.phone };
      folded = { ...mergeRow(snap, r), handle: canonical };
    }
    out.push(folded);
  }
  return out;
}

/** Compare an incoming parsed row against what's already in the DB. */
function classifyLocationChange(
  incoming: LocationData,
  existing: ExistingLocationSnapshot
): { brandsChanged: boolean; addressChanged: boolean; infoChanged: boolean } {
  const norm = (v: string | null | undefined) => (v ?? '').trim();
  const normLower = (v: string | null | undefined) => norm(v).toLowerCase();

  const brandsChanged =
    norm(incoming.brands) !== norm(existing.brands) ||
    norm(incoming.customBrands) !== norm(existing.customBrands);

  const addressChanged =
    normLower(incoming.addressLine1) !== normLower(existing.addressLine1) ||
    normLower(incoming.addressLine2) !== normLower(existing.addressLine2) ||
    normLower(incoming.city) !== normLower(existing.city) ||
    normLower(incoming.stateProvinceRegion) !== normLower(existing.stateProvinceRegion) ||
    normLower(incoming.country) !== normLower(existing.country) ||
    norm(incoming.postalCode) !== norm(existing.postalCode);

  const infoChanged =
    norm(incoming.name) !== norm(existing.name) ||
    norm(incoming.website) !== norm(existing.website) ||
    norm(incoming.email) !== norm(existing.email);

  return { brandsChanged, addressChanged, infoChanged };
}

export interface MasterRecordsResult {
  columns: string[];
  records: Record<string, string>[];
  totalCount: number;
}

export type { MasterExportFilters };

export const storeService = {
  /** Get master store records from the DB, optionally filtered by brand / country / premium. */
  async getMasterRecords(filters?: MasterExportFilters): Promise<MasterRecordsResult> {
    const where = buildMasterExportWhere(filters);

    const locations = await prisma.location.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    const records = locations.map(locationToCSVRow);
    const columns = records.length > 0 ? Object.keys(records[0]) : [];
    return { columns, records, totalCount: records.length };
  },

  /**
   * Distinct `Location.country` values for the master-data UI dropdown.
   * When `brand` is set, uses the same legacy brand text match as exports / public API.
   * When `premiumOnly`, restricts to premium locations (combines with brand when both set).
   */
  async listDistinctCountriesForMasterFilter(filters?: {
    brand?: string;
    premiumOnly?: boolean;
  }): Promise<string[]> {
    const clauses: Prisma.LocationWhereInput[] = [];
    const brand = filters?.brand?.trim();
    if (brand) clauses.push(legacyBrandTextFilterWhere(brand));
    if (filters?.premiumOnly) clauses.push({ isPremium: true });
    const where: Prisma.LocationWhereInput =
      clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0]! : { AND: clauses };

    const rows = await prisma.location.findMany({
      where,
      select: { country: true },
      distinct: ['country'],
      orderBy: { country: 'asc' },
    });
    return rows.map((r) => r.country).filter((c) => typeof c === 'string' && c.trim() !== '');
  },

  /**
   * Fetch Location rows for a specific upload from the DB, mapped back to CSV-column
   * keyed records so the frontend receives the same shape as a CSV read.
   * Returns an empty array if no rows are linked to the given uploadId.
   */
  async getLocationsByUploadId(uploadId: string): Promise<Record<string, string>[]> {
    const locations = await prisma.location.findMany({
      where: { uploadId },
      orderBy: { name: 'asc' },
    });
    return locations.map(locationToCSVRow);
  },

  /**
   * Batch upsert Location rows into PostgreSQL.
   * - Converts each record via parseRowToLocationData (skips invalid rows).
   * - Preserves existing isPremium values; re-applies from PremiumStore for
   *   any handle that matches.
   * - Optionally stamps all rows with an uploadId.
   * - failFast: true (default) — one transaction per batch ({@link BATCH_SIZE} rows); on failure falls back to per-row upserts for that batch.
   * - failFast: false — per-row upsert with try/catch for every row.
   * - requireCompleteForDb — only rows passing isRowCompleteForDb are upserted (incomplete stay on CSV only).
   * - mergeOnUpdate — union brands with existing; intra-batch collapse. Scraper: keep DB phone. Manual: use mergeKind `manual` so CSV phone applies when non-empty.
   *   Dedupe before insert: same rounded coords + country; address fingerprint + city + country; containment;
   *   name-aware proximity (name narrows candidates; city + address agreement decides the merge);
   *   plus intra-batch collapse when mergeOnUpdate is true.
   */
  async batchUpsertLocations(
    records: Record<string, string>[],
    uploadId?: string,
    options?: {
      failFast?: boolean;
      requireCompleteForDb?: boolean;
      mergeOnUpdate?: boolean;
      mergeKind?: BatchUpsertMergeKind;
    }
  ): Promise<UpsertResult> {
    const failFast = options?.failFast !== false;
    const requireComplete = options?.requireCompleteForDb === true;
    const mergeOnUpdate = options?.mergeOnUpdate === true;
    const mergeKind: BatchUpsertMergeKind = options?.mergeKind ?? 'scraper';

    let working = records;
    let skippedIncomplete = 0;
    if (requireComplete) {
      working = records.filter(isRowCompleteForDb);
      skippedIncomplete = records.length - working.length;
    }

    const parsed = working
      .map(parseRowToLocationData)
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map(applyStableHandleToCompleteParsedRow);

    const skipped = skippedIncomplete + (working.length - parsed.length);
    if (parsed.length === 0) {
      return {
        upserted: 0,
        skipped,
        created: 0,
        updated: 0,
        unchanged: 0,
        newStores: [],
        brandsChanged: [],
        addressChanged: [],
        infoChanged: [],
        skippedIncomplete: requireComplete ? skippedIncomplete : undefined,
        affectedHandles: [],
      };
    }

    if (failFast) {
      const result = await storeService.batchUpsertLocationsFailFast(
        parsed,
        uploadId,
        skipped,
        mergeOnUpdate,
        mergeKind
      );
      return { ...result, skippedIncomplete: requireComplete ? skippedIncomplete : result.skippedIncomplete };
    }
    const result = await storeService.batchUpsertLocationsResilient(
      parsed,
      uploadId,
      skipped,
      mergeOnUpdate,
      mergeKind
    );
    return { ...result, skippedIncomplete: requireComplete ? skippedIncomplete : result.skippedIncomplete };
  },

  /** Batched transactions; per-batch fallback to per-row upserts on transaction failure. */
  async batchUpsertLocationsFailFast(
    parsed: LocationData[],
    uploadId: string | undefined,
    skipped: number,
    mergeOnUpdate: boolean,
    mergeKind: BatchUpsertMergeKind
  ): Promise<UpsertResult> {
    let upserted = 0;
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const newStores: string[] = [];
    const brandsChanged: string[] = [];
    const addressChanged: string[] = [];
    const infoChanged: string[] = [];
    const premiumHandles = new Set<string>();
    const dbErrors: string[] = [];
    let failed = 0;

    const mergeRow: MergeRowFn =
      mergeKind === 'manual' ? mergeLocationDataForManualImport : mergeLocationDataForUpdate;

    const affectedHandles = new Set<string>();

    const upsertPayload = (row: LocationData) => ({
      where: { handle: row.handle },
      update: {
        ...row,
        ...(uploadId ? { uploadId } : {}),
      },
      create: {
        ...row,
        ...(uploadId ? { uploadId } : {}),
      },
    });

    const tallyAfterUpsert = (row: LocationData, preExisting: ExistingLocationSnapshot | undefined) => {
      if (!preExisting) {
        newStores.push(row.name);
        created++;
      } else {
        const changes = classifyLocationChange(row, preExisting);
        if (changes.brandsChanged || changes.addressChanged || changes.infoChanged) {
          if (changes.brandsChanged) brandsChanged.push(row.name);
          if (changes.addressChanged) addressChanged.push(row.name);
          if (changes.infoChanged) infoChanged.push(row.name);
          updated++;
        } else {
          unchanged++;
        }
      }
    };

    for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
      const batch = parsed.slice(i, i + BATCH_SIZE);
      const batchHandles = batch.map((r) => r.handle);
      /** At most one create/update/unchanged tally per handle in this sub-batch (finalBatch can list a handle more than once). */
      const tallySeen = new Set<string>();

      const existingRecords = await prisma.location.findMany({
        where: { handle: { in: batchHandles } },
        select: existingSelect,
      });
      const existingMap = new Map(existingRecords.map((r) => [r.handle, r]));

      const coordCache = new Map<string, ExistingLocationSnapshot | null>();
      const fpCache = new Map<string, ExistingLocationSnapshot | null>();
      const handleRemap = new Map<string, ExistingLocationSnapshot>();

      for (const row of batch) {
        if (existingMap.has(row.handle)) continue;
        const match = await resolveExistingMatchForRow(row, coordCache, fpCache);
        if (match) {
          handleRemap.set(row.handle, match);
          existingMap.set(row.handle, match);
          logger.info(
            `[storeService] Dedupe merge: "${row.name}" (${row.handle}) → existing "${match.name}" (${match.handle})`
          );
        }
      }

      const mergedBatch = batch.map((row) => {
        const ex = existingMap.get(row.handle);
        const remapped = handleRemap.get(row.handle);
        const baseRow = ex && mergeOnUpdate ? mergeRow(ex, row) : row;
        return remapped ? { ...baseRow, handle: remapped.handle } : baseRow;
      });

      const inDbHandles = new Set(existingRecords.map((r) => r.handle));
      for (const m of handleRemap.values()) inDbHandles.add(m.handle);

      const finalBatch = mergeOnUpdate
        ? collapseBatchRowsByIdentity(mergedBatch, true, inDbHandles, mergeRow)
        : mergedBatch;

      const uniqueHandles = [...new Set(finalBatch.map((r) => r.handle))];
      const snapshots = await prisma.location.findMany({
        where: { handle: { in: uniqueHandles } },
        select: existingSelect,
      });
      const snapByHandle = new Map(snapshots.map((s) => [s.handle, s]));

      try {
        await prisma.$transaction(
          async (tx) => {
            for (const row of finalBatch) {
              await tx.location.upsert(upsertPayload(row));
            }
          },
          LOCATION_UPSERT_TRANSACTION_OPTIONS
        );
        for (const row of finalBatch) {
          premiumHandles.add(row.handle);
          affectedHandles.add(row.handle);
          if (tallySeen.has(row.handle)) continue;
          tallySeen.add(row.handle);
          const existing = snapByHandle.get(row.handle);
          if (!existing) {
            newStores.push(row.name);
            created++;
          } else {
            const changes = classifyLocationChange(row, existing);
            if (changes.brandsChanged || changes.addressChanged || changes.infoChanged) {
              if (changes.brandsChanged) brandsChanged.push(row.name);
              if (changes.addressChanged) addressChanged.push(row.name);
              if (changes.infoChanged) infoChanged.push(row.name);
              updated++;
            } else {
              unchanged++;
            }
          }
        }
        // Distinct locations written (finalBatch can list the same handle more than once after collapse).
        upserted += uniqueHandles.length;
      } catch (err: any) {
        logger.error(
          `[storeService] Batch transaction failed (${batch.length} input rows), per-row fallback:`,
          err.message
        );
        for (const row of finalBatch) {
          const preExisting = snapByHandle.get(row.handle);
          try {
            await prisma.location.upsert(upsertPayload(row));
            premiumHandles.add(row.handle);
            affectedHandles.add(row.handle);
            if (tallySeen.has(row.handle)) continue;
            tallySeen.add(row.handle);
            tallyAfterUpsert(row, preExisting);
            upserted++;
          } catch (rowErr: any) {
            failed++;
            dbErrors.push(`Error importing ${row.name || row.handle}: ${rowErr.message}`);
            logger.error(`[storeService] Fallback upsert failed for ${row.handle}:`, rowErr);
          }
        }
      }
    }

    await storeService.reapplyPremiumFlags([...premiumHandles]);

    const base = {
      upserted,
      skipped,
      created,
      updated,
      unchanged,
      newStores,
      brandsChanged,
      addressChanged,
      infoChanged,
    };
    if (dbErrors.length > 0 || failed > 0) {
      return { ...base, dbErrors, failed, affectedHandles: [...affectedHandles] };
    }
    return { ...base, affectedHandles: [...affectedHandles] };
  },

  /** Per-row upsert with try/catch so one bad row does not roll back the batch. */
  async batchUpsertLocationsResilient(
    parsed: LocationData[],
    uploadId: string | undefined,
    skipped: number,
    mergeOnUpdate: boolean,
    mergeKind: BatchUpsertMergeKind
  ): Promise<UpsertResult> {
    let upserted = 0;
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const newStores: string[] = [];
    const brandsChanged: string[] = [];
    const addressChanged: string[] = [];
    const infoChanged: string[] = [];
    const dbErrors: string[] = [];
    let failed = 0;
    const successfulHandles: string[] = [];

    const mergeRow: MergeRowFn =
      mergeKind === 'manual' ? mergeLocationDataForManualImport : mergeLocationDataForUpdate;

    const affectedHandles = new Set<string>();

    for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
      const batch = parsed.slice(i, i + BATCH_SIZE);
      const batchHandles = batch.map((r) => r.handle);
      const tallySeen = new Set<string>();

      const existingRecords = await prisma.location.findMany({
        where: { handle: { in: batchHandles } },
        select: existingSelect,
      });
      const existingMap = new Map(existingRecords.map((r) => [r.handle, r]));

      const coordCache = new Map<string, ExistingLocationSnapshot | null>();
      const fpCache = new Map<string, ExistingLocationSnapshot | null>();
      const handleRemap = new Map<string, ExistingLocationSnapshot>();

      for (const row of batch) {
        if (existingMap.has(row.handle)) continue;
        const match = await resolveExistingMatchForRow(row, coordCache, fpCache);
        if (match) {
          handleRemap.set(row.handle, match);
          existingMap.set(row.handle, match);
          logger.info(
            `[storeService] Dedupe merge: "${row.name}" (${row.handle}) → existing "${match.name}" (${match.handle})`
          );
        }
      }

      const mergedBatch = batch.map((row) => {
        const ex = existingMap.get(row.handle);
        const remapped = handleRemap.get(row.handle);
        const baseRow = ex && mergeOnUpdate ? mergeRow(ex, row) : row;
        return remapped ? { ...baseRow, handle: remapped.handle } : baseRow;
      });

      const inDbHandles = new Set(existingRecords.map((r) => r.handle));
      for (const m of handleRemap.values()) inDbHandles.add(m.handle);

      const finalBatch = mergeOnUpdate
        ? collapseBatchRowsByIdentity(mergedBatch, true, inDbHandles, mergeRow)
        : mergedBatch;

      const uniqueHandles = [...new Set(finalBatch.map((r) => r.handle))];
      const snapshots = await prisma.location.findMany({
        where: { handle: { in: uniqueHandles } },
        select: existingSelect,
      });
      const snapByHandle = new Map(snapshots.map((s) => [s.handle, s]));

      for (const row of finalBatch) {
        const preExisting = snapByHandle.get(row.handle);
        try {
          await prisma.$transaction(
            async (tx) => {
              await tx.location.upsert({
                where: { handle: row.handle },
                update: {
                  ...row,
                  ...(uploadId ? { uploadId } : {}),
                },
                create: {
                  ...row,
                  ...(uploadId ? { uploadId } : {}),
                },
              });
            },
            LOCATION_UPSERT_TRANSACTION_OPTIONS
          );
          affectedHandles.add(row.handle);
          if (tallySeen.has(row.handle)) continue;
          tallySeen.add(row.handle);
          successfulHandles.push(row.handle);
          upserted++;

          if (!preExisting) {
            newStores.push(row.name);
            created++;
          } else {
            const changes = classifyLocationChange(row, preExisting);
            if (changes.brandsChanged || changes.addressChanged || changes.infoChanged) {
              if (changes.brandsChanged) brandsChanged.push(row.name);
              if (changes.addressChanged) addressChanged.push(row.name);
              if (changes.infoChanged) infoChanged.push(row.name);
              updated++;
            } else {
              unchanged++;
            }
          }
        } catch (err: any) {
          failed++;
          dbErrors.push(`Error importing ${row.name || row.handle}: ${err.message}`);
          logger.error(`[storeService] Resilient upsert failed for ${row.handle}:`, err);
        }
      }
    }

    await storeService.reapplyPremiumFlags(successfulHandles);

    return {
      upserted,
      skipped,
      created,
      updated,
      unchanged,
      newStores,
      brandsChanged,
      addressChanged,
      infoChanged,
      dbErrors,
      failed,
      affectedHandles: [...affectedHandles],
    };
  },

  /**
   * Re-apply isPremium = true from PremiumStore for a specific set of handles.
   * No-ops when the handles array is empty.
   */
  async reapplyPremiumFlags(handles: string[]): Promise<void> {
    if (handles.length === 0) return;
    await prisma.$executeRaw`
      UPDATE "Location" l
      SET "isPremium" = true
      FROM "PremiumStore" ps
      WHERE l.handle = ps.handle
        AND l.handle = ANY(${handles}::text[])
    `;
  },

  /**
   * Update Location rows in the DB by Handle (or coordinate proximity fallback).
   * Each update is merged with the existing record so unspecified fields are preserved.
   * Returns counts for the DB operations and the updated rows in CSV-column format.
   */
  async updateMasterRecords(updates: Record<string, string>[]): Promise<{
    updatedCount: number;
    totalRequested: number;
    changedRows: Record<string, string>[];
    dbUpserted: number;
    dbSkipped: number;
  }> {
    let updatedCount = 0;
    const changedRows: Record<string, string>[] = [];

    for (const update of updates) {
      const handle = (update.Handle || update.handle || '').trim();
      const latStr = (update.Latitude || '').trim();
      const lonStr = (update.Longitude || '').trim();

      // Primary match: unique handle
      let existing = handle
        ? await prisma.location.findUnique({ where: { handle } })
        : null;

      // Fallback match: coordinate bounding-box proxy for ~50 m radius
      if (!existing && latStr && lonStr) {
        const lat = parseFloat(latStr);
        const lon = parseFloat(lonStr);
        if (!isNaN(lat) && !isNaN(lon)) {
          const lonTol = COORD_TOLERANCE_DEG / Math.cos((lat * Math.PI) / 180);
          existing = await prisma.location.findFirst({
            where: {
              latitude: { gte: lat - COORD_TOLERANCE_DEG, lte: lat + COORD_TOLERANCE_DEG },
              longitude: { gte: lon - lonTol, lte: lon + lonTol },
            },
          });
        }
      }

      if (!existing) continue;

      // Merge: convert existing DB record → CSV row, overlay update fields, parse back
      const mergedCsvRow = {
        ...locationToCSVRow(existing),
        ...update,
        Handle: existing.handle, // handle is immutable
      };
      const rowData = parseRowToLocationData(mergedCsvRow);
      if (!rowData) continue;

      await prisma.location.update({
        where: { handle: existing.handle },
        data: rowData,
      });

      changedRows.push(locationToCSVRow({ ...existing, ...rowData }));
      updatedCount++;
    }

    if (changedRows.length > 0) {
      const updatedHandles = changedRows.map((r) => r.Handle).filter(Boolean);
      await storeService.reapplyPremiumFlags(updatedHandles);
    }

    return {
      updatedCount,
      totalRequested: updates.length,
      changedRows,
      dbUpserted: updatedCount,
      dbSkipped: updates.length - updatedCount,
    };
  },

  /** Remove a single store from the Location table by handle */
  async deleteMasterRecord(handle: string): Promise<{ removed: boolean }> {
    const handleNorm = (handle || '').trim();
    const existing = await prisma.location.findUnique({ where: { handle: handleNorm } });
    if (!existing) return { removed: false };

    await prisma.location.delete({ where: { handle: handleNorm } });
    return { removed: true };
  },

  /**
   * Generate a CSV string from the Location table.
   * Optional filters: brand, country (same as locations API), premium-only.
   * The resulting CSV uses the same human-readable column headers as the original master CSV.
   */
  async generateDownloadCSV(filters?: MasterExportFilters): Promise<string> {
    const where = buildMasterExportWhere(filters);

    const locations = await prisma.location.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    const rows = locations.map(locationToCSVRow);
    return Papa.unparse(rows, { header: true });
  },
};
