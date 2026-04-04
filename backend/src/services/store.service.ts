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
import { computeStableHandleFromRow } from '../utils/stable-handle';
import { logger } from '../utils/logger';
import { brandConfigIdToDisplayName } from '../utils/brand-display-name';

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
 * Find an existing Location within ~50 m of the given coordinates.
 * Returns the minimal snapshot needed for merging, or null if none found.
 */
async function findNearbyLocation(lat: number, lon: number): Promise<ExistingLocationSnapshot | null> {
  const lonTol = COORD_TOLERANCE_DEG / Math.cos((lat * Math.PI) / 180);
  return prisma.location.findFirst({
    where: {
      latitude: { gte: lat - COORD_TOLERANCE_DEG, lte: lat + COORD_TOLERANCE_DEG },
      longitude: { gte: lon - lonTol, lte: lon + lonTol },
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
    },
  });
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
    norm(incoming.phone) !== norm(existing.phone) ||
    norm(incoming.website) !== norm(existing.website) ||
    norm(incoming.email) !== norm(existing.email);

  return { brandsChanged, addressChanged, infoChanged };
}

function brandFilterWhere(brandFilter: string) {
  const raw = brandFilter.trim();
  const display = brandConfigIdToDisplayName(raw);
  const or: Array<{ brands?: object; customBrands?: object }> = [
    { brands: { contains: display, mode: 'insensitive' as const } },
    { customBrands: { contains: display, mode: 'insensitive' as const } },
  ];
  if (raw.toLowerCase() !== display.toLowerCase()) {
    or.push(
      { brands: { contains: raw, mode: 'insensitive' as const } },
      { customBrands: { contains: raw, mode: 'insensitive' as const } }
    );
  }
  return { OR: or };
}

export interface MasterRecordsResult {
  columns: string[];
  records: Record<string, string>[];
  totalCount: number;
}

export const storeService = {
  /** Get master store records from the DB, optionally filtered by brand */
  async getMasterRecords(brandFilter?: string): Promise<MasterRecordsResult> {
    const where = brandFilter?.trim() ? brandFilterWhere(brandFilter) : {};

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
   * - mergeOnUpdate — scraper/job saves: union brands and keep DB phone on conflict; manual uploads omit this.
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

    for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
      const batch = parsed.slice(i, i + BATCH_SIZE);
      const batchHandles = batch.map((r) => r.handle);

      const existingRecords = await prisma.location.findMany({
        where: { handle: { in: batchHandles } },
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
        },
      });
      const existingMap = new Map(existingRecords.map((r) => [r.handle, r]));

      // For rows whose handle wasn't found, check if a nearby record exists (~50 m).
      // If so, remap to the existing handle to prevent duplicates from minor address/GPS drift.
      const handleRemap = new Map<string, ExistingLocationSnapshot>();
      for (const row of batch) {
        if (!existingMap.has(row.handle)) {
          const nearby = await findNearbyLocation(row.latitude, row.longitude);
          if (nearby) {
            handleRemap.set(row.handle, nearby);
            existingMap.set(row.handle, nearby);
            logger.info(
              `[storeService] Proximity merge: "${row.name}" (${row.handle}) → existing "${nearby.name}" (${nearby.handle})`
            );
          }
        }
      }

      const mergedBatch = batch.map((row) => {
        const ex = existingMap.get(row.handle);
        const remapped = handleRemap.get(row.handle);
        const baseRow = ex && mergeOnUpdate ? mergeLocationDataForUpdate(ex, row) : row;
        return remapped ? { ...baseRow, handle: remapped.handle } : baseRow;
      });

      for (const row of mergedBatch) {
        const originalHandle = batch.find((b) => {
          const remap = handleRemap.get(b.handle);
          return (remap ? remap.handle : b.handle) === row.handle;
        })?.handle;
        const existing = originalHandle ? existingMap.get(originalHandle) : existingMap.get(row.handle);
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

      await prisma.$transaction(
        mergedBatch.map((row) =>
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

    const handles = parsed.map((r) => r.handle);
    await storeService.reapplyPremiumFlags(handles);

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
        },
      });
      const existingMap = new Map(existingRecords.map((r) => [r.handle, r]));

      // For rows whose handle wasn't found, check if a nearby record exists (~50 m).
      const handleRemap = new Map<string, ExistingLocationSnapshot>();
      for (const row of batch) {
        if (!existingMap.has(row.handle)) {
          const nearby = await findNearbyLocation(row.latitude, row.longitude);
          if (nearby) {
            handleRemap.set(row.handle, nearby);
            existingMap.set(row.handle, nearby);
            logger.info(
              `[storeService] Proximity merge: "${row.name}" (${row.handle}) → existing "${nearby.name}" (${nearby.handle})`
            );
          }
        }
      }

      const mergedBatch = batch.map((row) => {
        const ex = existingMap.get(row.handle);
        const remapped = handleRemap.get(row.handle);
        const baseRow = ex && mergeOnUpdate ? mergeLocationDataForUpdate(ex, row) : row;
        return remapped ? { ...baseRow, handle: remapped.handle } : baseRow;
      });

      for (const row of mergedBatch) {
        const originalHandle = batch.find((b) => {
          const remap = handleRemap.get(b.handle);
          return (remap ? remap.handle : b.handle) === row.handle;
        })?.handle;
        const snapshot = originalHandle ? existingMap.get(originalHandle) : existingMap.get(row.handle);
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

          if (!snapshot) {
            newStores.push(row.name);
            created++;
          } else {
            const changes = classifyLocationChange(row, snapshot);
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
   * Optionally filter by brand (matches against both `brands` and `customBrands` columns).
   * The resulting CSV uses the same human-readable column headers as the original master CSV.
   */
  async generateDownloadCSV(brandFilter?: string): Promise<string> {
    const where = brandFilter?.trim() ? brandFilterWhere(brandFilter) : {};

    const locations = await prisma.location.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    const rows = locations.map(locationToCSVRow);
    return Papa.unparse(rows, { header: true });
  },
};
