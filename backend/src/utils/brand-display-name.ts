/**
 * Normalize brand config IDs (e.g. omega_stores, accutron_stores) to display labels
 * (e.g. OMEGA, ACCUTRON) for CSV Brands column, DB, and admin UI parity.
 */

const SUFFIXES = ['_stores', '_retailers', '_dealers', '_watches'] as const;

/** True if token looks like a brand config key accidentally stored in Tags. */
export function looksLikeBrandConfigId(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  return SUFFIXES.some((s) => t.toLowerCase().endsWith(s));
}

const DISPLAY_OVERRIDES: Record<string, string> = {
  'ALANGE SOEHNE': 'A. LANGE & SÖHNE',
  'BAUME ET MERCIER': 'BAUME & MERCIER',
  'BELL ROSS': 'BELL & ROSS',
};

/**
 * Single brand token or config id → ALL CAPS display name, no _stores suffix.
 */
export function brandConfigIdToDisplayName(brandId: string): string {
  let name = brandId.trim();
  if (!name) return '';
  for (const suf of SUFFIXES) {
    const low = name.toLowerCase();
    if (low.endsWith(suf)) {
      name = name.slice(0, -suf.length);
      break;
    }
  }
  name = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  return DISPLAY_OVERRIDES[name] ?? name;
}

/**
 * Comma-separated Brands column: each token normalized, case-insensitive dedupe.
 */
export function normalizeBrandsCsvField(raw: string | null | undefined): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const tokens = String(raw)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const display = brandConfigIdToDisplayName(t);
    if (!display) continue;
    const key = display.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(display);
  }
  return out.length ? out.join(', ') : null;
}

/**
 * Tags: only rewrite tokens that look like brand_* config ids; leave other tags as-is.
 */
export function normalizeTagsCsvField(raw: string | null | undefined): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const tokens = String(raw)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const out = tokens.map((t) => (looksLikeBrandConfigId(t) ? brandConfigIdToDisplayName(t) : t));
  return out.join(', ') || null;
}
