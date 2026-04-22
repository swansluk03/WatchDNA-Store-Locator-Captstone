import { describe, it, expect } from 'vitest';
import {
  brandConfigIdToDisplayName,
  normalizeBrandsCsvField,
  normalizeTagsCsvField,
} from '../../utils/brand-display-name';

describe('brandConfigIdToDisplayName', () => {
  it('strips _stores and uppercases', () => {
    expect(brandConfigIdToDisplayName('accutron_stores')).toBe('ACCUTRON');
    expect(brandConfigIdToDisplayName('breva_stores')).toBe('BREVA');
  });

  it('maps known multi-word brands', () => {
    expect(brandConfigIdToDisplayName('bell_ross_stores')).toBe('BELL & ROSS');
  });

  it('leaves already-clean tokens uppercased', () => {
    expect(brandConfigIdToDisplayName('OMEGA')).toBe('OMEGA');
  });

  it('strips simple HTML in a single token (scraper/CSV error)', () => {
    expect(
      brandConfigIdToDisplayName(
        '<A HREF="HTTPS://WATCHDNA.COM/BLOGS/HISTORY/HAMILTON">HAMILTON'
      )
    ).toBe('HAMILTON');
  });

  it('drops address-like lines mistaken for a brand', () => {
    expect(brandConfigIdToDisplayName('88 RUE DU RHONE')).toBe('');
  });
});

describe('normalizeBrandsCsvField', () => {
  it('dedupes case-insensitively', () => {
    expect(normalizeBrandsCsvField('omega, OMEGA, omega_stores')).toBe('OMEGA');
  });
});

describe('normalizeTagsCsvField', () => {
  it('rewrites only *_stores-like tokens', () => {
    expect(normalizeTagsCsvField('accutron_stores, boutique')).toBe('ACCUTRON, boutique');
  });
});
