/**
 * Geo-Verify Pipeline
 *
 * Runs coordinate verification (geocoding) for all stores of a given brand, then
 * performs a brand-scoped address-fingerprint + geo-proximity deduplication pass to
 * merge any stores whose coordinates were previously wrong and now resolve to the
 * same physical location.  Brand fields are unioned on the surviving row so no
 * brand association is lost.
 */

import prisma from '../lib/prisma';
import { dedupeAddressFingerprint } from '../utils/address-dedupe';
import { normalizeBrandsCsvField } from '../utils/brand-display-name';
import { normalizeCountry } from '../utils/country';
import {
  haversineDistanceMeters,
  isUnusableScraperCoordinate,
  namesSimilarForDedupe,
} from '../utils/geo-dedupe';
import { legacyBrandTextFilterWhere } from '../utils/legacy-brand-filter';
import { mergeCommaSeparatedBrands } from '../utils/merge-location-update';
import { verifyHandles, type VerifyHandlesSummary } from './coordinate-verification.service';

// ─── Task state (in-memory) ────────────────────────────────────────────────────

export type GeoVerifyPipelineResult = {
  coordinatesUpdated: number;
  verifiedStampOnly: number;
  geocodeFailed: number;
  errors: number;
  dedupMerged: number;
  locationsRemaining: number;
  elapsedSec: number;
};

export type GeoVerifyTask = {
  id: string;
  brandName: string;
  status: 'running' | 'done' | 'error';
  progress: { checked: number; total: number };
  phase: 'geocoding' | 'dedup' | 'done';
  log: string[];
  result?: GeoVerifyPipelineResult;
  error?: string;
  startedAt: Date;
};

/** Shared in-memory task registry — lives for the lifetime of the server process. */
export const geoVerifyTasks = new Map<string, GeoVerifyTask>();

// ─── Dedup helpers (brand-scoped) ────────────────────────────────────────────

const GEO_PROXIMITY_M = 150;
const MAX_GROUP_SPREAD_M = 500;

type StoreRow = {
  handle: string;
  name: string;
  brands: string | null;
  customBrands: string | null;
  tags: string | null;
  addressLine1: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  isPremium: boolean;
  updatedAt: Date;
};

type MergePlan = {
  keep: StoreRow;
  remove: StoreRow[];
  mergedBrands: string | null;
  mergedCustomBrands: string | null;
  mergedTags: string | null;
  mergedName: string;
};

function fingerprintGroupKey(loc: StoreRow): string {
  return `${dedupeAddressFingerprint(loc.addressLine1)}|${loc.city.trim().toLowerCase()}|${normalizeCountry(loc.country)}`;
}

function extractStreetNumbers(addr: string): Set<string> {
  const matches = addr.match(/\b\d{2,}\b/g);
  return new Set(matches ?? []);
}

function addressesShareStreetNumber(addrA: string, addrB: string): boolean {
  const numsA = extractStreetNumbers(addrA);
  const numsB = extractStreetNumbers(addrB);
  if (numsA.size === 0 || numsB.size === 0) return true;
  for (const n of numsA) if (numsB.has(n)) return true;
  return false;
}

function brandFieldCount(s: string | null): number {
  return (s ?? '').split(',').filter((x) => x.trim()).length;
}

function sortSurvivorFirst(a: StoreRow, b: StoreRow): number {
  if (a.isPremium !== b.isPremium) return a.isPremium ? -1 : 1;
  const ba = brandFieldCount(a.brands) + brandFieldCount(a.customBrands);
  const bb = brandFieldCount(b.brands) + brandFieldCount(b.customBrands);
  if (ba !== bb) return bb - ba;
  const na = (a.name ?? '').trim().length;
  const nb = (b.name ?? '').trim().length;
  if (na !== nb) return nb - na;
  const t = b.updatedAt.getTime() - a.updatedAt.getTime();
  if (t !== 0) return t;
  return a.handle.localeCompare(b.handle);
}

function buildMergePlanFromGroup(members: StoreRow[]): MergePlan {
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
  return { keep, remove, mergedBrands: brands, mergedCustomBrands: customBrands, mergedTags: tags, mergedName: name };
}

/**
 * Build merge plans for the given stores using:
 * - Pass 1: identical address fingerprint + city + country
 * - Pass 2: geo-proximity (≤150 m, different fp, similar name, shared street number)
 *
 * Brand fields are unioned across the group so no affiliation is lost.
 */
function buildBrandScopedDedupPlans(stores: StoreRow[]): MergePlan[] {
  const plans: MergePlan[] = [];
  const alreadyGrouped = new Set<string>();

  // Pass 1: address fingerprint groups
  const byKey = new Map<string, StoreRow[]>();
  for (const loc of stores) {
    const fp = dedupeAddressFingerprint(loc.addressLine1);
    if (fp.length < 6) continue;
    const k = fingerprintGroupKey(loc);
    const list = byKey.get(k) ?? [];
    list.push(loc);
    byKey.set(k, list);
  }
  for (const members of byKey.values()) {
    if (members.length < 2) continue;
    plans.push(buildMergePlanFromGroup(members));
    for (const m of members) alreadyGrouped.add(m.handle);
  }

  // Pass 2: geo-proximity groups (different address fingerprint, same country, ≤150 m)
  const candidates = stores.filter(
    (loc) => !alreadyGrouped.has(loc.handle) && !isUnusableScraperCoordinate(loc.latitude, loc.longitude)
  );
  const n = candidates.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]!);
    return parent[i]!;
  };
  const union = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (normalizeCountry(a.country) !== normalizeCountry(b.country)) continue;
      const dist = haversineDistanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);
      if (dist > GEO_PROXIMITY_M) continue;
      if (dedupeAddressFingerprint(a.addressLine1) === dedupeAddressFingerprint(b.addressLine1)) continue;
      if (!namesSimilarForDedupe(a.name, b.name)) continue;
      if (!addressesShareStreetNumber(a.addressLine1, b.addressLine1)) continue;
      union(i, j);
    }
  }

  const byRoot = new Map<number, StoreRow[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r)!.push(candidates[i]!);
  }

  for (const members of byRoot.values()) {
    if (members.length < 2) continue;

    // Coordinate spread check — skip groups that are too spread out
    const usable = members.filter((m) => !isUnusableScraperCoordinate(m.latitude, m.longitude));
    if (usable.length >= 2) {
      let maxD = 0;
      for (let i = 0; i < usable.length; i++) {
        for (let j = i + 1; j < usable.length; j++) {
          maxD = Math.max(
            maxD,
            haversineDistanceMeters(usable[i]!.latitude, usable[i]!.longitude, usable[j]!.latitude, usable[j]!.longitude)
          );
        }
      }
      if (maxD > MAX_GROUP_SPREAD_M) continue;
    }

    plans.push(buildMergePlanFromGroup(members));
  }

  return plans;
}

async function executeDedupPlans(plans: MergePlan[]): Promise<number> {
  let duplicatesRemoved = 0;
  for (const plan of plans) {
    const loserHandles = plan.remove.map((r) => r.handle);

    const survivorPrem = await prisma.premiumStore.findUnique({ where: { handle: plan.keep.handle } });
    const loserNotes: (string | null)[] = [];
    for (const r of plan.remove) {
      const prem = await prisma.premiumStore.findUnique({ where: { handle: r.handle } });
      if (prem) loserNotes.push(prem.notes);
    }

    await prisma.premiumStore.deleteMany({ where: { handle: { in: loserHandles } } });

    if (!survivorPrem && loserNotes.length > 0) {
      await prisma.premiumStore.create({
        data: { handle: plan.keep.handle, notes: loserNotes[0] ?? undefined },
      });
    }

    await prisma.location.update({
      where: { handle: plan.keep.handle },
      data: {
        name: plan.mergedName,
        brands: plan.mergedBrands,
        customBrands: plan.mergedCustomBrands,
        tags: plan.mergedTags,
      },
    });

    await prisma.location.deleteMany({ where: { handle: { in: loserHandles } } });
    duplicatesRemoved += loserHandles.length;
  }
  return duplicatesRemoved;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runGeoVerifyPipeline(task: GeoVerifyTask): Promise<void> {
  const wallStart = Date.now();

  const appendLog = (msg: string) => {
    task.log.push(msg);
  };

  try {
    const brandWhere = legacyBrandTextFilterWhere(task.brandName);
    const storeRows = await prisma.location.findMany({
      where: brandWhere,
      select: { handle: true },
    });
    const handles = storeRows.map((r) => r.handle);
    task.progress.total = handles.length;

    if (handles.length === 0) {
      appendLog(`No stores found for brand "${task.brandName}".`);
      task.status = 'done';
      task.phase = 'done';
      task.result = {
        coordinatesUpdated: 0,
        verifiedStampOnly: 0,
        geocodeFailed: 0,
        errors: 0,
        dedupMerged: 0,
        locationsRemaining: 0,
        elapsedSec: 0,
      };
      return;
    }

    appendLog(`Found ${handles.length} store(s) for brand "${task.brandName}".`);
    appendLog('Phase 1: Running coordinate verification (geocoding)...');

    // Phase 1: geocode each store, updating coordinates where Nominatim disagrees
    let verifySummary: VerifyHandlesSummary;
    try {
      verifySummary = await verifyHandles(handles, {
        forceReverify: true,
        onProgress: (processed, total) => {
          task.progress.checked = processed;
          task.progress.total = total;
        },
      });
    } catch (e: unknown) {
      throw new Error(`Geocoding phase failed: ${String(e)}`);
    }

    appendLog(
      `Geocoding complete — ` +
      `${verifySummary.coordinatesUpdated} coordinate(s) updated, ` +
      `${verifySummary.verifiedStampOnly} confirmed (no change), ` +
      `${verifySummary.geocodeFailed} geocode failure(s), ` +
      `${verifySummary.errors} error(s).`
    );

    // Phase 2: brand-scoped deduplication now that coordinates are fresh
    task.phase = 'dedup';
    appendLog('Phase 2: Running address deduplication for this brand...');

    const freshStores = await prisma.location.findMany({
      where: brandWhere,
      select: {
        handle: true,
        name: true,
        brands: true,
        customBrands: true,
        tags: true,
        addressLine1: true,
        city: true,
        country: true,
        latitude: true,
        longitude: true,
        isPremium: true,
        updatedAt: true,
      },
      orderBy: { handle: 'asc' },
    });

    const plans = buildBrandScopedDedupPlans(freshStores);
    appendLog(`Found ${plans.length} merge group(s).`);

    const dedupMerged = await executeDedupPlans(plans);
    if (dedupMerged > 0) {
      appendLog(`Removed ${dedupMerged} duplicate location(s). Brand fields were unioned onto surviving rows.`);
    } else {
      appendLog('No duplicate locations found after deduplication.');
    }

    const remaining = await prisma.location.count({ where: brandWhere });
    const elapsedSec = (Date.now() - wallStart) / 1000;
    appendLog(`Done. ${remaining} store(s) remaining. Elapsed: ${elapsedSec.toFixed(1)}s`);

    task.status = 'done';
    task.phase = 'done';
    task.result = {
      coordinatesUpdated: verifySummary.coordinatesUpdated,
      verifiedStampOnly: verifySummary.verifiedStampOnly,
      geocodeFailed: verifySummary.geocodeFailed,
      errors: verifySummary.errors,
      dedupMerged,
      locationsRemaining: remaining,
      elapsedSec,
    };
  } catch (e: unknown) {
    task.status = 'error';
    task.phase = 'done';
    task.error = String(e);
    appendLog(`Error: ${String(e)}`);
  }
}
