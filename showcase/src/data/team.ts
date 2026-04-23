export type Contribution = {
  area: string;
  details: string;
};

export type TeamMember = {
  id: string;
  name: string;
  handle: string;
  role: string;
  focus: string;
  accent: string;
  commits: number;
  linesAdded: number;
  linesRemoved: number;
  ownership: string[];
  pitch: string;
  contributions: Contribution[];
  talkingPoints: string[];
};

export const team: TeamMember[] = [
  {
    id: 'asmit',
    name: 'Asmit Datta',
    handle: 'sm11t',
    role: 'Backend & Scraper Engine',
    focus: 'Turning fifty watch locators into one clean, normalized, multilingual dataset.',
    accent: 'from-amber-300/20 to-amber-600/10',
    commits: 75,
    linesAdded: 309051,
    linesRemoved: 2339,
    ownership: [
      'backend/src/server.ts + Prisma schema',
      'Prototypes/Data_Scrappers/universal_scraper.py',
      'backend/brand_configs.json',
      'backend/src/services/* (auth, analytics, premium)',
      'tools/translate_stores.py'
    ],
    pitch:
      'Writes the Python engine that swallows every brand shape we throw at it, the Express/Prisma backend that stores the result, and the translation pipeline that makes non-Latin stores searchable on the map.',
    contributions: [
      {
        area: 'Universal Scraper Engine',
        details:
          '3,300-line Python engine with pluggable strategies — JSON single-call, viewport grids, radius expansion, POST-per-country, geohash-prefix sharding, worldwide-country pagination, stores-by-api-countries. 10+ brand configs including Tissot (10.6k), Seiko (10.4k), Raymond Weil, Mondaine, Panerai, Aerowatch.'
      },
      {
        area: 'Express + Prisma Backend',
        details:
          'Express/TypeScript backend with JWT auth, per-route rate limiting, CORS whitelisting, security headers, and a rich Prisma Location model: address, hours, coords, premium flags, four locales, Shopify file GIDs.'
      },
      {
        area: 'Supabase Migration',
        details:
          'Migrated the project off Railway Postgres onto managed Supabase. Set up env validation, direct-URL for migrations, and deployment configuration for both environments.'
      },
      {
        area: 'Non-Latin Translation Pipeline',
        details:
          'translate_stores.py with rate-limit retry logic so Japanese, Chinese, Arabic names become searchable English. Editable translations surface in the admin panel.'
      },
      {
        area: 'Premium API + 25-Test Suite',
        details:
          'Scaffolded the Premium Store admin API with a 25-test suite. Integrated with the user map so gold markers now hydrate from the API instead of a hardcoded list.'
      },
      {
        area: 'Analytics Pipeline',
        details:
          'AnalyticsEvent table ingests store_tapped, brand_searched, store_phone_tapped from the mobile app with session grouping — powers the admin App Analytics page.'
      }
    ],
    talkingPoints: [
      'Walk through a brand config and show how the engine picks its strategy',
      'Demo the admin panel translating a Japanese store into English',
      'Open Prisma Studio and filter by premium = true',
      'Show the 25-test Premium API suite running green'
    ]
  },
  {
    id: 'luke',
    name: 'Luke Swanson',
    handle: 'swansluk03',
    role: 'Admin Console & Data Pipeline',
    focus: 'Everything admins touch — scraping UI, premium stores, dedup, Shopify sync.',
    accent: 'from-emerald-300/20 to-emerald-600/10',
    commits: 57,
    linesAdded: 30805,
    linesRemoved: 5087,
    ownership: [
      'admin-frontend/src/pages/Scraper.tsx (60KB)',
      'admin-frontend/src/pages/PremiumStores.tsx',
      'backend/src/services/store.service.ts',
      'backend/src/controllers/scraper.controller.ts',
      'Prototypes/endpoint_discoverer/*'
    ],
    pitch:
      'Built the admin console the team uses daily — scraper UI, premium stores tab, dedup pipeline, Shopify image sync — plus the endpoint discoverer that kicks off every new brand.',
    contributions: [
      {
        area: 'Endpoint Discoverer',
        details:
          '56KB Python tool that probes a brand website, sniffs network traffic, and ranks candidate store-locator APIs. Shipped the MVP scraping workflow in the admin console back in October 2025.'
      },
      {
        area: 'Admin Scraper UI',
        details:
          'The 60KB Scraper.tsx page drives every brand config live: pick a config, run a job, stream logs, download the resulting CSV filtered by country or brand.'
      },
      {
        area: 'Premium Stores Tab',
        details:
          'End-to-end Premium Stores surface (UI + service + controller). Add, edit, tag service centers, flag AD Verified, and upload / replace / remove store images in Shopify directly from the panel.'
      },
      {
        area: 'Deduplication Pipeline',
        details:
          'Designed the address-normalization and address-dedupe utilities, plus dry-run scripts. Fixes the "same store, three brands" case that used to pollute the master dataset.'
      },
      {
        area: 'Rolex 1,200+ Fix',
        details:
          'Rewrote the Rolex viewport logic so the scraper now returns 1,200+ authorized retailers instead of the ~300 the old config was stuck at.'
      },
      {
        area: 'Manual Add + AD Verified',
        details:
          'Added manual store creation for boutique brands with no locator. Extended Prisma + admin UI for Verified Retailer / AD Verified tagging so the map can treat them specially.'
      }
    ],
    talkingPoints: [
      'Start a live scrape from the admin panel and watch logs stream',
      'Open the Premium Stores tab and upload a store image to Shopify',
      'Run the dedup dry-run script against a duplicated Rolex store',
      'Show the endpoint discoverer picking up a brand it has never seen'
    ]
  },
  {
    id: 'hrisika',
    name: 'Hrisika Jagdeep',
    handle: 'hjagdeep',
    role: 'User Frontend — Filter & Search',
    focus: 'How 28,000 stores become findable on a phone in three taps.',
    accent: 'from-fuchsia-300/20 to-fuchsia-600/10',
    commits: 94,
    linesAdded: 10009,
    linesRemoved: 6463,
    ownership: [
      'user-frontend/index.html (2.4k lines)',
      'user-frontend/styles.css',
      'user-frontend/prototype.html',
      'TECHNICAL_DOCUMENTATION.md'
    ],
    pitch:
      'Owns the filter panel, brand toggle, store search, and the entire mobile experience. The reason a visitor on a 4G phone can find a Tissot dealer near them in under a minute.',
    contributions: [
      {
        area: 'Filter Panel Refactor',
        details:
          'Rebuilt the filter panel from a flat checkbox list into a collapsible brand toggle + store search + service-center toggle. Migrated inline styles out of index.html into styles.css.'
      },
      {
        area: 'Search-by-Store',
        details:
          'Fuzzy search across store name, city, brand, zip — with a live result counter and checkbox sync back to the map state.'
      },
      {
        area: 'Mobile Optimization Sprint',
        details:
          'Sequence of mobile fixes resolving sticky scroll, checkbox tap targets, filter-panel overflow, and safe-area padding for iOS Safari.'
      },
      {
        area: 'Frontend ↔ Backend Integration',
        details:
          'First wired the static Leaflet prototype to the live backend API. Everything after that built on this integration layer.'
      },
      {
        area: 'Technical Documentation',
        details:
          'Wrote and maintains TECHNICAL_DOCUMENTATION.md — 1,100 lines covering architecture, file structure, deployment, dependencies, API endpoints, and migration notes.'
      }
    ],
    talkingPoints: [
      'Search "tokyo" on the live map and show the filter sync',
      'Open the filter panel on mobile and demo the collapsible brand list',
      'Compare prototype.html with current index.html to show evolution',
      'Walk through TECHNICAL_DOCUMENTATION.md as the team onboarding guide'
    ]
  },
  {
    id: 'robert',
    name: 'Robert Blanco',
    handle: 'rjblanco',
    role: 'Map Interactions & Verified UX',
    focus: 'Markers, detail sidebar, "Near Me", verified badges — everything a user clicks.',
    accent: 'from-sky-300/20 to-sky-600/10',
    commits: 49,
    linesAdded: 3220,
    linesRemoved: 1448,
    ownership: [
      'user-frontend/index.html (marker + detail logic)',
      '"Near Me" + radius filter',
      'Verified retailer + premium marker system',
      'Mobile Safari geolocation flow'
    ],
    pitch:
      'If the map reacts to a user — marker click, cluster zoom, "Near Me", verified badge, clickable brand — that interaction is his. Also the reason the map doesn\'t melt an iPhone on load.',
    contributions: [
      {
        area: 'Near Me + Radius',
        details:
          'Built "Near Me" and the radius-based filter so the map surfaces the closest dealer and scopes to the user\'s area. Later made it respect active filters so it never surfaces hidden markers.'
      },
      {
        area: 'Store Detail Sidebar',
        details:
          'Replaced the Leaflet popup with a full sidebar detail panel — image, brands, hours, verified badge, clickable phone + directions.'
      },
      {
        area: 'Premium + Verified System',
        details:
          'Gold markers for premium retailers, verified badge UI, and the Verified Retailer / AD Verified display logic on cards and detail panel.'
      },
      {
        area: 'Custom WatchDNA Pin + Clustering',
        details:
          'Designed the custom WatchDNA marker and tuned MarkerCluster interaction so zooming in feels smooth rather than jumpy.'
      },
      {
        area: 'Viewport-Based Load Optimization',
        details:
          'Rewrote startup so the map no longer downloads all 28k stores at once — only what\'s near the user\'s viewport. Ships dramatically faster on mobile.'
      },
      {
        area: 'Mobile Safari Fixes',
        details:
          'Navigated iOS Safari\'s geolocation quirks — permission dialog flow, fallback copy, and a Safari-only denied message.'
      }
    ],
    talkingPoints: [
      'Demo "Near Me" with and without active filters',
      'Click a premium store to open the sidebar — highlight the gold marker',
      'Show before / after map load time with viewport loading',
      'Trigger the Mobile Safari denied message on an iPhone'
    ]
  },
  {
    id: 'aracely',
    name: 'Aracely Berrio',
    handle: 'aberrio5',
    role: 'Visual Design & Sidebar UX',
    focus: 'How the product feels — tiles, type, color, spacing, motion.',
    accent: 'from-rose-300/20 to-rose-600/10',
    commits: 33,
    linesAdded: 984,
    linesRemoved: 399,
    ownership: [
      'Map theme + attribution styling',
      'Cormorant typography system',
      'Marker cluster color & sizing',
      'Sidebar store list interaction'
    ],
    pitch:
      'Set the visual language of the product — serif type, Bright map theme, cluster colors, sidebar flow — and prototyped the map UX before the team had one.',
    contributions: [
      {
        area: 'Mapbox → OSM Prototype',
        details:
          'Shipped the original Mapbox prototype, then ported it to OpenStreetMap + Leaflet to free the project from Mapbox tileset encryption.'
      },
      {
        area: 'Design System',
        details:
          'Chose the Cormorant serif (matches WatchDNA brand), set the Bright map theme, designed attribution presentation, and standardized marker-cluster colors.'
      },
      {
        area: 'Scrollable Store List',
        details:
          'Built the sidebar list users see before opening a detail panel — including the zoom-in / zoom-out logic so the map reframes when a store is opened and restores when closed.'
      },
      {
        area: 'Filter Toggle Polish',
        details:
          'Owns copy + placement of the filter toggle, Clear Filters button, and sidebar header text when the filter panel is open.'
      },
      {
        area: 'Infinite-Zoom Fix',
        details:
          'Fixed the bug where users could pan horizontally past the dateline into infinity — locked the map to the world envelope.'
      }
    ],
    talkingPoints: [
      'Compare the Mapbox prototype screenshot with the current OSM map',
      'Show how opening a store zooms in and closing zooms back out',
      'Walk through the Cormorant + color palette choices',
      'Demo Clear Filters from a fully-filtered state'
    ]
  }
];
