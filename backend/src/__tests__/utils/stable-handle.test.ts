import { describe, it, expect } from 'vitest';
import { computeStableHandleFromRow, normalizeScraperRowForCsv } from '../../utils/stable-handle';

describe('stable-handle', () => {
  const base = {
    Name: 'Test Store',
    Phone: '555-0100',
    'Address Line 1': '123 Main St',
    'Address Line 2': '',
    City: 'Paris',
    Country: 'France',
    Latitude: '48.85660',
    Longitude: '2.35220',
    Handle: 'upstream-999',
  };

  it('computeStableHandleFromRow is deterministic', () => {
    const a = computeStableHandleFromRow(base);
    const b = computeStableHandleFromRow({ ...base, Handle: 'other-id' });
    expect(a).toBe(b);
    expect(a.startsWith('loc_')).toBe(true);
  });

  it('different coordinates yield different handles', () => {
    const a = computeStableHandleFromRow(base);
    const b = computeStableHandleFromRow({
      ...base,
      Latitude: '48.85661',
      Longitude: '2.35220',
    });
    expect(a).not.toBe(b);
  });

  it('normalizeScraperRowForCsv leaves incomplete rows unchanged', () => {
    const incomplete = { ...base, Phone: '' };
    expect(normalizeScraperRowForCsv(incomplete).Handle).toBe('upstream-999');
  });

  it('normalizeScraperRowForCsv replaces handle when complete', () => {
    const out = normalizeScraperRowForCsv(base);
    expect(out.Handle).toMatch(/^loc_[a-f0-9]{24}$/);
  });
});
