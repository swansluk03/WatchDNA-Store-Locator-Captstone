import { Request, Response } from 'express';
import { premiumService } from '../services/premium.service';
import { logger } from '../utils/logger';

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
      const result = await premiumService.batchMarkPremium(validHandles);
      res.json(result);
    } catch (err) {
      logger.error('premiumController.markPremium error:', err);
      res.status(500).json({ error: 'Failed to mark stores as premium' });
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
