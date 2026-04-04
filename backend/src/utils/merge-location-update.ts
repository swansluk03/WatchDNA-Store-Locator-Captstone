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

/** Digits only for comparing phone numbers across formatting. */
export function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

/**
 * On update: keep DB phone when incoming is empty, or when both are non-empty but differ
 * (avoids a second brand scrape replacing a good number with a different API value).
 * When digits match (same number, possibly different formatting), prefer the incoming
 * value so that previously un-normalized numbers are upgraded to E.164 on the next scrape.
 */
export function mergePhoneOnUpdate(existing: string | null, incoming: string | null): string | null {
  const e = (existing ?? '').trim();
  const i = (incoming ?? '').trim();
  if (!i) return e || null;
  if (!e) return i;
  const de = phoneDigits(e);
  const di = phoneDigits(i);
  if (!de || !di) return e;
  // Same number — prefer incoming so E.164 format propagates on re-scrape.
  // A suffix match handles cases where existing lacks the country code prefix.
  const sameNumber = de === di || (de.length >= 7 && di.endsWith(de)) || (di.length >= 7 && de.endsWith(di));
  if (sameNumber) return i;
  // Different digits — keep existing to avoid overwriting with a wrong number.
  return e;
}

/**
 * Merge incoming scrape row into an existing Location so multi-brand scrapes add brands
 * without overwriting phone / merged brand list.
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
    phone: mergePhoneOnUpdate(existing.phone, incoming.phone),
  };
}
