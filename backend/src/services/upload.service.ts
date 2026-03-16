import fs from 'fs/promises';
import path from 'path';
import validationService from './validation.service';
import locationService from './location.service';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';

export class UploadService {

  async createUpload(fileInfo: {
    filename: string;
    originalFilename: string;
    fileSize: number;
    uploadedBy?: string;
  }) {
    return prisma.upload.create({
      data: {
        filename: fileInfo.filename,
        originalFilename: fileInfo.originalFilename,
        fileSize: fileInfo.fileSize,
        uploadedBy: fileInfo.uploadedBy || 'admin',
        status: 'pending'
      }
    });
  }

  async processUpload(uploadId: string, filePath: string) {
    try {
      await prisma.upload.update({
        where: { id: uploadId },
        data: { status: 'validating' }
      });

      logger.info(`[Upload ${uploadId}] Validating...`);
      const validationResult = await validationService.validateCSV(filePath, {
        autoFix: true,
        checkUrls: false
      });
      logger.info(`[Upload ${uploadId}] Validation ${validationResult.valid ? 'passed' : 'failed'} — errors: ${validationResult.errors.length}, warnings: ${validationResult.warnings.length}`);

      const updateData = validationService.formatForDatabase(validationResult);
      await prisma.upload.update({ where: { id: uploadId }, data: updateData });

      const logs = validationService.createValidationLogs(uploadId, validationResult);
      if (logs.length > 0) {
        await prisma.validationLog.createMany({ data: logs });
      }

      if (updateData.status === 'valid') {
        logger.info(`[Upload ${uploadId}] Importing to DB...`);
        try {
          const importResult = await locationService.importFromCSV(filePath);
          logger.info(`[Upload ${uploadId}] Import done — new: ${importResult.newCount}, updated: ${importResult.updatedCount}`);
          await prisma.upload.update({
            where: { id: uploadId },
            data: {
              status: 'completed',
              rowsProcessed: importResult.newCount + importResult.updatedCount
            }
          });
        } catch (importError: any) {
          logger.error(`[Upload ${uploadId}] Import failed:`, importError.message);
        }
      }

      return { success: true, uploadId, validationResult };

    } catch (error: any) {
      logger.error(`[Upload ${uploadId}] Processing failed:`, error.message);
      await prisma.upload.update({
        where: { id: uploadId },
        data: {
          status: 'failed',
          validationErrors: JSON.stringify([{ issue: 'processing_error', message: error.message }])
        }
      });
      throw error;
    }
  }

  async getUpload(uploadId: string) {
    return prisma.upload.findUnique({
      where: { id: uploadId },
      include: { validationLogs: { orderBy: { rowNumber: 'asc' } } }
    });
  }

  async listUploads(params: { page?: number; limit?: number; status?: string }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.status) where.status = params.status;

    const [uploads, total] = await Promise.all([
      prisma.upload.findMany({
        where,
        orderBy: { uploadedAt: 'desc' },
        skip,
        take: limit,
        include: { _count: { select: { validationLogs: true, locations: true } } }
      }),
      prisma.upload.count({ where })
    ]);

    return {
      uploads,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  async getValidationLogs(uploadId: string, params: { logType?: string; page?: number; limit?: number }) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = { uploadId };
    if (params.logType) where.logType = params.logType;

    const [logs, total] = await Promise.all([
      prisma.validationLog.findMany({
        where,
        orderBy: [{ rowNumber: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: limit
      }),
      prisma.validationLog.count({ where })
    ]);

    return { logs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async deleteUpload(uploadId: string) {
    const upload = await prisma.upload.findUnique({ where: { id: uploadId } });
    if (!upload) throw new Error('Upload not found');

    await prisma.upload.delete({ where: { id: uploadId } });

    try {
      const uploadDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
      await fs.unlink(path.join(uploadDir, upload.filename));
    } catch (error: any) {
      logger.warn(`[Upload ${uploadId}] File deletion failed (DB record removed):`, error.message);
    }

    return { success: true };
  }

  async getStats() {
    const [totalUploads, validUploads, invalidUploads, totalLocations] = await Promise.all([
      prisma.upload.count(),
      prisma.upload.count({ where: { status: 'valid' } }),
      prisma.upload.count({ where: { status: 'invalid' } }),
      prisma.location.count()
    ]);
    return { totalUploads, validUploads, invalidUploads, totalLocations };
  }

  /**
   * Get the full file path for an upload filename.
   * Returns null if the path escapes the uploads directory (security check).
   */
  async getFilePath(filename: string): Promise<string | null> {
    try {
      const uploadDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
      const absolute = path.resolve(path.join(uploadDir, filename));
      if (!absolute.startsWith(path.resolve(uploadDir))) {
        logger.warn('[Upload] Path traversal attempt blocked:', filename);
        return null;
      }
      return absolute;
    } catch (error: any) {
      logger.error('[Upload] getFilePath error:', error.message);
      return null;
    }
  }

  async getMasterCSVPath(): Promise<string | null> {
    try {
      const uploadDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
      return path.resolve(path.join(uploadDir, 'master_stores.csv'));
    } catch (error: any) {
      logger.error('[Upload] getMasterCSVPath error:', error.message);
      return null;
    }
  }

  async revalidateUpload(uploadId: string, options?: { autoFix?: boolean; checkUrls?: boolean }) {
    try {
      const upload = await prisma.upload.findUnique({ where: { id: uploadId } });
      if (!upload) throw new Error('Upload not found');

      const filePath = await this.getFilePath(upload.filename);
      if (!filePath) throw new Error('File path could not be resolved');

      await prisma.upload.update({ where: { id: uploadId }, data: { status: 'validating' } });

      logger.info(`[Upload ${uploadId}] Re-validating${options?.autoFix ? ' with auto-fix' : ''}...`);
      const validationResult = await validationService.validateCSV(filePath, options || {});

      await prisma.validationLog.deleteMany({ where: { uploadId } });

      const updateData = validationService.formatForDatabase(validationResult);
      await prisma.upload.update({ where: { id: uploadId }, data: updateData });

      const logs = validationService.createValidationLogs(uploadId, validationResult);
      if (logs.length > 0) {
        await prisma.validationLog.createMany({ data: logs });
      }

      logger.info(`[Upload ${uploadId}] Re-validation ${validationResult.valid ? 'passed' : 'failed'} — errors: ${validationResult.errors.length}`);
      return { success: true, uploadId, validationResult };

    } catch (error: any) {
      logger.error(`[Upload ${uploadId}] Re-validation error:`, error.message);
      await prisma.upload.update({
        where: { id: uploadId },
        data: {
          status: 'failed',
          validationErrors: JSON.stringify([{ issue: 'revalidation_error', message: error.message }])
        }
      });
      throw error;
    }
  }
}

export default new UploadService();
