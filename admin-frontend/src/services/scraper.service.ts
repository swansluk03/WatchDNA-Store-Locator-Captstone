import api from './api';

export interface Brand {
  id: string;
  name: string;
  type: string;
  url: string;
  description: string;
  method?: string;
  enabled?: boolean;
  isViewportBased?: boolean;
}

export interface ScraperJob {
  id: string;
  brandName: string;
  config: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  uploadId?: string;
  errorMessage?: string;
  recordsScraped: number;
  upload?: {
    id: string;
    filename: string;
    status: string;
    rowsTotal: number;
  };
}

export interface ScraperStats {
  totalJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalRecords: number;
}

export interface CreateJobRequest {
  brandName: string;
  url: string;
  region?: string;
}

export const scraperService = {
  // Get all available brands
  async getBrands(): Promise<Brand[]> {
    const response = await api.get('/scraper/brands');
    return response.data.brands;
  },

  // Create a new scraping job
  async createJob(data: CreateJobRequest): Promise<ScraperJob> {
    const response = await api.post('/scraper/jobs', data);
    return response.data.job;
  },

  // List all scraper jobs
  async listJobs(params?: {
    status?: string;
    brandName?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ jobs: ScraperJob[]; pagination: any }> {
    const response = await api.get('/scraper/jobs', { params });
    return response.data;
  },

  // Get a specific job
  async getJob(id: string): Promise<ScraperJob> {
    const response = await api.get(`/scraper/jobs/${id}`);
    return response.data.job;
  },

  // Get job logs
  async getJobLogs(id: string): Promise<{
    logs: string;
    status: string;
    brandName: string;
    errorMessage?: string;
    startedAt: string;
    completedAt?: string;
  }> {
    const response = await api.get(`/scraper/jobs/${id}/logs`);
    return response.data;
  },

  // Cancel a running job
  async cancelJob(id: string): Promise<{ message: string }> {
    const response = await api.post(`/scraper/jobs/${id}/cancel`);
    return response.data;
  },

  // Delete a job
  async deleteJob(id: string): Promise<void> {
    await api.delete(`/scraper/jobs/${id}`);
  },

  // Get scraper statistics
  async getStats(): Promise<{
    stats: ScraperStats;
    recentJobs: ScraperJob[];
  }> {
    const response = await api.get('/scraper/stats');
    return response.data;
  },

  // Discover endpoints from a store locator page
  async discoverEndpoints(storeLocatorUrl: string): Promise<any> {
    const response = await api.post('/scraper/discover', { url: storeLocatorUrl });
    return response.data;
  },

  // Save discovered endpoint as brand configuration
  async saveBrandConfig(data: {
    brandId: string;
    brandName: string;
    endpoint: any;
    suggestedConfig?: any;
    overwrite?: boolean;
    oldBrandId?: string;
  }): Promise<void> {
    await api.post('/scraper/brands', data);
  },

  // Get a specific brand configuration
  async getBrandConfig(brandId: string): Promise<{ brandId: string; config: any }> {
    const response = await api.get(`/scraper/brands/${brandId}`);
    return response.data;
  }
};

