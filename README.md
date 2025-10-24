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

```bash
cd admin-frontend
npm install
npm run dev
```

The frontend will start on `http://localhost:5173`

### 3. Access Admin Panel

Open your browser to `http://localhost:5173` and login with:
- Username: `admin`
- Password: `admin123`

**That's it!** You can now upload and validate CSV files through the admin panel.

---

## Python Tools Setup

The Python tools are used for CSV validation and web scraping.

### Option 1: Automatic Activation with direnv (Recommended)

1. **Install direnv** (one-time setup):
   ```bash
   sudo apt-get install direnv    # Linux/WSL
   # or: brew install direnv       # Mac
   ```

2. **Add to your shell** (one-time setup):
   ```bash
   echo 'eval "$(direnv hook bash)"' >> ~/.bashrc
   source ~/.bashrc
   ```

3. **Allow the project** (first time in this repo):
   ```bash
   cd /path/to/WatchDNA-Store-Locator-Captstone
   direnv allow
   ```

The virtual environment will now activate automatically when you enter the directory!

### Option 2: Manual Activation

If you prefer not to use direnv:

```bash
# Create venv (first time only)
python3 -m venv venv

# Activate manually each time
source venv/bin/activate
```

### Install Python Dependencies

#### Option 1: Automatic Setup (Recommended)
```bash
# One-command setup for new team members
./setup_environment.sh
```

#### Option 2: Quick Setup
```bash
# Simple setup
./quick_setup.sh
```

#### Option 3: Manual Setup
```bash
# Create venv
python3 -m venv venv

# Activate venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

**Make Sure to add packages/imports to requirements.txt!**

---

## Documentation

- **Backend API**: See [backend/README.md](backend/README.md)
- **Admin Frontend**: See [admin-frontend/README.md](admin-frontend/README.md)
- **Python Tools**: See individual script files in `tools/`

---

## Development Workflow

### Working with the Admin Panel

1. **Start Backend** (Terminal 1):
   ```bash
   cd backend
   npm run dev
   ```

2. **Start Frontend** (Terminal 2):
   ```bash
   cd admin-frontend
   npm run dev
   ```

3. **Access at** `http://localhost:5173`

### Working with Python Tools

1. **Activate venv**:
   ```bash
   source venv/bin/activate  # or just cd into directory if using direnv
   ```

2. **Run validation**:
   ```bash
   python tools/validate_csv.py locations.csv
   ```

3. **Run scraper**:
   ```bash
   python tools/dynamic_scraper.py --brand omega
   ```

---

## Features

### Admin Panel
- User authentication (JWT-based)
- CSV upload and validation
- Error/warning log viewer
- Store location management
- Dashboard with statistics
- Brand configuration management

### Python Tools
- CSV validation with detailed error reporting
- Web scraping for store locations
- Brand-specific scraper configurations
- JSON and HTML parsing support

---

## Tech Stack

| Component | Technologies |
|-----------|-------------|
| **Backend** | Node.js, Express, TypeScript, Prisma, SQLite |
| **Frontend** | React 19, TypeScript, Vite, React Router |
| **Python Tools** | Python 3, BeautifulSoup, Requests, Pandas |
| **Database** | SQLite (development), supports PostgreSQL (production) |

---

## Environment Variables

### Backend (`.env`)
```bash
DATABASE_URL="file:./dev.db"
PORT=3001
NODE_ENV=development
UPLOAD_DIR=./uploads
JWT_SECRET=change_this_to_random_secret_in_production
JWT_EXPIRES_IN=7d
```

### Frontend (optional `.env`)
```bash
VITE_API_URL=http://localhost:3001
```

---

## Troubleshooting

### Admin Panel Issues

**Can't login / "Login failed" error:**
1. Make sure backend is running on port 3001
2. Check backend console for errors
3. Verify admin user exists: `cd backend && npm run seed-admin`
4. Clear browser localStorage: Open DevTools (F12) → Console → Run `localStorage.clear()`

**Database errors:**
```bash
cd backend
rm dev.db
npx prisma migrate deploy
npm run seed-admin
```

**Port already in use:**
- Backend: Change `PORT` in `backend/.env`
- Frontend: Run `npm run dev -- --port 3000`

### Python Tool Issues

**Python not found:**
- Make sure Python 3 is installed
- Try `python3` instead of `python`

**Dependencies missing:**
```bash
source venv/bin/activate
pip install -r requirements.txt
```

**Module not found:**
Make sure venv is activated (you should see `(venv)` in your terminal prompt)

---

## Project Team

This is a team capstone project for the WatchDNA Store Locator system.

**Components:**
- Admin Panel Backend & Frontend
- Python CSV Validation Tools
- Web Scraping System
- Store Locator Integration

---

## Next Steps

- [ ] Deploy admin panel to production (Render/Railway/Vercel)
- [ ] Add user management UI
- [ ] Integrate scraper job monitoring
- [ ] Add location map visualization
- [ ] Export validated data to various formats
- [ ] Add automated testing

---

## Contributing

When adding new features or fixing bugs:

1. Update relevant README files
2. Add new dependencies to `package.json` (Node.js) or `requirements.txt` (Python)
3. Document API endpoints in backend README
4. Test locally before pushing

---

## License

This is a private capstone project.
