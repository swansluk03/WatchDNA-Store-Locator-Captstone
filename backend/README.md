# WatchDNA Admin Backend

Admin panel backend for WatchDNA Store Locator - CSV upload, validation, and data scraper management.

## Features

- CSV file upload with automatic validation
- Integration with Python validation scripts
- Validation logs and error tracking
- Brand configuration management
- RESTful API for admin panel frontend

## Tech Stack

- Node.js + Express + TypeScript
- Prisma ORM + SQLite
- Python integration for validation/scraping

## Project Structure

```
backend/
├── src/
│   ├── controllers/     # Request handlers
│   ├── services/        # Business logic
│   ├── routes/          # API routes
│   ├── middleware/      # Upload handling
│   └── server.ts        # Express app
├── prisma/
│   └── schema.prisma    # Database schema
├── uploads/             # Temporary CSV storage
└── dev.db              # SQLite database
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and adjust if needed:

```bash
cp .env.example .env
```

### 3. Initialize Database

```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 4. Create Admin User

```bash
npm run seed-admin
```

Default credentials:
- Username: `admin`
- Password: `admin123`

### 5. Start Development Server

```bash
npm run dev
```

Server runs on `http://localhost:3001`

## API Endpoints

### Authentication

```
POST /api/auth/login           # Login with username/password
POST /api/auth/logout          # Logout (client-side token removal)
GET  /api/auth/me              # Get current user info (requires auth)
GET  /api/auth/users           # List all users (admin only)
```

**Note:** All upload endpoints require authentication. Include JWT token in Authorization header.

### Health Check

```
GET /health
```

### CSV Uploads

```
POST   /api/uploads              # Upload CSV file
GET    /api/uploads              # List uploads (paginated)
GET    /api/uploads/stats        # Get statistics
GET    /api/uploads/:id          # Get upload details
GET    /api/uploads/:id/logs     # Get validation logs
DELETE /api/uploads/:id          # Delete upload
```

### Scraper Management

```
GET /api/scraper/brands          # List available brand configs
```

## Testing the API

### 1. Login

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

Response:
```json
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

Save the `token` value for subsequent requests.

### 2. Upload a CSV

```bash
curl -X POST http://localhost:3001/api/uploads \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -F "file=@../locations.csv"
```

Response:
```json
{
  "success": true,
  "upload": {
    "id": "uuid-here",
    "filename": "locations.csv",
    "status": "pending",
    "uploadedAt": "2025-10-22T20:14:06.646Z"
  },
  "message": "File uploaded successfully. Validation in progress."
}
```

### 3. Check Upload Status

```bash
curl http://localhost:3001/api/uploads/{upload-id} \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

Response:
```json
{
  "id": "uuid-here",
  "status": "valid",
  "validationErrors": [],
  "validationWarnings": [],
  "rowsTotal": 3,
  "validationLogs": []
}
```

### List All Uploads

```bash
curl http://localhost:3001/api/uploads
```

### Get Statistics

```bash
curl http://localhost:3001/api/uploads/stats
```

Response:
```json
{
  "totalUploads": 1,
  "validUploads": 1,
  "invalidUploads": 0,
  "totalLocations": 0
}
```

### List Brand Configs

```bash
curl http://localhost:3001/api/scraper/brands
```

## Python Integration

The backend integrates with existing Python tools:

- **validate_csv.py** - CSV validation (spawned via `child_process`)
- **dynamic_scraper.py** - Data scraping (to be integrated)

### How It Works

```javascript
// Spawn Python validation process
const process = spawn('python', [
  'tools/validate_csv.py',
  csvFilePath,
  '--json'
]);

// Parse JSON output and store in database
```

## Database Schema

### Upload
- Stores upload metadata
- Validation results (errors/warnings as JSON)
- Status tracking

### ValidationLog
- Individual validation errors/warnings
- Linked to upload
- Filterable by type/row

### Location
- Store location data (58 fields)
- Linked to upload
- Geographic data (lat/long)

### ScraperJob
- Scraper job tracking (future)

### User
- Admin accounts
- Username/email/password (hashed with bcrypt)
- Roles: admin (full access) or viewer (read-only)

## User Management

### Create Admin Users

**Option 1: Interactive CLI**
```bash
npm run create-admin
```

Prompts for:
- Username
- Email
- Password (min 6 chars)
- Role (admin/viewer)

**Option 2: Quick Seed (Development)**
```bash
npm run seed-admin
```

Creates default admin:
- Username: `admin`
- Password: `admin123`

**Option 3: Programmatically**
```typescript
import authService from './services/auth.service';

await authService.createUser({
  username: 'john',
  email: 'john@example.com',
  password: 'secure123',
  role: 'admin'
});
```

### Roles

- **admin**: Full access (upload, delete, view all)
- **viewer**: Read-only access (view uploads, view logs)

## Development

### Available Scripts

- `npm run dev` - Start dev server with hot reload
- `npm run build` - Build for production
- `npm start` - Run production build
- `npm run seed-admin` - Create default admin user
- `npm run create-admin` - Interactive admin creation
- `npx prisma studio` - Open database GUI
- `npx prisma migrate dev` - Create new migration

### Adding a New Endpoint

1. Create controller in `src/controllers/`
2. Create service in `src/services/`
3. Add route in `src/routes/`
4. Register route in `src/server.ts`

## Next Steps

- [x] Authentication system (JWT) ✅
- [x] User management ✅
- [x] Protected routes ✅
- [ ] Build frontend admin panel (React)
- [ ] Add scraper job endpoints
- [ ] Add location CRUD endpoints
- [ ] Add CSV export functionality
- [ ] Deploy to production (Render/Railway)

## Troubleshooting

### Python not found

Make sure Python is in your PATH, or set `PYTHON_PATH` in `.env`:

```
PYTHON_PATH=python3
```

### Database issues

Reset database:

```bash
rm dev.db
npx prisma migrate dev --name init
```

### Port already in use

Change port in `.env`:

```
PORT=3002
```

## Contributing

This is a team project for the WatchDNA Store Locator capstone.

- Backend/Admin Panel: Your role
- Data Scraper: Team member's role
