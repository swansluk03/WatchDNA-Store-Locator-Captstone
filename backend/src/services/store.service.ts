/**
 * Store data service - abstracts master store data access.
 * Currently uses CSV; designed for easy migration to PostgreSQL.
 */

import fs from 'fs';
import Papa from 'papaparse';
import uploadService from './upload.service';

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

/** Extract brand names from a store record (Brands + Custom Brands columns) */
function extractStoreBrands(store: Record<string, string>): Set<string> {
  const brands = new Set<string>();
  const brandsStr = (store['Brands'] ?? '').trim();
  if (brandsStr) {
    for (const b of brandsStr.split(',')) {
      const trimmed = b.trim().toUpperCase();
      if (trimmed) brands.add(trimmed);
    }
  }
  const customStr = (store['Custom Brands'] ?? '').trim();
  if (customStr) {
    const matches = customStr.match(/>([^<]+)<\/A>/gi);
    if (matches) {
      for (const m of matches) {
        const brand = m.replace(/^>|<\/A>$/gi, '').trim().toUpperCase();
        if (brand) brands.add(brand);
      }
    }
  }
  return brands;
}

/** Check if store has the given brand (case-insensitive, supports multi-brand) */
function storeHasBrand(store: Record<string, string>, brandFilter: string): boolean {
  const storeBrands = extractStoreBrands(store);
  const filterDisplay = brandIdToDisplayName(brandFilter);
  return storeBrands.has(filterDisplay);
}

export interface MasterRecordsResult {
  columns: string[];
  records: Record<string, string>[];
  totalCount: number;
}

export const storeService = {
  /** Get master store records, optionally filtered by brand */
  async getMasterRecords(brandFilter?: string): Promise<MasterRecordsResult> {
    const masterCsvPath = await uploadService.getMasterCSVPath();
    if (!masterCsvPath || !fs.existsSync(masterCsvPath)) {
      return { columns: [], records: [], totalCount: 0 };
    }

    const fileContent = fs.readFileSync(masterCsvPath, 'utf-8');
    const parseResult = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
    });

    const rows = (parseResult.data as Record<string, string>[]) ?? [];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    let filtered = rows;
    if (brandFilter && brandFilter.trim()) {
      const filterDisplay = brandIdToDisplayName(brandFilter.trim());
      filtered = rows.filter((r) => storeHasBrand(r, brandFilter.trim()));
    }

    return {
      columns,
      records: filtered,
      totalCount: filtered.length,
    };
  },

  /** Update rows in master store data (CSV for now; swap implementation for PostgreSQL) */
  async updateMasterRecords(updates: Record<string, string>[]): Promise<{
    updatedCount: number;
    totalRequested: number;
  }> {
    const COORD_MATCH_TOLERANCE_METERS = 50;
    const masterCsvPath = await uploadService.getMasterCSVPath();
    if (!masterCsvPath || !fs.existsSync(masterCsvPath)) {
      throw new Error('Master CSV not found');
    }

    const fileContent = fs.readFileSync(masterCsvPath, 'utf-8');
    const parseResult = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
    });

    const masterRows = parseResult.data as Record<string, string>[];
    let updatedCount = 0;

    for (const update of updates) {
      const handle = (update.Handle || update.handle || '').trim();
      const latStr = (update.Latitude || '').trim();
      const lonStr = (update.Longitude || '').trim();

      const idx = masterRows.findIndex((r) => {
        const rHandle = (r.Handle || '').trim();
        if (handle && rHandle === handle) return true;
        if (latStr && lonStr && r.Latitude && r.Longitude) {
          const rLat = parseFloat(r.Latitude);
          const rLon = parseFloat(r.Longitude);
          const lat = parseFloat(latStr);
          const lon = parseFloat(lonStr);
          if (!isNaN(lat) && !isNaN(lon) && !isNaN(rLat) && !isNaN(rLon)) {
            const dist = Math.hypot(
              (lat - rLat) * 111320,
              (lon - rLon) * 111320 * Math.cos((lat * Math.PI) / 180)
            );
            return dist <= COORD_MATCH_TOLERANCE_METERS;
          }
        }
        return false;
      });

      if (idx >= 0) {
        const schemaKeys = new Set(Object.keys(masterRows[0] || {}));
        const readonlyColumns = new Set(['Handle']);
        for (const [key, value] of Object.entries(update)) {
          if (
            value !== undefined &&
            schemaKeys.has(key) &&
            !readonlyColumns.has(key)
          ) {
            masterRows[idx][key] = String(value).trim();
          }
        }
        updatedCount++;
      }
    }

    const csvContent = Papa.unparse(masterRows);
    fs.writeFileSync(masterCsvPath, csvContent, 'utf-8');

    return { updatedCount, totalRequested: updates.length };
  },

  /** Remove a single store from master by Handle */
  async deleteMasterRecord(handle: string): Promise<{ removed: boolean }> {
    const masterCsvPath = await uploadService.getMasterCSVPath();
    if (!masterCsvPath || !fs.existsSync(masterCsvPath)) {
      throw new Error('Master CSV not found');
    }

    const fileContent = fs.readFileSync(masterCsvPath, 'utf-8');
    const parseResult = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
    });

    const masterRows = parseResult.data as Record<string, string>[];
    const handleNorm = (handle || '').trim();
    const idx = masterRows.findIndex((r) => (r.Handle || r.handle || '').trim() === handleNorm);

    if (idx < 0) {
      return { removed: false };
    }

    masterRows.splice(idx, 1);
    const csvContent = Papa.unparse(masterRows);
    fs.writeFileSync(masterCsvPath, csvContent, 'utf-8');
    return { removed: true };
  },
};
