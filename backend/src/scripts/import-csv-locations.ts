/**
 * Validate then import a store CSV using the same pipeline as admin CSV upload:
 * Python validate_csv (--fix, --db-import-parity), then locationService.importFromCSV
 * (batch upsert, dedupe, merge with existing stores — same as scraper output).
 *
 * Usage (from backend/):
 *   npm run import-csv-locations
 *   npm run import-csv-locations -- ../locations2.csv
 *   npm run import-csv-locations -- /absolute/path/to/file.csv
 */

import path from 'path';
import fs from 'fs/promises';
import uploadService from '../services/upload.service';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';

function defaultCsvPath(): string {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  return path.join(repoRoot, 'locations2.csv');
}

function resolveCsvPath(arg: string | undefined): string {
  if (!arg) return defaultCsvPath();
  return path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
}

async function main() {
  const csvPath = resolveCsvPath(process.argv[2]);

  try {
    await fs.access(csvPath);
  } catch {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  const stat = await fs.stat(csvPath);
  const base = path.basename(csvPath);

  const upload = await uploadService.createUpload({
    filename: base,
    originalFilename: base,
    fileSize: stat.size,
    uploadedBy: 'import-csv-locations',
    scraperType: 'manual_upload',
  });

  logger.warn(`[import-csv-locations] ${csvPath} → upload ${upload.id}`);

  const processResult = await uploadService.processUpload(upload.id, csvPath);
  const { validationResult, importResult, importError, success: processSuccess } = processResult;

  console.log(
    JSON.stringify(
      {
        uploadId: upload.id,
        valid: validationResult.valid,
        rowsChecked: validationResult.rows_checked,
        errors: validationResult.errors,
        warningsCount: validationResult.warnings.length,
        importSuccess: processSuccess,
        importError: importError ?? undefined,
        import: importResult
          ? {
              newCount: importResult.newCount,
              updatedCount: importResult.updatedCount,
              unchangedCount: importResult.unchangedCount,
              skippedCount: importResult.skippedCount,
              errorCount: importResult.errorCount,
            }
          : null,
      },
      null,
      2
    )
  );

  if (!validationResult.valid) {
    console.error('Validation failed; database not updated.');
    process.exit(1);
  }

  if (!processSuccess) {
    console.error(
      `Import failed after validation; database may be incomplete. ${importError ?? 'No import result returned.'}`
    );
    process.exit(1);
  }

  const final = await prisma.upload.findUnique({ where: { id: upload.id } });
  console.log('Upload status:', final?.status, 'rowsProcessed:', final?.rowsProcessed, 'rowsFailed:', final?.rowsFailed);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
