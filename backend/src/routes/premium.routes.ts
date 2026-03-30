import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { premiumController } from '../controllers/premium.controller';

const router = Router();

// Public — the map frontend needs this without auth
router.get('/names', premiumController.getNames);

// Admin-only routes
router.get('/stores', authenticate, premiumController.getStores);
router.post('/stores', authenticate, premiumController.markPremium);
router.delete('/stores', authenticate, premiumController.removePremium);

export default router;
