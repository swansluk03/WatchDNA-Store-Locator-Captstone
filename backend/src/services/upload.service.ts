import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import validationService from './validation.service';

const prisma = new PrismaClient();

export class UploadService {

  async createUpload(fileInfo: {
    filename: string;
    originalFilename: string;
    fileSize: number;
    uploadedBy?: string;
  }) {
    return await prisma.upload.create({
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
      // Update status to validating
      await prisma.upload.update({
        where: { id: uploadId },
        data: { status: 'validating' }
      });

      // Run validation
      console.log(`Starting validation for upload ${uploadId}...`);
      const validationResult = await validationService.validateCSV(filePath);
      console.log(`Validation complete. Valid: ${validationResult.valid}, Errors: ${validationResult.errors.length}`);

      // Update upload with validation results
      const updateData = validationService.formatForDatabase(validationResult);
      await prisma.upload.update({
        where: { id: uploadId },
        data: updateData
      });

      // Create validation log entries
      const logs = validationService.createValidationLogs(uploadId, validationResult);
      if (logs.length > 0) {
        await prisma.validationLog.createMany({
          data: logs
        });
      }

      console.log(`Upload ${uploadId} processed successfully. Status: ${updateData.status}`);

      return {
        success: true,
        uploadId,
        validationResult
      };

    } catch (error: any) {
      console.error(`Error processing upload ${uploadId}:`, error);

      // Update upload status to failed
      await prisma.upload.update({
        where: { id: uploadId },
        data: {
          status: 'failed',
          validationErrors: JSON.stringify([{
            issue: 'processing_error',
            message: error.message
          }])
        }
      });

      throw error;
    }
  }

  async getUpload(uploadId: string) {
    return await prisma.upload.findUnique({
      where: { id: uploadId },
      include: {
        validationLogs: {
          orderBy: {
            rowNumber: 'asc'
          }
        }
      }
    });
  }

  async listUploads(params: {
    page?: number;
    limit?: number;
    status?: string;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.status) {
      where.status = params.status;
    }

    const [uploads, total] = await Promise.all([
      prisma.upload.findMany({
        where,
        orderBy: {
          uploadedAt: 'desc'
        },
        skip,
        take: limit,
        include: {
          _count: {
            select: {
              validationLogs: true,
              locations: true
            }
          }
        }
      }),
      prisma.upload.count({ where })
    ]);

    return {
      uploads,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getValidationLogs(uploadId: string, params: {
    logType?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = { uploadId };
    if (params.logType) {
      where.logType = params.logType;
    }

    const [logs, total] = await Promise.all([
      prisma.validationLog.findMany({
        where,
        orderBy: [
          { rowNumber: 'asc' },
          { createdAt: 'asc' }
        ],
        skip,
        take: limit
      }),
      prisma.validationLog.count({ where })
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async deleteUpload(uploadId: string) {
    // Get upload to find file path
    const upload = await prisma.upload.findUnique({
      where: { id: uploadId }
    });

    if (!upload) {
      throw new Error('Upload not found');
    }

    // Delete from database (cascade will delete logs)
    await prisma.upload.delete({
      where: { id: uploadId }
    });

    // Delete file
    try {
      const uploadDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
      const filePath = path.join(uploadDir, upload.filename);
      await fs.unlink(filePath);
    } catch (error) {
      console.error('Error deleting file:', error);
      // Don't throw - database record is already deleted
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

    return {
      totalUploads,
      validUploads,
      invalidUploads,
      totalLocations
    };
  }

  /**
   * Get the full file path for an upload
   */
  async getFilePath(filename: string): Promise<string | null> {
    try {
      const uploadDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
      const filePath = path.join(uploadDir, filename);
      
      // Resolve to absolute path
      const absolutePath = path.resolve(filePath);
      
      // Security check: ensure file is within uploads directory
      const uploadsDirAbsolute = path.resolve(uploadDir);
      if (!absolutePath.startsWith(uploadsDirAbsolute)) {
        console.error('Security: Attempted to access file outside uploads directory');
        return null;
      }
      
      return absolutePath;
    } catch (error) {
      console.error('Error getting file path:', error);
      return null;
    }
  }

  /**
   * Get the path to the master CSV file
   */
  async getMasterCSVPath(): Promise<string | null> {
    try {
      const uploadDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
      const masterCsvPath = path.join(uploadDir, 'master_stores.csv');
      return path.resolve(masterCsvPath);
    } catch (error) {
      console.error('Error getting master CSV path:', error);
      return null;
    }
  }
}

export default new UploadService();
