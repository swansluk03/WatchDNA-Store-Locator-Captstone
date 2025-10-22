import { Request, Response } from 'express';
import uploadService from '../services/upload.service';

export class UploadController {

  async uploadCSV(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const file = req.file;

      // Create upload record
      const upload = await uploadService.createUpload({
        filename: file.filename,
        originalFilename: file.originalname,
        fileSize: file.size,
        uploadedBy: req.body.uploadedBy || 'admin'
      });

      // Start validation asynchronously
      uploadService.processUpload(upload.id, file.path)
        .catch(err => {
          console.error('Background validation error:', err);
        });

      res.status(201).json({
        success: true,
        upload: {
          id: upload.id,
          filename: upload.originalFilename,
          status: upload.status,
          uploadedAt: upload.uploadedAt
        },
        message: 'File uploaded successfully. Validation in progress.'
      });

    } catch (error: any) {
      console.error('Upload error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getUpload(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const upload = await uploadService.getUpload(id);

      if (!upload) {
        return res.status(404).json({ error: 'Upload not found' });
      }

      // Parse JSON fields
      const response = {
        ...upload,
        validationErrors: upload.validationErrors ? JSON.parse(upload.validationErrors) : [],
        validationWarnings: upload.validationWarnings ? JSON.parse(upload.validationWarnings) : []
      };

      res.json(response);

    } catch (error: any) {
      console.error('Get upload error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async listUploads(req: Request, res: Response) {
    try {
      const { page, limit, status } = req.query;

      const result = await uploadService.listUploads({
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
        status: status as string
      });

      res.json(result);

    } catch (error: any) {
      console.error('List uploads error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getValidationLogs(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { logType, page, limit } = req.query;

      const result = await uploadService.getValidationLogs(id, {
        logType: logType as string,
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined
      });

      res.json(result);

    } catch (error: any) {
      console.error('Get validation logs error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async deleteUpload(req: Request, res: Response) {
    try {
      const { id } = req.params;

      await uploadService.deleteUpload(id);

      res.json({ success: true, message: 'Upload deleted successfully' });

    } catch (error: any) {
      console.error('Delete upload error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getStats(req: Request, res: Response) {
    try {
      const stats = await uploadService.getStats();
      res.json(stats);
    } catch (error: any) {
      console.error('Get stats error:', error);
      res.status(500).json({ error: error.message });
    }
  }
}

export default new UploadController();
