/**
 * Backfill or re-run Nominatim coordinate verification for Location rows.
 *
 * Geocoder (Photon vs Nominatim), URLs, User-Agent, rate limit, and drift are set in src/config/geo-verify.ts.
 *
 * Usage:
 *   npm run verify-store-coordinates
 *   ... --dry-run          # log actions, no DB writes
 *   ... --force            # re-verify even if already verified for same address key
 *   ... --limit 50         # max locations to process
 */

import 'dotenv/config';
import prisma from '../lib/prisma';
import { readGeoVerifyConfig } from '../config/geo-verify';
import { verifyHandles } from '../services/coordinate-verification.service';

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  let limit = Number.POSITIVE_INFINITY;
  const i = argv.indexOf('--limit');
  if (i >= 0 && argv[i + 1]) {
    const n = parseInt(argv[i + 1], 10);
    if (Number.isFinite(n) && n > 0) limit = n;
  }
  return { dryRun, force, limit };
}

async function main() {
  const { dryRun, force, limit } = parseArgs(process.argv.slice(2));
  const config = readGeoVerifyConfig();

  if (!config.nominatimUserAgent) {
    console.error('Set NOMINATIM_USER_AGENT in src/config/geo-verify.ts (required by Nominatim).');
    process.exit(1);
  }

  let processed = 0;
  const totals = {
    checked: 0,
    skippedAlreadyVerified: 0,
    coordinatesUpdated: 0,
    verifiedStampOnly: 0,
    geocodeFailed: 0,
    errors: 0,
  };

  if (force) {
    let cursor: string | undefined;
    while (processed < limit) {
      const take = Math.min(100, limit - processed);
      const batch = await prisma.location.findMany({
        take,
        orderBy: { id: 'asc' },
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: { id: true, handle: true },
      });
      if (batch.length === 0) break;

      const summary = await verifyHandles(
        batch.map((b) => b.handle),
        { dryRun, forceReverify: true }
      );
      for (const k of Object.keys(totals) as (keyof typeof totals)[]) {
        totals[k] += summary[k];
      }
      console.log(
        `batch ${batch[0].id.slice(0, 8)}…${batch.length} handles → ${JSON.stringify(summary)}`
      );

      processed += batch.length;
      cursor = batch[batch.length - 1]!.id;
    }
  } else {
    while (processed < limit) {
      const take = Math.min(100, limit - processed);
      const batch = await prisma.location.findMany({
        where: { coordinatesVerifiedAt: null },
        orderBy: { id: 'asc' },
        take,
        select: { handle: true },
      });
      if (batch.length === 0) break;

      const summary = await verifyHandles(batch.map((b) => b.handle), { dryRun });
      for (const k of Object.keys(totals) as (keyof typeof totals)[]) {
        totals[k] += summary[k];
      }
      console.log(`batch ${batch.length} unverified handles → ${JSON.stringify(summary)}`);

      processed += batch.length;
    }
  }

  console.log('\nDone. Totals:', JSON.stringify(totals, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
