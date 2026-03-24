import { describe, it, expect } from 'vitest';
import {
  VALIDATION_JOB_RECORDS_SAVE,
  VALIDATION_MANUAL_UPLOAD,
  VALIDATION_REVALIDATE_DEFAULT,
  VALIDATION_SCRAPER_JOB_COMPLETION,
} from '../../config/validation-policy';

describe('validation-policy', () => {
  it('uses auto-fix for all bulk CSV pipelines', () => {
    expect(VALIDATION_MANUAL_UPLOAD.autoFix).toBe(true);
    expect(VALIDATION_SCRAPER_JOB_COMPLETION.autoFix).toBe(true);
    expect(VALIDATION_JOB_RECORDS_SAVE.autoFix).toBe(true);
    expect(VALIDATION_REVALIDATE_DEFAULT.autoFix).toBe(true);
  });
});
