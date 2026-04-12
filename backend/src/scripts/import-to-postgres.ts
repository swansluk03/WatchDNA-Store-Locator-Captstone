/**
 * Import data from SQLite export to PostgreSQL
 * Run this AFTER migrating to PostgreSQL
 *
 * Usage: npm run import-postgres
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

// Use direct connection for bulk imports (not pooled)
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL
    }
  }
});

async function importData() {
  try {
    console.log('📥 Importing data to PostgreSQL...\n');

    // Read export file
    const exportFile = path.join(__dirname, '..', '..', 'migrations', 'sqlite-export.json');

    if (!fs.existsSync(exportFile)) {
      throw new Error(`Export file not found: ${exportFile}\nRun 'npm run export-data' first!`);
    }

    const exportData = JSON.parse(fs.readFileSync(exportFile, 'utf-8'));
    const { data } = exportData;

    console.log('📊 Import Summary:');
    console.log('='.repeat(50));
    console.log(`Users to import: ${data.users.length}`);
    console.log(`Uploads to import: ${data.uploads.length}`);
    console.log(`Locations to import: ${data.locations.length}`);
    console.log(`Scraper Jobs to import: ${data.scraperJobs.length}`);
    console.log(`Validation Logs to import: ${data.validationLogs.length}`);
    console.log('='.repeat(50));
    console.log('');

    // Import in order (respecting foreign keys)

    // 1. Users
    console.log('👤 Importing users...');
    for (const user of data.users) {
      await prisma.user.create({ data: user });
    }
    console.log(`✅ ${data.users.length} users imported\n`);

    // 2. Uploads
    console.log('📁 Importing uploads...');
    for (const upload of data.uploads) {
      await prisma.upload.create({ data: upload });
    }
    console.log(`✅ ${data.uploads.length} uploads imported\n`);

    // 3. Locations
    console.log('📍 Importing locations...');
    let locationCount = 0;
    for (const location of data.locations) {
      await prisma.location.create({ data: location });
      locationCount++;
      if (locationCount % 100 === 0) {
        console.log(`  Imported ${locationCount}/${data.locations.length} locations...`);
      }
    }
    console.log(`✅ ${data.locations.length} locations imported\n`);

    // 4. Scraper Jobs
    console.log('🤖 Importing scraper jobs...');
    for (const job of data.scraperJobs) {
      await prisma.scraperJob.create({ data: job });
    }
    console.log(`✅ ${data.scraperJobs.length} scraper jobs imported\n`);

    // 5. Validation Logs
    console.log('📝 Importing validation logs...');
    for (const log of data.validationLogs) {
      await prisma.validationLog.create({ data: log });
    }
    console.log(`✅ ${data.validationLogs.length} validation logs imported\n`);

    console.log('='.repeat(50));
    console.log('🎉 All data imported successfully!');
    console.log('='.repeat(50));

  } catch (error: any) {
    console.error('❌ Import failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

importData()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
