/**
 * Export all data from SQLite database to JSON
 * Run this BEFORE switching to PostgreSQL
 *
 * Usage: npm run export-data
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function exportData() {
  try {
    console.log('📤 Exporting SQLite data...\n');

    // Export all tables
    const [users, uploads, locations, scraperJobs, validationLogs] = await Promise.all([
      prisma.user.findMany(),
      prisma.upload.findMany(),
      prisma.location.findMany(),
      prisma.scraperJob.findMany(),
      prisma.validationLog.findMany()
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      counts: {
        users: users.length,
        uploads: uploads.length,
        locations: locations.length,
        scraperJobs: scraperJobs.length,
        validationLogs: validationLogs.length
      },
      data: {
        users,
        uploads,
        locations,
        scraperJobs,
        validationLogs
      }
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
