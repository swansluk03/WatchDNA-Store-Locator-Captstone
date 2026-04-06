/**
 * Merge Location rows that share the same dedupe address fingerprint (St vs Street, etc.),
 * same city, and same country, OR that are within a geo-proximity radius (catches transliteration
 * address variants). Phone differences never block merges — the survivor's phone is kept.
 *
 * Usage:
 *   npx ts-node src/scripts/merge-address-duplicate-locations.ts
 *   npx ts-node src/scripts/merge-address-duplicate-locations.ts --execute
 */

import 'dotenv/config';
import prisma from '../lib/prisma';
import { dedupeAddressFingerprint } from '../utils/address-dedupe';
import { normalizeBrandsCsvField } from '../utils/brand-display-name';
import { normalizeCountry } from '../utils/country';
import { haversineDistanceMeters, isUnusableScraperCoordinate } from '../utils/geo-dedupe';
import { mergeCommaSeparatedBrands } from '../utils/merge-location-update';

const execute = process.argv.includes('--execute');
/** Max coordinate spread (m) within an address-fingerprint group to allow merging. */
const MAX_GROUP_SPREAD_M = 500;
/**
 * Max distance (m) for geo-proximity grouping.
 * Kept tight (150 m) so only stores at the same physical building are merged —
 * different-floor or different-wing units in the same mall are within this range,
 * but genuinely separate branches on different streets are not.
 */
const GEO_PROXIMITY_M = 150;

type Loc = Awaited<ReturnType<typeof loadLocations>>[number];

function fingerprintGroupKey(loc: { addressLine1: string; city: string; country: string }): string {
  return `${dedupeAddressFingerprint(loc.addressLine1)}|${loc.city.trim().toLowerCase()}|${normalizeCountry(loc.country)}`;
}

/**
 * @param skipSpreadCheck - pass true for address-fingerprint groups where the address
 *   already guarantees same location; bad geocoding in one record shouldn't block the merge.
 */
function canMergeGroup(members: Loc[], skipSpreadCheck = false): boolean {
  if (members.length < 2) return false;
  if (skipSpreadCheck) return true;
  const usable = members.filter(
    (m) => !isUnusableScraperCoordinate(m.latitude, m.longitude)
  );
  if (usable.length < 2) return true;
  let maxD = 0;
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      maxD = Math.max(
        maxD,
        haversineDistanceMeters(
          usable[i]!.latitude,
          usable[i]!.longitude,
          usable[j]!.latitude,
          usable[j]!.longitude
        )
      );
    }
  }
  return maxD <= MAX_GROUP_SPREAD_M;
}

/** Normalize a store name for similarity comparison. */
function normalizeName(name: string | null): string {
  return (name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * True if two store names are similar enough to be considered the same store.
 * One normalized name must be a substring of the other (min 4 chars for the shorter).
 * This prevents merging "Omega Boutique" and "Breitling Boutique" that happen to be
 * in the same mall.
 */
function namesSimilarForGeoDedupe(nameA: string | null, nameB: string | null): boolean {
  const na = normalizeName(nameA);
  const nb = normalizeName(nameB);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (shorter.length < 4) return false;
  return longer.includes(shorter);
}

/**
 * Extract multi-digit street numbers from an address string.
 * Single digits are excluded to avoid false matches on unit/floor numbers.
 */
function extractStreetNumbers(addr: string): Set<string> {
  const matches = addr.match(/\b\d{2,}\b/g);
  return new Set(matches ?? []);
}

/**
 * True if both addresses share at least one street number, or if one (or both) has no
 * multi-digit numbers (in which case we cannot use numbers to distinguish them).
 * Prevents merging "1600 Water St" vs "5001 Expressway" — clearly different locations.
 */
function addressesShareStreetNumber(addrA: string, addrB: string): boolean {
  const numsA = extractStreetNumbers(addrA);
  const numsB = extractStreetNumbers(addrB);
  if (numsA.size === 0 || numsB.size === 0) return true;
  for (const n of numsA) {
    if (numsB.has(n)) return true;
  }
  return false;
}

/**
 * Build geo-proximity merge groups for stores whose addresses differ but are physically close
 * (e.g. same store with different transliterations of the street name). Only pairs that are:
 *   - not already captured by the address-fingerprint pass
 *   - within GEO_PROXIMITY_M metres
 *   - in the same country
 *   - have similar names (one contains the other)
 * are grouped.
 */
function buildGeoProximityGroups(all: Loc[], alreadyGroupedHandles: Set<string>): Loc[][] {
  const candidates = all.filter(
    (loc) =>
      !alreadyGroupedHandles.has(loc.handle) &&
      !isUnusableScraperCoordinate(loc.latitude, loc.longitude)
  );

  const n = candidates.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number {
    if (parent[i] !== i) parent[i] = find(parent[i]!);
    return parent[i]!;
  }
  function union(i: number, j: number) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (normalizeCountry(a.country) !== normalizeCountry(b.country)) continue;
      const dist = haversineDistanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);
      if (dist > GEO_PROXIMITY_M) continue;
      // Only merge if address fingerprints differ (same-fp pairs are already handled above)
      if (dedupeAddressFingerprint(a.addressLine1) === dedupeAddressFingerprint(b.addressLine1)) continue;
      // Require name similarity to avoid merging different stores in the same building
      if (!namesSimilarForGeoDedupe(a.name, b.name)) continue;
      // Require at least one shared street number (prevents "1600 Water St" vs "5001 Expressway")
      if (!addressesShareStreetNumber(a.addressLine1, b.addressLine1)) continue;
      union(i, j);
    }
  }

  const byRoot = new Map<number, Loc[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r)!.push(candidates[i]!);
  }

  return [...byRoot.values()].filter((g) => g.length >= 2);
}

function brandFieldLength(s: string | null): number {
  return (s ?? '').split(',').filter((x) => x.trim()).length;
}

function sortSurvivorFirst(a: Loc, b: Loc): number {
  if (a.isPremium !== b.isPremium) return a.isPremium ? -1 : 1;
  const ba = brandFieldLength(a.brands) + brandFieldLength(a.customBrands);
  const bb = brandFieldLength(b.brands) + brandFieldLength(b.customBrands);
  if (ba !== bb) return bb - ba;
  const na = (a.name ?? '').trim().length;
  const nb = (b.name ?? '').trim().length;
  if (na !== nb) return nb - na;
  const t = b.updatedAt.getTime() - a.updatedAt.getTime();
  if (t !== 0) return t;
  return a.handle.localeCompare(b.handle);
}

async function loadLocations() {
  return prisma.location.findMany({ orderBy: { handle: 'asc' } });
}

function buildMergePlan(groups: Loc[][], label: string, skipSpreadCheck = false): Plan[] {
  const plans: Plan[] = [];
  for (const members of groups) {
    if (!canMergeGroup(members, skipSpreadCheck)) continue;
    const sorted = [...members].sort(sortSurvivorFirst);
    const keep = sorted[0]!;
    const remove = sorted.slice(1);
    let brands = normalizeBrandsCsvField(keep.brands);
    let customBrands = keep.customBrands ?? null;
    let tags = keep.tags ?? null;
    let name = (keep.name ?? '').trim();
    for (const r of remove) {
      brands = mergeCommaSeparatedBrands(brands, normalizeBrandsCsvField(r.brands));
      customBrands = mergeCommaSeparatedBrands(customBrands, r.customBrands);
      tags = mergeCommaSeparatedBrands(tags, r.tags);
      const rn = (r.name ?? '').trim();
      if (rn.length > name.length) name = rn;
    }
    plans.push({ keep, remove, mergedBrands: brands, mergedCustom: customBrands, mergedTags: tags, name, label });
  }
  return plans;
}

type Plan = {
  keep: Loc;
  remove: Loc[];
  mergedBrands: string | null;
  mergedCustom: string | null;
  mergedTags: string | null;
  name: string;
  label: string;
};

async function main() {
  console.log(execute ? 'MODE: EXECUTE (writes to DB)\n' : 'MODE: DRY-RUN (no writes)\n');

  const all = await loadLocations();

  // --- Pass 1: address-fingerprint groups (same deduped fp + city + country) ---
  const byKey = new Map<string, Loc[]>();
  for (const loc of all) {
    const fp = dedupeAddressFingerprint(loc.addressLine1);
    if (fp.length < 6) continue;
    const k = fingerprintGroupKey(loc);
    const list = byKey.get(k) ?? [];
    list.push(loc);
    byKey.set(k, list);
  }
  const fpGroups = [...byKey.values()].filter((g) => g.length >= 2);
  const fpPlans = buildMergePlan(fpGroups, 'address-fingerprint', true);

  // Collect handles already covered by address-fingerprint plans
  const alreadyGrouped = new Set<string>();
  for (const p of fpPlans) {
    alreadyGrouped.add(p.keep.handle);
    for (const r of p.remove) alreadyGrouped.add(r.handle);
  }

  // --- Pass 2: geo-proximity groups (same country, within GEO_PROXIMITY_M, different fp) ---
  const geoGroups = buildGeoProximityGroups(all, alreadyGrouped);
  const geoPlans = buildMergePlan(geoGroups, 'geo-proximity');

  const plans = [...fpPlans, ...geoPlans];

  console.log(
    `Address-fingerprint merge groups (coords ≤ ${MAX_GROUP_SPREAD_M}m): ${fpPlans.length}`
  );
  for (const m of fpPlans) {
    console.log(`\nKeep ${m.keep.handle} | remove: ${m.remove.map((r) => r.handle).join(', ')}`);
    console.log(`  ${m.keep.addressLine1} / ${m.name}`);
  }
  console.log(
    `\nGeo-proximity merge groups (≤ ${GEO_PROXIMITY_M}m, different address format): ${geoPlans.length}`
  );
  for (const m of geoPlans) {
    console.log(`\nKeep ${m.keep.handle} | remove: ${m.remove.map((r) => r.handle).join(', ')}`);
    console.log(`  [${m.label}] ${m.keep.addressLine1} / ${m.name}`);
    for (const r of m.remove) console.log(`    ← ${r.addressLine1} / ${r.name}`);
  }
  console.log(`\nTotal merge groups: ${plans.length}`);

  if (!execute) {
    console.log('\nPass --execute to merge into survivors and delete duplicate rows.');
    return;
  }

  for (const m of plans) {
    const loserHandles = m.remove.map((r) => r.handle);

    const survivorPrem = await prisma.premiumStore.findUnique({
      where: { handle: m.keep.handle },
    });
    const loserNotes: (string | null)[] = [];
    for (const r of m.remove) {
      const prem = await prisma.premiumStore.findUnique({ where: { handle: r.handle } });
      if (prem) loserNotes.push(prem.notes);
    }

    await prisma.premiumStore.deleteMany({ where: { handle: { in: loserHandles } } });

    if (!survivorPrem && loserNotes.length > 0) {
      await prisma.premiumStore.create({
        data: { handle: m.keep.handle, notes: loserNotes[0] ?? undefined },
      });
    }

    await prisma.location.update({
      where: { handle: m.keep.handle },
      data: {
        name: m.name,
        brands: m.mergedBrands,
        customBrands: m.mergedCustom,
        tags: m.mergedTags,
      },
    });

    await prisma.location.deleteMany({ where: { handle: { in: loserHandles } } });
  }

  const remaining = await prisma.location.count();
  console.log(`\nDone. Merged ${plans.length} groups. Locations remaining: ${remaining}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
