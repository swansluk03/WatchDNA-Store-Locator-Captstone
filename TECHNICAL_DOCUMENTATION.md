# WatchDNA Store Locator - Technical Documentation

**Project:** WatchDNA Store Locator Capstone
**Version:** 1.0.0
**Last Updated:** December 2, 2025
**Status:** Active Development

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Technology Stack](#technology-stack)
4. [File Structure & Navigation](#file-structure--navigation)
5. [Installation & Setup](#installation--setup)
6. [Libraries & Dependencies](#libraries--dependencies)
7. [APIs & SDKs](#apis--sdks)
8. [License Information](#license-information)
9. [Database Schema](#database-schema)
10. [API Endpoints](#api-endpoints)
11. [Development Workflow](#development-workflow)

---

## Project Overview

The WatchDNA Store Locator is a comprehensive web application designed to manage, validate, and display watch retailer locations across multiple geographic regions. The system consists of three main components:

1. **Admin Panel** - Full-stack web application for managing store locations
2. **Python Tools** - CSV validation and web scraping utilities
3. **Interactive Map** - Store locator front-end with premium vendor classification

### Key Features

- CSV file upload and validation
- Automated web scraping for store data
- Interactive map visualization with Leaflet.js
- Premium vendor detection and classification
- Multi-language support (English, French, Chinese, Spanish)
- Geographic search and filtering
- RESTful API for location management
- JWT-based authentication system

---

## System Architecture

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        WatchDNA Store Locator                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────┐         ┌─────────────────┐         ┌──────────────────┐
│   Admin Panel   │         │  Python Tools   │         │  Map Front-End   │
│   (Frontend)    │◄────────┤   (Scripts)     │         │   (prototype)    │
│                 │         │                 │         │                  │
│  React 19       │         │  - CSV Validator│         │  Leaflet.js      │
│  TypeScript     │         │  - Web Scraper  │         │  MarkerCluster   │
│  Vite           │         │  - Normalizer   │         │  PapaParse       │
└────────┬────────┘         └────────┬────────┘         └────────┬─────────┘
         │                           │                           │
         │ HTTP/REST                 │ spawns                    │ reads CSV
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend API (Node.js)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ Express.js   │  │ Prisma ORM   │  │  Authentication       │ │
│  │ REST API     │  │              │  │  (JWT + bcrypt)       │ │
│  └──────────────┘  └──────┬───────┘  └───────────────────────┘ │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │   PostgreSQL   │
                    │   Database     │
                    │                │
                    │  - Locations   │
                    │  - Uploads     │
                    │  - Users       │
                    │  - Logs        │
                    └────────────────┘
```

### Component Interaction Flow

1. **Data Collection**: Python scrapers collect store location data from brand websites
2. **Validation**: CSV files are validated using Python validation scripts
3. **Upload**: Admin panel uploads validated CSV files to backend
4. **Storage**: Backend processes and stores data in PostgreSQL database
5. **API**: RESTful API provides data access to front-end applications
6. **Display**: Interactive map fetches and displays location data

---

## Technology Stack

### Backend Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | 18+ | JavaScript runtime environment |
| **Express.js** | 4.18.2 | Web application framework |
| **TypeScript** | 5.3.3 | Type-safe JavaScript |
| **Prisma** | 5.22.0 | ORM and database toolkit |
| **PostgreSQL** | Latest | Production database (SQLite for dev) |

### Frontend Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | 19.1.1 | UI component library |
| **TypeScript** | 5.9.3 | Type-safe JavaScript |
| **Vite** | 5.4.11 | Build tool and dev server |
| **React Router** | 6.30.1 | Client-side routing |
| **Axios** | 1.12.2 | HTTP client |

### Python Tools

| Technology | Version | Purpose |
|------------|---------|---------|
| **Python** | 3.x | Scripting language |
| **BeautifulSoup4** | 4.14.2 | HTML parsing |
| **Selenium** | 4.15.2 | Browser automation |
| **Requests** | 2.31.0 | HTTP library |
| **lxml** | 5.3.0 | XML/HTML parser |

### Map Visualization

| Technology | Version | Purpose |
|------------|---------|---------|
| **Leaflet.js** | 1.9.4 | Interactive maps |
| **MarkerCluster** | 1.5.3 | Marker clustering |
| **PapaParse** | 5.4.1 | CSV parsing |

---

## File Structure & Navigation

```
WatchDNA-Store-Locator-Captstone/
│
├── backend/                          # Backend API
│   ├── src/
│   │   ├── controllers/              # Request handlers
│   │   │   ├── auth.controller.ts    # Authentication logic
│   │   │   ├── location.controller.ts # Location CRUD
│   │   │   ├── upload.controller.ts  # File upload handling
│   │   │   └── scraper.controller.ts # Scraper job management
│   │   │
│   │   ├── services/                 # Business logic
│   │   │   ├── auth.service.ts       # User management & JWT
│   │   │   ├── location.service.ts   # Location operations
│   │   │   ├── upload.service.ts     # Upload processing
│   │   │   ├── validation.service.ts # CSV validation
│   │   │   └── scraper.service.ts    # Scraper integration
│   │   │
│   │   ├── routes/                   # API routes
│   │   │   ├── auth.routes.ts        # /api/auth/*
│   │   │   ├── location.routes.ts    # /api/locations/*
│   │   │   ├── upload.routes.ts      # /api/uploads/*
│   │   │   └── scraper.routes.ts     # /api/scraper/*
│   │   │
│   │   ├── middleware/               # Express middleware
│   │   │   ├── auth.middleware.ts    # JWT verification
│   │   │   └── upload.middleware.ts  # File upload config
│   │   │
│   │   ├── scripts/                  # Utility scripts
│   │   │   ├── seed-admin.ts         # Create default admin
│   │   │   ├── create-admin.ts       # Interactive admin creation
│   │   │   ├── import-initial-data.ts # Import CSV to DB
│   │   │   ├── export-sqlite-data.ts # Export data
│   │   │   └── reset-database.ts     # Database reset
│   │   │
│   │   └── server.ts                 # Express application entry
│   │
│   ├── prisma/
│   │   ├── schema.prisma             # Database schema
│   │   └── migrations/               # Database migrations
│   │
│   ├── uploads/                      # Temporary file storage
│   ├── package.json                  # Dependencies
│   ├── tsconfig.json                 # TypeScript config
│   ├── .env.example                  # Environment template
│   └── README.md                     # Backend docs
│
├── admin-frontend/                   # Admin Panel UI
│   ├── src/
│   │   ├── components/               # React components
│   │   │   ├── Layout.tsx            # Main layout wrapper
│   │   │   └── ProtectedRoute.tsx    # Auth route guard
│   │   │
│   │   ├── pages/                    # Page components
│   │   │   ├── Login.tsx             # Login page
│   │   │   ├── Dashboard.tsx         # Dashboard
│   │   │   ├── Uploads.tsx           # Upload list
│   │   │   ├── UploadDetail.tsx      # Upload details
│   │   │   └── Scraper.tsx           # Scraper management
│   │   │
│   │   ├── contexts/                 # React Context
│   │   │   └── AuthContext.tsx       # Auth state management
│   │   │
│   │   ├── services/                 # API clients
│   │   │   ├── api.ts                # Axios instance
│   │   │   └── scraper.service.ts    # Scraper API calls
│   │   │
│   │   ├── types/                    # TypeScript types
│   │   │   └── index.ts              # Shared types
│   │   │
│   │   ├── styles/                   # CSS files
│   │   ├── App.tsx                   # Root component
│   │   └── main.tsx                  # React entry point
│   │
│   ├── package.json                  # Dependencies
│   ├── vite.config.ts                # Vite configuration
│   ├── tsconfig.json                 # TypeScript config
│   └── README.md                     # Frontend docs
│
├── tools/                            # Python utilities
│   ├── validate_csv.py               # CSV validation
│   └── add_test_row.py               # Test data generator
│
├── Prototypes/                       # Experimental code
│   └── Data_Scrappers/               # Web scraping tools
│       ├── universal_scraper.py      # Generic scraper
│       ├── data_normalizer.py        # Data normalization
│       ├── master_csv_manager.py     # CSV management
│       ├── pattern_detector.py       # Pattern detection
│       ├── locator_type_detector.py  # Locator type identification
│       ├── analyze_endpoint.py       # API endpoint analyzer
│       ├── test_scraping.py          # Scraper testing
│       ├── viewport_grid.py          # Viewport simulation
│       └── brand_configs.json        # Brand configurations
│
├── prototype.html                    # Interactive map demo
├── mb_prototype.html                 # Mapbox prototype
├── locations.csv                     # Store location data
├── requirements.txt                  # Python dependencies
├── README.md                         # Main documentation
├── .env.example                      # Environment template
└── TECHNICAL_DOCUMENTATION.md        # This file
```

### Key Directories Explained

- **[backend/src/controllers/](backend/src/controllers/)** - HTTP request handlers that process incoming API requests
- **[backend/src/services/](backend/src/services/)** - Business logic layer, database operations
- **[backend/src/routes/](backend/src/routes/)** - API endpoint definitions and routing
- **[admin-frontend/src/pages/](admin-frontend/src/pages/)** - React page components
- **[admin-frontend/src/components/](admin-frontend/src/components/)** - Reusable React components
- **[tools/](tools/)** - Python validation and utility scripts
- **[Prototypes/Data_Scrappers/](Prototypes/Data_Scrappers/)** - Web scraping implementations

---

## Installation & Setup

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.x
- **PostgreSQL** (for production) or SQLite (for development)
- **Git** for version control

### 1. Clone Repository

```bash
git clone <repository-url>
cd WatchDNA-Store-Locator-Captstone
```

### 2. Backend Setup

```bash
cd backend

# Install Node dependencies
npm install

# Create environment file
cp .env.example .env

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate deploy

# Seed admin user (username: admin, password: admin123)
npm run seed-admin

# Start development server
npm run dev
```

Backend will run on `http://localhost:3001`

### 3. Frontend Setup

In a new terminal:

```bash
cd admin-frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Frontend will run on `http://localhost:5173`

### 4. Python Tools Setup

```bash
# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate  # Linux/Mac
# or
venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt
```

### Environment Configuration

#### Backend .env

```bash
# Database (SQLite for dev, PostgreSQL for prod)
DATABASE_URL="file:./dev.db"
DIRECT_URL="file:./dev.db"

# Server
PORT=3001
NODE_ENV=development

# Paths
UPLOAD_DIR=./uploads
PYTHON_PATH=python

# Authentication
JWT_SECRET=change_this_to_random_secret_in_production
JWT_EXPIRES_IN=7d

# Optional: Mapbox for future map features
MAPBOX_SECRET=your_mapbox_token_here
```

#### Frontend .env (optional)

```bash
VITE_API_URL=http://localhost:3001
```

---

## Libraries & Dependencies

### Backend Dependencies

#### Production Dependencies

| Library | Version | License | Source | Purpose |
|---------|---------|---------|--------|---------|
| **@prisma/client** | 5.22.0 | Apache-2.0 | [npm](https://www.npmjs.com/package/@prisma/client) | Database ORM client |
| **express** | 4.18.2 | MIT | [npm](https://www.npmjs.com/package/express) | Web framework |
| **cors** | 2.8.5 | MIT | [npm](https://www.npmjs.com/package/cors) | Cross-origin resource sharing |
| **dotenv** | 16.3.1 | BSD-2-Clause | [npm](https://www.npmjs.com/package/dotenv) | Environment variables |
| **bcrypt** | 5.1.1 | MIT | [npm](https://www.npmjs.com/package/bcrypt) | Password hashing |
| **jsonwebtoken** | 9.0.2 | MIT | [npm](https://www.npmjs.com/package/jsonwebtoken) | JWT authentication |
| **multer** | 1.4.5-lts.1 | MIT | [npm](https://www.npmjs.com/package/multer) | File upload handling |
| **papaparse** | 5.5.3 | MIT | [npm](https://www.npmjs.com/package/papaparse) | CSV parsing |
| **uuid** | 9.0.1 | MIT | [npm](https://www.npmjs.com/package/uuid) | UUID generation |

#### Development Dependencies

| Library | Version | License | Source | Purpose |
|---------|---------|---------|--------|---------|
| **typescript** | 5.3.3 | Apache-2.0 | [npm](https://www.npmjs.com/package/typescript) | TypeScript compiler |
| **prisma** | 5.22.0 | Apache-2.0 | [npm](https://www.npmjs.com/package/prisma) | Database toolkit |
| **ts-node** | 10.9.2 | MIT | [npm](https://www.npmjs.com/package/ts-node) | TypeScript execution |
| **ts-node-dev** | 2.0.0 | MIT | [npm](https://www.npmjs.com/package/ts-node-dev) | Dev server with hot reload |
| **@types/express** | 4.17.21 | MIT | [npm](https://www.npmjs.com/package/@types/express) | TypeScript definitions |
| **@types/cors** | 2.8.17 | MIT | [npm](https://www.npmjs.com/package/@types/cors) | TypeScript definitions |
| **@types/bcrypt** | 5.0.0 | MIT | [npm](https://www.npmjs.com/package/@types/bcrypt) | TypeScript definitions |
| **@types/jsonwebtoken** | 9.0.10 | MIT | [npm](https://www.npmjs.com/package/@types/jsonwebtoken) | TypeScript definitions |
| **@types/multer** | 1.4.11 | MIT | [npm](https://www.npmjs.com/package/@types/multer) | TypeScript definitions |
| **@types/papaparse** | 5.5.0 | MIT | [npm](https://www.npmjs.com/package/@types/papaparse) | TypeScript definitions |
| **@types/uuid** | 9.0.7 | MIT | [npm](https://www.npmjs.com/package/@types/uuid) | TypeScript definitions |
| **@types/node** | 20.10.5 | MIT | [npm](https://www.npmjs.com/package/@types/node) | TypeScript definitions |

### Frontend Dependencies

#### Production Dependencies

| Library | Version | License | Source | Purpose |
|---------|---------|---------|--------|---------|
| **react** | 19.1.1 | MIT | [npm](https://www.npmjs.com/package/react) | UI library |
| **react-dom** | 19.1.1 | MIT | [npm](https://www.npmjs.com/package/react-dom) | React DOM rendering |
| **react-router-dom** | 6.30.1 | MIT | [npm](https://www.npmjs.com/package/react-router-dom) | Client-side routing |
| **axios** | 1.12.2 | MIT | [npm](https://www.npmjs.com/package/axios) | HTTP client |

#### Development Dependencies

| Library | Version | License | Source | Purpose |
|---------|---------|---------|--------|---------|
| **vite** | 5.4.11 | MIT | [npm](https://www.npmjs.com/package/vite) | Build tool |
| **@vitejs/plugin-react** | 4.3.4 | MIT | [npm](https://www.npmjs.com/package/@vitejs/plugin-react) | React plugin for Vite |
| **typescript** | 5.9.3 | Apache-2.0 | [npm](https://www.npmjs.com/package/typescript) | TypeScript compiler |
| **eslint** | 9.36.0 | MIT | [npm](https://www.npmjs.com/package/eslint) | Code linting |
| **@eslint/js** | 9.36.0 | MIT | [npm](https://www.npmjs.com/package/@eslint/js) | ESLint JavaScript config |
| **typescript-eslint** | 8.45.0 | MIT | [npm](https://www.npmjs.com/package/typescript-eslint) | TypeScript ESLint |
| **eslint-plugin-react-hooks** | 5.2.0 | MIT | [npm](https://www.npmjs.com/package/eslint-plugin-react-hooks) | React Hooks linting |
| **eslint-plugin-react-refresh** | 0.4.22 | MIT | [npm](https://www.npmjs.com/package/eslint-plugin-react-refresh) | React Refresh linting |
| **@types/react** | 19.1.16 | MIT | [npm](https://www.npmjs.com/package/@types/react) | TypeScript definitions |
| **@types/react-dom** | 19.1.9 | MIT | [npm](https://www.npmjs.com/package/@types/react-dom) | TypeScript definitions |
| **@types/node** | 24.6.0 | MIT | [npm](https://www.npmjs.com/package/@types/node) | TypeScript definitions |
| **globals** | 16.4.0 | MIT | [npm](https://www.npmjs.com/package/globals) | Global identifiers |

### Python Dependencies

| Library | Version | License | Source | Purpose |
|---------|---------|---------|--------|---------|
| **beautifulsoup4** | 4.14.2 | MIT | [PyPI](https://pypi.org/project/beautifulsoup4/) | HTML/XML parsing |
| **soupsieve** | 2.8 | MIT | [PyPI](https://pypi.org/project/soupsieve/) | CSS selector library |
| **requests** | 2.31.0 | Apache-2.0 | [PyPI](https://pypi.org/project/requests/) | HTTP library |
| **lxml** | 5.3.0 | BSD | [PyPI](https://pypi.org/project/lxml/) | XML/HTML parser |
| **selenium** | 4.15.2 | Apache-2.0 | [PyPI](https://pypi.org/project/selenium/) | Browser automation |
| **typing_extensions** | 4.15.0 | PSF | [PyPI](https://pypi.org/project/typing-extensions/) | Type hints backport |

### Front-End Map Libraries (CDN)

| Library | Version | License | Source | Purpose |
|---------|---------|---------|--------|---------|
| **Leaflet.js** | 1.9.4 | BSD-2-Clause | [unpkg](https://unpkg.com/leaflet@1.9.4/) | Interactive maps |
| **Leaflet.markercluster** | 1.5.3 | MIT | [unpkg](https://unpkg.com/leaflet.markercluster@1.5.3/) | Marker clustering |
| **PapaParse** | 5.4.1 | MIT | [unpkg](https://unpkg.com/papaparse@5.4.1/) | CSV parsing in browser |

---

## APIs & SDKs

### Internal APIs

#### Authentication API

**Base URL:** `http://localhost:3001/api/auth`

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/login` | POST | User login | No |
| `/logout` | POST | User logout | Yes |
| `/me` | GET | Get current user | Yes |
| `/users` | GET | List all users | Yes (admin) |

#### Upload API

**Base URL:** `http://localhost:3001/api/uploads`

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/` | POST | Upload CSV file | Yes |
| `/` | GET | List uploads (paginated) | Yes |
| `/stats` | GET | Get upload statistics | Yes |
| `/:id` | GET | Get upload details | Yes |
| `/:id/logs` | GET | Get validation logs | Yes |
| `/:id` | DELETE | Delete upload | Yes |

#### Location API

**Base URL:** `http://localhost:3001/api/locations`

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/` | GET | List all locations | No |
| `/search` | GET | Search locations | No |
| `/nearby` | GET | Find nearby locations | No |
| `/brands` | GET | List all brands | No |
| `/stats` | GET | Location statistics | No |
| `/:id` | GET | Get location by ID | No |

#### Scraper API

**Base URL:** `http://localhost:3001/api/scraper`

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/brands` | GET | List brand configs | Yes |

### External APIs & SDKs

#### Prisma ORM

- **Version:** 5.22.0
- **Type:** Database ORM
- **Documentation:** [https://www.prisma.io/docs](https://www.prisma.io/docs)
- **License:** Apache-2.0
- **Purpose:** Database access, migrations, and type-safe queries
- **Configuration:** [backend/prisma/schema.prisma](backend/prisma/schema.prisma)

**Features Used:**
- PostgreSQL database provider
- Automated migrations
- Type-safe database client
- Relation management
- Query optimization

#### Leaflet.js Mapping API

- **Version:** 1.9.4
- **Type:** JavaScript mapping library
- **Documentation:** [https://leafletjs.com/reference.html](https://leafletjs.com/reference.html)
- **License:** BSD-2-Clause
- **Source:** [https://unpkg.com/leaflet@1.9.4/](https://unpkg.com/leaflet@1.9.4/)
- **Purpose:** Interactive map rendering and controls

**Features Used:**
- Tile layer management
- Custom markers (regular and premium)
- Popup information windows
- Geographic bounds calculation
- Event handling (click, hover)

#### Selenium WebDriver

- **Version:** 4.15.2
- **Type:** Browser automation framework
- **Documentation:** [https://www.selenium.dev/documentation/](https://www.selenium.dev/documentation/)
- **License:** Apache-2.0
- **Purpose:** Dynamic web scraping and browser automation

**Features Used:**
- Headless browser operation
- JavaScript rendering
- Element interaction
- Page navigation
- Screenshot capture

### Third-Party Integrations

#### Mapbox (Future/Optional)

- **Status:** Planned for future use
- **Purpose:** Enhanced mapping features
- **Configuration:** `MAPBOX_SECRET` in `.env`
- **Documentation:** [https://docs.mapbox.com/](https://docs.mapbox.com/)

---

## License Information

### Project License

**License:** ISC (Internet Systems Consortium)
**Type:** Private Capstone Project
**Status:** Not for public distribution

### Open Source Licenses Summary

This project uses the following open-source licenses:

| License | Libraries | Commercial Use | Modification | Distribution | Private Use |
|---------|-----------|----------------|--------------|--------------|-------------|
| **MIT** | Express, React, Axios, Multer, JWT, most deps | ✅ | ✅ | ✅ | ✅ |
| **Apache-2.0** | TypeScript, Prisma, Requests, Selenium | ✅ | ✅ | ✅ | ✅ |
| **BSD-2-Clause** | Leaflet.js, dotenv | ✅ | ✅ | ✅ | ✅ |
| **ISC** | (This project) | ✅ | ✅ | ✅ | ✅ |

**Note:** All dependencies are permissive open-source licenses compatible with commercial use.

### License Compliance

All third-party libraries comply with their respective licenses:
- Attribution maintained in package.json files
- No modifications to core libraries
- Used as intended by their respective licenses

---

## Database Schema

### Prisma Schema Overview

**File:** [backend/prisma/schema.prisma](backend/prisma/schema.prisma)
**Database Provider:** PostgreSQL (SQLite for development)

### Entity Relationship Diagram

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│    User     │         │   Upload     │         │  Location   │
├─────────────┤         ├──────────────┤         ├─────────────┤
│ id (PK)     │         │ id (PK)      │────┐    │ id (PK)     │
│ username    │         │ filename     │    │    │ handle      │
│ email       │         │ uploadedBy   │    │    │ name        │
│ passwordHash│         │ status       │    └───▶│ uploadId(FK)│
│ role        │         │ rowsTotal    │         │ latitude    │
│ createdAt   │         │ rowsProcessed│         │ longitude   │
│ lastLogin   │         └──────┬───────┘         │ ...58 fields│
└─────────────┘                │                 └─────────────┘
                               │
                               │
                      ┌────────┼────────┐
                      │        │        │
                      ▼        ▼        ▼
              ┌──────────┐ ┌────────────┐
              │Validation│ │ ScraperJob │
              │   Log    │ │            │
              ├──────────┤ ├────────────┤
              │ id (PK)  │ │ id (PK)    │
              │uploadId  │ │ brandName  │
              │ rowNumber│ │ status     │
              │ logType  │ │ config     │
              │ message  │ │ uploadId   │
              └──────────┘ └────────────┘
```

### Database Tables

#### User Table

Stores admin and viewer user accounts.

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| id | String | UUID primary key | PK, auto-generated |
| username | String | Login username | Unique, indexed |
| email | String | User email | Unique, indexed |
| passwordHash | String | Bcrypt password hash | - |
| role | String | User role | Default: "admin" |
| createdAt | DateTime | Account creation | Auto-generated |
| lastLogin | DateTime? | Last login timestamp | Nullable |

**Indexes:** username, email

#### Upload Table

Tracks CSV file uploads and validation status.

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| id | String | UUID primary key | PK, auto-generated |
| filename | String | Stored filename | - |
| originalFilename | String | Original upload name | - |
| fileSize | Int | File size in bytes | - |
| uploadedBy | String | Username of uploader | Default: "admin" |
| uploadedAt | DateTime | Upload timestamp | Auto-generated |
| status | String | Processing status | Default: "pending" |
| validationErrors | String? | JSON error array | Nullable |
| validationWarnings | String? | JSON warning array | Nullable |
| rowsTotal | Int | Total rows in CSV | Default: 0 |
| rowsProcessed | Int | Successfully processed | Default: 0 |
| rowsFailed | Int | Failed validations | Default: 0 |
| brandConfig | String? | Brand configuration | Nullable |
| scraperType | String? | Scraper type used | Nullable |

**Status Values:** pending, validating, valid, invalid, processing, completed, failed
**Indexes:** status, uploadedAt

#### Location Table

Stores detailed store location information with multi-language support.

**Core Fields:**

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| id | String | UUID primary key | PK, auto-generated |
| uploadId | String? | Related upload | FK (nullable) |
| handle | String | Unique identifier | Unique |
| name | String | Store name | - |
| status | Boolean | Active/inactive | Default: true |
| latitude | Float | Geographic latitude | Required |
| longitude | Float | Geographic longitude | Required |

**Address Fields:**

| Field | Type | Description |
|-------|------|-------------|
| addressLine1 | String | Street address |
| addressLine2 | String? | Additional address |
| postalCode | String? | ZIP/postal code |
| city | String | City name |
| stateProvinceRegion | String? | State/province |
| country | String | Country name |

**Contact Fields:**

| Field | Type | Description |
|-------|------|-------------|
| phone | String? | Phone number |
| email | String? | Contact email |
| website | String? | Store website |
| imageUrl | String? | Store image |

**Hours of Operation:**

| Field | Type | Description |
|-------|------|-------------|
| monday - sunday | String? | Opening hours |

**SEO Fields:**

| Field | Type | Description |
|-------|------|-------------|
| pageTitle | String? | Page title |
| pageDescription | String? | Page description |
| metaTitle | String? | Meta title tag |
| metaDescription | String? | Meta description |

**Localization (French, Chinese, Spanish):**
- Name translations
- Page title translations
- Page description translations
- Custom brand translations

**Custom Buttons (with localization):**
- Up to 2 custom buttons per location
- Title and URL for each button
- Translations for French, Chinese, Spanish

**Indexes:** uploadId, city, country

#### ValidationLog Table

Individual validation errors and warnings.

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| id | String | UUID primary key | PK |
| uploadId | String | Related upload | FK, cascade delete |
| rowNumber | Int? | CSV row number | Nullable |
| logType | String | error/warning/info | Indexed |
| fieldName | String? | Field with issue | Nullable |
| issueType | String | Type of issue | - |
| message | String | Descriptive message | - |
| value | String? | Problematic value | Nullable |
| createdAt | DateTime | Log timestamp | Auto-generated |

**Indexes:** uploadId, logType

#### ScraperJob Table

Tracks web scraping job execution.

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| id | String | UUID primary key | PK |
| brandName | String | Brand being scraped | Indexed |
| config | String | JSON configuration | - |
| status | String | Job status | Default: "queued", indexed |
| startedAt | DateTime | Job start time | Auto-generated |
| completedAt | DateTime? | Job completion | Nullable |
| uploadId | String? | Related upload | FK (nullable) |
| errorMessage | String? | Error details | Nullable |
| recordsScraped | Int | Records found | Default: 0 |
| logs | String? | Full output logs | Nullable |

**Status Values:** queued, running, completed, failed
**Indexes:** status, brandName

---

## API Endpoints

See complete API documentation in [backend/README.md](backend/README.md#api-endpoints)

### Authentication Endpoints

**POST /api/auth/login**

Authenticate user and receive JWT token.

```json
Request:
{
  "username": "admin",
  "password": "admin123"
}

Response:
{
  "success": true,
  "user": {
    "id": "uuid",
    "username": "admin",
    "email": "admin@watchdna.com",
    "role": "admin"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**GET /api/auth/me**

Get current authenticated user.

```json
Response:
{
  "id": "uuid",
  "username": "admin",
  "email": "admin@watchdna.com",
  "role": "admin"
}
```

### Upload Endpoints

**POST /api/uploads**

Upload and validate CSV file.

```bash
curl -X POST http://localhost:3001/api/uploads \
  -H "Authorization: Bearer <token>" \
  -F "file=@locations.csv"
```

**GET /api/uploads**

List all uploads with pagination.

```json
Response:
{
  "data": [
    {
      "id": "uuid",
      "filename": "locations.csv",
      "status": "valid",
      "uploadedAt": "2025-12-02T10:00:00Z",
      "rowsTotal": 150
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

**GET /api/uploads/stats**

Get upload statistics.

```json
Response:
{
  "totalUploads": 5,
  "validUploads": 4,
  "invalidUploads": 1,
  "totalLocations": 450
}
```

### Location Endpoints

**GET /api/locations**

List all locations with optional filters.

Query parameters:
- `brand` - Filter by brand
- `country` - Filter by country
- `city` - Filter by city
- `status` - Filter by active/inactive
- `search` - Search by name
- `limit` - Results per page
- `offset` - Pagination offset

**GET /api/locations/nearby**

Find locations near coordinates.

Query parameters:
- `latitude` - Center latitude
- `longitude` - Center longitude
- `radius` - Search radius in miles

**GET /api/locations/brands**

Get list of all unique brands.

```json
Response:
[
  "Omega",
  "Rolex",
  "TAG Heuer",
  "Breitling"
]
```

---

## Development Workflow

### Starting the Development Environment

1. **Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

2. **Terminal 2 - Frontend:**
```bash
cd admin-frontend
npm run dev
```

3. **Terminal 3 - Python (if needed):**
```bash
source venv/bin/activate
python tools/validate_csv.py locations.csv
```

### Available NPM Scripts

#### Backend Scripts

```bash
npm run dev              # Start development server
npm run build            # Build for production
npm start                # Run production build
npm run seed-admin       # Create default admin user
npm run create-admin     # Interactive admin creation
npm run import-data      # Import CSV to database
npm run export-data      # Export database data
npm run reset-db         # Reset database
npx prisma studio        # Open database GUI
npx prisma migrate dev   # Create database migration
```

#### Frontend Scripts

```bash
npm run dev              # Start development server
npm run build            # Build for production
npm run preview          # Preview production build
npm run lint             # Run ESLint
```

### Git Workflow

**Current Branch:** `connect0`
**Main Branch:** `main`

**Recent Commits:**
- `92b8ccb` - Reset route
- `a8b5d97` - Fixed initial premium vendor logic, gold markers display
- `486c2ed` - Added premium markers + vendor classification
- `7111063` - Initial premium vendor logic
- `a41cc95` - Implement premium vendor detection from email column

### Testing the System

1. **Test Backend API:**
```bash
curl http://localhost:3001/health
```

2. **Test Database:**
```bash
cd backend
npx prisma studio
```

3. **Test CSV Validation:**
```bash
source venv/bin/activate
python tools/validate_csv.py locations.csv
```

4. **Test Frontend:**
Navigate to `http://localhost:5173` and login with:
- Username: `admin`
- Password: `admin123`

### Database Management

**View Database:**
```bash
cd backend
npx prisma studio
```

**Reset Database:**
```bash
cd backend
npm run reset-db
npm run seed-admin
```

**Create Migration:**
```bash
cd backend
npx prisma migrate dev --name <migration_name>
```

---

## Additional Resources

- **Main README:** [README.md](README.md)
- **Backend Documentation:** [backend/README.md](backend/README.md)
- **Frontend Documentation:** [admin-frontend/README.md](admin-frontend/README.md)
- **Phase 1 Completion:** [PHASE1_COMPLETE.md](PHASE1_COMPLETE.md)
- **Reset Guide:** [RESET_GUIDE.md](RESET_GUIDE.md)

---

## Project Status & Roadmap

### Completed Features ✅

- Full-stack admin panel (backend + frontend)
- JWT authentication system
- CSV upload and validation
- Database schema and migrations
- Location import/export
- Interactive map prototype with premium vendors
- Python web scraping tools
- Multi-language support in data model

### In Progress 🚧

- Premium vendor classification refinement
- Scraper job monitoring UI
- Enhanced map features

### Planned Features 📋

- User management UI
- CSV export functionality
- Location map visualization in admin panel
- Automated testing suite
- Production deployment
- API rate limiting
- Advanced search filters

---

**Document Version:** 1.0.0
**Last Updated:** December 2, 2025
**Maintained By:** WatchDNA Capstone Team
