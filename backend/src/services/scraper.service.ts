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
      const outputFile = path.join(outputDir, `${brandName}_${Date.now()}.csv`);

      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Run the Python scraper
      const pythonProcess = spawn('python3', [
        path.join(scraperPath, 'universal_scraper.py'),
        '--url', url,
        '--output', outputFile,
        '--region', region,
        '--no-validate'
      ], {
        cwd: scraperPath,
        env: { ...process.env }
      });

      // Track this process for cancellation
      this.runningProcesses.set(jobId, pythonProcess);

      let stdout = '';
      let stderr = '';
      let lastLogUpdate = Date.now();

      pythonProcess.stdout.on('data', async (data) => {
        const output = data.toString();
        stdout += output;
        console.log(`[Scraper ${jobId}] ${output.trim()}`);
        
        // Update logs in database every 2 seconds for real-time viewing
        const now = Date.now();
        if (now - lastLogUpdate > 2000) {
          lastLogUpdate = now;
          try {
            await prisma.scraperJob.update({
              where: { id: jobId },
              data: {
                logs: `=== LIVE OUTPUT ===\n${stdout}\n\n${stderr ? `=== ERRORS ===\n${stderr}` : ''}`
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
        
        // Update errors immediately
        const now = Date.now();
        if (now - lastLogUpdate > 2000) {
          lastLogUpdate = now;
          try {
            await prisma.scraperJob.update({
              where: { id: jobId },
              data: {
                logs: `=== LIVE OUTPUT ===\n${stdout}\n\n=== ERRORS ===\n${stderr}`
              }
            });
          } catch (err) {
            console.error(`Failed to update live error logs for ${jobId}:`, err);
          }
        }
      });

      pythonProcess.on('close', async (code) => {
        // Clean up the process from tracking map
        this.runningProcesses.delete(jobId);
        
        const fullLogs = `=== STDOUT ===\n${stdout}\n\n=== STDERR ===\n${stderr}`;
        
        if (code === 0) {
          // Success - parse results and create upload
          try {
            const fileStats = fs.statSync(outputFile);
            // Count actual data rows (excluding header)
            const totalRows = await this.countCsvRows(outputFile);
            
            // Parse the output to get actual normalized count
            const normalizedMatch = stdout.match(/(\d+)\s+stores\s+normalized/i) || 
                                   stdout.match(/✅\s+(\d+)\s+stores/i);
            const recordsScraped = normalizedMatch ? parseInt(normalizedMatch[1]) : totalRows;

            // Create Upload record
            const upload = await prisma.upload.create({
              data: {
                filename: path.basename(outputFile),
                originalFilename: `${brandName}_scraped.csv`,
                fileSize: fileStats.size,
                uploadedBy: 'scraper',
                status: 'completed',
                brandConfig: brandName,
                scraperType: config.type || 'json',
                rowsTotal: recordsScraped,
                rowsProcessed: recordsScraped,
              }
            });

            // Update job with logs
            await prisma.scraperJob.update({
              where: { id: jobId },
              data: {
                status: 'completed',
                completedAt: new Date(),
                recordsScraped,
                uploadId: upload.id,
                logs: fullLogs
              }
            });

            console.log(`✅ Scraping job ${jobId} completed successfully. ${recordsScraped} records scraped.`);
          } catch (error: any) {
            console.error(`Error processing scraper results for job ${jobId}:`, error);
            await prisma.scraperJob.update({
              where: { id: jobId },
              data: {
                status: 'failed',
                completedAt: new Date(),
                errorMessage: `Post-processing error: ${error.message}`,
                logs: fullLogs
              }
            });
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
   * Count rows in a CSV file (excluding header)
   */
  async countCsvRows(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let lineCount = 0;
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        lineCount += lines.length;
      });

      stream.on('end', () => {
        // Subtract 1 for header row
        resolve(Math.max(0, lineCount - 1));
      });

      stream.on('error', reject);
    });
  }
}

export const scraperService = new ScraperService();

