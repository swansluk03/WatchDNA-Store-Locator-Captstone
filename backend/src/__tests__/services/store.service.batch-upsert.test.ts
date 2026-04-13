import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  upsertFn: vi.fn().mockResolvedValue({}),
  findManyFn: vi.fn().mockResolvedValue([]),
  transactionFn: vi.fn(),
  queryRawFn: vi.fn().mockResolvedValue([]),
  executeRawFn: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../lib/prisma', () => ({
  default: {
    location: {
      findMany: (...args: unknown[]) => prismaMocks.findManyFn(...args),
      upsert: (...args: unknown[]) => prismaMocks.upsertFn(...args),
    },
    $transaction: (...args: unknown[]) => prismaMocks.transactionFn(...args),
    $queryRaw: (...args: unknown[]) => prismaMocks.queryRawFn(...args),
    $executeRaw: (...args: unknown[]) => prismaMocks.executeRawFn(...args),
  },
}));

import { storeService } from '../../services/store.service';

const completeCsvRow = (handle: string, brands: string) => ({
  Handle: handle,
  Name: 'Test Store',
  Status: 'active',
  'Address Line 1': '100 Batch Test Ln',
  'Address Line 2': '',
  City: 'Austin',
  'State/Province/Region': 'TX',
  Country: 'United States',
  'Postal Code': '78701',
  Phone: '+1 512 555 0100',
  Email: '',
  Website: '',
  Latitude: '30.2672',
  Longitude: '-97.7431',
  Brands: brands,
  Tags: '',
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMocks.findManyFn.mockResolvedValue([]);
  prismaMocks.queryRawFn.mockResolvedValue([]);
  prismaMocks.upsertFn.mockResolvedValue({});
  prismaMocks.executeRawFn.mockResolvedValue(0);
});

describe('storeService.batchUpsertLocations', () => {
  it('runs batched $transaction on success path', async () => {
    prismaMocks.transactionFn.mockImplementation(async (callback: (tx: any) => Promise<void>) => {
      await callback({
        location: { upsert: prismaMocks.upsertFn },
      });
    });

    const row = completeCsvRow('h1', 'OMEGA');
    await storeService.batchUpsertLocations([row], undefined, {
      failFast: true,
      requireCompleteForDb: true,
      mergeOnUpdate: true,
      mergeKind: 'manual',
    });

    expect(prismaMocks.transactionFn).toHaveBeenCalledTimes(1);
    expect(prismaMocks.upsertFn).toHaveBeenCalledTimes(1);
  });

  it('falls back to per-row upsert when $transaction fails', async () => {
    prismaMocks.transactionFn.mockRejectedValue(new Error('simulated deadlock'));

    const row = completeCsvRow('h2', 'ROLEX');
    const result = await storeService.batchUpsertLocations([row], undefined, {
      failFast: true,
      requireCompleteForDb: true,
      mergeOnUpdate: false,
    });

    expect(prismaMocks.transactionFn).toHaveBeenCalledTimes(1);
    expect(prismaMocks.upsertFn).toHaveBeenCalledTimes(1);
    expect(result.failed ?? 0).toBe(0);
    expect(result.dbErrors ?? []).toHaveLength(0);
    expect(result.upserted).toBe(1);
  });

  it('collapses two same-place rows when mergeOnUpdate is true', async () => {
    prismaMocks.transactionFn.mockImplementation(async (callback: (tx: any) => Promise<void>) => {
      await callback({
        location: { upsert: prismaMocks.upsertFn },
      });
    });

    const a = completeCsvRow('legacy-a', 'OMEGA');
    const b = {
      ...completeCsvRow('legacy-b', 'ROLEX'),
      Latitude: '30.26719',
      Longitude: '-97.74309',
    };

    await storeService.batchUpsertLocations([a, b], undefined, {
      failFast: true,
      requireCompleteForDb: true,
      mergeOnUpdate: true,
      mergeKind: 'manual',
    });

    expect(prismaMocks.upsertFn).toHaveBeenCalledTimes(1);
    const upsertArg = prismaMocks.upsertFn.mock.calls[0][0] as { update: { brands?: string | null } };
    const brands = upsertArg.update.brands ?? '';
    expect(brands).toContain('OMEGA');
    expect(brands).toContain('ROLEX');
  });

  it('upserts a row that has no phone number when requireCompleteForDb is true', async () => {
    prismaMocks.transactionFn.mockImplementation(async (callback: (tx: any) => Promise<void>) => {
      await callback({ location: { upsert: prismaMocks.upsertFn } });
    });

    const row = { ...completeCsvRow('h-nophone', 'OMEGA'), Phone: '' };
    const result = await storeService.batchUpsertLocations([row], undefined, {
      failFast: true,
      requireCompleteForDb: true,
      mergeOnUpdate: false,
    });

    expect(result.upserted).toBe(1);
    expect(result.skippedIncomplete ?? 0).toBe(0);
  });
});
