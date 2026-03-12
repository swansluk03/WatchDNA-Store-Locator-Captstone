import path from 'path';
import fs from 'fs';

/**
 * Resolves the absolute path to the scraper/tools directories.
 *
 * In development (ts-node): __dirname is backend/src/utils, so the repo root
 * is three levels up (../../..).
 *
 * In production (Railway, root dir = backend/): __dirname is /app/dist/utils.
 * Railway only deploys the backend/ subtree, so Prototypes/ is NOT present.
 * Set SCRAPER_PATH env var on Railway to an absolute path if you mount the
 * scrapers via a volume or shared layer.
 *
 * Key files that must exist alongside the backend in production:
 *   - brand_configs.json  → copied to backend/brand_configs.json
 *   - tools/validate_csv.py → copied to backend/tools/validate_csv.py
 */

// Repo root in dev; /app in production (backend/ deployed as root)
const backendRoot = path.join(__dirname, '..', '..');

// Scraper directory: honour SCRAPER_PATH env var first, then dev default
export const SCRAPER_PATH: string = process.env.SCRAPER_PATH
  ? process.env.SCRAPER_PATH
  : path.join(backendRoot, '..', 'Prototypes', 'Data_Scrappers');

// Endpoint discoverer directory
export const ENDPOINT_DISCOVERER_PATH: string = process.env.SCRAPER_PATH
  ? path.join(process.env.SCRAPER_PATH, '..', 'endpoint_discoverer')
  : path.join(backendRoot, '..', 'Prototypes', 'endpoint_discoverer');

// brand_configs.json — lives inside backend/ so it is always deployed
export const BRAND_CONFIGS_PATH: string = path.join(backendRoot, 'brand_configs.json');

// validate_csv.py — lives inside backend/tools/ so it is always deployed
export const VALIDATE_CSV_PATH: string = path.join(backendRoot, 'tools', 'validate_csv.py');

// Python command: prefer venv if present (dev), else system python3
const venvPython = path.join(backendRoot, '..', 'venv', 'bin', 'python3');
export const PYTHON_CMD: string = (() => {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  if (fs.existsSync(venvPython)) return venvPython;
  return 'python3';
})();
