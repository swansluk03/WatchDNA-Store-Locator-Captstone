import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { premiumController } from '../controllers/premium.controller';

const router = Router();

router.use(authenticate);

router.get('/stores', premiumController.getStores);
router.post('/stores', premiumController.markPremium);
router.delete('/stores', premiumController.removePremium);

export default router;
