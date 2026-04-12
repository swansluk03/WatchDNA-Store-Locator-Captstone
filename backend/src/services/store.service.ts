/**
 * Store data service — master store data access.
 * All reads and writes go directly to the PostgreSQL Location table.
 * The DB is the single source of truth; CSVs are audit/input artifacts only.
 */

import Papa from 'papaparse';
import prisma from '../lib/prisma';
import { parseRowToLocationData, locationToCSVRow, type LocationData } from '../utils/csv-to-location';
import { isRowCompleteForDb } from '../utils/row-completeness';
import { mergeLocationDataForUpdate } from '../utils/merge-location-update';
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
  PROXIMITY_MERGE_SIMILAR_NAME_MAX_METERS,
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

const BATCH_SIZE = 500;

/** ~50 metres expressed as degrees of latitude — matches the tolerance in updateMasterRecords. */
const COORD_TOLERANCE_DEG = 0.00045;

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
 * Nearest existing Location within {@link PROXIMITY_MERGE_MAX_METERS} and same normalized country.
 * Distance-ranked (unlike findFirst in a small box) so geocode drift and dense retail behave predictably.
 *
 * When `incomingName` is provided and the strict radius finds nothing, a second pass checks within
 * {@link PROXIMITY_MERGE_NAME_MATCH_MAX_METERS} but only for candidates whose name normalizes to the
 * same alnum key. A third pass uses {@link namesSimilarForDedupe} within
 * {@link PROXIMITY_MERGE_SIMILAR_NAME_MAX_METERS} for "Inc." / department-store name variants at the
 * same building where address fingerprints still differ.
 */
async function findNearestLocationForDedupe(
  lat: number,
  lon: number,
  country: string,
  incomingName?: string
): Promise<ExistingLocationSnapshot | null> {
  if (isUnusableScraperCoordinate(lat, lon)) return null;

  const queryRadius = incomingName
    ? PROXIMITY_MERGE_SIMILAR_NAME_MAX_METERS
    : PROXIMITY_MERGE_MAX_METERS;
  const box = boundingBoxForRadiusMeters(lat, lon, queryRadius);
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

  // Primary pass: strict 75 m radius, no name requirement.
  const nearest = pickNearestWithin(sameCountry, lat, lon, PROXIMITY_MERGE_MAX_METERS);
  if (nearest) {
    const { latitude: _lat, longitude: _lon, ...snapshot } = nearest;
    return snapshot;
  }

  if (incomingName) {
    const normIncoming = normalizeNameForDedupe(incomingName);
    const nameMatched = sameCountry.filter(
      (c) => normalizeNameForDedupe(c.name) === normIncoming
    );
    const nameNearest = pickNearestWithin(nameMatched, lat, lon, PROXIMITY_MERGE_NAME_MATCH_MAX_METERS);
    if (nameNearest) {
      logger.info(
        `[storeService] Name-match dedupe (${PROXIMITY_MERGE_NAME_MATCH_MAX_METERS}m): ` +
          `"${incomingName}" → existing "${nameNearest.name}" (${nameNearest.handle})`
      );
      const { latitude: _lat, longitude: _lon, ...snapshot } = nameNearest;
      return snapshot;
    }

    const similarMatched = sameCountry.filter((c) => namesSimilarForDedupe(incomingName, c.name));
    const similarNearest = pickNearestWithin(
      similarMatched,
      lat,
      lon,
      PROXIMITY_MERGE_SIMILAR_NAME_MAX_METERS
    );
    if (similarNearest) {
      logger.info(
        `[storeService] Similar-name dedupe (${PROXIMITY_MERGE_SIMILAR_NAME_MAX_METERS}m): ` +
          `"${incomingName}" → existing "${similarNearest.name}" (${similarNearest.handle})`
      );
      const { latitude: _lat, longitude: _lon, ...snapshot } = similarNearest;
      return snapshot;
    }
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
 * Existing row with same coordinates rounded to 5 dp and same country (scrapers often drift only in address text / handle hash).
 */
async function findByRoundedCoords(
  lat: number,
  lon: number,
  country: string
): Promise<ExistingLocationSnapshot | null> {
  if (isUnusableScraperCoordinate(lat, lon)) return null;
  const c = normalizeCountry(country);
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
  const nearest = pickNearestWithin(rows, lat, lon, PROXIMITY_MERGE_MAX_METERS * 2);
  return matchRowToSnapshot(nearest ?? rows[0]);
}

/**
 * Existing row with same normalized address line1 fingerprint + city + country as analyze-duplicate-locations.ts.
 */
async function findByAddressFingerprint(
  fpRaw: string,
  fpDeduped: string,
  city: string,
  country: string,
  lat: number,
  lon: number
): Promise<ExistingLocationSnapshot | null> {
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
  if (rows.length === 1) {
    // Guard: if both sides have valid coordinates, reject matches that are too far apart.
    // Prevents "23 High St" in one district merging with "23 High St" across the same city.
    const r = rows[0];
    if (
      !isUnusableScraperCoordinate(lat, lon) &&
      !isUnusableScraperCoordinate(r.latitude, r.longitude) &&
      haversineDistanceMeters(lat, lon, r.latitude, r.longitude) > ADDRESS_FP_EXACT_MAX_METERS
    ) {
      return null;
    }
    return matchRowToSnapshot(r);
  }
  // Multiple candidates with the same fingerprint: pick the nearest within the guard radius.
  // Do NOT fall back to rows[0] — if nothing is close enough, it is safer to create a new record.
  const nearest = pickNearestWithin(rows, lat, lon, ADDRESS_FP_EXACT_MAX_METERS);
  return nearest ? matchRowToSnapshot(nearest) : null;
}

/**
 * Same city + country, and one address fingerprint contains the other (e.g. "marinamall" vs "marinamall18st").
 * Stricter than analyze "similar pairs"; requires min length to reduce false merges.
 */
async function findByContainedFingerprint(
  fpRaw: string,
  fpDeduped: string,
  city: string,
  country: string,
  lat: number,
  lon: number
): Promise<ExistingLocationSnapshot | null> {
  if (
    Math.max(fpRaw.length, fpDeduped.length) < MIN_ADDRESS_FP_CONTAIN_LEN ||
    isUnusableScraperCoordinate(lat, lon)
  ) {
    return null;
  }
  const c = normalizeCountry(country);
  const cityNormContain = city.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
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
  if (filtered.length === 1) {
    // Guard: contained fingerprints are a weaker signal than exact matches, so use a tighter radius.
    const r = filtered[0];
    if (
      !isUnusableScraperCoordinate(lat, lon) &&
      !isUnusableScraperCoordinate(r.latitude, r.longitude) &&
      haversineDistanceMeters(lat, lon, r.latitude, r.longitude) > ADDRESS_FP_CONTAIN_MAX_METERS
    ) {
      return null;
    }
    return matchRowToSnapshot(r);
  }
  // Multiple containment candidates: pick nearest within the contain radius.
  // Do NOT fall back to filtered[0] — if nothing is close enough, create a new record.
  const nearest = pickNearestWithin(filtered, lat, lon, ADDRESS_FP_CONTAIN_MAX_METERS);
  return nearest ? matchRowToSnapshot(nearest) : null;
}

async function resolveExistingMatchForRow(
  row: LocationData,
  coordCache: Map<string, ExistingLocationSnapshot | null>,
  fpCache: Map<string, ExistingLocationSnapshot | null>
): Promise<ExistingLocationSnapshot | null> {
  const c = normalizeCountry(row.country);
  const coordKey = `${row.latitude.toFixed(5)}|${row.longitude.toFixed(5)}|${c}`;
  if (!coordCache.has(coordKey)) {
    const hit = await findByRoundedCoords(row.latitude, row.longitude, row.country);
    coordCache.set(coordKey, hit);
  }
  const coordHit = coordCache.get(coordKey);
  if (coordHit) return coordHit;

  const fp = addressFingerprintLine1(row.addressLine1);
  const fpDed = dedupeAddressFingerprint(row.addressLine1);
  if (Math.max(fp.length, fpDed.length) >= 6) {
    const fpKey = `${fp}|${fpDed}|${row.city.trim().toLowerCase()}|${c}`;
    if (!fpCache.has(fpKey)) {
      let hit = await findByAddressFingerprint(
        fp,
        fpDed,
        row.city,
        row.country,
        row.latitude,
        row.longitude
      );
      if (!hit) {
        hit = await findByContainedFingerprint(
          fp,
          fpDed,
          row.city,
          row.country,
          row.latitude,
          row.longitude
        );
      }
      fpCache.set(fpKey, hit);
    }
    const fpHit = fpCache.get(fpKey);
    if (fpHit) return fpHit;
  }

  return findNearestLocationForDedupe(row.latitude, row.longitude, row.country, row.name);
}

/**
 * Merge multiple incoming rows in one batch that target the same place (same 5dp coords or same address fingerprint + city + country).
 */
function collapseBatchRowsByIdentity(
  rows: LocationData[],
  mergeOnUpdate: boolean,
  inDbHandles: Set<string>
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
      if (coordKey(rows[i]) === coordKey(rows[j])) union(i, j);
      else if (
        dedupeAddressFingerprint(rows[i].addressLine1).length >= 6 &&
        addrKey(rows[i]) === addrKey(rows[j])
      ) {
        union(i, j);
      } else if (
        rows[i].city.trim().toLowerCase() === rows[j].city.trim().toLowerCase() &&
        countriesMatchForDedupe(rows[i].country, rows[j].country)
      ) {
        const di = dedupeAddressFingerprint(rows[i].addressLine1);
        const dj = dedupeAddressFingerprint(rows[j].addressLine1);
        if (safeAddressFingerprintContainment(di, dj)) {
          union(i, j);
        }
      } else if (
        countriesMatchForDedupe(rows[i].country, rows[j].country) &&
        namesSimilarForDedupe(rows[i].name, rows[j].name) &&
        !isUnusableScraperCoordinate(rows[i].latitude, rows[i].longitude) &&
        !isUnusableScraperCoordinate(rows[j].latitude, rows[j].longitude) &&
        haversineDistanceMeters(
          rows[i].latitude,
          rows[i].longitude,
          rows[j].latitude,
          rows[j].longitude
        ) <= PROXIMITY_MERGE_SIMILAR_NAME_MAX_METERS
      ) {
        union(i, j);
      }
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
      folded = { ...mergeLocationDataForUpdate(snap, r), handle: canonical };
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
   * - failFast: true (default) — one transaction per 500-row batch (scraper jobs).
   * - failFast: false — per-row upsert with try/catch (manual CSV upload parity).
   * - requireCompleteForDb — only rows passing isRowCompleteForDb are upserted (incomplete stay on CSV only).
   * - mergeOnUpdate — scraper/job saves: union brands; phone is never overwritten (DB value kept). Manual CSV uploads omit merge.
   *   Dedupe before insert (mergeOnUpdate): same rounded coords + country; exact address fingerprint + city + country;
   *   fingerprint substring (same city/country, min length); proximity (strict then name then similar-name);
   *   plus intra-batch collapse (coords, address keys, containment, similar name + close coordinates).
   */
  async batchUpsertLocations(
    records: Record<string, string>[],
    uploadId?: string,
    options?: { failFast?: boolean; requireCompleteForDb?: boolean; mergeOnUpdate?: boolean }
  ): Promise<UpsertResult> {
    const failFast = options?.failFast !== false;
    const requireComplete = options?.requireCompleteForDb === true;
    const mergeOnUpdate = options?.mergeOnUpdate === true;

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
      };
    }

    if (failFast) {
      const result = await storeService.batchUpsertLocationsFailFast(
        parsed,
        uploadId,
        skipped,
        mergeOnUpdate
      );
      return { ...result, skippedIncomplete: requireComplete ? skippedIncomplete : result.skippedIncomplete };
    }
    const result = await storeService.batchUpsertLocationsResilient(
      parsed,
      uploadId,
      skipped,
      mergeOnUpdate
    );
    return { ...result, skippedIncomplete: requireComplete ? skippedIncomplete : result.skippedIncomplete };
  },

  /** Scraper path: batched transactions for throughput. */
  async batchUpsertLocationsFailFast(
    parsed: LocationData[],
    uploadId: string | undefined,
    skipped: number,
    mergeOnUpdate: boolean
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

    for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
      const batch = parsed.slice(i, i + BATCH_SIZE);
      const batchHandles = batch.map((r) => r.handle);

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
        const baseRow = ex && mergeOnUpdate ? mergeLocationDataForUpdate(ex, row) : row;
        return remapped ? { ...baseRow, handle: remapped.handle } : baseRow;
      });

      const inDbHandles = new Set(existingRecords.map((r) => r.handle));
      for (const m of handleRemap.values()) inDbHandles.add(m.handle);

      const finalBatch = mergeOnUpdate
        ? collapseBatchRowsByIdentity(mergedBatch, true, inDbHandles)
        : mergedBatch;

      const uniqueHandles = [...new Set(finalBatch.map((r) => r.handle))];
      const snapshots = await prisma.location.findMany({
        where: { handle: { in: uniqueHandles } },
        select: existingSelect,
      });
      const snapByHandle = new Map(snapshots.map((s) => [s.handle, s]));

      for (const row of finalBatch) {
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

      for (const h of finalBatch.map((r) => r.handle)) premiumHandles.add(h);

      await prisma.$transaction(
        finalBatch.map((row) =>
          prisma.location.upsert({
            where: { handle: row.handle },
            update: {
              ...row,
              ...(uploadId ? { uploadId } : {}),
            },
            create: {
              ...row,
              ...(uploadId ? { uploadId } : {}),
            },
          })
        )
      );

      upserted += batch.length;
    }

    await storeService.reapplyPremiumFlags([...premiumHandles]);

    return { upserted, skipped, created, updated, unchanged, newStores, brandsChanged, addressChanged, infoChanged };
  },

  /** Manual upload path: per-row upsert so one bad row does not roll back the batch. */
  async batchUpsertLocationsResilient(
    parsed: LocationData[],
    uploadId: string | undefined,
    skipped: number,
    mergeOnUpdate: boolean
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

    for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
      const batch = parsed.slice(i, i + BATCH_SIZE);
      const batchHandles = batch.map((r) => r.handle);

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
        const baseRow = ex && mergeOnUpdate ? mergeLocationDataForUpdate(ex, row) : row;
        return remapped ? { ...baseRow, handle: remapped.handle } : baseRow;
      });

      const inDbHandles = new Set(existingRecords.map((r) => r.handle));
      for (const m of handleRemap.values()) inDbHandles.add(m.handle);

      const finalBatch = mergeOnUpdate
        ? collapseBatchRowsByIdentity(mergedBatch, true, inDbHandles)
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
          await prisma.location.upsert({
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
