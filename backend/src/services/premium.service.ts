import prisma from '../lib/prisma';

export const premiumService = {
  /** Get all premium store handles */
  async listAll(): Promise<{ handle: string; addedAt: Date; notes: string | null }[]> {
    return prisma.premiumStore.findMany({ orderBy: { addedAt: 'desc' } });
  },

  /** Get just the handles (for admin API) */
  async getHandles(): Promise<string[]> {
    const stores = await prisma.premiumStore.findMany({ select: { handle: true } });
    return stores.map((s) => s.handle);
  },

  /** Get names of all premium locations (for public/map API) */
  async getPremiumNames(): Promise<string[]> {
    const locations = await prisma.location.findMany({
      where: { isPremium: true },
      select: { name: true },
    });
    return locations.map((l) => l.name).filter(Boolean);
  },

  /** Add a store as premium and sync the Location flag */
  async add(handle: string, notes?: string): Promise<{ handle: string; addedAt: Date; notes: string | null }> {
    const trimmed = handle.trim();
    if (!trimmed) throw new Error('Handle is required');

    const entry = await prisma.premiumStore.upsert({
      where: { handle: trimmed },
      update: { notes: notes ?? null },
      create: { handle: trimmed, notes: notes ?? null },
    });

    // Sync isPremium flag on Location table
    await prisma.location.updateMany({
      where: { handle: trimmed },
      data: { isPremium: true },
    });

    return entry;
  },

  /** Remove a store from premium and clear the Location flag */
  async remove(handle: string): Promise<boolean> {
    const trimmed = handle.trim();
    const existing = await prisma.premiumStore.findUnique({ where: { handle: trimmed } });
    if (!existing) return false;

    await prisma.premiumStore.delete({ where: { handle: trimmed } });

    // Clear isPremium flag on Location table
    await prisma.location.updateMany({
      where: { handle: trimmed },
      data: { isPremium: false },
    });

    return true;
  },

  /** Check if a handle is premium */
  async isPremium(handle: string): Promise<boolean> {
    const entry = await prisma.premiumStore.findUnique({ where: { handle: handle.trim() } });
    return !!entry;
  },

  /** Bulk add handles as premium */
  async bulkAdd(handles: string[], notes?: string): Promise<{ added: number }> {
    const trimmed = handles.map((h) => h.trim()).filter(Boolean);
    if (trimmed.length === 0) return { added: 0 };

    let added = 0;
    for (const handle of trimmed) {
      await prisma.premiumStore.upsert({
        where: { handle },
        update: { notes: notes ?? null },
        create: { handle, notes: notes ?? null },
      });
      added++;
    }

    // Sync isPremium flags
    await prisma.location.updateMany({
      where: { handle: { in: trimmed } },
      data: { isPremium: true },
    });

    return { added };
  },
};
