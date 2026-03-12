/**
 * Import master_stores.csv into PostgreSQL.
 *
 * Strategy: TRUNCATE Location, batch insert all rows, then re-apply premium flags.
 * This supports full scraper re-runs — stale rows are never left behind.
 *
 * Usage: npm run import-master
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';

const prisma = new PrismaClient();

const BATCH_SIZE = 500;
const CSV_PATH = path.join(__dirname, '..', '..', 'uploads', 'master_stores.csv');

function parseRow(row: any) {
  const latitude = parseFloat(row.Latitude);
  const longitude = parseFloat(row.Longitude);

  if (!row.Handle || !row.Name || isNaN(latitude) || isNaN(longitude)) {
    return null;
  }

  return {
    handle: String(row.Handle).trim(),
    name: row.Name.trim(),
    status: row.Status?.toLowerCase() === 'active' || row.Status?.toLowerCase() === 'true' || !row.Status,
    addressLine1: row['Address Line 1'] || '',
    addressLine2: row['Address Line 2'] || null,
    postalCode: row['Postal/ZIP Code'] || null,
    city: row.City || '',
    stateProvinceRegion: row['State/Province/Region'] || null,
    country: row.Country || '',
    phone: row.Phone || null,
    email: row.Email || null,
    website: row.Website || null,
    imageUrl: row['Image URL'] || null,

    monday: row.Monday || null,
    tuesday: row.Tuesday || null,
    wednesday: row.Wednesday || null,
    thursday: row.Thursday || null,
    friday: row.Friday || null,
    saturday: row.Saturday || null,
    sunday: row.Sunday || null,

    latitude,
    longitude,

    pageTitle: row['Page Title'] || null,
    pageDescription: row['Page Description'] || null,
    metaTitle: row['Meta Title'] || null,
    metaDescription: row['Meta Description'] || null,

    priority: row.Priority ? parseInt(row.Priority) : null,
    tags: row[' Tags'] || row.Tags || null,
    brands: row.Brands || null,
    customBrands: row['Custom Brands'] || null,
    isPremium: false,

    nameFr: row['Name - FR'] || null,
    pageTitleFr: row['Page Title - FR'] || null,
    pageDescriptionFr: row['Page Description - FR'] || null,
    customBrandsFr: row['Custom Brands - FR'] || null,

    nameZhCn: row['Name - ZH-CN'] || null,
    pageTitleZhCn: row['Page Title - ZH-CN'] || null,
    pageDescriptionZhCn: row['Page Description - ZH-CN'] || null,
    customBrandsZhCn: row['Custom Brands - ZH-CN'] || null,

    nameEs: row['Name - ES'] || null,
    pageTitleEs: row['Page Title - ES'] || null,
    pageDescriptionEs: row['Page Description - ES'] || null,
    customBrandsEs: row['Custom Brands - ES'] || null,

    customButton1Title: row['Custom Button title 1'] || null,
    customButton1Url: row['Custom Button URL 1'] || null,
    customButton1TitleFr: row['Custom Button title 1 - FR'] || null,
    customButton1UrlFr: row['Custom Button URL 1 - FR'] || null,
    customButton1TitleZhCn: row['Custom Button title 1 - ZH-CN'] || null,
    customButton1UrlZhCn: row['Custom Button URL 1 - ZH-CN'] || null,
    customButton1TitleEs: row['Custom Button title 1 - ES'] || null,
    customButton1UrlEs: row['Custom Button URL 1 - ES'] || null,

    customButton2Title: row['Custom Button title 2'] || null,
    customButton2Url: row['Custom Button URL 2'] || null,
    customButton2TitleFr: row['Custom Button title 2 - FR'] || null,
    customButton2UrlFr: row['Custom Button URL 2 - FR'] || null,
    customButton2TitleZhCn: row['Custom Button title 2 - ZH-CN'] || null,
    customButton2UrlZhCn: row['Custom Button URL 2 - ZH-CN'] || null,
    customButton2TitleEs: row['Custom Button title 2 - ES'] || null,
    customButton2UrlEs: row['Custom Button URL 2 - ES'] || null,
  };
}

async function importMasterCSV() {
  console.log('Starting master CSV import...\n');

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found at: ${CSV_PATH}`);
  }

  const fileContent = fs.readFileSync(CSV_PATH, 'utf-8');
  const { data: rawRows, errors } = Papa.parse(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim()
  });

  if (errors.length > 0) {
    console.warn(`CSV parse warnings: ${errors.length}`);
  }

  const rows = rawRows as any[];
  const validRows: any[] = [];
  let skipped = 0;

  for (const row of rows) {
    const parsed = parseRow(row);
    if (parsed) {
      validRows.push(parsed);
    } else {
      skipped++;
    }
  }

  console.log(`Parsed ${rows.length} rows — ${validRows.length} valid, ${skipped} skipped`);

  console.log('Clearing existing Location rows...');
  const { count: deleted } = await prisma.location.deleteMany({});
  console.log(`Deleted ${deleted} existing rows`);

  console.log(`Inserting ${validRows.length} rows in batches of ${BATCH_SIZE}...`);
  let inserted = 0;

  for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
    const batch = validRows.slice(i, i + BATCH_SIZE);
    const result = await prisma.location.createMany({
      data: batch,
      skipDuplicates: true
    });
    inserted += result.count;
    console.log(`  Inserted ${inserted}/${validRows.length}...`);
  }

  console.log('\nRe-applying premium flags from PremiumStore table...');
  const premiumCount = await prisma.premiumStore.count();

  if (premiumCount > 0) {
    await prisma.$executeRaw`
      UPDATE "Location" l
      SET "isPremium" = true
      FROM "PremiumStore" ps
      WHERE l.handle = ps.handle
    `;
    console.log(`Applied premium flags (${premiumCount} premium handles on record)`);
  } else {
    console.log('No premium stores on record — skipping premium flag update');
  }

  const finalCount = await prisma.location.count();
  console.log(`\nImport complete: ${finalCount} locations in database`);
}

importMasterCSV()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Import failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
