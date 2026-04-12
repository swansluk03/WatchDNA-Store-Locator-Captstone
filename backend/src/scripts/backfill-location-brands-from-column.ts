/**
 * One-time (or idempotent): copy legacy Location.brands into Brand + LocationBrand, then clear the column.
 *
 *   npx ts-node src/scripts/backfill-location-brands-from-column.ts
 */
import 'dotenv/config';

import prisma from '../lib/prisma';
import { syncLocationStandardBrands } from '../utils/location-brands';

async function main() {
  const rows = await prisma.location.findMany({
    where: { brands: { not: null } },
    select: { id: true, brands: true, handle: true },
  });

  let n = 0;
  for (const r of rows) {
    if (!r.brands?.trim()) continue;
    await syncLocationStandardBrands(prisma, r.id, r.brands);
    // Raw SQL so a partial Prisma schema ↔ DB mismatch on other columns cannot block this script.
    await prisma.$executeRaw`UPDATE "Location" SET "brands" = NULL WHERE id = ${r.id}`;
    n++;
  }

  console.log(`Backfilled ${n} locations (had non-empty brands column).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
