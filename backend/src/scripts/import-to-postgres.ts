/**
 * Import tables from migrations/sqlite-export.json into PostgreSQL (FK-safe order).
 * Expects the JSON shape produced by `npm run export-data`; not limited to SQLite origins.
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
    const raw = exportData.data ?? {};
    const data = {
      users: raw.users ?? [],
      uploads: raw.uploads ?? [],
      brands: raw.brands ?? [],
      locations: raw.locations ?? [],
      locationBrands: raw.locationBrands ?? [],
      scraperJobs: raw.scraperJobs ?? [],
      validationLogs: raw.validationLogs ?? [],
      premiumStores: raw.premiumStores ?? [],
      brandConfigs: raw.brandConfigs ?? [],
      brandConfigBaselineExcludes: raw.brandConfigBaselineExcludes ?? [],
      analyticsEvents: raw.analyticsEvents ?? [],
    };

    console.log('📊 Import Summary:');
    console.log('='.repeat(50));
    console.log(`Users to import: ${data.users.length}`);
    console.log(`Uploads to import: ${data.uploads.length}`);
    console.log(`Brands to import: ${data.brands.length}`);
    console.log(`Locations to import: ${data.locations.length}`);
    console.log(`LocationBrand links to import: ${data.locationBrands.length}`);
    console.log(`Scraper Jobs to import: ${data.scraperJobs.length}`);
    console.log(`Validation Logs to import: ${data.validationLogs.length}`);
    console.log(`Premium Stores to import: ${data.premiumStores.length}`);
    console.log(`BrandConfigs to import: ${data.brandConfigs.length}`);
    console.log(`Analytics Events to import: ${data.analyticsEvents.length}`);
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

    // 3. Brand (before LocationBrand)
    if (data.brands.length > 0) {
      console.log('🏷️  Importing brands...');
      for (const row of data.brands) {
        await prisma.brand.create({ data: row });
      }
      console.log(`✅ ${data.brands.length} brands imported\n`);
    }

    // 4. Locations
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

    // 5. LocationBrand
    if (data.locationBrands.length > 0) {
      console.log('🔗 Importing location–brand links...');
      for (const row of data.locationBrands) {
        await prisma.locationBrand.create({ data: row });
      }
      console.log(`✅ ${data.locationBrands.length} links imported\n`);
    }

    // 6. Scraper Jobs
    console.log('🤖 Importing scraper jobs...');
    for (const job of data.scraperJobs) {
      await prisma.scraperJob.create({ data: job });
    }
    console.log(`✅ ${data.scraperJobs.length} scraper jobs imported\n`);

    // 7. Validation Logs
    console.log('📝 Importing validation logs...');
    for (const log of data.validationLogs) {
      await prisma.validationLog.create({ data: log });
    }
    console.log(`✅ ${data.validationLogs.length} validation logs imported\n`);

    // 8. PremiumStore (registry; no FK to Location in schema)
    if (data.premiumStores.length > 0) {
      console.log('⭐ Importing premium store registry...');
      for (const row of data.premiumStores) {
        await prisma.premiumStore.create({ data: row });
      }
      console.log(`✅ ${data.premiumStores.length} premium rows imported\n`);
    }

    if (data.brandConfigs.length > 0) {
      console.log('⚙️  Importing brand configs...');
      for (const row of data.brandConfigs) {
        await prisma.brandConfig.create({ data: row });
      }
      console.log(`✅ ${data.brandConfigs.length} brand configs imported\n`);
    }

    if (data.brandConfigBaselineExcludes.length > 0) {
      for (const row of data.brandConfigBaselineExcludes) {
        await prisma.brandConfigBaselineExclude.create({ data: row });
      }
      console.log(`✅ ${data.brandConfigBaselineExcludes.length} brand config baseline excludes imported\n`);
    }

    if (data.analyticsEvents.length > 0) {
      console.log('📈 Importing analytics events...');
      for (const row of data.analyticsEvents) {
        await prisma.analyticsEvent.create({ data: row });
      }
      console.log(`✅ ${data.analyticsEvents.length} analytics events imported\n`);
    }

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
