import crypto from 'crypto';
import { normalizeCountry } from './country';
import { normalizedCountryAndPhoneFromCsvRow } from './csv-to-location';
import { isRowCompleteForDb } from './row-completeness';

function norm(s: string | undefined | null): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Deterministic handle from address + city + country + rounded coordinates.
 * Same physical store should map to the same handle across scraper runs even when
 * the upstream id in the CSV changes.
 */
export function computeStableHandleFromRow(row: Record<string, string>): string {
  const lat = parseFloat(String(row.Latitude ?? ''));
  const lon = parseFloat(String(row.Longitude ?? ''));
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    throw new Error('stable handle requires valid coordinates');
  }
  const addr1 = norm(row['Address Line 1']);
  const addr2 = norm(row['Address Line 2']);
  const addressPart = addr1 || addr2 || '';
  const city = norm(row.City);
  const country = normalizeCountry(String(row.Country || '')).toLowerCase();
  const key = [addressPart, city, country, lat.toFixed(5), lon.toFixed(5)].join('|');
  return `loc_${crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 24)}`;
}

/**
 * Canonical Country + Phone on CSV-shaped rows via {@link normalizedCountryAndPhoneFromCsvRow}
 * (same code path as parseRowToLocationData / DB upsert).
 */
export function normalizeScraperFieldsForCsv(row: Record<string, string>): Record<string, string> {
  const { country, phone } = normalizedCountryAndPhoneFromCsvRow(row);
  const out = { ...row };
  if (Object.prototype.hasOwnProperty.call(row, 'Country')) {
    out.Country = country;
  }
  if (Object.prototype.hasOwnProperty.call(row, 'Phone')) {
    out.Phone = phone ?? '';
  }
  return out;
}

/**
 * For scraper job CSV + DB: normalize Country/Phone, then assign stable Handle when complete for DB.
 * Incomplete rows keep the source handle so editors can still see and fix them.
 */
export function normalizeScraperRowForCsv(row: Record<string, string>): Record<string, string> {
  const fields = normalizeScraperFieldsForCsv(row);
  if (!isRowCompleteForDb(fields)) return fields;
  try {
    return { ...fields, Handle: computeStableHandleFromRow(fields) };
  } catch {
    return fields;
  }
}

export function normalizeScraperRowsForCsv(rows: Record<string, string>[]): Record<string, string>[] {
  return rows.map(normalizeScraperRowForCsv);
}
