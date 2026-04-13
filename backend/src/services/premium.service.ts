/**
 * Premium store service — manages which stores are marked as premium.
 * `PremiumStore` is the registry (source of truth for “in premium program”);
 * `Location.isPremium` is kept in sync for fast reads — use reconcile after bulk imports if drift is suspected.
 */

import type { Prisma } from '@prisma/client';

import prisma from '../lib/prisma';
import { locationTableHasBrandFilterModeColumn } from '../utils/location-brand-filter-column';
import { normalizeCountry } from '../utils/country';
import { normalizePhone } from '../utils/normalize-phone';
import {
  STORE_IMAGE_PUBLIC_PREFIX,
  isValidStoreImageFilename,
  managedImageFilenameFromUrl,
  removeStoreImageFile,
} from '../utils/store-premium-image';

export type PremiumRetailKind = 'boutique' | 'multi_brand';

export const STORE_LISTING_AUTHORIZED_DEALERS = 'Authorized Dealers';
export const STORE_LISTING_AD_VERIFIED = 'AD Verified';

export type StoreListingType = typeof STORE_LISTING_AUTHORIZED_DEALERS | typeof STORE_LISTING_AD_VERIFIED;

export type BrandFilterModeWire = 'brand' | 'verified_brand';

export function isValidPremiumRetailKind(v: unknown): v is PremiumRetailKind {
  return v === 'boutique' || v === 'multi_brand';
}

function brandFilterModeFromDb(v: string | null | undefined): BrandFilterModeWire {
  return v === 'verified_brand' ? 'verified_brand' : 'brand';
}

/** Thrown when `isPremium: true` without valid `premiumRetailKind`. */
export const ERR_PREMIUM_MARK_METADATA = 'PREMIUM_MARK_METADATA_REQUIRED';

export interface PremiumStoreRecord {
  handle: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateProvinceRegion: string | null;
  country: string;
  postalCode: string | null;
  phone: string | null;
  brands: string | null;
  isPremium: boolean;
  website: string | null;
  imageUrl: string | null;
  pageDescription: string | null;
  monday: string | null;
  tuesday: string | null;
  wednesday: string | null;
  thursday: string | null;
  friday: string | null;
  saturday: string | null;
  sunday: string | null;
  /** Derived from `Location.isPremium` for the admin and public map. */
  storeType: StoreListingType;
  brandFilterMode: BrandFilterModeWire;
  isServiceCenter: boolean;
  premiumRetailKind: PremiumRetailKind | null;
}

const premiumStoreSelect = {
  handle: true,
  name: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  stateProvinceRegion: true,
  country: true,
  postalCode: true,
  phone: true,
  brands: true,
  isPremium: true,
  website: true,
  imageUrl: true,
  pageDescription: true,
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: true,
  sunday: true,
  brandFilterMode: true,
} as const;

/** Same as `premiumStoreSelect` when the DB has migrated; used when `brandFilterMode` column is absent. */
const premiumStoreSelectNoBrandFilter: Omit<typeof premiumStoreSelect, 'brandFilterMode'> = (() => {
  const copy = { ...premiumStoreSelect };
  delete (copy as Record<string, unknown>).brandFilterMode;
  return copy;
})();

async function selectForPremiumLocationRow(): Promise<
  typeof premiumStoreSelect | typeof premiumStoreSelectNoBrandFilter
> {
  return (await locationTableHasBrandFilterModeColumn()) ? premiumStoreSelect : premiumStoreSelectNoBrandFilter;
}

function toPremiumRecord(loc: {
  handle: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateProvinceRegion: string | null;
  country: string;
  postalCode: string | null;
  phone: string | null;
  brands: string | null;
  isPremium: boolean;
  website: string | null;
  imageUrl: string | null;
  pageDescription: string | null;
  monday: string | null;
  tuesday: string | null;
  wednesday: string | null;
  thursday: string | null;
  friday: string | null;
  saturday: string | null;
  sunday: string | null;
  brandFilterMode?: string | null;
}): PremiumStoreRecord {
  const listing: StoreListingType = loc.isPremium
    ? STORE_LISTING_AD_VERIFIED
    : STORE_LISTING_AUTHORIZED_DEALERS;
  return {
    ...loc,
    country: normalizeCountry(loc.country ?? '') || '',
    storeType: listing,
    brandFilterMode: brandFilterModeFromDb(loc.brandFilterMode),
    isServiceCenter: false,
    premiumRetailKind: null,
  };
}

function mergePremiumRegistry(
  base: PremiumStoreRecord,
  row: {
    isServiceCenter: boolean;
    premiumRetailKind: string | null;
  } | null
): PremiumStoreRecord {
  if (!row) {
    return { ...base, isServiceCenter: false, premiumRetailKind: null };
  }
  const kind = isValidPremiumRetailKind(row.premiumRetailKind) ? row.premiumRetailKind : null;
  return {
    ...base,
    isServiceCenter: row.isServiceCenter,
    premiumRetailKind: kind,
  };
}

/** PATCH body: only these keys may update Location (plus optional isPremium for registry sync). */
export type PremiumStoreUpdateInput = Partial<{
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateProvinceRegion: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  website: string | null;
  imageUrl: string | null;
  pageDescription: string | null;
  brands: string | null;
  monday: string | null;
  tuesday: string | null;
  wednesday: string | null;
  thursday: string | null;
  friday: string | null;
  saturday: string | null;
  sunday: string | null;
  isPremium: boolean;
  isServiceCenter: boolean;
  premiumRetailKind: PremiumRetailKind | null;
  brandFilterMode: BrandFilterModeWire | null;
}>;

export type MarkPremiumEntry = {
  handle: string;
  isServiceCenter: boolean;
  premiumRetailKind: PremiumRetailKind;
};

function emptyToNull(s: string | null | undefined): string | null {
  if (s === undefined || s === null) return null;
  const t = s.trim();
  return t === '' ? null : t;
}

export const premiumService = {
  /**
   * Fetch all stores from the Location table with only the fields needed
   * for the premium management UI. Merges storeType from PremiumStore registry.
   */
  async getStores(): Promise<PremiumStoreRecord[]> {
    const locSelect = await selectForPremiumLocationRow();
    const [rows, premiumRows] = await Promise.all([
      prisma.location.findMany({
        select: locSelect,
        orderBy: { name: 'asc' },
      }),
      prisma.premiumStore.findMany({
        select: {
          handle: true,
          isServiceCenter: true,
          premiumRetailKind: true,
        },
      }),
    ]);
    const regMap = new Map(
      premiumRows.map((p) => [
        p.handle,
        {
          isServiceCenter: p.isServiceCenter,
          premiumRetailKind: p.premiumRetailKind,
        },
      ])
    );
    return rows.map((loc) => mergePremiumRegistry(toPremiumRecord(loc), regMap.get(loc.handle) ?? null));
  },

  /**
   * Update one store by handle. Unknown body keys are ignored.
   * Returns null if the handle does not exist.
   */
  async updateStoreByHandle(
    handle: string,
    body: PremiumStoreUpdateInput
  ): Promise<PremiumStoreRecord | null> {
    const h = handle.trim();
    if (!h) return null;

    const locSelect = await selectForPremiumLocationRow();
    const existing = await prisma.location.findUnique({
      where: { handle: h },
      select: locSelect,
    });
    if (!existing) return null;

    const data: Prisma.LocationUpdateInput = {};
    let nextCountry = normalizeCountry(existing.country ?? '') || existing.country;

    if (body.addressLine1 !== undefined) {
      data.addressLine1 = (body.addressLine1 ?? '').trim() || existing.addressLine1;
    }
    if (body.addressLine2 !== undefined) {
      data.addressLine2 = emptyToNull(body.addressLine2);
    }
    if (body.city !== undefined) {
      data.city = (body.city ?? '').trim() || existing.city;
    }
    if (body.stateProvinceRegion !== undefined) {
      data.stateProvinceRegion = emptyToNull(body.stateProvinceRegion);
    }
    if (body.postalCode !== undefined) {
      data.postalCode = emptyToNull(body.postalCode);
    }
    if (body.country !== undefined) {
      const norm = normalizeCountry((body.country ?? '').trim()) || (body.country ?? '').trim();
      data.country = norm || existing.country;
      nextCountry = norm || existing.country;
    }
    if (body.website !== undefined) {
      data.website = emptyToNull(body.website);
    }
    if (body.brands !== undefined) {
      data.brands = emptyToNull(body.brands);
    }
    if (body.imageUrl !== undefined) {
      data.imageUrl = emptyToNull(body.imageUrl);
    }
    if (body.pageDescription !== undefined) {
      data.pageDescription = emptyToNull(body.pageDescription);
    }
    if (body.monday !== undefined) data.monday = emptyToNull(body.monday);
    if (body.tuesday !== undefined) data.tuesday = emptyToNull(body.tuesday);
    if (body.wednesday !== undefined) data.wednesday = emptyToNull(body.wednesday);
    if (body.thursday !== undefined) data.thursday = emptyToNull(body.thursday);
    if (body.friday !== undefined) data.friday = emptyToNull(body.friday);
    if (body.saturday !== undefined) data.saturday = emptyToNull(body.saturday);
    if (body.sunday !== undefined) data.sunday = emptyToNull(body.sunday);
    if (body.phone !== undefined) {
      const raw = body.phone === null ? '' : String(body.phone);
      data.phone = normalizePhone(raw, nextCountry);
    }
    if (body.brandFilterMode !== undefined && (await locationTableHasBrandFilterModeColumn())) {
      data.brandFilterMode = body.brandFilterMode === 'verified_brand' ? 'verified_brand' : null;
    }

    const premiumOp =
      body.isPremium === undefined
        ? null
        : body.isPremium
          ? ('mark' as const)
          : ('unmark' as const);

    const registryPatch: Prisma.PremiumStoreUpdateInput = {};
    if (body.isServiceCenter !== undefined) registryPatch.isServiceCenter = body.isServiceCenter;
    if (body.premiumRetailKind !== undefined) {
      registryPatch.premiumRetailKind = body.premiumRetailKind;
    }
    const hasRegistryPatch = Object.keys(registryPatch).length > 0;

    if (hasRegistryPatch && premiumOp === null) {
      const reg = await prisma.premiumStore.findUnique({
        where: { handle: h },
        select: { handle: true },
      });
      if (!reg) {
        throw new Error('STORE_TYPE_REQUIRES_PREMIUM');
      }
    }

    if (premiumOp === 'mark' && !isValidPremiumRetailKind(body.premiumRetailKind)) {
      throw new Error(ERR_PREMIUM_MARK_METADATA);
    }

    const premiumRowSelect = {
      isServiceCenter: true,
      premiumRetailKind: true,
    } as const;

    await prisma.$transaction(async (tx) => {
      if (premiumOp === 'mark') {
        const markData: Prisma.PremiumStoreCreateInput = {
          handle: h,
          isServiceCenter: body.isServiceCenter ?? false,
          premiumRetailKind: body.premiumRetailKind as PremiumRetailKind,
          storeType: STORE_LISTING_AD_VERIFIED,
        };
        await tx.premiumStore.upsert({
          where: { handle: h },
          update: {
            addedAt: new Date(),
            isServiceCenter: body.isServiceCenter ?? false,
            premiumRetailKind: body.premiumRetailKind as PremiumRetailKind,
            storeType: STORE_LISTING_AD_VERIFIED,
          },
          create: markData,
        });
        data.isPremium = true;
      } else if (premiumOp === 'unmark') {
        await tx.premiumStore.deleteMany({ where: { handle: h } });
        data.isPremium = false;
      } else if (hasRegistryPatch) {
        await tx.premiumStore.updateMany({
          where: { handle: h },
          data: registryPatch,
        });
      }

      if (Object.keys(data).length > 0) {
        await tx.location.update({
          where: { handle: h },
          data,
        });
      }
    });

    const [updated, premiumRow] = await Promise.all([
      prisma.location.findUnique({ where: { handle: h }, select: locSelect }),
      prisma.premiumStore.findUnique({ where: { handle: h }, select: premiumRowSelect }),
    ]);
    if (!updated) return null;

    if (body.imageUrl !== undefined) {
      const prevFile = managedImageFilenameFromUrl(existing.imageUrl);
      const nextUrl = emptyToNull(body.imageUrl);
      const nextFile = managedImageFilenameFromUrl(nextUrl);
      if (prevFile && prevFile !== nextFile) {
        await removeStoreImageFile(prevFile).catch(() => undefined);
      }
    }

    return mergePremiumRegistry(toPremiumRecord(updated), premiumRow);
  },

  /**
   * Save an uploaded store image file (already on disk under store-images/) and set Location.imageUrl.
   * Removes the previous managed image file when replacing.
   */
  async applyStoreImageUpload(handle: string, storedFilename: string): Promise<PremiumStoreRecord | null> {
    const h = handle.trim();
    if (!h || !isValidStoreImageFilename(storedFilename)) return null;

    const locSelect = await selectForPremiumLocationRow();
    const existing = await prisma.location.findUnique({
      where: { handle: h },
      select: locSelect,
    });
    if (!existing) return null;

    const prevFile = managedImageFilenameFromUrl(existing.imageUrl);
    const imageUrl = `${STORE_IMAGE_PUBLIC_PREFIX}${storedFilename}`;

    await prisma.location.update({
      where: { handle: h },
      data: { imageUrl },
    });

    if (prevFile && prevFile !== storedFilename) {
      await removeStoreImageFile(prevFile).catch(() => undefined);
    }

    const [updated, premiumRow] = await Promise.all([
      prisma.location.findUnique({ where: { handle: h }, select: locSelect }),
      prisma.premiumStore.findUnique({
        where: { handle: h },
        select: { isServiceCenter: true, premiumRetailKind: true },
      }),
    ]);
    if (!updated) return null;
    return mergePremiumRegistry(toPremiumRecord(updated), premiumRow);
  },

  /**
   * Mark a batch of stores as premium.
   * Upserts each handle into PremiumStore and sets Location.isPremium = true.
   */
  async batchMarkPremium(entries: MarkPremiumEntry[]): Promise<{ marked: number }> {
    if (entries.length === 0) return { marked: 0 };

    for (const e of entries) {
      if (!e.handle?.trim() || typeof e.isServiceCenter !== 'boolean' || !isValidPremiumRetailKind(e.premiumRetailKind)) {
        throw new Error('INVALID_MARK_PREMIUM_ENTRIES');
      }
    }

    const handles = entries.map((e) => e.handle.trim());

    await prisma.$transaction([
      ...entries.map((e) =>
        prisma.premiumStore.upsert({
          where: { handle: e.handle },
          update: {
            addedAt: new Date(),
            isServiceCenter: e.isServiceCenter,
            premiumRetailKind: e.premiumRetailKind,
            storeType: STORE_LISTING_AD_VERIFIED,
          },
          create: {
            handle: e.handle,
            isServiceCenter: e.isServiceCenter,
            premiumRetailKind: e.premiumRetailKind,
            storeType: STORE_LISTING_AD_VERIFIED,
          },
        })
      ),
      prisma.location.updateMany({
        where: { handle: { in: handles } },
        data: { isPremium: true },
      }),
    ]);

    return { marked: entries.length };
  },

  /**
   * Remove premium status from a batch of stores.
   * Deletes each handle from PremiumStore and sets Location.isPremium = false.
   */
  /** Get names of all premium locations (public — used by the map) */
  async getPremiumNames(): Promise<string[]> {
    const locations = await prisma.location.findMany({
      where: { isPremium: true },
      select: { name: true },
    });
    return locations.map((l) => l.name).filter(Boolean);
  },

  async batchRemovePremium(handles: string[]): Promise<{ removed: number }> {
    if (handles.length === 0) return { removed: 0 };

    await prisma.$transaction([
      prisma.premiumStore.deleteMany({
        where: { handle: { in: handles } },
      }),
      prisma.location.updateMany({
        where: { handle: { in: handles } },
        data: { isPremium: false },
      }),
    ]);

    return { removed: handles.length };
  },

  /**
   * Set `Location.isPremium` from `PremiumStore` handles (true in registry → true on location;
   * not in registry → false). Use after bulk imports or manual DB edits that caused drift.
   */
  async reconcilePremiumLocationFlags(): Promise<{ setTrueCount: number; setFalseCount: number }> {
    const setTrueCount = await prisma.$executeRaw`
      UPDATE "Location" l
      SET "isPremium" = true
      FROM "PremiumStore" ps
      WHERE l.handle = ps.handle AND l."isPremium" = false
    `;
    const setFalseCount = await prisma.$executeRaw`
      UPDATE "Location" l
      SET "isPremium" = false
      WHERE l."isPremium" = true
        AND NOT EXISTS (SELECT 1 FROM "PremiumStore" ps WHERE ps.handle = l.handle)
    `;
    return {
      setTrueCount: Number(setTrueCount),
      setFalseCount: Number(setFalseCount),
    };
  },
};
