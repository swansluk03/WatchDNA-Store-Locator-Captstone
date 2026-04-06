import type { LocationData } from './csv-to-location';
import { normalizeBrandsCsvField } from './brand-display-name';

type ExistingSnapshot = {
  brands: string | null;
  customBrands: string | null;
  phone: string | null;
};

/**
 * Union comma-separated brand labels (case-insensitive dedupe, preserve first-seen casing).
 */
export function mergeCommaSeparatedBrands(a: string | null, b: string | null): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string | null) => {
    for (const part of (raw ?? '').split(',')) {
      const t = part.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  };
  add(a);
  add(b);
  return out.length ? out.join(', ') : null;
}

/**
 * Merge incoming scrape/job row into an existing Location.
 * Brands are unioned. Phone always stays the DB value — scrapes do not change it;
 * only manual admin edits (e.g. premium store editor) update phone.
 */
export function mergeLocationDataForUpdate(
  existing: ExistingSnapshot,
  incoming: LocationData
): LocationData {
  return {
    ...incoming,
    brands: mergeCommaSeparatedBrands(
      normalizeBrandsCsvField(existing.brands),
      normalizeBrandsCsvField(incoming.brands)
    ),
    customBrands: mergeCommaSeparatedBrands(existing.customBrands, incoming.customBrands),
    phone: existing.phone,
  };
}
