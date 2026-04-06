import { describe, it, expect } from 'vitest';
import {
  dedupeAddressFingerprint,
  expandTrailingStreetAbbrevForDedupe,
  safeAddressFingerprintContainment,
} from '../../utils/address-dedupe';
import { addressFingerprintLine1 } from '../../utils/stable-handle';

describe('expandTrailingStreetAbbrevForDedupe / dedupeAddressFingerprint', () => {
  it('normalizes St vs Street for the same line', () => {
    expect(expandTrailingStreetAbbrevForDedupe('513 Whitaker St')).toBe('513 whitaker street');
    expect(dedupeAddressFingerprint('513 WHITAKER STREET')).toBe('513whitakerstreet');
    expect(dedupeAddressFingerprint('513 Whitaker St')).toBe('513whitakerstreet');
  });
});

describe('safeAddressFingerprintContainment', () => {
  it('allows mall / unit extensions', () => {
    const a = addressFingerprintLine1('Marina Mall');
    const b = addressFingerprintLine1('MARINA MALL 18 ST');
    expect(safeAddressFingerprintContainment(a, b)).toBe(true);
  });

  it('rejects different street numbers that share a digit prefix', () => {
    const a = addressFingerprintLine1('Calle Serrano 2');
    const b = addressFingerprintLine1('CALLE SERRANO 26');
    expect(safeAddressFingerprintContainment(a, b)).toBe(false);
  });
});
