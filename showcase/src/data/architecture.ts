export type Tier = 'client' | 'edge' | 'service' | 'data' | 'external';

export type ArchNode = {
  id: string;
  label: string;
  sublabel: string;
  tier: Tier;
  host: string;
  x: number;
  y: number;
};

export type ArchEdge = {
  from: string;
  to: string;
  label?: string;
  kind: 'http' | 'read-write' | 'upload' | 'scrape';
};

export const archNodes: ArchNode[] = [
  { id: 'user', label: 'End User', sublabel: 'WatchDNA.com visitor', tier: 'client', host: 'Shopify storefront', x: 22, y: 9 },
  { id: 'admin', label: 'Admin', sublabel: 'Internal operator', tier: 'client', host: 'Web app', x: 78, y: 9 },
  { id: 'map', label: 'User Map', sublabel: 'Leaflet + MarkerCluster', tier: 'edge', host: 'Vercel · dealer-fetcher', x: 22, y: 33 },
  { id: 'panel', label: 'Admin Panel', sublabel: 'React 19 + Vite', tier: 'edge', host: 'Railway · admin-console', x: 78, y: 33 },
  { id: 'api', label: 'Backend API', sublabel: 'Express + TS + Prisma', tier: 'service', host: 'Railway', x: 50, y: 56 },
  { id: 'db', label: 'Database', sublabel: 'Location · Premium · Events', tier: 'data', host: 'Supabase Postgres', x: 20, y: 74 },
  { id: 'files', label: 'File Storage', sublabel: 'CSV + Shopify media', tier: 'data', host: 'Railway + Shopify', x: 50, y: 74 },
  { id: 'scraper', label: 'Python Scraper', sublabel: 'universal_scraper.py', tier: 'service', host: 'Local / Railway job', x: 80, y: 74 },
  { id: 'brands', label: 'Brand Locators', sublabel: 'Rolex · Tissot · Seiko · …', tier: 'external', host: 'External sites', x: 80, y: 93 }
];

export const archEdges: ArchEdge[] = [
  { from: 'user', to: 'map', kind: 'http', label: 'iframe' },
  { from: 'admin', to: 'panel', kind: 'http' },
  { from: 'map', to: 'api', kind: 'http', label: 'GET /api/stores' },
  { from: 'panel', to: 'api', kind: 'http', label: 'JWT' },
  { from: 'api', to: 'db', kind: 'read-write' },
  { from: 'api', to: 'files', kind: 'read-write' },
  { from: 'scraper', to: 'api', kind: 'upload', label: 'CSV upload' },
  { from: 'scraper', to: 'brands', kind: 'scrape', label: 'scheduled' }
];
