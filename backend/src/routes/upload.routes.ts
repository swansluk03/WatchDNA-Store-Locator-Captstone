import { Router } from 'express';
import uploadController from '../controllers/upload.controller';
import { uploadMiddleware } from '../middleware/upload.middleware';
import { authenticate, requireRole } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// POST /api/uploads - Upload CSV file (admin only)
router.post('/', requireRole(['admin']), uploadMiddleware.single('file'), uploadController.uploadCSV);

// GET /api/uploads - List all uploads
router.get('/', uploadController.listUploads);

// GET /api/uploads/stats - Get statistics
router.get('/stats', uploadController.getStats);

// GET /api/uploads/:id - Get single upload details
router.get('/:id', uploadController.getUpload);

// GET /api/uploads/:id/logs - Get validation logs for upload
router.get('/:id/logs', uploadController.getValidationLogs);

// DELETE /api/uploads/:id - Delete upload (admin only)
router.delete('/:id', requireRole(['admin']), uploadController.deleteUpload);

export default router;
