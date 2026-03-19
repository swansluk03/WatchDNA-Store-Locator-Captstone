import { Router } from 'express';
import premiumController from '../controllers/premium.controller';
import { authenticate, requireRole } from '../middleware/auth.middleware';

const router = Router();

// Public — frontend needs these without auth
router.get('/handles', premiumController.getHandles);
router.get('/names', premiumController.getNames);

// Admin-only routes
router.get('/', authenticate, requireRole(['admin']), premiumController.listAll);
router.post('/', authenticate, requireRole(['admin']), premiumController.add);
router.post('/bulk', authenticate, requireRole(['admin']), premiumController.bulkAdd);
router.delete('/:handle', authenticate, requireRole(['admin']), premiumController.remove);

export default router;
