# Backend — WatchDNA Admin API

This folder contains the Node.js/TypeScript backend for the admin panel: CSV upload handling, validation orchestration, user auth, and API endpoints consumed by the admin UI.

Quick setup (folder-local):

```powershell
cd backend
npm install
copy .env.example .env            # Windows PowerShell
npx prisma generate
npx prisma migrate dev --name init
npm run seed-admin
npm run dev
```

Default dev server: http://localhost:3001

Key files in this folder:

- `src/server.ts` — Express app entry
- `src/controllers/` — Request handlers (auth, uploads, locations, scraper)
- `src/services/` — Business logic and DB access
- `prisma/schema.prisma` — Database schema
- `uploads/` — Temporary uploaded CSV files

Common API endpoints (local to backend):

- `POST /api/auth/login` — Authenticate user
- `GET  /api/auth/me` — Current user
- `POST /api/uploads` — Upload CSV (authenticated)
- `GET  /api/uploads` — List uploads
- `GET  /health` — Health check

Testing examples (use from project root):

```powershell
# Login
curl -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}'

# Upload (replace token and path)
curl -X POST http://localhost:3001/api/uploads -H "Authorization: Bearer <TOKEN>" -F "file=@../locations.csv"
```

Notes:
- This README only documents backend-specific setup and endpoints. See the repository root README and `admin-frontend/README.md` for other components.
