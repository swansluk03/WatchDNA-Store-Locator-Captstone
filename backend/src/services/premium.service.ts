/**
 * Premium store service — manages which stores are marked as premium.
 * Keeps Location.isPremium and the PremiumStore registry in sync.
 */

import prisma from '../lib/prisma';

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
}

export const premiumService = {
  /**
   * Fetch all stores from the Location table with only the fields needed
   * for the premium management UI. One batch request — filtering is done client-side.
   */
  async getStores(): Promise<PremiumStoreRecord[]> {
    return prisma.location.findMany({
      select: {
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
      },
      orderBy: { name: 'asc' },
    });
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
