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

  it('aligns North Milwaukee vs Milwaukee and FR av. vs Avenue with accents', () => {
    expect(
      dedupeAddressFingerprint('1200 North Milwaukee Avenue, Glenview')
    ).toBe(dedupeAddressFingerprint('1200 Milwaukee Avenue, Glenview'));
    expect(dedupeAddressFingerprint('26 Avenue Jean-Jaurès')).toBe(
      dedupeAddressFingerprint('26 av Jean JAURES')
    );
  });

  it('keeps West in West River St and strips suites/units so same street number merges', () => {
    expect(dedupeAddressFingerprint('300 WEST RIVER ST, BLDG C, UNIT 4')).toBe(
      dedupeAddressFingerprint('300, Suite 101 West River Street')
    );
  });

  it('strips floor markers and collapses hyphenated lot numbers', () => {
    expect(dedupeAddressFingerprint('1-1-43 ABENOSUJI')).toBe(dedupeAddressFingerprint('1-1-43 11F ABENOSUJI'));
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
