import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { scraperService } from '../services/scraper.service';
import uploadService from '../services/upload.service';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

const prisma = new PrismaClient();

const COORD_MATCH_TOLERANCE_METERS = 50;

// Helper functions for brand config similarity detection
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;
  
  // Check if one contains the other (e.g., "audemars_piguet" vs "audemars_piguet_stores")
  if (s1.includes(s2) || s2.includes(s1)) {
    return 0.85; // High similarity for substring matches
  }
  
  // Simple Levenshtein distance-based similarity
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const editDistance = levenshteinDistance(s1, s2);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1: string, str2: string): number {
  // Initialize matrix with dimensions (str2.length + 1) x (str1.length + 1)
  const matrix: number[][] = [];
  
  // Initialize first column: matrix[i][0] = i for all i
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  // Initialize first row: matrix[0][j] = j for all j
  // Note: matrix[0][0] is already set to 0, so start from j = 1
  for (let j = 1; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  // Fill the rest of the matrix
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[str2.length][str1.length];
}

function normalizeUrlForComparison(url: string): string {
  try {
    const urlObj = new URL(url);
    // Keep only hostname and pathname, remove query params and fragments
    return `${urlObj.hostname}${urlObj.pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

type SimilarBrandConfig = { brandId: string; config: any; similarity: number; reason: string };

function findSimilarBrandConfigs(
  brandId: string,
  endpointUrl: string,
  configs: Record<string, any>
): SimilarBrandConfig[] {
  const similar: SimilarBrandConfig[] = [];
  const normalizedNewUrl = normalizeUrlForComparison(endpointUrl);
  
  for (const [existingBrandId, existingConfig] of Object.entries(configs)) {
    // Skip exact match (handled separately)
    if (existingBrandId === brandId) continue;
    
    let similarity = 0;
    let reason = '';
    
    // Check name similarity
    const nameSimilarity = calculateSimilarity(brandId, existingBrandId);
    if (nameSimilarity >= 0.7) {
      similarity = nameSimilarity;
      reason = `Similar brand name (${(nameSimilarity * 100).toFixed(0)}% match)`;
    }
    
    // Check URL similarity
    if (existingConfig.url) {
      const normalizedExistingUrl = normalizeUrlForComparison(existingConfig.url);
      if (normalizedExistingUrl === normalizedNewUrl) {
        similarity = Math.max(similarity, 0.95);
        reason = reason ? `${reason} + Same endpoint URL` : 'Same endpoint URL';
      } else if (normalizedExistingUrl.includes(normalizedNewUrl) || normalizedNewUrl.includes(normalizedExistingUrl)) {
        similarity = Math.max(similarity, 0.8);
        reason = reason ? `${reason} + Similar endpoint URL` : 'Similar endpoint URL';
      }
    }
    
    if (similarity >= 0.7) {
      similar.push({ brandId: existingBrandId, config: existingConfig, similarity, reason });
    }
  }
  
  // Sort by similarity (highest first)
  return similar.sort((a, b) => b.similarity - a.similarity);
}

export const scraperController = {
  // GET /api/scraper/brands - List available brand configs
  async getBrands(req: Request, res: Response) {
    try {
      const configPath = path.join(__dirname, '..', '..', '..', 'Prototypes', 'Data_Scrappers', 'brand_configs.json');
      const configData = fs.readFileSync(configPath, 'utf-8');
      const configs = JSON.parse(configData);

      // Filter out _README and disabled brands
      const brands = Object.entries(configs)
        .filter(([key, value]: [string, any]) => {
          return key !== '_README' && value.enabled !== false;
        })
        .map(([key, value]: [string, any]) => {
          // Format name: convert snake_case to Title Case
          let formattedName = key
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
          
          // Check if this is a US-only brand (check URL or description)
          const brandUrl = value.url || '';
          const description = value.description || '';
          
          // Check for US-only indicators, but exclude language codes like /us-en, /us-es, /us/en/, etc.
          // Language codes can be: /us-en (dash) or /us/en/ (slash)
          const hasUSPathDash = brandUrl.includes('/us-');
          const hasUSPathSlash = /\/us\/[a-z]{2,5}(\/|$|\?)/.test(brandUrl);
          const isLanguageCode = (hasUSPathDash && /\/us-[a-z]{2,5}(\/|$|\?)/.test(brandUrl)) || hasUSPathSlash;
          
          // If /us- or /us/ exists but it's a language code, don't treat it as US-only
          // Otherwise, check all US-only indicators
          const isUSOnly = ((hasUSPathDash || hasUSPathSlash) && !isLanguageCode) || 
                          brandUrl.includes('.us/') || 
                          brandUrl.includes('us.alpina') ||
                          description.toLowerCase().includes('us only') ||
                          description.toLowerCase().includes('united states');
          
          if (isUSOnly) {
            formattedName += ' (U.S.)';
          }
          
          // Check if this is a viewport-based scraper (check URL for viewport indicators)
          const isViewportBased = brandUrl.includes('viewport') || 
                                 brandUrl.includes('by_viewport') ||
                                 brandUrl.includes('bounds') ||
                                 brandUrl.includes('bbox') ||
                                 brandUrl.includes('northEast') ||
                                 brandUrl.includes('southWest');
          
          return {
            id: key,
            name: formattedName,
            type: value.type,
            url: value.url,
            description: value.description || '',
            method: value.method || 'GET',
            enabled: true,
            isViewportBased: isViewportBased
          };
        })
        .sort((a, b) => {
          // Sort alphabetically by name (case-insensitive)
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

      res.json({ brands });
    } catch (error: any) {
      console.error('Error loading brand configs:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/scraper/jobs - Start a new scraping job
  async createJob(req: Request, res: Response) {
    try {
      const { brandName, url, region = 'world' } = req.body;

      if (!brandName || !url) {
        return res.status(400).json({ error: 'brandName and url are required' });
      }

      // Load brand config
      const configPath = path.join(__dirname, '..', '..', '..', 'Prototypes', 'Data_Scrappers', 'brand_configs.json');
      const configData = fs.readFileSync(configPath, 'utf-8');
      const configs = JSON.parse(configData);
      const brandConfig = configs[brandName];

      if (!brandConfig) {
        return res.status(404).json({ error: 'Brand configuration not found' });
      }

      // Create job in database
      const job = await prisma.scraperJob.create({
        data: {
          brandName,
          config: JSON.stringify({ ...brandConfig, url, region }),
          status: 'queued',
        },
      });

      // Start scraping asynchronously
      scraperService.startScraping(job.id, brandName, url, region, brandConfig)
        .catch((error: any) => {
          console.error(`Error in scraping job ${job.id}:`, error);
        });

      res.status(201).json({ 
        message: 'Scraping job created',
        job: {
          id: job.id,
          brandName: job.brandName,
          status: job.status,
          startedAt: job.startedAt
        }
      });
    } catch (error: any) {
      console.error('Error creating scraper job:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // GET /api/scraper/jobs - List all scraper jobs
  async listJobs(req: Request, res: Response) {
    try {
      const { status, brandName, limit = 50, offset = 0 } = req.query;

      const where: any = {};
      if (status) where.status = status;
      if (brandName) where.brandName = brandName;

      const [jobs, total] = await Promise.all([
        prisma.scraperJob.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          take: Number(limit),
          skip: Number(offset),
          include: {
            upload: {
              select: {
                id: true,
                filename: true,
                status: true,
                rowsTotal: true,
              }
            }
          }
        }),
        prisma.scraperJob.count({ where })
      ]);

      res.json({ 
        jobs,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
          hasMore: total > Number(offset) + Number(limit)
        }
      });
    } catch (error: any) {
      console.error('Error listing scraper jobs:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // GET /api/scraper/jobs/:id - Get job details
  async getJob(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const job = await prisma.scraperJob.findUnique({
        where: { id },
        include: {
          upload: true
        }
      });

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      res.json({ job });
    } catch (error: any) {
      console.error('Error getting scraper job:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // GET /api/scraper/jobs/:id/logs - Get job logs
  async getJobLogs(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const job = await prisma.scraperJob.findUnique({
        where: { id },
        select: {
          id: true,
          brandName: true,
          status: true,
          logs: true,
          errorMessage: true,
          startedAt: true,
          completedAt: true
        }
      });

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      res.json({
        logs: job.logs || 'No logs available yet',
        status: job.status,
        brandName: job.brandName,
        errorMessage: job.errorMessage,
        startedAt: job.startedAt,
        completedAt: job.completedAt
      });
    } catch (error: any) {
      console.error('Error getting scraper job logs:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // DELETE /api/scraper/jobs/:id - Delete a job
  async deleteJob(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const job = await prisma.scraperJob.findUnique({
        where: { id }
      });

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      // Don't allow deleting running jobs
      if (job.status === 'running') {
        return res.status(400).json({ error: 'Cannot delete a running job' });
      }

      await prisma.scraperJob.delete({
        where: { id }
      });

      res.json({ message: 'Job deleted successfully' });
    } catch (error: any) {
      console.error('Error deleting scraper job:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // GET /api/scraper/stats - Get scraper statistics
  async getStats(req: Request, res: Response) {
    try {
      const [totalJobs, runningJobs, completedJobs, failedJobs] = await Promise.all([
        prisma.scraperJob.count(),
        prisma.scraperJob.count({ where: { status: 'running' } }),
        prisma.scraperJob.count({ where: { status: 'completed' } }),
        prisma.scraperJob.count({ where: { status: 'failed' } })
      ]);
      
      // Count unique records from master CSV (already deduplicated)
      let totalRecords = 0;
      try {
        const masterCsvPath = await uploadService.getMasterCSVPath();
        if (masterCsvPath && fs.existsSync(masterCsvPath)) {
          totalRecords = await scraperService.countCsvRows(masterCsvPath);
        }
      } catch (error: any) {
        console.error('Error counting master CSV rows:', error);
        // Fallback to sum of individual job records if master CSV can't be read
        const totalRecordsResult = await prisma.scraperJob.aggregate({
          _sum: { recordsScraped: true }
        });
        totalRecords = totalRecordsResult._sum.recordsScraped || 0;
      }

      // Get recent jobs
      const recentJobs = await prisma.scraperJob.findMany({
        orderBy: { startedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          brandName: true,
          status: true,
          startedAt: true,
          completedAt: true,
          recordsScraped: true
        }
      });

      res.json({
        stats: {
          totalJobs,
          runningJobs,
          completedJobs,
          failedJobs,
          totalRecords
        },
        recentJobs
      });
    } catch (error: any) {
      console.error('Error getting scraper stats:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/scraper/jobs/:id/cancel - Cancel a running job
  async cancelJob(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const result = await scraperService.cancelJob(id);

      if (result.success) {
        res.json({ message: result.message });
      } else {
        res.status(400).json({ error: result.message });
      }
    } catch (error: any) {
      console.error('Error cancelling scraper job:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // GET /api/scraper/jobs/:id/records - Get CSV records for a completed job
  async getJobRecords(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const job = await prisma.scraperJob.findUnique({
        where: { id },
        include: { upload: true }
      });

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (job.status !== 'completed') {
        return res.status(400).json({ error: 'Only completed jobs have viewable records' });
      }

      if (!job.uploadId || !job.upload) {
        return res.status(404).json({ error: 'No upload linked to this job' });
      }

      const filePath = await uploadService.getFilePath(job.upload.filename);
      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Job CSV file not found' });
      }

      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const parseResult = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h: string) => h.trim()
      });

      const rows = parseResult.data as Record<string, string>[];

      res.json({
        jobId: job.id,
        brandName: job.brandName,
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        records: rows
      });
    } catch (error: any) {
      console.error('Error fetching job records:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // PATCH /api/scraper/master-csv - Update rows in master CSV
  async updateMasterCsvRows(req: Request, res: Response) {
    try {
      const { rows: updates } = req.body as { rows: Record<string, string>[] };

      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ error: 'rows array with at least one record is required' });
      }

      const masterCsvPath = await uploadService.getMasterCSVPath();
      if (!masterCsvPath || !fs.existsSync(masterCsvPath)) {
        return res.status(404).json({ error: 'Master CSV not found' });
      }

      const fileContent = fs.readFileSync(masterCsvPath, 'utf-8');
      const parseResult = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h: string) => h.trim()
      });

      const masterRows = parseResult.data as Record<string, string>[];

      let updatedCount = 0;

      for (const update of updates) {
        const handle = (update.Handle || update.handle || '').trim();
        const latStr = (update.Latitude || '').trim();
        const lonStr = (update.Longitude || '').trim();

        const idx = masterRows.findIndex((r) => {
          const rHandle = (r.Handle || '').trim();
          if (handle && rHandle === handle) return true;
          if (latStr && lonStr && r.Latitude && r.Longitude) {
            const rLat = parseFloat(r.Latitude);
            const rLon = parseFloat(r.Longitude);
            const lat = parseFloat(latStr);
            const lon = parseFloat(lonStr);
            if (!isNaN(lat) && !isNaN(lon) && !isNaN(rLat) && !isNaN(rLon)) {
              const dist = Math.hypot(
                (lat - rLat) * 111320,  // rough meters per degree lat
                (lon - rLon) * 111320 * Math.cos(lat * Math.PI / 180)
              );
              return dist <= COORD_MATCH_TOLERANCE_METERS;
            }
          }
          return false;
        });

        if (idx >= 0) {
          const schemaKeys = new Set(Object.keys(masterRows[0] || {}));
          const readonlyColumns = new Set(['Handle']);
          for (const [key, value] of Object.entries(update)) {
            if (value !== undefined && schemaKeys.has(key) && !readonlyColumns.has(key)) {
              masterRows[idx][key] = String(value).trim();
            }
          }
          updatedCount++;
        }
      }

      const csvContent = Papa.unparse(masterRows);
      fs.writeFileSync(masterCsvPath, csvContent, 'utf-8');

      res.json({
        message: 'Master CSV updated successfully',
        updatedCount,
        totalRequested: updates.length
      });
    } catch (error: any) {
      console.error('Error updating master CSV:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/scraper/discover - Discover endpoints from store locator page
  async discoverEndpoints(req: Request, res: Response) {
    try {
      const { url } = req.body;

      if (!url) {
        return res.status(400).json({ error: 'URL is required' });
      }

      // Create a temporary output file for JSON results
      const outputDir = path.join(__dirname, '..', '..', '..', 'tmp');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const outputFile = path.join(outputDir, `discovery_${Date.now()}.json`);

      // Call the endpoint discoverer Python script
      const { spawn } = require('child_process');
      const discovererPath = path.join(
        __dirname,
        '..',
        '..',
        '..',
        'Prototypes',
        'endpoint_discoverer',
        'endpoint_discoverer.py'
      );

      return new Promise((resolve, reject) => {
        let responseSent = false;
        
        const sendResponse = (statusCode: number, data: any) => {
          if (!responseSent) {
            responseSent = true;
            res.status(statusCode).json(data);
            // Resolve the Promise after sending response to prevent hanging in Express v5+
            if (statusCode >= 200 && statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(data.error || 'Request failed'));
            }
          }
        };

        const pythonProcess = spawn('python3', [
          discovererPath,
          '--url',
          url,
          '--headless',
          '--output',
          outputFile
        ], {
          cwd: path.dirname(discovererPath),
          env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        pythonProcess.on('close', (code: number) => {
          // Try to read the output file
          try {
            if (fs.existsSync(outputFile)) {
              const resultData = fs.readFileSync(outputFile, 'utf-8');
              const result = JSON.parse(resultData);
              
              // Clean up temp file
              fs.unlinkSync(outputFile);
              
              sendResponse(200, result);
            } else {
              // If output file doesn't exist, try to parse stdout for JSON
              // Find the last complete JSON object (endpoint discoverer outputs final result at the end)
              // This handles cases where stdout contains multiple JSON objects or mixed text/JSON
              let jsonMatch: RegExpMatchArray | null = null;
              const lastBraceIndex = stdout.lastIndexOf('}');
              if (lastBraceIndex !== -1) {
                // Find the matching opening brace by counting braces backwards
                let braceCount = 1;
                let startIndex = lastBraceIndex - 1;
                while (startIndex >= 0 && braceCount > 0) {
                  if (stdout[startIndex] === '}') braceCount++;
                  else if (stdout[startIndex] === '{') braceCount--;
                  startIndex--;
                }
                if (braceCount === 0) {
                  // Found balanced braces - extract the JSON object
                  const jsonString = stdout.substring(startIndex + 1, lastBraceIndex + 1);
                  jsonMatch = [jsonString];
                }
              }
              
              // Fallback: if brace matching failed, try non-greedy regex for first JSON object
              if (!jsonMatch) {
                jsonMatch = stdout.match(/\{[\s\S]*?\}/);
              }
              
              if (jsonMatch) {
                try {
                  const result = JSON.parse(jsonMatch[0]);
                  sendResponse(200, result);
                } catch {
                  sendResponse(500, {
                    error: 'Endpoint discovery completed but failed to parse results',
                    details: stderr || 'No error details available',
                    raw_output: stdout.substring(0, 1000)
                  });
                }
              } else {
                sendResponse(500, {
                  error: 'Endpoint discovery failed',
                  details: stderr || 'No output file created and no JSON found in stdout',
                  raw_output: stdout.substring(0, 1000)
                });
              }
            }
          } catch (fileError: any) {
            // Clean up temp file if it exists
            if (fs.existsSync(outputFile)) {
              try {
                fs.unlinkSync(outputFile);
              } catch {}
            }
            
            sendResponse(500, {
              error: 'Failed to read discovery results',
              details: fileError.message,
              raw_output: stdout.substring(0, 1000)
            });
          }
        });

        // Set timeout (5 minutes for discovery - some store locators load slowly)
        const DISCOVERY_TIMEOUT_MS = 5 * 60 * 1000;
        const timeoutId = setTimeout(() => {
          if (!pythonProcess.killed && !responseSent) {
            pythonProcess.kill();
            sendResponse(500, {
              error: 'Endpoint discovery timed out after 5 minutes'
            });
          }
        }, DISCOVERY_TIMEOUT_MS);

        pythonProcess.on('error', (error: Error) => {
          // Clear timeout when process fails to start
          clearTimeout(timeoutId);
          sendResponse(500, {
            error: 'Failed to start endpoint discoverer',
            details: error.message
          });
        });

        // Clear timeout if process completes before timeout
        pythonProcess.on('close', () => {
          clearTimeout(timeoutId);
        });
      });
    } catch (error: any) {
      console.error('Error discovering endpoints:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // GET /api/scraper/brands/:id - Get a specific brand configuration
  async getBrandConfig(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const configPath = path.join(
        __dirname,
        '..',
        '..',
        '..',
        'Prototypes',
        'Data_Scrappers',
        'brand_configs.json'
      );
      const configData = fs.readFileSync(configPath, 'utf-8');
      const configs = JSON.parse(configData);

      if (!configs[id]) {
        return res.status(404).json({ error: `Brand configuration "${id}" not found` });
      }

      res.json({ brandId: id, config: configs[id] });
    } catch (error: any) {
      console.error('Error getting brand config:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/scraper/brands - Save discovered endpoint as brand configuration
  async saveBrandConfig(req: Request, res: Response) {
    try {
      const { brandId, brandName, endpoint, suggestedConfig, overwrite, oldBrandId } = req.body;

      if (!brandId || !endpoint || !endpoint.url) {
        return res.status(400).json({ error: 'brandId and endpoint.url are required' });
      }

      // Load existing brand configs
      const configPath = path.join(
        __dirname,
        '..',
        '..',
        '..',
        'Prototypes',
        'Data_Scrappers',
        'brand_configs.json'
      );
      const configData = fs.readFileSync(configPath, 'utf-8');
      const configs = JSON.parse(configData);

      // Check for exact match first
      if (configs[brandId] && overwrite !== true) {
        // Return existing config so frontend can show comparison
        return res.status(409).json({ 
          error: `Brand configuration "${brandId}" already exists`,
          existingConfig: configs[brandId],
          brandId
        });
      }

      // Check for similar brand configs (by name similarity or URL match)
      const similarConfigs: SimilarBrandConfig[] = findSimilarBrandConfigs(brandId, endpoint.url, configs);
      if (similarConfigs.length > 0 && overwrite !== true) {
        // Return the most similar config (highest similarity)
        const mostSimilar: SimilarBrandConfig = similarConfigs[0];
        return res.status(409).json({
          error: `Similar brand configuration found: "${mostSimilar.brandId}"`,
          existingConfig: mostSimilar.config,
          brandId: mostSimilar.brandId,
          similarity: mostSimilar.similarity,
          reason: mostSimilar.reason,
          allSimilar: similarConfigs.map((s: SimilarBrandConfig) => ({
            brandId: s.brandId,
            similarity: s.similarity,
            reason: s.reason
          }))
        });
      }
      
      // If overwrite is true, we'll proceed to overwrite below
      // If overwrite is false/undefined and config exists, we already returned above

      // Build brand configuration from discovered endpoint
      // Use suggested_config as base if available, otherwise build from endpoint
      const baseConfig = suggestedConfig || {};
      const brandConfig: any = {
        type: endpoint.type || baseConfig.type || 'json',
        url: endpoint.url,
        method: baseConfig.method || 'GET',
        description: baseConfig.description || `Discovered endpoint for ${brandName || brandId}`,
        enabled: true
      };

      // Add data_path if available (from verified endpoint or suggested config)
      // Priority: endpoint.data_path > baseConfig.data_path
      // This is critical for the scraper to find stores in the JSON response
      if (endpoint.data_path && endpoint.data_path.trim()) {
        brandConfig.data_path = endpoint.data_path;
      } else if (baseConfig.data_path && baseConfig.data_path.trim()) {
        brandConfig.data_path = baseConfig.data_path;
      }
      
      // Log warning if data_path is missing (helps debug)
      if (!brandConfig.data_path) {
        console.warn(`⚠️  Warning: No data_path detected for brand ${brandId}. The scraper may not be able to find stores in the JSON response.`);
      }

      // Add field_mapping if available
      // Priority: baseConfig.field_mapping (from pattern detector) > endpoint.field_mapping (from verifier)
      // The pattern detector has more accurate detection, so prefer it
      if (baseConfig.field_mapping && Object.keys(baseConfig.field_mapping).length > 0) {
        brandConfig.field_mapping = baseConfig.field_mapping;
      } else if (endpoint.field_mapping && Object.keys(endpoint.field_mapping).length > 0) {
        brandConfig.field_mapping = endpoint.field_mapping;
      }

      // Add headers if needed (e.g., Accept: application/json)
      if (baseConfig.headers) {
        brandConfig.headers = baseConfig.headers;
      }

      // Add any other properties from suggested config
      if (baseConfig._note) {
        brandConfig._note = baseConfig._note;
      }

      // When overwriting with a new name, remove the old key so we don't keep both
      if (overwrite === true && oldBrandId && oldBrandId !== brandId) {
        delete configs[oldBrandId];
      }

      // Save to brand_configs.json
      configs[brandId] = brandConfig;
      fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf-8');

      res.json({
        message: 'Brand configuration saved successfully',
        brandId,
        config: brandConfig
      });
    } catch (error: any) {
      console.error('Error saving brand config:', error);
      res.status(500).json({ error: error.message });
    }
  }
};

