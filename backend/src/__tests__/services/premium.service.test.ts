import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  findUnique,
  findMany,
  $transaction,
  $executeRaw,
  premiumFindUnique,
  premiumUpsert,
  locationUpdateMany,
  premiumDeleteMany,
} = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  premiumFindUnique: vi.fn(),
  premiumUpsert: vi.fn(),
  locationUpdateMany: vi.fn(),
  premiumDeleteMany: vi.fn(),
}));

vi.mock('../../utils/location-brand-filter-column', () => ({
  locationTableHasBrandFilterModeColumn: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    location: {
      findUnique,
      findMany,
      updateMany: locationUpdateMany,
    },
    $transaction,
    $executeRaw,
    premiumStore: {
      findUnique: premiumFindUnique,
      upsert: premiumUpsert,
      deleteMany: premiumDeleteMany,
    },
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
  brandFilterMode: null as string | null,
};

const emptyPremiumRow = {
  isServiceCenter: false,
  premiumRetailKind: null as string | null,
};

describe('premiumService.updateStoreByHandle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    premiumFindUnique.mockResolvedValue({ ...emptyPremiumRow });
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
    premiumFindUnique.mockResolvedValue({
      isServiceCenter: false,
      premiumRetailKind: 'boutique',
    });

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

    const result = await premiumService.updateStoreByHandle('h1', {
      isPremium: true,
      isServiceCenter: false,
      premiumRetailKind: 'boutique',
    });

    expect(txPremiumUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { handle: 'h1' },
        create: expect.objectContaining({
          handle: 'h1',
          isServiceCenter: false,
          premiumRetailKind: 'boutique',
          storeType: 'AD Verified',
        }),
      })
    );
    expect(txLocationUpdate).toHaveBeenCalledWith({
      where: { handle: 'h1' },
      data: expect.objectContaining({ isPremium: true }),
    });
    expect(result?.isPremium).toBe(true);
    expect(result?.premiumRetailKind).toBe('boutique');
  });

  it('throws when marking premium without valid premiumRetailKind', async () => {
    findUnique.mockResolvedValueOnce({ ...baseRow });

    await expect(
      premiumService.updateStoreByHandle('h1', { isPremium: true })
    ).rejects.toThrow('PREMIUM_MARK_METADATA_REQUIRED');
    expect($transaction).not.toHaveBeenCalled();
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

  it('updates brandFilterMode on Location without a PremiumStore row', async () => {
    const txLocationUpdate = vi.fn().mockResolvedValue(undefined);

    findUnique
      .mockResolvedValueOnce({ ...baseRow })
      .mockResolvedValueOnce({ ...baseRow, brandFilterMode: 'verified_brand' });

    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        premiumStore: {
          upsert: vi.fn(),
          deleteMany: vi.fn(),
        },
        location: { update: txLocationUpdate },
      });
    });

    const result = await premiumService.updateStoreByHandle('h1', {
      brandFilterMode: 'verified_brand',
    });

    expect(txLocationUpdate).toHaveBeenCalledWith({
      where: { handle: 'h1' },
      data: expect.objectContaining({ brandFilterMode: 'verified_brand' }),
    });
    expect(result?.brandFilterMode).toBe('verified_brand');
  });

  it('throws when isServiceCenter is set without a PremiumStore row and no mark premium', async () => {
    findUnique.mockResolvedValueOnce({ ...baseRow });
    premiumFindUnique.mockResolvedValueOnce(null);

    await expect(
      premiumService.updateStoreByHandle('h1', { isServiceCenter: true })
    ).rejects.toThrow('STORE_TYPE_REQUIRES_PREMIUM');
    expect($transaction).not.toHaveBeenCalled();
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

  it('updates brands CSV on Location when brands is provided', async () => {
    const txLocationUpdate = vi.fn().mockResolvedValue(undefined);

    findUnique
      .mockResolvedValueOnce({ ...baseRow, brands: 'OMEGA' })
      .mockResolvedValueOnce({ ...baseRow, brands: 'OMEGA, ROLEX' });

    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        premiumStore: {
          upsert: vi.fn(),
          deleteMany: vi.fn(),
        },
        location: { update: txLocationUpdate },
      });
    });

    const result = await premiumService.updateStoreByHandle('h1', {
      brands: 'OMEGA, ROLEX',
    });

    expect(txLocationUpdate).toHaveBeenCalledWith({
      where: { handle: 'h1' },
      data: expect.objectContaining({ brands: 'OMEGA, ROLEX' }),
    });
    expect(result?.brands).toBe('OMEGA, ROLEX');
  });

  it('clears brands when brands is null', async () => {
    const txLocationUpdate = vi.fn().mockResolvedValue(undefined);

    findUnique
      .mockResolvedValueOnce({ ...baseRow, brands: 'OMEGA' })
      .mockResolvedValueOnce({ ...baseRow, brands: null });

    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        premiumStore: {
          upsert: vi.fn(),
          deleteMany: vi.fn(),
        },
        location: { update: txLocationUpdate },
      });
    });

    await premiumService.updateStoreByHandle('h1', { brands: null });

    expect(txLocationUpdate).toHaveBeenCalledWith({
      where: { handle: 'h1' },
      data: expect.objectContaining({ brands: null }),
    });
  });
});

describe('premiumService.batchMarkPremium / batchRemovePremium', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    premiumUpsert.mockResolvedValue({});
    locationUpdateMany.mockResolvedValue({ count: 2 });
    premiumDeleteMany.mockResolvedValue({ count: 1 });
  });

  it('batchMarkPremium runs array transaction with upserts and location updateMany', async () => {
    $transaction.mockImplementation((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg as Promise<unknown>[]) : Promise.resolve()
    );

    const r = await premiumService.batchMarkPremium([
      { handle: 'a', isServiceCenter: true, premiumRetailKind: 'boutique' },
      { handle: 'b', isServiceCenter: false, premiumRetailKind: 'multi_brand' },
    ]);

    expect(r.marked).toBe(2);
    expect(premiumUpsert).toHaveBeenCalledTimes(2);
    expect(premiumUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { handle: 'a' },
        create: expect.objectContaining({
          handle: 'a',
          isServiceCenter: true,
          premiumRetailKind: 'boutique',
          storeType: 'AD Verified',
        }),
      })
    );
    expect(locationUpdateMany).toHaveBeenCalledWith({
      where: { handle: { in: ['a', 'b'] } },
      data: { isPremium: true },
    });
  });

  it('batchMarkPremium throws on invalid entry', async () => {
    await expect(
      premiumService.batchMarkPremium([
        // @ts-expect-error exercise runtime validation
        { handle: 'a', isServiceCenter: false, premiumRetailKind: 'invalid' },
      ])
    ).rejects.toThrow('INVALID_MARK_PREMIUM_ENTRIES');
  });

  it('batchRemovePremium deletes registry rows and clears isPremium', async () => {
    $transaction.mockImplementation((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg as Promise<unknown>[]) : Promise.resolve()
    );

    const r = await premiumService.batchRemovePremium(['x']);

    expect(r.removed).toBe(1);
    expect(premiumDeleteMany).toHaveBeenCalledWith({ where: { handle: { in: ['x'] } } });
    expect(locationUpdateMany).toHaveBeenCalledWith({
      where: { handle: { in: ['x'] } },
      data: { isPremium: false },
    });
  });
});

describe('premiumService.reconcilePremiumLocationFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    $executeRaw.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
  });

  it('runs two raw updates and returns counts', async () => {
    const r = await premiumService.reconcilePremiumLocationFlags();
    expect(r).toEqual({ setTrueCount: 2, setFalseCount: 1 });
    expect($executeRaw).toHaveBeenCalledTimes(2);
  });
});
