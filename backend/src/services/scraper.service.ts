import { PrismaClient } from '@prisma/client';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import validationService from './validation.service';
import { SCRAPER_PATH, PYTHON_CMD } from '../utils/paths';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

class ScraperService {
  // Track running processes for cancellation
  private runningProcesses: Map<string, ChildProcess> = new Map();
  /**
   * Start a scraping job
   */
  async startScraping(
    jobId: string, 
    brandName: string, 
    url: string, 
    region: string,
    config: any
  ): Promise<void> {
    try {
      // Update job status to running with initial log
      await prisma.scraperJob.update({
        where: { id: jobId },
        data: { 
          status: 'running',
          logs: `[${new Date().toISOString()}] Starting scraping job for ${brandName}\n[${new Date().toISOString()}] URL: ${url}\n[${new Date().toISOString()}] Region: ${region}\n`
        }
      });

      const scraperPath = SCRAPER_PATH;
      const outputDir = path.join(__dirname, '..', '..', 'uploads', 'scraped');
      const masterCsvDir = path.join(__dirname, '..', '..', 'uploads');
      
      // Individual CSV file for this brand scrape (for debugging/tracking)
      const individualCsvFile = path.join(outputDir, `${brandName}_${Date.now()}.csv`);
      
      // Master CSV file (accumulates all brands)
      const masterCsvFile = path.join(masterCsvDir, 'master_stores.csv');

      // Ensure output directories exist
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      if (!fs.existsSync(masterCsvDir)) {
        fs.mkdirSync(masterCsvDir, { recursive: true });
      }

      const pythonCmd = PYTHON_CMD;

      // Run the Python scraper (outputs to individual CSV)
      const pythonProcess = spawn(pythonCmd, [
        '-u', // Unbuffered output - ensures real-time logging
        path.join(scraperPath, 'universal_scraper.py'),
        '--url', url,
        '--output', individualCsvFile,
        '--region', region,
        '--brand-config', JSON.stringify(config) // Pass brand config for field mapping
      ], {
        cwd: scraperPath,
        env: { 
          ...process.env,
          PYTHONUNBUFFERED: '1' // Also set env var for extra safety
        }
      });

      // Track this process for cancellation
      this.runningProcesses.set(jobId, pythonProcess);

      let stdout = '';
      let stderr = '';
      let lastLogUpdate = Date.now();
      const LOG_UPDATE_INTERVAL = 500; // Update every 500ms for better real-time viewing

      // Helper function to format logs with timestamps
      const formatLogs = (stdout: string, stderr: string) => {
        const timestamp = new Date().toISOString();
        let formatted = `=== JOB STARTED ===\n`;
        formatted += `Brand: ${brandName}\n`;
        formatted += `URL: ${url}\n`;
        formatted += `Region: ${region}\n`;
        formatted += `Type: ${config.type || 'auto-detect'}\n`;
        formatted += `Started: ${timestamp}\n`;
        formatted += `\n=== LIVE OUTPUT ===\n${stdout}`;
        if (stderr) {
          formatted += `\n\n=== ERRORS ===\n${stderr}`;
        }
        return formatted;
      };

      pythonProcess.stdout.on('data', async (data) => {
        const output = data.toString();
        stdout += output;
        logger.info(`[Scraper ${jobId}] ${output.trim()}`);
        
        // Check for important log markers that should trigger immediate update
        const importantMarkers = [
          '🔍', '✅', '❌', '⚠️', '📡', '🗺️', '🌍', 
          'Analyzing', 'Scraping', 'Normalizing', 'Validating',
          'Found', 'stores', 'ERROR', 'SUCCESS'
        ];
        const isImportant = importantMarkers.some(marker => output.includes(marker));
        
        // Update logs immediately for important events, or on interval for others
        const now = Date.now();
        const shouldUpdate = isImportant || (now - lastLogUpdate > LOG_UPDATE_INTERVAL);
        
        if (shouldUpdate) {
          lastLogUpdate = now;
          try {
            await prisma.scraperJob.update({
              where: { id: jobId },
              data: {
                logs: formatLogs(stdout, stderr)
              }
            });
          } catch (err) {
            logger.warn(`Failed to update live logs for ${jobId}:`, err);
          }
        }
      });

      pythonProcess.stderr.on('data', async (data) => {
        const output = data.toString();
        stderr += output;
        logger.error(`[Scraper ${jobId}] ERROR: ${output.trim()}`);
        
        // Update errors immediately (don't wait for interval)
        try {
          await prisma.scraperJob.update({
            where: { id: jobId },
            data: {
              logs: formatLogs(stdout, stderr)
            }
          });
          lastLogUpdate = Date.now();
        } catch (err) {
            logger.warn(`Failed to update live error logs for ${jobId}:`, err);
        }
      });

      pythonProcess.on('close', async (code) => {
        // Clean up the process from tracking map
        this.runningProcesses.delete(jobId);
        
        const completionTime = new Date().toISOString();
        const fullLogs = formatLogs(stdout, stderr) + `\n\n=== JOB COMPLETED ===\nExit Code: ${code}\nCompleted: ${completionTime}`;
        
        if (code === 0) {
          // Success - parse results, merge to master CSV, and create uploads
          let recordsScraped: number | null = null; // Track if recordsScraped was set
          let individualUpload: any = null;
          
          try {
            const individualFileStats = fs.statSync(individualCsvFile);
            // Count actual data rows (excluding header)
            const totalRows = await this.countCsvRows(individualCsvFile);
            
            // Parse the output to get actual normalized count
            const normalizedMatch = stdout.match(/(\d+)\s+stores\s+normalized/i) || 
                                   stdout.match(/✅\s+(\d+)\s+stores/i);
            recordsScraped = normalizedMatch ? parseInt(normalizedMatch[1]) : totalRows;

            // Merge individual CSV into master CSV with deduplication
            // Add timeout to prevent hanging
            const masterCsvManagerPath = path.join(scraperPath, 'master_csv_manager.py');
            let mergeStdout = '';
            let mergeStderr = '';
            
            try {
              const mergeProcess = spawn(pythonCmd, [
                masterCsvManagerPath,
                individualCsvFile,
                masterCsvFile,
                brandName
              ], {
                cwd: scraperPath,
                env: { ...process.env }
              });

              mergeProcess.stdout.on('data', (data) => {
                mergeStdout += data.toString();
                logger.info(`[Master CSV Merge ${jobId}] ${data.toString().trim()}`);
              });
              mergeProcess.stderr.on('data', (data) => {
                mergeStderr += data.toString();
                logger.error(`[Master CSV Merge ${jobId}] ERROR: ${data.toString().trim()}`);
              });

              // Add timeout (5 minutes for merge operation)
              let mergeTimeout: NodeJS.Timeout | null = setTimeout(() => {
                if (!mergeProcess.killed) {
                  logger.warn(`⚠️ Master CSV merge timed out after 5 minutes for job ${jobId}`);
                  mergeProcess.kill();
                }
                mergeTimeout = null; // Clear reference after timeout fires
              }, 300000); // 5 minutes

              // Helper to safely clear timeout
              const clearMergeTimeout = () => {
                if (mergeTimeout !== null) {
                  clearTimeout(mergeTimeout);
                  mergeTimeout = null;
                }
              };

              await new Promise<void>((resolve) => {
                mergeProcess.on('close', (code) => {
                  clearMergeTimeout(); // Always clear timeout when process closes
                  if (code === 0) {
                    logger.warn(`✅ Master CSV merge completed for job ${jobId}`);                    resolve();
                  } else {
                    logger.error(`⚠️ Master CSV merge failed (code ${code}) for job ${jobId}: ${mergeStderr}`);
                    // Don't fail the job if merge fails, just log it
                    resolve();
                  }
                });
                mergeProcess.on('error', (error) => {
                  clearMergeTimeout(); // Always clear timeout on error
                  logger.error(`⚠️ Master CSV merge error for job ${jobId}: ${error.message}`);
                  // Don't fail the job if merge fails
                  resolve();
                });
              });
              
              // Ensure timeout is cleared even if promise resolves/rejects unexpectedly
              clearMergeTimeout();
            } catch (mergeError: any) {
              logger.error(`⚠️ Error starting master CSV merge for job ${jobId}:`, mergeError);
              // Continue even if merge fails - don't block job completion
            }

            // Get master CSV stats if it exists
            let masterFileStats = null;
            let masterRows = 0;
            if (fs.existsSync(masterCsvFile)) {
              masterFileStats = fs.statSync(masterCsvFile);
              masterRows = await this.countCsvRows(masterCsvFile);
            }

            // Create Upload record for individual CSV
            // Store relative path from uploads directory (e.g., "scraped/brand_timestamp.csv")
            const uploadsBaseDir = path.join(__dirname, '..', '..', 'uploads');
            const individualFilename = path.relative(uploadsBaseDir, individualCsvFile);
            
            individualUpload = await prisma.upload.create({
              data: {
                filename: individualFilename,
                originalFilename: `${brandName}_scraped_${Date.now()}.csv`,
                fileSize: individualFileStats.size,
                uploadedBy: 'scraper',
                status: 'completed',
                brandConfig: brandName,
                scraperType: config.type || 'json',
                rowsTotal: recordsScraped !== null ? recordsScraped : 0,
                rowsProcessed: recordsScraped !== null ? recordsScraped : 0,
              }
            });

            // Run validation on scraped CSV so View Run shows errors, warnings, and logs
            try {
              const validationResult = await validationService.validateCSV(individualCsvFile, {
                autoFix: false,
                checkUrls: false
              });
              const updateData = validationService.formatForDatabase(validationResult);
              await prisma.upload.update({
                where: { id: individualUpload.id },
                data: {
                  validationErrors: updateData.validationErrors,
                  validationWarnings: updateData.validationWarnings,
                }
              });
              const logs = validationService.createValidationLogs(individualUpload.id, validationResult);
              if (logs.length > 0) {
                await prisma.validationLog.createMany({ data: logs });
              }
            } catch (validationErr: any) {
              logger.warn(`[Job ${jobId}] Validation failed (upload still created):`, validationErr?.message);
            }

            // Create or update Upload record for master CSV
            // Check if master CSV upload already exists
            const existingMasterUpload = await prisma.upload.findFirst({
              where: {
                originalFilename: 'master_stores.csv',
                uploadedBy: 'scraper'
              },
              orderBy: {
                uploadedAt: 'desc'
              }
            });

            let masterUpload;
            if (existingMasterUpload && masterFileStats) {
              // Update existing master upload
              masterUpload = await prisma.upload.update({
                where: { id: existingMasterUpload.id },
                data: {
                  fileSize: masterFileStats.size,
                  rowsTotal: masterRows,
                  rowsProcessed: masterRows,
                  uploadedAt: new Date() // Update timestamp
                }
              });
            } else if (masterFileStats) {
              // Create new master upload record
              // Store just the filename since it's in the uploads directory
              masterUpload = await prisma.upload.create({
                data: {
                  filename: 'master_stores.csv',
                  originalFilename: 'master_stores.csv',
                  fileSize: masterFileStats.size,
                  uploadedBy: 'scraper',
                  status: 'completed',
                  brandConfig: 'all_brands',
                  scraperType: 'master',
                  rowsTotal: masterRows,
                  rowsProcessed: masterRows,
                }
              });
            }

            // Update job with logs - ensure this always happens even if there are errors
            const mergeInfo = mergeStdout ? `\n\n=== MASTER CSV MERGE ===\n${mergeStdout}` : '';
            const mergeErrorInfo = mergeStderr ? `\n\n=== MASTER CSV MERGE ERRORS ===\n${mergeStderr}` : '';
            const finalLogs = fullLogs + mergeInfo + mergeErrorInfo;
            
            // CRITICAL: Update job status - this MUST happen even if other operations fail
            logger.info(`[Job ${jobId}] Updating job status to completed...`);
            try {
              await prisma.scraperJob.update({
                where: { id: jobId },
                data: {
                  status: 'completed',
                  completedAt: new Date(),
                  recordsScraped: recordsScraped !== null ? recordsScraped : 0,
                  uploadId: individualUpload?.id || null,
                  logs: finalLogs
                }
              });

              logger.warn(`✅ Scraping job ${jobId} completed. Records: ${recordsScraped !== null ? recordsScraped : 0}`);
              if (masterFileStats) {
                logger.warn(`   Master CSV: ${masterRows} total stores (after deduplication)`);
              }
              if (mergeStdout) {
                const mergeLines = mergeStdout.split('\n');
                const finalSummary = mergeLines.filter(line =>
                  line.includes('FINAL SUMMARY') ||
                  line.includes('Master CSV final:') ||
                  line.includes('Total deduplicated:')
                );
                if (finalSummary.length > 0) {
                  logger.warn(finalSummary.map(l => l.trim()).join(' | '));
                }
              }
            } catch (updateError: any) {
              logger.error(`⚠️ Failed to update job status for ${jobId}:`, updateError);
              try {
                logger.info(`[Job ${jobId}] Retrying status update with minimal data...`);
                await prisma.scraperJob.update({
                  where: { id: jobId },
                  data: {
                    status: 'completed',
                    completedAt: new Date(),
                    recordsScraped: recordsScraped !== null ? recordsScraped : 0,
                    uploadId: individualUpload?.id || null,
                    logs: `Status update error occurred, but job completed successfully.\n\n${finalLogs}\n\nUpdate Error: ${updateError.message}`
                  }
                });
                logger.warn(`✅ Retry status update succeeded for job ${jobId}`);
              } catch (retryError: any) {
                logger.error(`❌ Critical: Could not update job ${jobId} status even after retry:`, retryError);
              }
            }
          } catch (error: any) {
            logger.error(`Error processing scraper results for job ${jobId}:`, error);
            
            // Ensure we always update status, even on error
            // Only use fallback if recordsScraped was never set (null)
            // If recordsScraped was set (including 0), use that value
            const finalRecordsScraped = recordsScraped !== null ? recordsScraped : (() => {
              const match = stdout.match(/(\d+)\s+stores\s+normalized/i);
              return match ? parseInt(match[1]) : 0;
            })();
            
            try {
              await prisma.scraperJob.update({
                where: { id: jobId },
                data: {
                  status: 'failed',
                  completedAt: new Date(),
                  errorMessage: `Post-processing error: ${error.message}`,
                  recordsScraped: finalRecordsScraped,
                  logs: fullLogs + `\n\n=== POST-PROCESSING ERROR ===\n${error.message}\n${error.stack || ''}`
                }
              });
            } catch (updateError: any) {
              logger.error(`❌ Critical: Could not update failed job status for ${jobId}:`, updateError);
            }
          }
        } else {
          await prisma.scraperJob.update({
            where: { id: jobId },
            data: {
              status: 'failed',
              completedAt: new Date(),
              errorMessage: stderr || `Process exited with code ${code}`,
              logs: fullLogs
            }
          });

          logger.error(`❌ Scraping job ${jobId} failed with code ${code}`);
        }
      });

      pythonProcess.on('error', async (error) => {
        this.runningProcesses.delete(jobId);
        logger.error(`Error spawning Python process for job ${jobId}:`, error);
        await prisma.scraperJob.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errorMessage: error.message,
            logs: `=== ERROR ===\n${error.message}\n${error.stack || ''}`
          }
        });
      });

    } catch (error: any) {
      logger.error(`Error starting scraping job ${jobId}:`, error);
      await prisma.scraperJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: error.message,
          logs: `=== ERROR ===\n${error.message}\n${error.stack || ''}`
        }
      });
    }
  }

  /**
   * Cancel a running scraping job
   */
  async cancelJob(jobId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Check if job exists and is running
      const job = await prisma.scraperJob.findUnique({
        where: { id: jobId }
      });

      if (!job) {
        return { success: false, message: 'Job not found' };
      }

      if (job.status !== 'running') {
        return { success: false, message: `Job is not running (status: ${job.status})` };
      }

      // Get the process
      const process = this.runningProcesses.get(jobId);
      
      if (!process) {
        // Process not found in map, but job is marked as running
        // Update job status to cancelled anyway
        await prisma.scraperJob.update({
          where: { id: jobId },
          data: {
            status: 'cancelled',
            completedAt: new Date(),
            errorMessage: 'Job was cancelled (process not found)',
            logs: (job.logs || '') + `\n\n[${new Date().toISOString()}] Job cancelled by user`
          }
        });
        return { success: true, message: 'Job marked as cancelled (process not found)' };
      }

      // Kill the process
      logger.warn(`🛑 Cancelling scraping job ${jobId}...`);
      process.kill('SIGTERM');

      setTimeout(() => {
        if (this.runningProcesses.has(jobId)) {
          logger.warn(`🛑 Force killing job ${jobId}...`);
          process.kill('SIGKILL');
        }
      }, 5000);

      // Update job status
      await prisma.scraperJob.update({
        where: { id: jobId },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
          errorMessage: 'Job was cancelled by user',
          logs: (job.logs || '') + `\n\n[${new Date().toISOString()}] ⛔ Job cancelled by user`
        }
      });

      // Remove from tracking map
      this.runningProcesses.delete(jobId);

      logger.warn(`✅ Scraping job ${jobId} cancelled`);
      return { success: true, message: 'Job cancelled successfully' };

    } catch (error: any) {
      logger.error(`Error cancelling job ${jobId}:`, error);
      return { success: false, message: `Error cancelling job: ${error.message}` };
    }
  }

  /**
   * Save job records: persist to job CSV, then append complete records to master.
   * Incomplete records (missing phone or address) stay in job CSV only.
   */
  async saveJobRecords(
    jobId: string,
    records: Record<string, string>[]
  ): Promise<{
    savedToJob: number;
    appendedToMaster: number;
    skippedIncomplete: number;
    validationErrors?: number;
  }> {
    const job = await prisma.scraperJob.findUnique({
      where: { id: jobId },
      include: { upload: true }
    });
    if (!job || job.status !== 'completed' || !job.uploadId || !job.upload) {
      throw new Error('Job not found or has no upload');
    }

    const uploadService = (await import('./upload.service')).default;
    const filePath = await uploadService.getFilePath(job.upload.filename);
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('Job CSV file not found');
    }

    const masterCsvPath = await uploadService.getMasterCSVPath();
    if (!masterCsvPath || !fs.existsSync(masterCsvPath)) {
      throw new Error('Master CSV not found');
    }

    const isComplete = (r: Record<string, string>) => {
      const phone = (r['Phone'] ?? '').trim();
      const addr1 = (r['Address Line 1'] ?? '').trim();
      const addr2 = (r['Address Line 2'] ?? '').trim();
      return phone.length > 0 && (addr1.length > 0 || addr2.length > 0);
    };

    const completeRecords = records.filter(isComplete);
    const skippedIncomplete = records.length - completeRecords.length;

    const Papa = (await import('papaparse')).default;
    const csvContent = Papa.unparse(records);
    fs.writeFileSync(filePath, csvContent, 'utf-8');

    let appendedToMaster = 0;
    if (completeRecords.length > 0) {
      const validationService = (await import('./validation.service')).default;
      const tmpDir = path.join(__dirname, '..', '..', 'tmp');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const tmpCsv = path.join(tmpDir, `job_${jobId}_complete_${Date.now()}.csv`);
      const tmpCsvContent = Papa.unparse(completeRecords);
      fs.writeFileSync(tmpCsv, tmpCsvContent, 'utf-8');

      try {
        const validationResult = await validationService.validateCSV(tmpCsv, {
          autoFix: true,
          checkUrls: false
        });
        if (!validationResult.valid && validationResult.errors.length > 0) {
          fs.unlinkSync(tmpCsv);
          return {
            savedToJob: records.length,
            appendedToMaster: 0,
            skippedIncomplete,
            validationErrors: validationResult.errors.length
          };
        }
      } catch {
        // If validation fails to run, still try to append (e.g. validator script missing)
      }

      const pythonCmd = PYTHON_CMD;
      const scraperPath = SCRAPER_PATH;
      const masterCsvManagerPath = path.join(scraperPath, 'master_csv_manager.py');

      const result = await new Promise<{ stores_added: number; stores_merged: number }>((resolve, reject) => {
        const proc = spawn(pythonCmd, [
          masterCsvManagerPath,
          tmpCsv,
          masterCsvPath,
          job.brandName
        ], { cwd: scraperPath, env: { ...process.env } });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
          if (fs.existsSync(tmpCsv)) fs.unlinkSync(tmpCsv);
          if (code !== 0) {
            reject(new Error(`Master merge failed: ${stderr || stdout}`));
            return;
          }
          const match = stdout.match(/New unique stores added:\s*(\d+)/);
          const mergedMatch = stdout.match(/Matched existing stores:\s*(\d+)/);
          resolve({
            stores_added: match ? parseInt(match[1]) : completeRecords.length,
            stores_merged: mergedMatch ? parseInt(mergedMatch[1]) : 0
          });
        });
      });
      appendedToMaster = result.stores_added + result.stores_merged;
    }

    return {
      savedToJob: records.length,
      appendedToMaster,
      skippedIncomplete
    };
  }

  /**
   * Count rows in a CSV file (excluding header).
   * Counts newlines so chunk boundaries don't overcount (streaming split('\n') would inflate the count).
   */
  async countCsvRows(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let newlineCount = 0;
      let lastChunkEndsWithNewline = false;
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => {
        const s = chunk.toString();
        const matches = s.match(/\n/g);
        newlineCount += matches ? matches.length : 0;
        lastChunkEndsWithNewline = s.length > 0 && s[s.length - 1] === '\n';
      });

      stream.on('end', () => {
        // Lines = newlines + 1 when file doesn't end with \n, else lines = newlines (last line empty).
        // Data rows = lines - 1 (header). So: if trailing \n then newlineCount - 1, else newlineCount.
        const dataRows = lastChunkEndsWithNewline ? Math.max(0, newlineCount - 1) : newlineCount;
        resolve(dataRows);
      });

      stream.on('error', reject);
    });
  }
}

export const scraperService = new ScraperService();

