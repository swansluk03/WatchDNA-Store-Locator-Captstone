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
router.get('/jobs/:id/records', scraperController.getJobRecords);
router.post('/jobs/:id/cancel', scraperController.cancelJob);
router.delete('/jobs/:id', scraperController.deleteJob);

// Master CSV updates
router.patch('/master-csv', scraperController.updateMasterCsvRows);

// Statistics
router.get('/stats', scraperController.getStats);

// Endpoint discovery
router.post('/discover', scraperController.discoverEndpoints);

// Brand configuration routes
router.get('/brands/:id', scraperController.getBrandConfig);
router.post('/brands', scraperController.saveBrandConfig);

export default router;
