# Phase 1 Complete - Data Pipeline Summary

## ✅ What's Working Now

### 1. **Scraper Jobs** (Auto-Import)
```
Admin Panel → Start Scrape Job
    ↓
Python Scraper Runs
    ↓
Individual CSV Created (e.g., omega_stores_timestamp.csv)
    ↓
Master CSV Merged (master_stores.csv) - deduplicates
    ↓
✨ AUTO-IMPORT TO DATABASE ✨
    ↓
Location table updated
    ↓
Public Map Shows New Data Immediately
```

### 2. **Manual CSV Uploads** (Fixed - Now Auto-Imports!)
```
Admin Panel → Upload CSV
    ↓
Validation Runs
    ↓
If VALID:
    ↓
✨ AUTO-IMPORT TO DATABASE ✨
    ↓
Location table updated
    ↓
Public Map Shows New Data Immediately
```

### 3. **Public Map (prototype.html)**
- **Data Source:** API → Database (NOT CSV files!)
- **URL:** http://localhost:3001/ or http://localhost:3001/prototype.html
- **Features:**
  - Brand filtering
  - Type filtering (Retailers, Boutiques, Malls)
  - Store name search
  - "Near Me" geolocation
  - Radius search (5/10/25/50 miles)
  - All data is LIVE from database

---

## 📊 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      DATA SOURCES                            │
├─────────────────────────────────────────────────────────────┤
│  1. Scraper Jobs (omega, rolex, etc.)                       │
│  2. Manual CSV Uploads                                       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                VALIDATION & PROCESSING                       │
├─────────────────────────────────────────────────────────────┤
│  - Python validation                                         │
│  - Field mapping                                             │
│  - Deduplication (by handle or name+address)                │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│              DATABASE (Location Table)                       │
├─────────────────────────────────────────────────────────────┤
│  - Single source of truth                                    │
│  - 1,452+ locations                                          │
│  - Indexed for fast queries                                  │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                   PUBLIC API                                 │
├─────────────────────────────────────────────────────────────┤
│  GET /api/locations          - List all                      │
│  GET /api/locations/stats    - Statistics                    │
│  GET /api/locations/search   - Search by name/address        │
│  GET /api/locations/nearby   - Radius search                 │
│  GET /api/locations/brands   - List unique brands            │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                  PUBLIC MAP (prototype.html)                 │
├─────────────────────────────────────────────────────────────┤
│  - Fetches from API                                          │
│  - Real-time data                                            │
│  - Interactive filters                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗂️ About master_stores.csv

**Purpose:** Backup/archive file that accumulates all scraped data

**When Updated:**
- ✅ After every scraper job completes
- ❌ NOT updated by manual CSV uploads (by design)

**Why It Exists:**
- Historical record of all scraper runs
- Backup in case database needs to be rebuilt
- Can be downloaded via admin panel

**Important:**
- **prototype.html does NOT use this file anymore!**
- It uses the API → Database
- The CSV is just a backup/export

---

## 🔄 How Data Stays In Sync

### Scraped Data:
1. Scraper runs → CSV → master_stores.csv → **Database**
2. Map pulls from **Database**
3. ✅ Always in sync

### Manual Uploads:
1. Upload CSV → Validation → **Database** (if valid)
2. Map pulls from **Database**
3. ✅ Always in sync
4. ⚠️ Does NOT update master_stores.csv (only scrapers do)

---

## 🧪 How to Test

### Test 1: Manual CSV Upload
1. Go to admin panel: http://localhost:5173/uploads
2. Upload a valid CSV with store locations
3. Wait for validation to complete
4. If valid: Data automatically imports to database
5. Refresh http://localhost:3001/ → New stores appear!

### Test 2: Scraper Job
1. Go to admin panel: http://localhost:5173/scraper
2. Start a scrape job (e.g., Omega)
3. Watch logs for:
   ```
   === DATABASE IMPORT ===
   ✅ Import completed
     • New locations: X
     • Updated locations: Y
   ```
4. Refresh map → Scraped stores appear!

### Test 3: API Directly
```bash
# Check total locations
curl "http://localhost:3001/api/locations/stats"

# Search
curl "http://localhost:3001/api/locations/search?q=Paris"

# List with filters
curl "http://localhost:3001/api/locations?country=France&limit=10"
```

---

## 📁 Important Files

### Backend:
- `backend/src/services/location.service.ts` - Database operations & CSV import
- `backend/src/services/scraper.service.ts` - Scraper orchestration (lines 267-293: auto-import)
- `backend/src/services/upload.service.ts` - Manual upload handling (lines 58-78: auto-import)
- `backend/src/routes/location.routes.ts` - Public API endpoints
- `backend/src/controllers/location.controller.ts` - API handlers

### Frontend:
- `prototype.html` - Public map (lines 245-294: API integration)
- `admin-frontend/src/pages/Scraper.tsx` - Scraper management
- `admin-frontend/src/pages/Uploads.tsx` - Manual upload management

### Data:
- `backend/dev.db` - SQLite database (Location table)
- `backend/uploads/master_stores.csv` - Backup CSV (scraper output only)
- `backend/uploads/scraped/` - Individual brand CSVs

---

## ✅ Phase 1 Deliverables

- [x] Location Service with CSV import
- [x] Public API endpoints with filtering
- [x] Auto-import after scraper jobs
- [x] Auto-import after manual uploads (NEW FIX!)
- [x] prototype.html connected to API
- [x] Real-time data pipeline
- [x] Database as single source of truth

---

## 🚀 Next: Phase 2

- Migrate to PostgreSQL + PostGIS
- Optimize spatial queries
- Production deployment
- Shopify integration

---

**Date:** November 24, 2025
**Status:** Phase 1 Complete ✅
