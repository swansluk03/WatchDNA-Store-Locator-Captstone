import fs from 'fs/promises';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { premiumService, type MarkPremiumEntry, type PremiumStoreUpdateInput } from '../services/premium.service';
import {
  deleteShopifyFile,
  searchShopifyFiles,
  shopifyFilesConfigured,
  uploadPremiumStoreImageToShopify,
} from '../services/shopify-files.service';
import { logger } from '../utils/logger';
import {
  STORE_IMAGE_MIME_TO_EXT,
  contentTypeForStoreImageFilename,
  isValidStoreImageFilename,
  removeStoreImageFile,
  storeImageAbsolutePath,
} from '../utils/store-premium-image';

function normImageUrl(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

const PATCH_KEYS: (keyof PremiumStoreUpdateInput)[] = [
  'name',
  'nameEn',
  'addressLine1',
  'addressLine1En',
  'addressLine2',
  'city',
  'cityEn',
  'stateProvinceRegion',
  'postalCode',
  'country',
  'phone',
  'website',
  'imageUrl',
  'shopifyFileGid',
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
      parsed.push({
        handle,
        isServiceCenter: o.isServiceCenter,
      });
    }

    if (parsed.length === 0 || parsed.length !== entries.length) {
      res.status(400).json({
        error: 'Each entry must include handle (string) and isServiceCenter (boolean)',
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
      if (shopifyFilesConfigured()) {
        const buf = (file as Express.Multer.File & { buffer?: Buffer }).buffer;
        if (!buf?.length) {
          res.status(400).json({ error: 'Empty image upload' });
          return;
        }
        const h = handle.trim();
        logger.integration(`[premium-image] POST image (Shopify Files) handle=${h} size=${buf.length}`);

        const beforeShopify = await premiumService.getLocationShopifyImageRow(h);

        const ext = STORE_IMAGE_MIME_TO_EXT[file.mimetype] ?? '.jpg';
        const originalName = (file.originalname || '').trim();
        const baseName = originalName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
        // Append a short timestamp so re-uploads of the same filename never silently collide in Shopify Files.
        const ts = Date.now().toString(36);
        const filename = baseName ? `${baseName}_${ts}${ext}` : `${uuidv4()}${ext}`;
        const alt = `Store ${h.slice(0, 120)}`;
        const { cdnUrl, fileGid } = await uploadPremiumStoreImageToShopify({
          buffer: buf,
          mimeType: file.mimetype,
          filename,
          alt,
          storeHandle: h,
        });
        const store = await premiumService.applyStoreImageExternalUrl(handle, cdnUrl, fileGid, {
          exclusiveShopifyUpload: true,
        });
        if (!store) {
          logger.warn(`[premium-image] store not found after Shopify upload handle=${h}`);
          res.status(404).json({ error: 'Store not found' });
          return;
        }
        logger.integration(`[premium-image] saved imageUrl to DB handle=${h} gid=${fileGid}`);

        if (beforeShopify.exclusiveUpload === true && beforeShopify.gid) {
          logger.integration(
            `[premium-image] deleting replaced app-owned Shopify file gid=${beforeShopify.gid} handle=${h}`
          );
          deleteShopifyFile(beforeShopify.gid).catch((err) =>
            logger.warn(`[premium-image] old file delete failed gid=${beforeShopify.gid}`, err)
          );
        }

        res.json({ store });
        return;
      }

      logger.integration(
        `[premium-image] POST image (local disk) handle=${handle.trim()} file=${file.filename}`
      );
      const store = await premiumService.applyStoreImageUpload(handle, file.filename);
      if (!store) {
        await removeStoreImageFile(file.filename).catch(() => undefined);
        res.status(404).json({ error: 'Store not found' });
        return;
      }
      logger.integration(`[premium-image] saved local imageUrl handle=${handle.trim()}`);
      res.json({ store });
    } catch (err) {
      const h = handle?.trim() ?? '';
      logger.error(
        `[premium-image] upload failed handle=${h} shopify=${shopifyFilesConfigured()}`,
        err
      );
      if (!shopifyFilesConfigured()) {
        await removeStoreImageFile(file.filename).catch(() => undefined);
      }
      const msg = err instanceof Error ? err.message : 'Failed to save store image';
      res.status(500).json({ error: msg });
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
      const beforeRow = await premiumService.getLocationShopifyImageRow(handle.trim());

      const store = await premiumService.updateStoreByHandle(handle, patch);
      if (!store) {
        res.status(404).json({ error: 'Store not found' });
        return;
      }

      // Only delete from Shopify when the previous file was created by our upload flow (exclusive)
      // and the store is actually releasing that asset (URL/GID changed or image cleared).
      let gidToDelete: string | null = null;
      if (shopifyFilesConfigured() && beforeRow.exclusiveUpload === true && beforeRow.gid) {
        const patchUrl = 'imageUrl' in patch ? normImageUrl(patch.imageUrl) : undefined;
        const patchGid = 'shopifyFileGid' in patch ? (patch.shopifyFileGid ?? null) : undefined;
        const beforeUrl = normImageUrl(beforeRow.imageUrl);

        const urlCleared = patchUrl !== undefined && patchUrl === null && beforeUrl !== null;
        const urlChanged =
          patchUrl !== undefined && beforeUrl !== null && patchUrl !== beforeUrl;
        const gidChanged = patchGid !== undefined && patchGid !== beforeRow.gid;

        if (urlCleared || urlChanged || gidChanged) {
          gidToDelete = beforeRow.gid;
        }
      }

      if (gidToDelete) {
        logger.integration(
          `[premium-image] deleting released app-owned Shopify file gid=${gidToDelete} handle=${handle.trim()}`
        );
        deleteShopifyFile(gidToDelete).catch((err) =>
          logger.warn(`[premium-image] old file delete failed gid=${gidToDelete}`, err)
        );
      }

      res.json({ store });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'STORE_TYPE_REQUIRES_PREMIUM') {
        res.status(400).json({
          error: 'Mark the store as premium before changing premium-only fields.',
        });
        return;
      }
      logger.error('premiumController.updateStore error:', err);
      res.status(500).json({ error: 'Failed to update store' });
    }
  },

  /**
   * GET /api/premium-stores/shopify-files?q=&limit=
   * Searches Shopify Content → Files for images matching the query. Requires read_files scope on the app.
   */
  async searchShopifyFiles(req: Request, res: Response): Promise<void> {
    if (!shopifyFilesConfigured()) {
      res.json({ files: [], configured: false });
      return;
    }
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10) || 20, 50);
    try {
      const files = await searchShopifyFiles(q, limit);
      res.json({ files, configured: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/access denied|unauthorized|read_files/i.test(msg)) {
        logger.warn('premiumController.searchShopifyFiles: Shopify access denied — add read_files scope', msg);
        res.status(503).json({
          error: 'Shopify file search is unavailable. Ensure the app has the read_files scope and reinstall.',
          configured: true,
        });
        return;
      }
      logger.error('premiumController.searchShopifyFiles error:', err);
      res.status(500).json({ error: 'Failed to search Shopify files' });
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
