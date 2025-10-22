import { Router } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

// GET /api/scraper/brands - List available brand configs
router.get('/brands', (req, res) => {
  try {
    const configPath = path.join(__dirname, '..', '..', '..', 'Prototypes', 'Data_Scrappers', 'brand_configs.json');
    const configData = fs.readFileSync(configPath, 'utf-8');
    const configs = JSON.parse(configData);

    // Filter out the _README entry
    const brands = Object.entries(configs)
      .filter(([key]) => key !== '_README')
      .map(([key, value]: [string, any]) => ({
        name: key,
        type: value.type,
        url: value.url,
        description: value.description || ''
      }));

    res.json({ brands });

  } catch (error: any) {
    console.error('Error loading brand configs:', error);
    res.status(500).json({ error: error.message });
  }
});

// TODO: Add scraper job endpoints in next phase
// POST /api/scraper/jobs - Start scraping job
// GET /api/scraper/jobs - List scraper jobs
// GET /api/scraper/jobs/:id - Get job status

export default router;
