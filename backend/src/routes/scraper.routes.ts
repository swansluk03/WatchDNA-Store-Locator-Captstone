import { Router } from 'express';
import { scraperController } from '../controllers/scraper.controller';

const router = Router();

// Brand config routes
router.get('/brands', scraperController.getBrands);

// Job management routes
router.post('/jobs', scraperController.createJob);
router.get('/jobs', scraperController.listJobs);
router.get('/jobs/:id', scraperController.getJob);
router.get('/jobs/:id/logs', scraperController.getJobLogs);
router.post('/jobs/:id/cancel', scraperController.cancelJob);
router.delete('/jobs/:id', scraperController.deleteJob);

// Statistics
router.get('/stats', scraperController.getStats);

export default router;
