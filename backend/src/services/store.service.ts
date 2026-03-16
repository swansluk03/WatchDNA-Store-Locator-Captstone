/**
 * Store data service — master store data access.
 * All reads and writes go directly to the PostgreSQL Location table.
 * The DB is the single source of truth; CSVs are audit/input artifacts only.
 */

import Papa from 'papaparse';
import prisma from '../lib/prisma';
import { parseRowToLocationData, locationToCSVRow } from '../utils/csv-to-location';
import { logger } from '../utils/logger';

const BATCH_SIZE = 500;

/** Normalize brand config ID (e.g. omega_stores) to display format used in Brands column (e.g. OMEGA) */
function brandIdToDisplayName(brandId: string): string {
  let name = brandId
    .replace(/_stores$/, '')
    .replace(/_retailers$/, '')
    .replace(/_dealers$/, '')
    .replace(/_/g, ' ')
    .toUpperCase();
  const mappings: Record<string, string> = {
    'ALANGE SOEHNE': 'A. LANGE & SÖHNE',
    'BAUME ET MERCIER': 'BAUME & MERCIER',
    'BELL ROSS': 'BELL & ROSS',
  };
  return mappings[name] ?? name;
}


export interface MasterRecordsResult {
  columns: string[];
  records: Record<string, string>[];
  totalCount: number;
}

export const storeService = {
  /** Get master store records from the DB, optionally filtered by brand */
  async getMasterRecords(brandFilter?: string): Promise<MasterRecordsResult> {
    const displayFilter = brandFilter?.trim()
      ? brandIdToDisplayName(brandFilter.trim())
      : undefined;

    const where = displayFilter
      ? {
          OR: [
            { brands: { contains: displayFilter } },
            { customBrands: { contains: displayFilter } },
          ],
        }
      : {};

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
   * Returns counts of upserted and skipped rows.
   */
  async batchUpsertLocations(
    records: Record<string, string>[],
    uploadId?: string
  ): Promise<{ upserted: number; skipped: number }> {
    const parsed = records
      .map(parseRowToLocationData)
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const skipped = records.length - parsed.length;
    if (parsed.length === 0) return { upserted: 0, skipped };

    let upserted = 0;

    for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
      const batch = parsed.slice(i, i + BATCH_SIZE);

      await prisma.$transaction(
        batch.map((row) =>
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

    // Re-apply premium flags for just the handles we touched
    const handles = parsed.map((r) => r.handle);
    await storeService.reapplyPremiumFlags(handles);

    return { upserted, skipped };
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
    // ~50 metres expressed as degrees of latitude
    const COORD_TOLERANCE_DEG = 0.00045;
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
    const displayFilter = brandFilter?.trim()
      ? brandIdToDisplayName(brandFilter.trim())
      : undefined;

    const where = displayFilter
      ? {
          OR: [
            { brands: { contains: displayFilter } },
            { customBrands: { contains: displayFilter } },
          ],
        }
      : {};

    const locations = await prisma.location.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    const rows = locations.map(locationToCSVRow);
    return Papa.unparse(rows, { header: true });
  },
};
