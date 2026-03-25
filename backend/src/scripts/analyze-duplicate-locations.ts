/**
 * Report likely duplicate Location rows (same name, same coords, same address key).
 *
 * Usage: npx ts-node src/scripts/analyze-duplicate-locations.ts
 */

import 'dotenv/config';
import prisma from '../lib/prisma';

async function main() {
  console.log('=== Duplicate / near-duplicate analysis (Location) ===\n');

  const total = await prisma.location.count();
  console.log(`Total locations: ${total}\n`);

  const dupNameExact = await prisma.$queryRaw<
    { name: string; cnt: bigint; handles: string[] }[]
  >`
    SELECT "name", COUNT(*)::bigint AS cnt, array_agg("handle" ORDER BY "handle") AS handles
    FROM "Location"
    GROUP BY "name"
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 40
  `;
  console.log(`--- Same exact Name (case-sensitive), count > 1: ${dupNameExact.length} groups ---`);
  for (const row of dupNameExact.slice(0, 15)) {
    console.log(`  ${Number(row.cnt)}× "${row.name}" → ${row.handles.slice(0, 5).join(', ')}${row.handles.length > 5 ? '…' : ''}`);
  }
  if (dupNameExact.length > 15) console.log(`  … and ${dupNameExact.length - 15} more groups\n`);
  else console.log('');

  const dupNameNorm = await prisma.$queryRaw<
    { norm_name: string; cnt: bigint; handles: string[] }[]
  >`
    SELECT LOWER(TRIM("name")) AS norm_name, COUNT(*)::bigint AS cnt,
           array_agg("handle" ORDER BY "handle") AS handles
    FROM "Location"
    GROUP BY LOWER(TRIM("name"))
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 40
  `;
  console.log(`--- Same Name (case-insensitive trim), count > 1: ${dupNameNorm.length} groups ---`);
  for (const row of dupNameNorm.slice(0, 15)) {
    console.log(`  ${Number(row.cnt)}× "${row.norm_name}" → ${row.handles.slice(0, 4).join(', ')}${row.handles.length > 4 ? '…' : ''}`);
  }
  console.log('');

  const dupCoords = await prisma.$queryRaw<
    { lat: string; lng: string; cnt: bigint; handles: string[] }[]
  >`
    SELECT ROUND("latitude"::numeric, 5)::text AS lat,
           ROUND("longitude"::numeric, 5)::text AS lng,
           COUNT(*)::bigint AS cnt,
           array_agg("handle" ORDER BY "handle") AS handles
    FROM "Location"
    GROUP BY ROUND("latitude"::numeric, 5), ROUND("longitude"::numeric, 5)
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 40
  `;
  console.log(`--- Same coordinates (5 dp), count > 1: ${dupCoords.length} groups ---`);
  for (const row of dupCoords.slice(0, 15)) {
    console.log(`  ${Number(row.cnt)}× (${row.lat}, ${row.lng}) → ${row.handles.slice(0, 4).join(', ')}${row.handles.length > 4 ? '…' : ''}`);
  }
  console.log('');

  const dupAddrKey = await prisma.$queryRaw<
    { addr_key: string; cnt: bigint; handles: string[] }[]
  >`
    SELECT
      LOWER(TRIM(COALESCE("addressLine1", ''))) || '|' ||
      LOWER(TRIM(COALESCE("city", ''))) || '|' ||
      LOWER(TRIM(COALESCE("country", ''))) AS addr_key,
      COUNT(*)::bigint AS cnt,
      array_agg("handle" ORDER BY "handle") AS handles
    FROM "Location"
    WHERE LENGTH(TRIM(COALESCE("addressLine1", ''))) > 3
    GROUP BY 1
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 40
  `;
  console.log(`--- Same addressLine1 + city + country (normalized), count > 1: ${dupAddrKey.length} groups ---`);
  for (const row of dupAddrKey.slice(0, 12)) {
    console.log(`  ${Number(row.cnt)}× ${row.addr_key.slice(0, 80)}${row.addr_key.length > 80 ? '…' : ''}`);
    console.log(`      handles: ${row.handles.slice(0, 4).join(', ')}${row.handles.length > 4 ? '…' : ''}`);
  }
  console.log('');

  const nearDup = await prisma.$queryRaw<
    { name_a: string; handle_a: string; name_b: string; handle_b: string; dist_m: number }[]
  >`
    WITH pairs AS (
      SELECT
        a."name" AS name_a, a."handle" AS handle_a,
        b."name" AS name_b, b."handle" AS handle_b,
        (
          6371000 * acos(
            LEAST(1.0, GREATEST(-1.0,
              cos(radians(a."latitude")) * cos(radians(b."latitude"))
              * cos(radians(b."longitude") - radians(a."longitude"))
              + sin(radians(a."latitude")) * sin(radians(b."latitude"))
            ))
          )
        )::float AS dist_m
      FROM "Location" a
      JOIN "Location" b ON a."handle" < b."handle"
      WHERE LOWER(TRIM(a."name")) = LOWER(TRIM(b."name"))
        AND a."country" = b."country"
    )
    SELECT name_a, handle_a, name_b, handle_b, dist_m
    FROM pairs
    WHERE dist_m > 5 AND dist_m < 500
    ORDER BY dist_m ASC
    LIMIT 25
  `;
  console.log(`--- Same normalized name + country, different handles, 5m < distance < 500m (sample) ---`);
  console.log(`    (${nearDup.length} pairs — possible duplicate handles with coordinate drift)\n`);
  for (const p of nearDup.slice(0, 15)) {
    console.log(`  ~${Math.round(p.dist_m)}m  ${p.handle_a} vs ${p.handle_b}`);
    console.log(`         "${p.name_a}"`);
  }

  console.log('\nDone.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
