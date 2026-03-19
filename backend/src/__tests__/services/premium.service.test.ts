import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma before importing the service
vi.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    premiumStore: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    location: {
      updateMany: vi.fn(),
    },
  },
}));

import prisma from '../../lib/prisma';
import { premiumService } from '../../services/premium.service';

describe('Premium Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listAll', () => {
    it('should return all premium stores ordered by addedAt desc', async () => {
      const mockStores = [
        { handle: 'store-1', addedAt: new Date('2026-03-18'), notes: 'VIP' },
        { handle: 'store-2', addedAt: new Date('2026-03-17'), notes: null },
      ];
      (prisma.premiumStore.findMany as any).mockResolvedValue(mockStores);

      const result = await premiumService.listAll();

      expect(result).toEqual(mockStores);
      expect(prisma.premiumStore.findMany).toHaveBeenCalledWith({ orderBy: { addedAt: 'desc' } });
    });

    it('should return empty array when no premium stores exist', async () => {
      (prisma.premiumStore.findMany as any).mockResolvedValue([]);

      const result = await premiumService.listAll();

      expect(result).toEqual([]);
    });
  });

  describe('getHandles', () => {
    it('should return only handles as string array', async () => {
      (prisma.premiumStore.findMany as any).mockResolvedValue([
        { handle: 'store-1' },
        { handle: 'store-2' },
      ]);

      const result = await premiumService.getHandles();

      expect(result).toEqual(['store-1', 'store-2']);
      expect(prisma.premiumStore.findMany).toHaveBeenCalledWith({ select: { handle: true } });
    });
  });

  describe('add', () => {
    it('should upsert a premium store and sync the Location flag', async () => {
      const mockEntry = { handle: 'store-1', addedAt: new Date(), notes: 'Paid tier' };
      (prisma.premiumStore.upsert as any).mockResolvedValue(mockEntry);
      (prisma.location.updateMany as any).mockResolvedValue({ count: 1 });

      const result = await premiumService.add('store-1', 'Paid tier');

      expect(result).toEqual(mockEntry);
      expect(prisma.premiumStore.upsert).toHaveBeenCalledWith({
        where: { handle: 'store-1' },
        update: { notes: 'Paid tier' },
        create: { handle: 'store-1', notes: 'Paid tier' },
      });
      expect(prisma.location.updateMany).toHaveBeenCalledWith({
        where: { handle: 'store-1' },
        data: { isPremium: true },
      });
    });

    it('should throw when handle is empty', async () => {
      await expect(premiumService.add('')).rejects.toThrow('Handle is required');
    });

    it('should trim whitespace from handle', async () => {
      const mockEntry = { handle: 'store-1', addedAt: new Date(), notes: null };
      (prisma.premiumStore.upsert as any).mockResolvedValue(mockEntry);
      (prisma.location.updateMany as any).mockResolvedValue({ count: 1 });

      await premiumService.add('  store-1  ');

      expect(prisma.premiumStore.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { handle: 'store-1' } })
      );
    });
  });

  describe('remove', () => {
    it('should delete premium store and clear the Location flag', async () => {
      (prisma.premiumStore.findUnique as any).mockResolvedValue({ handle: 'store-1' });
      (prisma.premiumStore.delete as any).mockResolvedValue({});
      (prisma.location.updateMany as any).mockResolvedValue({ count: 1 });

      const result = await premiumService.remove('store-1');

      expect(result).toBe(true);
      expect(prisma.premiumStore.delete).toHaveBeenCalledWith({ where: { handle: 'store-1' } });
      expect(prisma.location.updateMany).toHaveBeenCalledWith({
        where: { handle: 'store-1' },
        data: { isPremium: false },
      });
    });

    it('should return false when handle does not exist', async () => {
      (prisma.premiumStore.findUnique as any).mockResolvedValue(null);

      const result = await premiumService.remove('nonexistent');

      expect(result).toBe(false);
      expect(prisma.premiumStore.delete).not.toHaveBeenCalled();
    });
  });

  describe('isPremium', () => {
    it('should return true when handle is in PremiumStore', async () => {
      (prisma.premiumStore.findUnique as any).mockResolvedValue({ handle: 'store-1' });

      const result = await premiumService.isPremium('store-1');
      expect(result).toBe(true);
    });

    it('should return false when handle is not in PremiumStore', async () => {
      (prisma.premiumStore.findUnique as any).mockResolvedValue(null);

      const result = await premiumService.isPremium('store-1');
      expect(result).toBe(false);
    });
  });

  describe('bulkAdd', () => {
    it('should upsert multiple handles and sync Location flags', async () => {
      (prisma.premiumStore.upsert as any).mockResolvedValue({});
      (prisma.location.updateMany as any).mockResolvedValue({ count: 3 });

      const result = await premiumService.bulkAdd(['s1', 's2', 's3'], 'Batch');

      expect(result).toEqual({ added: 3 });
      expect(prisma.premiumStore.upsert).toHaveBeenCalledTimes(3);
      expect(prisma.location.updateMany).toHaveBeenCalledWith({
        where: { handle: { in: ['s1', 's2', 's3'] } },
        data: { isPremium: true },
      });
    });

    it('should skip empty handles', async () => {
      const result = await premiumService.bulkAdd(['', '  ']);

      expect(result).toEqual({ added: 0 });
      expect(prisma.premiumStore.upsert).not.toHaveBeenCalled();
    });
  });
});
