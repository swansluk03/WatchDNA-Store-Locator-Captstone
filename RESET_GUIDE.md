# Reset Guide - How to Start Fresh

## Where is Your Data?

### 🔵 Primary Data (ACTIVE)
**Location:** PostgreSQL on Supabase Cloud
- **4,484 locations**
- 1 admin user
- 6 uploads
- 3 scraper jobs
- 24 validation logs

**Access:**
- Supabase Dashboard: https://supabase.com/dashboard
- Locally: `npm run prisma:studio` (http://localhost:5555)

### 📦 Backup Data (INACTIVE)
- SQLite database: `backend/dev.db` (old, not used)
- Export backup: `backend/migrations/sqlite-export.json` (4,484 locations)

### 📁 Local Files (ACTIVE)
- Uploaded CSVs: `backend/uploads/*.csv`
- Scraped CSVs: `backend/uploads/scraped/*.csv`
- Master store data lives in PostgreSQL only. Export a snapshot from the admin UI or `GET /backend/uploads/master_stores.csv` (generated from the DB) when you need a CSV file for backup or `import-master`.

---

## Reset Options

### Option A: Reset PostgreSQL Database Only (Keep Local Files)

**What it does:** Deletes all data from Supabase PostgreSQL, keeps local files intact.

```bash
cd backend
npm run reset-db
```

**Then re-initialize:**
```bash
# Create admin user
npm run seed-admin

# Import locations from CSV (path required)
npm run import-data -- /path/to/your-stores.csv
```

**Result:** Fresh database with locations from the CSV you passed.

---

### Option B: Reset Everything (Database + Local Files)

**What it does:** Deletes database AND all local uploads/files.

```bash
cd backend

# 1. Reset database
npm run reset-db

# 2. Delete local files
rm -rf uploads/*
rm -rf migrations/sqlite-export.json

# 3. Re-initialize
npm run seed-admin
npm run import-data -- /path/to/your-stores.csv
```

**Result:** Completely fresh start

---

### Option C: Reset Only Locations (Keep Users/Uploads)

**What it does:** Deletes locations only, preserves admin user and upload history.

Use Prisma Studio:
```bash
npm run prisma:studio
```

Then:
1. Open http://localhost:5555
2. Click "Location" table
3. Click "Delete all records"
4. Confirm deletion

**Or use SQL:**
```bash
cd backend
npx prisma db execute --stdin <<< "DELETE FROM \"Location\";"
```

**Then re-import:**
```bash
npm run import-data -- /path/to/your-stores.csv
```

---

### Option D: Delete Specific Data Types

#### Delete All Scraper Jobs:
```bash
npx prisma db execute --stdin <<< "DELETE FROM \"ScraperJob\";"
```

#### Delete All Uploads:
```bash
npx prisma db execute --stdin <<< "DELETE FROM \"Upload\";"
```

#### Delete All Validation Logs:
```bash
npx prisma db execute --stdin <<< "DELETE FROM \"ValidationLog\";"
```

---

### Option E: Nuclear Reset (Delete Database Schema)

**What it does:** Completely drops all tables and recreates from scratch.

```bash
cd backend

# 1. Optional: export stores as CSV (with backend running — same payload as admin download)
# curl -sS "http://localhost:3001/backend/uploads/master_stores.csv" -o ../stores-backup.csv

# 2. Reset database schema
npx prisma migrate reset --force

# 3. Re-create admin and re-import from CSV
npm run seed-admin
npm run import-data -- ../stores-backup.csv
```

**Warning:** This deletes EVERYTHING including table structure!

---

## Reset Scenarios

### "I want to start over with fresh locations"
```bash
cd backend
npm run reset-db
npm run seed-admin
npm run import-data -- /path/to/your-stores.csv
```

### "I want to test the scraper from scratch"
```bash
cd backend
# Delete scraper jobs and scraped files
npx prisma db execute --stdin <<< "DELETE FROM \"ScraperJob\";"
rm -rf uploads/scraped/*
```

### "I want to delete all locations and scrape fresh data"
```bash
cd backend
npx prisma db execute --stdin <<< "DELETE FROM \"Location\";"
# Then run scrapers via admin panel
```

### "I messed up, restore from backup"
```bash
cd backend
npm run reset-db
npm run seed-admin
npm run import-data -- /path/to/your-exported-stores.csv
```

---

## Safety Checklist

Before resetting:

- [ ] **Backup your data:** e.g. download from admin, or `curl` `GET /backend/uploads/master_stores.csv` while the API is running
- [ ] **Check Supabase dashboard:** Verify you're resetting the right database
- [ ] **Save admin password:** You'll need to re-create the admin user
- [ ] **Check uploads folder:** Any important CSV files backed up?

---

## Quick Reference Commands

```bash
# View all data in database
npm run prisma:studio

# Reset database (deletes all data)
npm run reset-db

# Create admin user
npm run seed-admin

# Import locations from CSV (path required)
npm run import-data -- ./stores.csv

# Export all stores as CSV: admin panel download, or curl GET /backend/uploads/master_stores.csv

# View database directly
npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM \"Location\";"
```

---

## Need Help?

- **Can't delete data:** Check Prisma Studio for foreign key constraints
- **Lost admin password:** Run `npm run seed-admin` to recreate admin user
- **Accidentally deleted everything:** Restore from a CSV backup with `npm run import-data -- ./your-backup.csv` after `seed-admin`
- **Supabase connection issues:** Check `.env` file has correct connection strings
