import { PrismaClient } from '@prisma/client';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

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

      const scraperPath = path.join(__dirname, '..', '..', '..', 'Prototypes', 'Data_Scrappers');
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

      // Run the Python scraper (outputs to individual CSV)
      const pythonProcess = spawn('python3', [
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
        console.log(`[Scraper ${jobId}] ${output.trim()}`);
        
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
            console.error(`Failed to update live logs for ${jobId}:`, err);
          }
        }
      });

      pythonProcess.stderr.on('data', async (data) => {
        const output = data.toString();
        stderr += output;
        console.error(`[Scraper ${jobId}] ERROR: ${output.trim()}`);
        
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
          console.error(`Failed to update live error logs for ${jobId}:`, err);
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
              const mergeProcess = spawn('python3', [
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
                console.log(`[Master CSV Merge ${jobId}] ${data.toString().trim()}`);
              });
              mergeProcess.stderr.on('data', (data) => {
                mergeStderr += data.toString();
                console.error(`[Master CSV Merge ${jobId}] ERROR: ${data.toString().trim()}`);
              });

              // Add timeout (5 minutes for merge operation)
              let mergeTimeout: NodeJS.Timeout | null = setTimeout(() => {
                if (!mergeProcess.killed) {
                  console.error(`⚠️ Master CSV merge timed out after 5 minutes for job ${jobId}`);
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
                    console.log(`✅ Master CSV merge completed successfully for job ${jobId}`);
                    resolve();
                  } else {
                    console.error(`⚠️ Master CSV merge failed with code ${code} for job ${jobId}: ${mergeStderr}`);
                    // Don't fail the job if merge fails, just log it
                    resolve();
                  }
                });
                mergeProcess.on('error', (error) => {
                  clearMergeTimeout(); // Always clear timeout on error
                  console.error(`⚠️ Master CSV merge error for job ${jobId}: ${error.message}`);
                  // Don't fail the job if merge fails
                  resolve();
                });
              });
              
              // Ensure timeout is cleared even if promise resolves/rejects unexpectedly
              clearMergeTimeout();
            } catch (mergeError: any) {
              console.error(`⚠️ Error starting master CSV merge for job ${jobId}:`, mergeError);
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
            console.log(`[Job ${jobId}] Updating job status to completed...`);
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

              console.log(`✅ Scraping job ${jobId} completed successfully.`);
              console.log(`   📊 Records scraped: ${recordsScraped !== null ? recordsScraped : 0}`);
              if (masterFileStats) {
                console.log(`   📊 Master CSV: ${masterRows} total stores (after deduplication)`);
              }
              if (mergeStdout) {
                // Extract key stats from merge output if available
                const mergeLines = mergeStdout.split('\n');
                const finalSummary = mergeLines.filter(line => 
                  line.includes('FINAL SUMMARY') || 
                  line.includes('Master CSV final:') ||
                  line.includes('Total deduplicated:')
                );
                if (finalSummary.length > 0) {
                  finalSummary.forEach(line => console.log(`   ${line.trim()}`));
                }
              }
            } catch (updateError: any) {
              // If status update fails, log it but don't throw - job already completed
              console.error(`⚠️ Failed to update job status for ${jobId}:`, updateError);
              console.error(`Error details:`, updateError.message, updateError.stack);
              
              // Try one more time with minimal data (but include uploadId if available)
              try {
                console.log(`[Job ${jobId}] Retrying status update with minimal data...`);
                await prisma.scraperJob.update({
                  where: { id: jobId },
                  data: {
                    status: 'completed',
                    completedAt: new Date(),
                    recordsScraped: recordsScraped !== null ? recordsScraped : 0,
                    uploadId: individualUpload?.id || null,  // Include uploadId in retry
                    logs: `Status update error occurred, but job completed successfully.\n\n${finalLogs}\n\nUpdate Error: ${updateError.message}`
                  }
                });
                console.log(`✅ Retry status update succeeded for job ${jobId}`);
              } catch (retryError: any) {
                console.error(`❌ Critical: Could not update job ${jobId} status even after retry:`, retryError);
                console.error(`Retry error details:`, retryError.message, retryError.stack);
              }
            }
          } catch (error: any) {
            console.error(`Error processing scraper results for job ${jobId}:`, error);
            console.error(`Error stack:`, error.stack);
            
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
              console.error(`❌ Critical: Could not update failed job status for ${jobId}:`, updateError);
            }
          }
        } else {
          // Failure
          await prisma.scraperJob.update({
            where: { id: jobId },
            data: {
              status: 'failed',
              completedAt: new Date(),
              errorMessage: stderr || `Process exited with code ${code}`,
              logs: fullLogs
            }
          });

          console.error(`❌ Scraping job ${jobId} failed with code ${code}`);
        }
      });

      pythonProcess.on('error', async (error) => {
        // Clean up the process from tracking map
        this.runningProcesses.delete(jobId);
        
        console.error(`Error spawning Python process for job ${jobId}:`, error);
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
      console.error(`Error starting scraping job ${jobId}:`, error);
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
      console.log(`🛑 Cancelling scraping job ${jobId}...`);
      process.kill('SIGTERM');
      
      // If process doesn't terminate in 5 seconds, force kill
      setTimeout(() => {
        if (this.runningProcesses.has(jobId)) {
          console.log(`🛑 Force killing job ${jobId}...`);
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

      console.log(`✅ Scraping job ${jobId} cancelled successfully`);
      return { success: true, message: 'Job cancelled successfully' };

    } catch (error: any) {
      console.error(`Error cancelling job ${jobId}:`, error);
      return { success: false, message: `Error cancelling job: ${error.message}` };
    }
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

