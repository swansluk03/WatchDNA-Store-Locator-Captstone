import { Request, Response } from 'express';
import { premiumService } from '../services/premium.service';

class PremiumController {
  /** GET /api/premium-stores/handles — public, returns list of premium handles */
  async getHandles(req: Request, res: Response) {
    try {
      const handles = await premiumService.getHandles();
      res.json({ handles });
    } catch (error: any) {
      console.error('[PremiumController] Error fetching handles:', error);
      res.status(500).json({ error: 'Failed to fetch premium handles', message: error.message });
    }
  }

  /** GET /api/premium-stores/names — public, returns names of premium locations for map */
  async getNames(req: Request, res: Response) {
    try {
      const names = await premiumService.getPremiumNames();
      res.json({ names });
    } catch (error: any) {
      console.error('[PremiumController] Error fetching premium names:', error);
      res.status(500).json({ error: 'Failed to fetch premium names', message: error.message });
    }
  }

  /** GET /api/premium-stores — admin, returns full premium store list */
  async listAll(req: Request, res: Response) {
    try {
      const stores = await premiumService.listAll();
      res.json({ stores });
    } catch (error: any) {
      console.error('[PremiumController] Error listing premium stores:', error);
      res.status(500).json({ error: 'Failed to list premium stores', message: error.message });
    }
  }

  /** POST /api/premium-stores — admin, add a store as premium */
  async add(req: Request, res: Response) {
    try {
      const { handle, notes } = req.body;
      if (!handle || typeof handle !== 'string') {
        return res.status(400).json({ error: 'handle is required' });
      }
      const entry = await premiumService.add(handle, notes);
      res.status(201).json(entry);
    } catch (error: any) {
      console.error('[PremiumController] Error adding premium store:', error);
      res.status(500).json({ error: 'Failed to add premium store', message: error.message });
    }
  }

  /** POST /api/premium-stores/bulk — admin, bulk add handles */
  async bulkAdd(req: Request, res: Response) {
    try {
      const { handles, notes } = req.body;
      if (!Array.isArray(handles) || handles.length === 0) {
        return res.status(400).json({ error: 'handles array is required' });
      }
      const result = await premiumService.bulkAdd(handles, notes);
      res.status(201).json(result);
    } catch (error: any) {
      console.error('[PremiumController] Error bulk adding premium stores:', error);
      res.status(500).json({ error: 'Failed to bulk add premium stores', message: error.message });
    }
  }

  /** DELETE /api/premium-stores/:handle — admin, remove premium status */
  async remove(req: Request, res: Response) {
    try {
      const { handle } = req.params;
      const removed = await premiumService.remove(handle);
      if (!removed) {
        return res.status(404).json({ error: 'Premium store not found' });
      }
      res.json({ removed: true, handle });
    } catch (error: any) {
      console.error('[PremiumController] Error removing premium store:', error);
      res.status(500).json({ error: 'Failed to remove premium store', message: error.message });
    }
  }
}

export default new PremiumController();
