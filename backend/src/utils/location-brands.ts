/**
 * Normalized Brand ↔ Location storage: one row per distinct brand label, many-to-many via LocationBrand.
 * Legacy `Location.brands` (CSV) is cleared on write after links are synced.
 */

import { Prisma } from '@prisma/client';

import { brandConfigIdToDisplayName, normalizeBrandsCsvField } from './brand-display-name';

type BrandLinkClient = Pick<Prisma.TransactionClient, 'brand' | 'locationBrand'>;

export function brandSlugFromDisplayName(display: string): string {
  return display.trim().toLowerCase();
}

export type LocationBrandsSource = {
  brands?: string | null;
  locationBrands?: Array<{ brand: { displayName: string } }>;
};

/**
 * CSV for merge/export: prefer normalized links, else legacy `brands` column (pre-backfill).
 */
export function effectiveBrandsCsvFromLocation(loc: LocationBrandsSource): string | null {
  if (loc.locationBrands && loc.locationBrands.length > 0) {
    const names = [...new Set(loc.locationBrands.map((lb) => lb.brand.displayName))].sort((a, b) =>
      a.localeCompare(b)
    );
    return names.join(', ') || null;
  }
  return loc.brands ?? null;
}

function displayNamesFromNormalizedField(csv: string | null | undefined): string[] {
  const norm = normalizeBrandsCsvField(csv);
  if (!norm) return [];
  return norm.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Replace all standard-brand links for a location from a normalized Brands CSV value. */
export async function syncLocationStandardBrands(
  db: BrandLinkClient,
  locationId: string,
  brandsCsv: string | null
): Promise<void> {
  const displays = displayNamesFromNormalizedField(brandsCsv);
  await db.locationBrand.deleteMany({ where: { locationId } });
  if (displays.length === 0) return;

  const brandIds: string[] = [];
  for (const displayName of displays) {
    const slug = brandSlugFromDisplayName(displayName);
    const row = await db.brand.upsert({
      where: { slug },
      create: { slug, displayName },
      update: {},
    });
    brandIds.push(row.id);
  }

  await db.locationBrand.createMany({
    data: brandIds.map((brandId) => ({ locationId, brandId })),
  });
}

/** Prisma where-clause: match legacy columns or normalized Brand links (and customBrands). */
export function buildLocationBrandFilterWhere(brandFilter: string): Prisma.LocationWhereInput {
  const raw = brandFilter.trim();
  const display = brandConfigIdToDisplayName(raw);
  const slugFromDisplay = brandSlugFromDisplayName(display);

  const or: Prisma.LocationWhereInput[] = [
    { brands: { contains: display, mode: 'insensitive' } },
    { customBrands: { contains: display, mode: 'insensitive' } },
    {
      locationBrands: {
        some: {
          brand: {
            OR: [{ displayName: { contains: display, mode: 'insensitive' } }, { slug: slugFromDisplay }],
          },
        },
      },
    },
  ];

  if (raw.toLowerCase() !== display.toLowerCase()) {
    or.push(
      { brands: { contains: raw, mode: 'insensitive' } },
      { customBrands: { contains: raw, mode: 'insensitive' } },
      {
        locationBrands: {
          some: {
            brand: {
              OR: [
                { displayName: { contains: raw, mode: 'insensitive' } },
                { slug: { contains: raw.toLowerCase(), mode: 'insensitive' } },
              ],
            },
          },
        },
      }
    );
  }

  return { OR: or };
}

/**
 * For raw SQL on `"Location" l`: brands column = linked display names or legacy `brands`.
 * Embed in $queryRaw`...` as ${EFFECTIVE_BRANDS_SELECT_RAW}.
 */
export const EFFECTIVE_BRANDS_SELECT_RAW = Prisma.raw(`
  COALESCE(
    (SELECT string_agg(b."displayName", ', ' ORDER BY b."displayName")
     FROM "LocationBrand" lb
     JOIN "Brand" b ON b.id = lb."brandId"
     WHERE lb."locationId" = l.id),
    l."brands"
  ) AS "brands"
`);
