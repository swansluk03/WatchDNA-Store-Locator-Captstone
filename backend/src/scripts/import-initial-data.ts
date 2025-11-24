/**
 * Import initial locations.csv data into the database
 *
 * Usage: npm run import-data
 */

import path from 'path';
import locationService from '../services/location.service';

async function importInitialData() {
  try {
    console.log('🚀 Starting initial data import...\n');

    // Path to locations.csv in the root directory
    const csvPath = path.join(__dirname, '..', '..', '..', 'locations.csv');
    console.log(`📁 CSV file path: ${csvPath}\n`);

    // Import the CSV
    const result = await locationService.importFromCSV(csvPath);

    // Display results
    console.log('\n📊 Import Results:');
    console.log('='.repeat(50));
    console.log(`✅ Success: ${result.success}`);
    console.log(`🆕 New locations: ${result.newCount}`);
    console.log(`🔄 Updated locations: ${result.updatedCount}`);
    console.log(`⏭️  Skipped: ${result.skippedCount}`);
    console.log(`❌ Errors: ${result.errorCount}`);
    console.log('='.repeat(50));

    if (result.errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      result.errors.slice(0, 10).forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
      if (result.errors.length > 10) {
        console.log(`... and ${result.errors.length - 10} more errors`);
      }
    }

    if (result.success) {
      console.log('\n✅ Initial data import completed successfully!');
      console.log(`📍 Total locations in database: ${result.newCount + result.updatedCount}`);
    } else {
      console.error('\n❌ Import failed!');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('\n💥 Fatal error during import:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the import
importInitialData()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Unexpected error:', error);
    process.exit(1);
  });
