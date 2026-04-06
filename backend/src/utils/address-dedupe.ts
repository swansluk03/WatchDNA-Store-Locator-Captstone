/** Min length for substring-style address fingerprint matching. */
export const MIN_ADDRESS_FP_CONTAIN_LEN = 8;

const TRAILING_STREET_ABBREV: Record<string, string> = {
  st: 'street',
  ave: 'avenue',
  rd: 'road',
  blvd: 'boulevard',
  dr: 'drive',
  ln: 'lane',
  ct: 'court',
  pl: 'place',
  pkwy: 'parkway',
  cir: 'circle',
  hwy: 'highway',
  fwy: 'freeway',
  expy: 'expressway',
  sq: 'square',
  ter: 'terrace',
  trl: 'trail',
  aly: 'alley',
  bnd: 'bend',
  brg: 'bridge',
  holw: 'hollow',
  pt: 'point',
  xing: 'crossing',
};

/**
 * Expand trailing US-style street abbreviations so "513 Whitaker St" and "513 Whitaker Street"
 * share the same dedupe fingerprint. Requires a space before the token (end of line1).
 */
export function expandTrailingStreetAbbrevForDedupe(line1: string): string {
  const t = line1.trim().toLowerCase();
  return t.replace(/(\s)(st|ave|rd|blvd|dr|ln|ct|pl|pkwy|cir)\.?$/i, (_, sp: string, abbr: string) => {
    const full = TRAILING_STREET_ABBREV[abbr.toLowerCase()];
    return full ? `${sp}${full}` : `${sp}${abbr}`;
  });
}

/** ASCII alnum fingerprint after expanding trailing St/Ave/… (for dedupe equality). */
export function dedupeAddressFingerprint(line1: string): string {
  return expandTrailingStreetAbbrevForDedupe(line1).replace(/[^a-z0-9]+/g, '');
}

/**
 * True when one fingerprint plausibly extends the other (mall/suite text), not different street numbers.
 * Blocks e.g. "calleSerrano2" vs "calleSerrano26" (digit suffix only).
 */
export function safeAddressFingerprintContainment(fpA: string, fpB: string): boolean {
  if (fpA.length < MIN_ADDRESS_FP_CONTAIN_LEN || fpB.length < MIN_ADDRESS_FP_CONTAIN_LEN) {
    return false;
  }
  const [shorter, longer] = fpA.length <= fpB.length ? [fpA, fpB] : [fpB, fpA];
  if (!longer.includes(shorter)) return false;
  if (longer === shorter) return true;
  if (longer.startsWith(shorter)) {
    const rest = longer.slice(shorter.length);
    if (/\d$/.test(shorter) && /^\d+$/.test(rest)) return false;
  }
  return true;
}
