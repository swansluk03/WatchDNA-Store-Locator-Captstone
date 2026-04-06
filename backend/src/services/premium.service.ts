/**
 * Premium store service — manages which stores are marked as premium.
 * Keeps Location.isPremium and the PremiumStore registry in sync.
 */

import type { Prisma } from '@prisma/client';

import prisma from '../lib/prisma';
import { normalizeCountry } from '../utils/country';
import { normalizePhone } from '../utils/normalize-phone';

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
  storeType: string | null;
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
} as const;

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
}): PremiumStoreRecord {
  return {
    ...loc,
    country: normalizeCountry(loc.country ?? '') || '',
    storeType: null,
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
  monday: string | null;
  tuesday: string | null;
  wednesday: string | null;
  thursday: string | null;
  friday: string | null;
  saturday: string | null;
  sunday: string | null;
  isPremium: boolean;
  storeType: string | null;
}>;

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
    const [rows, premiumRows] = await Promise.all([
      prisma.location.findMany({
        select: premiumStoreSelect,
        orderBy: { name: 'asc' },
      }),
      prisma.premiumStore.findMany({
        select: { handle: true, storeType: true },
      }),
    ]);
    const storeTypeMap = new Map(premiumRows.map((p) => [p.handle, p.storeType]));
    return rows.map((loc) => ({
      ...toPremiumRecord(loc),
      storeType: storeTypeMap.get(loc.handle) ?? null,
    }));
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

    const existing = await prisma.location.findUnique({
      where: { handle: h },
      select: premiumStoreSelect,
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

    const premiumOp =
      body.isPremium === undefined
        ? null
        : body.isPremium
          ? ('mark' as const)
          : ('unmark' as const);

    const storeTypeUpdate =
      body.storeType !== undefined ? { storeType: body.storeType } : {};

    await prisma.$transaction(async (tx) => {
      if (premiumOp === 'mark') {
        await tx.premiumStore.upsert({
          where: { handle: h },
          update: { addedAt: new Date(), ...storeTypeUpdate },
          create: { handle: h, ...storeTypeUpdate },
        });
        data.isPremium = true;
      } else if (premiumOp === 'unmark') {
        await tx.premiumStore.deleteMany({ where: { handle: h } });
        data.isPremium = false;
      } else if (Object.keys(storeTypeUpdate).length > 0) {
        // Update storeType without changing premium status
        await tx.premiumStore.updateMany({
          where: { handle: h },
          data: storeTypeUpdate,
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
      prisma.location.findUnique({ where: { handle: h }, select: premiumStoreSelect }),
      prisma.premiumStore.findUnique({ where: { handle: h }, select: { storeType: true } }),
    ]);
    if (!updated) return null;
    return { ...toPremiumRecord(updated), storeType: premiumRow?.storeType ?? null };
  },

  /**
   * Mark a batch of stores as premium.
   * Upserts each handle into PremiumStore and sets Location.isPremium = true.
   */
  async batchMarkPremium(handles: string[]): Promise<{ marked: number }> {
    if (handles.length === 0) return { marked: 0 };

    await prisma.$transaction([
      ...handles.map((handle) =>
        prisma.premiumStore.upsert({
          where: { handle },
          update: { addedAt: new Date() },
          create: { handle },
        })
      ),
      prisma.location.updateMany({
        where: { handle: { in: handles } },
        data: { isPremium: true },
      }),
    ]);

    return { marked: handles.length };
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
};
