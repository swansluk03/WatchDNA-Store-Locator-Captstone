import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { scraperService } from '../services/scraper.service';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

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
      const [totalJobs, runningJobs, completedJobs, failedJobs, totalRecordsResult] = await Promise.all([
        prisma.scraperJob.count(),
        prisma.scraperJob.count({ where: { status: 'running' } }),
        prisma.scraperJob.count({ where: { status: 'completed' } }),
        prisma.scraperJob.count({ where: { status: 'failed' } }),
        prisma.scraperJob.aggregate({
          _sum: { recordsScraped: true }
        })
      ]);
      
      const totalRecords = totalRecordsResult._sum.recordsScraped || 0;

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
  }
};

