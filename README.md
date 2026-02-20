# WatchDNA Store Locator - Capstone Project

Welcome to the Capstone Project Repo! This project includes:
- **Python tools** for CSV validation and web scraping
- **Admin Panel** (Backend + Frontend) for managing store locations
- **Store Locator** integration system

## Project Structure

```
WatchDNA-Store-Locator-Captstone/
├── backend/              # Admin panel API (Node.js + Express + Prisma)
├── admin-frontend/       # Admin panel UI (React + TypeScript + Vite)
├── tools/                # Python validation & scraping scripts
├── locations.csv         # Store location data
└── venv/                 # Python virtual environment
```

---

## Quick Start - Admin Panel

The admin panel allows you to upload, validate, and manage store location CSV files.

### Prerequisites

- **Node.js 18+** and npm
- **Python 3.x** (for CSV validation scripts)

### 1. Backend Setup

```bash
cd backend
npm install
cp .env.example .env
npx prisma migrate deploy
npm run seed-admin
npm run dev
```

The backend will start on `http://localhost:3001`

**Default admin credentials:**
- Username: `admin`
- Password: `admin123`

### 2. Frontend Setup

In a **new terminal**:
# WatchDNA Store Locator

Short overview and pointers to component READMEs.

This repository contains the admin backend, admin frontend, Python tools, and prototype code used for the WatchDNA Store Locator capstone.

See folder-specific READMEs for setup and usage:
- [backend/README.md](backend/README.md)
- [admin-frontend/README.md](admin-frontend/README.md)

Top-level layout:

```
WatchDNA-Store-Locator-Captstone/
├─ backend/              # Backend API (see backend/README.md)
├─ admin-frontend/       # Admin UI (see admin-frontend/README.md)
├─ tools/                # Python scripts (validation & scraping)
├─ Prototypes/           # Experimental scrapers and demos
├─ uploads/              # Uploaded CSVs and exports
├─ locations.csv         # Example location data
└─ TECHNICAL_DOCUMENTATION.md
```

Quick pointers:
- Start backend: `cd backend && npm install && npm run dev`
- Start frontend: `cd admin-frontend && npm install && npm run dev`

For development details, run the commands in the relevant folder and consult that folder's README.
   # or: brew install direnv       # Mac
