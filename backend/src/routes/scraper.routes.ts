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
router.patch('/jobs/:id/records', scraperController.saveJobRecords);
router.get('/jobs/:id/dropped-records', scraperController.getJobDroppedRecords);
router.post('/jobs/:id/cancel', scraperController.cancelJob);
router.delete('/jobs/:id', scraperController.deleteJob);

// Master CSV - get records (with optional brand filter), update, and remove
router.get('/master-csv/records', scraperController.getMasterCsvRecords);
router.patch('/master-csv', scraperController.updateMasterCsvRows);
router.delete('/master-csv/records', scraperController.deleteMasterRecord);

// Statistics
router.get('/stats', scraperController.getStats);

// Endpoint discovery
router.post('/discover', scraperController.discoverEndpoints);

// Brand configuration routes
router.get('/brands/:id', scraperController.getBrandConfig);
router.post('/brands', scraperController.saveBrandConfig);

export default router;
