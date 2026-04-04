import { describe, it, expect, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();
const findMany = vi.fn();
const $transaction = vi.fn();

vi.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    location: {
      findUnique,
      findMany,
    },
    $transaction,
    premiumStore: {},
  },
}));

import { premiumService } from '../../services/premium.service';

const baseRow = {
  handle: 'h1',
  name: 'Test Store',
  addressLine1: '1 Main St',
  addressLine2: null as string | null,
  city: 'NYC',
  stateProvinceRegion: 'NY' as string | null,
  country: 'United States',
  postalCode: '10001' as string | null,
  phone: '+12025550123' as string | null,
  brands: null as string | null,
  isPremium: false,
  website: null as string | null,
  imageUrl: null as string | null,
  pageDescription: null as string | null,
  monday: null as string | null,
  tuesday: null as string | null,
  wednesday: null as string | null,
  thursday: null as string | null,
  friday: null as string | null,
  saturday: null as string | null,
  sunday: null as string | null,
};

describe('premiumService.updateStoreByHandle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for blank handle', async () => {
    const r = await premiumService.updateStoreByHandle('  ', { city: 'X' });
    expect(r).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns null when location is missing', async () => {
    findUnique.mockResolvedValueOnce(null);
    const r = await premiumService.updateStoreByHandle('missing', { city: 'X' });
    expect(r).toBeNull();
    expect(findUnique).toHaveBeenCalledWith({
      where: { handle: 'missing' },
      select: expect.any(Object),
    });
  });

  it('runs transaction with premium upsert and location update when marking premium', async () => {
    const txPremiumUpsert = vi.fn().mockResolvedValue(undefined);
    const txLocationUpdate = vi.fn().mockResolvedValue(undefined);

    findUnique
      .mockResolvedValueOnce({ ...baseRow })
      .mockResolvedValueOnce({ ...baseRow, isPremium: true });

    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        premiumStore: {
          upsert: txPremiumUpsert,
          deleteMany: vi.fn(),
        },
        location: { update: txLocationUpdate },
      });
    });

    const result = await premiumService.updateStoreByHandle('h1', { isPremium: true });

    expect(txPremiumUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { handle: 'h1' },
        create: { handle: 'h1' },
      })
    );
    expect(txLocationUpdate).toHaveBeenCalledWith({
      where: { handle: 'h1' },
      data: expect.objectContaining({ isPremium: true }),
    });
    expect(result?.isPremium).toBe(true);
  });

  it('deletes premium row and sets isPremium false when unmarking', async () => {
    const txDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const txLocationUpdate = vi.fn().mockResolvedValue(undefined);

    findUnique
      .mockResolvedValueOnce({ ...baseRow, isPremium: true })
      .mockResolvedValueOnce({ ...baseRow, isPremium: false });

    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        premiumStore: {
          upsert: vi.fn(),
          deleteMany: txDeleteMany,
        },
        location: { update: txLocationUpdate },
      });
    });

    await premiumService.updateStoreByHandle('h1', { isPremium: false });

    expect(txDeleteMany).toHaveBeenCalledWith({ where: { handle: 'h1' } });
    expect(txLocationUpdate).toHaveBeenCalledWith({
      where: { handle: 'h1' },
      data: expect.objectContaining({ isPremium: false }),
    });
  });

  it('updates website without premium ops when isPremium omitted', async () => {
    const txPremiumUpsert = vi.fn();
    const txDeleteMany = vi.fn();
    const txLocationUpdate = vi.fn().mockResolvedValue(undefined);

    findUnique
      .mockResolvedValueOnce({ ...baseRow })
      .mockResolvedValueOnce({ ...baseRow, website: 'https://example.com' });

    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        premiumStore: {
          upsert: txPremiumUpsert,
          deleteMany: txDeleteMany,
        },
        location: { update: txLocationUpdate },
      });
    });

    await premiumService.updateStoreByHandle('h1', { website: 'https://example.com' });

    expect(txPremiumUpsert).not.toHaveBeenCalled();
    expect(txDeleteMany).not.toHaveBeenCalled();
    expect(txLocationUpdate).toHaveBeenCalledWith({
      where: { handle: 'h1' },
      data: expect.objectContaining({ website: 'https://example.com' }),
    });
  });
});
