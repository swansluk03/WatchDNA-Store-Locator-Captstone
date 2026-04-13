import fs from 'fs/promises';
import { Request, Response } from 'express';
import {
  ERR_PREMIUM_MARK_METADATA,
  isValidPremiumRetailKind,
  premiumService,
  type MarkPremiumEntry,
  type PremiumStoreUpdateInput,
} from '../services/premium.service';
import { logger } from '../utils/logger';
import {
  contentTypeForStoreImageFilename,
  isValidStoreImageFilename,
  removeStoreImageFile,
  storeImageAbsolutePath,
} from '../utils/store-premium-image';

const PATCH_KEYS: (keyof PremiumStoreUpdateInput)[] = [
  'addressLine1',
  'addressLine2',
  'city',
  'stateProvinceRegion',
  'postalCode',
  'country',
  'phone',
  'website',
  'imageUrl',
  'pageDescription',
  'brands',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'isPremium',
  'isServiceCenter',
  'premiumRetailKind',
  'brandFilterMode',
];

function pickPremiumUpdate(body: unknown): PremiumStoreUpdateInput {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  const src = body as Record<string, unknown>;
  const out: PremiumStoreUpdateInput = {};
  for (const key of PATCH_KEYS) {
    if (!(key in src)) continue;
    const v = src[key];
    if (key === 'isPremium') {
      if (typeof v === 'boolean') out.isPremium = v;
      continue;
    }
    if (key === 'isServiceCenter') {
      if (typeof v === 'boolean') out.isServiceCenter = v;
      continue;
    }
    if (key === 'premiumRetailKind') {
      if (v === null) {
        out.premiumRetailKind = null;
        continue;
      }
      if (typeof v === 'string' && isValidPremiumRetailKind(v)) {
        out.premiumRetailKind = v;
      }
      continue;
    }
    if (key === 'brandFilterMode') {
      if (v === null || v === '') {
        out.brandFilterMode = null;
        continue;
      }
      if (v === 'brand' || v === 'verified_brand') {
        out.brandFilterMode = v;
      }
      continue;
    }
    if (v === null) {
      (out as Record<string, unknown>)[key] = null;
      continue;
    }
    if (typeof v === 'string') {
      (out as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}

export const premiumController = {
  /** GET /api/premium-stores/names — public, returns names for the map */
  async getNames(req: Request, res: Response): Promise<void> {
    try {
      const names = await premiumService.getPremiumNames();
      res.json({ names });
    } catch (err) {
      logger.error('premiumController.getNames error:', err);
      res.status(500).json({ error: 'Failed to fetch premium names' });
    }
  },

  async getStores(req: Request, res: Response): Promise<void> {
    try {
      const stores = await premiumService.getStores();
      res.json({ stores, totalCount: stores.length });
    } catch (err) {
      logger.error('premiumController.getStores error:', err);
      res.status(500).json({ error: 'Failed to fetch stores' });
    }
  },

  async markPremium(req: Request, res: Response): Promise<void> {
    const { entries } = req.body as { entries?: unknown };

    if (!Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ error: 'entries must be a non-empty array' });
      return;
    }

    const parsed: MarkPremiumEntry[] = [];
    for (const raw of entries) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const o = raw as Record<string, unknown>;
      const handle = typeof o.handle === 'string' ? o.handle.trim() : '';
      if (!handle) continue;
      if (typeof o.isServiceCenter !== 'boolean') continue;
      if (!isValidPremiumRetailKind(o.premiumRetailKind)) continue;
      parsed.push({
        handle,
        isServiceCenter: o.isServiceCenter,
        premiumRetailKind: o.premiumRetailKind,
      });
    }

    if (parsed.length === 0 || parsed.length !== entries.length) {
      res.status(400).json({
        error:
          'Each entry must include handle (string), isServiceCenter (boolean), and premiumRetailKind ("boutique" | "multi_brand")',
      });
      return;
    }

    try {
      const result = await premiumService.batchMarkPremium(parsed);
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'INVALID_MARK_PREMIUM_ENTRIES') {
        res.status(400).json({ error: 'Invalid handle in entries' });
        return;
      }
      logger.error('premiumController.markPremium error:', err);
      res.status(500).json({ error: 'Failed to mark stores as premium' });
    }
  },

  /** GET /api/premium-stores/images/:filename — public (map and admin preview). */
  async serveStoreImage(req: Request, res: Response): Promise<void> {
    const filename = req.params.filename as string;
    if (!isValidStoreImageFilename(filename)) {
      res.status(404).end();
      return;
    }
    const abs = storeImageAbsolutePath(filename);
    if (!abs) {
      res.status(404).end();
      return;
    }
    try {
      await fs.access(abs);
    } catch {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', contentTypeForStoreImageFilename(filename));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(abs);
  },

  /** POST /api/premium-stores/stores/:handle/image — multipart field `image`. */
  async uploadStoreImage(req: Request, res: Response): Promise<void> {
    const handle = req.params.handle as string | undefined;
    if (!handle?.trim()) {
      res.status(400).json({ error: 'Missing store handle' });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No image file uploaded (use field name "image")' });
      return;
    }
    try {
      const store = await premiumService.applyStoreImageUpload(handle, file.filename);
      if (!store) {
        await removeStoreImageFile(file.filename).catch(() => undefined);
        res.status(404).json({ error: 'Store not found' });
        return;
      }
      res.json({ store });
    } catch (err) {
      logger.error('premiumController.uploadStoreImage error:', err);
      await removeStoreImageFile(file.filename).catch(() => undefined);
      res.status(500).json({ error: 'Failed to save store image' });
    }
  },

  async updateStore(req: Request, res: Response): Promise<void> {
    const handle = req.params.handle as string | undefined;
    if (!handle || !handle.trim()) {
      res.status(400).json({ error: 'Missing store handle' });
      return;
    }

    const patch = pickPremiumUpdate(req.body);
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    try {
      const store = await premiumService.updateStoreByHandle(handle, patch);
      if (!store) {
        res.status(404).json({ error: 'Store not found' });
        return;
      }
      res.json({ store });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'STORE_TYPE_REQUIRES_PREMIUM') {
        res.status(400).json({
          error: 'Mark the store as premium before changing premium-only fields.',
        });
        return;
      }
      if (err instanceof Error && err.message === ERR_PREMIUM_MARK_METADATA) {
        res.status(400).json({
          error:
            'When marking as premium, premiumRetailKind is required and must be "boutique" or "multi_brand".',
        });
        return;
      }
      logger.error('premiumController.updateStore error:', err);
      res.status(500).json({ error: 'Failed to update store' });
    }
  },

  async reconcile(req: Request, res: Response): Promise<void> {
    try {
      const result = await premiumService.reconcilePremiumLocationFlags();
      res.json(result);
    } catch (err) {
      logger.error('premiumController.reconcile error:', err);
      res.status(500).json({ error: 'Failed to reconcile premium flags' });
    }
  },

  async removePremium(req: Request, res: Response): Promise<void> {
    const { handles } = req.body as { handles?: unknown };

    if (!Array.isArray(handles) || handles.length === 0) {
      res.status(400).json({ error: 'handles must be a non-empty array of strings' });
      return;
    }

    const validHandles = handles.filter((h): h is string => typeof h === 'string' && h.trim() !== '');
    if (validHandles.length === 0) {
      res.status(400).json({ error: 'No valid handles provided' });
      return;
    }

    try {
      const result = await premiumService.batchRemovePremium(validHandles);
      res.json(result);
    } catch (err) {
      logger.error('premiumController.removePremium error:', err);
      res.status(500).json({ error: 'Failed to remove premium status' });
    }
  },
};
