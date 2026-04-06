import { describe, it, expect } from 'vitest';
import { addressFingerprintLine1 } from '../../utils/stable-handle';

/**
 * Fingerprints align with store dedupe SQL (ASCII [^a-z0-9] strip).
 * See address-dedupe.test.ts for containment safety rules.
 */
describe('addressFingerprintLine1 (dedupe)', () => {
  it('strips punctuation and case like analyze-duplicates SQL', () => {
    expect(addressFingerprintLine1('3111 W. Chandler Blvd')).toBe('3111wchandlerblvd');
    expect(addressFingerprintLine1('The Dubai Mall')).toBe('thedubaimall');
  });

  it('models mall / suite variants that substring dedupe should merge', () => {
    const a = addressFingerprintLine1('Marina Mall');
    const b = addressFingerprintLine1('MARINA MALL 18 ST');
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(b.includes(a)).toBe(true);
  });
});
