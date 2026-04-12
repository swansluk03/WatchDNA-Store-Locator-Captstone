import type { Prisma } from '@prisma/client';

import { brandConfigIdToDisplayName } from './brand-display-name';
import { locationCountryEqualsWhere } from './location-country-filter';

export type MasterExportFilters = {
  brand?: string;
  country?: string;
  /** When true, only rows with `Location.isPremium`. */
  premiumOnly?: boolean;
};

/** Brand filter using only `Location.brands` / `customBrands` (no LocationBrand join — matches reverted schema). */
function legacyBrandTextFilterWhere(brandFilter: string): Prisma.LocationWhereInput {
  const raw = brandFilter.trim();
  const display = brandConfigIdToDisplayName(raw);
  const or: Prisma.LocationWhereInput[] = [
    { brands: { contains: display, mode: 'insensitive' } },
    { customBrands: { contains: display, mode: 'insensitive' } },
  ];
  if (raw.toLowerCase() !== display.toLowerCase()) {
    or.push(
      { brands: { contains: raw, mode: 'insensitive' } },
      { customBrands: { contains: raw, mode: 'insensitive' } }
    );
  }
  return { OR: or };
}

export function buildMasterExportWhere(filters?: MasterExportFilters): Prisma.LocationWhereInput {
  const clauses: Prisma.LocationWhereInput[] = [];
  const brand = filters?.brand?.trim();
  if (brand) clauses.push(legacyBrandTextFilterWhere(brand));
  const countryClause = locationCountryEqualsWhere(filters?.country);
  if (countryClause) clauses.push(countryClause);
  if (filters?.premiumOnly) clauses.push({ isPremium: true });
  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0]!;
  return { AND: clauses };
}
