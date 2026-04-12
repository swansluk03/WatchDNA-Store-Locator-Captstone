/**
 * Export all Prisma-backed tables to JSON (works with PostgreSQL; legacy name kept for npm script).
 * Use before disaster recovery or when seeding another environment from a DB snapshot.
 *
 * Usage: npm run export-data
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function tryFindMany<T>(label: string, run: () => Promise<T[]>): Promise<T[]> {
  try {
    return await run();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[export] ${label} skipped (${msg})`);
    return [];
  }
}

async function exportData() {
  try {
    console.log('📤 Exporting database to JSON...\n');

    const [users, uploads, locations, scraperJobs, validationLogs] = await Promise.all([
      prisma.user.findMany(),
      prisma.upload.findMany(),
      prisma.location.findMany(),
      prisma.scraperJob.findMany(),
      prisma.validationLog.findMany(),
    ]);

    const [premiumStores, brands, locationBrands, brandConfigs, brandConfigBaselineExcludes, analyticsEvents] =
      await Promise.all([
        tryFindMany('PremiumStore', () => prisma.premiumStore.findMany()),
        tryFindMany('Brand', () => prisma.brand.findMany()),
        tryFindMany('LocationBrand', () => prisma.locationBrand.findMany()),
        tryFindMany('BrandConfig', () => prisma.brandConfig.findMany()),
        tryFindMany('BrandConfigBaselineExclude', () => prisma.brandConfigBaselineExclude.findMany()),
        tryFindMany('AnalyticsEvent', () => prisma.analyticsEvent.findMany()),
      ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      counts: {
        users: users.length,
        uploads: uploads.length,
        locations: locations.length,
        scraperJobs: scraperJobs.length,
        validationLogs: validationLogs.length,
        premiumStores: premiumStores.length,
        brands: brands.length,
        locationBrands: locationBrands.length,
        brandConfigs: brandConfigs.length,
        brandConfigBaselineExcludes: brandConfigBaselineExcludes.length,
        analyticsEvents: analyticsEvents.length,
      },
      data: {
        users,
        uploads,
        locations,
        scraperJobs,
        validationLogs,
        premiumStores,
        brands,
        locationBrands,
        brandConfigs,
        brandConfigBaselineExcludes,
        analyticsEvents,
      },
    };

    // Save to file
    const outputDir = path.join(__dirname, '..', '..', 'migrations');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputFile = path.join(outputDir, 'sqlite-export.json');
    fs.writeFileSync(outputFile, JSON.stringify(exportData, null, 2));

    console.log('✅ Data exported successfully!');
    console.log('📁 File:', outputFile);
    console.log('\n📊 Export Summary:');
    console.log('='.repeat(50));
    console.log(`Users: ${users.length}`);
    console.log(`Uploads: ${uploads.length}`);
    console.log(`Locations: ${locations.length}`);
    console.log(`Scraper Jobs: ${scraperJobs.length}`);
    console.log(`Validation Logs: ${validationLogs.length}`);
    console.log(`Premium Stores: ${premiumStores.length}`);
    console.log(`Brands: ${brands.length}`);
    console.log(`LocationBrands: ${locationBrands.length}`);
    console.log(`BrandConfigs: ${brandConfigs.length}`);
    console.log(`Analytics Events: ${analyticsEvents.length}`);
    console.log('='.repeat(50));

    console.log('\n⚠️  IMPORTANT: Keep this file safe! You\'ll need it to restore data to PostgreSQL.');

  } catch (error: any) {
    console.error('❌ Export failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

exportData()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
