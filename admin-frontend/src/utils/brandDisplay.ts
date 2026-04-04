/** Match backend `brand-display-name.ts` for Premium Stores filter + pills. */

const SUFFIXES = ['_stores', '_retailers', '_dealers', '_watches'] as const;

const DISPLAY_OVERRIDES: Record<string, string> = {
  'ALANGE SOEHNE': 'A. LANGE & SÖHNE',
  'BAUME ET MERCIER': 'BAUME & MERCIER',
  'BELL ROSS': 'BELL & ROSS',
};

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

/** Brands column: every token → display name (ALL CAPS, no _stores). */
export function parseBrandsForDisplay(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw.split(',').map((x) => x.trim()).filter(Boolean)) {
    const d = brandConfigIdToDisplayName(t);
    if (!d) continue;
    const k = d.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}

export function storeMatchesBrandFilter(
  rawBrands: string | null | undefined,
  selectedDisplay: string
): boolean {
  if (!selectedDisplay) return true;
  return parseBrandsForDisplay(rawBrands).includes(selectedDisplay);
}
