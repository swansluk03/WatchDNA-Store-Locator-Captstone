/**
 * One-time backfill script: normalize all phone numbers in the Location table to E.164.
 * Run once after deploying the normalize-phone utility changes.
 *
 *   npm run normalize-phones
 */

import prisma from '../lib/prisma';
import { normalizePhone } from '../utils/normalize-phone';

async function run() {
  const locations = await prisma.location.findMany({
    select: { id: true, handle: true, phone: true, country: true },
  });

  console.log(`Found ${locations.length} location(s) to check.`);

  let updated = 0;
  let unchanged = 0;
  let cleared = 0;

  for (const loc of locations) {
    const normalized = normalizePhone(loc.phone, loc.country);
    if (normalized === loc.phone) {
      unchanged++;
      continue;
    }

    await prisma.location.update({
      where: { id: loc.id },
      data: { phone: normalized },
    });

    if (normalized === null && loc.phone !== null) {
      cleared++;
      console.log(`  CLEARED  [${loc.handle}] "${loc.phone}" → null`);
    } else {
      updated++;
      console.log(`  UPDATED  [${loc.handle}] "${loc.phone}" → "${normalized}"`);
    }
  }

  console.log(`\nDone. Updated: ${updated} | Cleared: ${cleared} | Unchanged: ${unchanged}`);
  await prisma.$disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
