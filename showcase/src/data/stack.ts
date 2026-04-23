export type StackTier = 'frontend' | 'backend' | 'data' | 'devops';

export type StackItem = {
  name: string;
  role: string;
  tier: StackTier;
};

export const stack: StackItem[] = [
  { name: 'React 19', role: 'Admin panel UI', tier: 'frontend' },
  { name: 'Vite 6', role: 'Admin panel bundler', tier: 'frontend' },
  { name: 'Leaflet 1.9', role: 'User map rendering', tier: 'frontend' },
  { name: 'MarkerCluster 1.5', role: 'Efficient pin clustering', tier: 'frontend' },
  { name: 'MapLibre GL', role: 'Vector tile rendering', tier: 'frontend' },
  { name: 'PapaParse 5', role: 'Client-side CSV parsing', tier: 'frontend' },

  { name: 'Node 18', role: 'Backend runtime', tier: 'backend' },
  { name: 'Express 4', role: 'HTTP framework', tier: 'backend' },
  { name: 'TypeScript 5', role: 'Types everywhere', tier: 'backend' },
  { name: 'Prisma 5', role: 'ORM + migrations', tier: 'backend' },
  { name: 'Python 3', role: 'Scraper runtime', tier: 'backend' },
  { name: 'BeautifulSoup 4', role: 'HTML fallback parsing', tier: 'backend' },

  { name: 'Supabase', role: 'Managed Postgres + auth', tier: 'data' },
  { name: 'PostgreSQL 16', role: 'Relational datastore', tier: 'data' },
  { name: 'JWT', role: 'Admin session tokens', tier: 'data' },
  { name: 'Shopify Files', role: 'Store image CDN', tier: 'data' },

  { name: 'Railway', role: 'Backend + admin hosting', tier: 'devops' },
  { name: 'Vercel', role: 'User-map hosting', tier: 'devops' },
  { name: 'Shopify App', role: 'Storefront iframe embed', tier: 'devops' },
  { name: 'GitHub', role: 'Source + CI migrations', tier: 'devops' }
];
