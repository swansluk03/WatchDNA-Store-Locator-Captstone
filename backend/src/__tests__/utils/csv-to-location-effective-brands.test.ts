import { describe, it, expect } from 'vitest';

import { locationToCSVRowWithEffectiveBrands } from '../../utils/csv-to-location';

describe('locationToCSVRowWithEffectiveBrands', () => {
  it('prefers linked Brand display names over legacy brands column', () => {
    const row = locationToCSVRowWithEffectiveBrands({
      handle: 'h1',
      name: 'Store',
      status: true,
      brands: 'LEGACY',
      locationBrands: [{ brand: { displayName: 'OMEGA' } }, { brand: { displayName: 'RADO' } }],
    } as Record<string, unknown>);

    expect(row.Brands).toBe('OMEGA, RADO');
    expect(row.Handle).toBe('h1');
  });

  it('falls back to legacy brands when there are no links', () => {
    const row = locationToCSVRowWithEffectiveBrands({
      handle: 'h2',
      name: 'Other',
      status: true,
      brands: 'TAG HEUER',
      locationBrands: [],
    } as Record<string, unknown>);

    expect(row.Brands).toBe('TAG HEUER');
  });
});
