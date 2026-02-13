/**
 * Reset PostgreSQL database - Delete all data
 *
 * WARNING: This will delete ALL data from your PostgreSQL database!
 *
 * Usage: npm run reset-db
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetDatabase() {
  try {
    console.log('⚠️  WARNING: This will delete ALL data from your database!');
    console.log('Starting database reset in 3 seconds...\n');

    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('🗑️  Deleting all data...\n');

    // Delete in order (respecting foreign keys)
    const deletedLogs = await prisma.validationLog.deleteMany();
    console.log(`✅ Deleted ${deletedLogs.count} validation logs`);

    const deletedJobs = await prisma.scraperJob.deleteMany();
    console.log(`✅ Deleted ${deletedJobs.count} scraper jobs`);

    const deletedLocations = await prisma.location.deleteMany();
    console.log(`✅ Deleted ${deletedLocations.count} locations`);

    const deletedUploads = await prisma.upload.deleteMany();
    console.log(`✅ Deleted ${deletedUploads.count} uploads`);

    const deletedUsers = await prisma.user.deleteMany();
    console.log(`✅ Deleted ${deletedUsers.count} users`);

    console.log('\n🎉 Database reset complete!');
    console.log('\n📝 Next steps:');
    console.log('  1. Run: npm run seed-admin (to create admin user)');
    console.log('  2. Run: npm run import-data (to import locations.csv)');
    console.log('  3. Or upload CSVs via admin panel');

  } catch (error: any) {
    console.error('❌ Reset failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resetDatabase()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
