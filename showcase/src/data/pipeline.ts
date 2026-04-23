import type { LucideIcon } from 'lucide-react';
import {
  Target,
  Search,
  FileJson,
  Play,
  FileText,
  ShieldCheck,
  Upload,
  Database,
  Cloud,
  Map
} from 'lucide-react';

export type PipelineStep = {
  id: string;
  label: string;
  tool: string;
  description: string;
  owner: string;
  icon: LucideIcon;
};

export const pipeline: PipelineStep[] = [
  {
    id: 'target',
    label: 'Brand Target',
    tool: 'watchdna.com/tools/storelocator',
    description:
      'Thomas curates the canonical list of partner brands. Each brand becomes a ticket on the sweep board.',
    owner: 'Thomas',
    icon: Target
  },
  {
    id: 'discover',
    label: 'Endpoint Discovery',
    tool: 'endpoint_discoverer.py',
    description:
      'Probes the brand site, sniffs network traffic, ranks JSON endpoints, and flags anti-bot walls before we commit a config.',
    owner: 'Luke',
    icon: Search
  },
  {
    id: 'config',
    label: 'Brand Config',
    tool: 'brand_configs.json',
    description:
      'Strategy + URL + field mapping + pagination flags. ~56KB of per-brand JSON drives the whole scraper engine.',
    owner: 'Asmit',
    icon: FileJson
  },
  {
    id: 'scrape',
    label: 'Universal Scraper',
    tool: 'universal_scraper.py',
    description:
      'Runs the config: JSON single-call, viewport grid, radius expansion, POST-per-country, or geohash sharding.',
    owner: 'Asmit',
    icon: Play
  },
  {
    id: 'csv',
    label: 'Normalized CSV',
    tool: 'data_normalizer.py',
    description:
      'Folds raw rows into the canonical 40-column schema — addresses, hours, brands, coords — and standardizes country codes.',
    owner: 'Asmit',
    icon: FileText
  },
  {
    id: 'validate',
    label: 'Validator',
    tool: 'validate_csv.py',
    description:
      'Twenty-plus rules check coords, phone formats, country ISO codes, duplicates, and required-field presence.',
    owner: 'Asmit & Luke',
    icon: ShieldCheck
  },
  {
    id: 'upload',
    label: 'Admin Upload',
    tool: 'Scraper.tsx → /api/uploads',
    description:
      'Admin runs the scrape, reviews validation logs side-by-side, and confirms the batch upsert into the database.',
    owner: 'Luke',
    icon: Upload
  },
  {
    id: 'db',
    label: 'Supabase Postgres',
    tool: 'batchUpsertLocations',
    description:
      'Merges on handle. Location table with multilingual fields, premium flags, custom buttons, and Shopify file GIDs.',
    owner: 'Asmit',
    icon: Database
  },
  {
    id: 'api',
    label: 'Railway API',
    tool: '/api/stores · /master_stores.csv',
    description:
      'Express + Prisma API on Railway. Cache headers, per-route rate limiting, JWT admin auth, CORS whitelist.',
    owner: 'Asmit',
    icon: Cloud
  },
  {
    id: 'map',
    label: 'Leaflet Map',
    tool: 'user-frontend/index.html',
    description:
      'Loads only viewport-visible stores. MarkerCluster + client-side filters + "Near Me" + verified-retailer overlay.',
    owner: 'Robert · Hrisika · Aracely',
    icon: Map
  }
];
