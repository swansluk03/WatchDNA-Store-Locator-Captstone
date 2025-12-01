import { spawn } from 'child_process';
import path from 'path';

export interface ValidationError {
  row: number;
  field: string;
  issue: string;
  value?: string;
}

export interface ValidationWarning {
  type: string;
  message: string;
  [key: string]: any;
}

export interface ValidationResult {
  valid: boolean;
  file: string;
  rows_checked: number;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  status: string;
  exit_code: number;
}

export class ValidationService {
  private pythonPath: string;
  private validatorScriptPath: string;

  constructor() {
    this.pythonPath = process.env.PYTHON_PATH || 'python3';
    // Path to validate_csv.py in tools folder
    this.validatorScriptPath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'tools',
      'validate_csv.py'
    );
  }

  async validateCSV(
    filePath: string, 
    options?: {
      autoFix?: boolean;
      checkUrls?: boolean;
    }
  ): Promise<ValidationResult> {
    return new Promise((resolve, reject) => {
      const args = [
        this.validatorScriptPath,
        filePath,
        '--json' // Get JSON output
      ];

      // Add optional flags
      if (options?.autoFix) {
        args.push('--fix');
      }
      if (options?.checkUrls) {
        args.push('--check-urls');
      }

      console.log(`Running validation: ${this.pythonPath} ${args.join(' ')}`);

      const childProcess = spawn(this.pythonPath, args);

      let stdoutData = '';
      let stderrData = '';

      childProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      childProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      childProcess.on('close', (code) => {
        console.log(`Validation process exited with code ${code}`);

        if (stderrData && process.env.NODE_ENV === 'development') {
          console.log('Validation stderr:', stderrData);
        }

        try {
          // Try to find JSON in the output
          const jsonMatch = stdoutData.match(/\{[\s\S]*\}/);

          if (!jsonMatch) {
            // If no JSON found, check exit code
            if (code === 0) {
              // Validation passed but no JSON (shouldn't happen with --json flag)
              resolve({
                valid: true,
                file: filePath,
                rows_checked: 0,
                errors: [],
                warnings: [],
                status: 'passed',
                exit_code: code || 0
              });
            } else {
              reject(new Error(`Validation failed with exit code ${code}. Output: ${stdoutData}`));
            }
            return;
          }

          const result = JSON.parse(jsonMatch[0]);

          resolve({
            valid: code === 0,
            file: result.file || filePath,
            rows_checked: result.rows_checked || 0,
            errors: result.errors || [],
            warnings: result.warnings || [],
            status: result.status || (code === 0 ? 'passed' : 'failed'),
            exit_code: code || 0
          });

        } catch (err) {
          console.error('Failed to parse validation output:', err);
          console.error('Stdout:', stdoutData);
          reject(new Error(`Failed to parse validation output: ${err}`));
        }
      });

      childProcess.on('error', (err) => {
        console.error('Failed to start validation process:', err);
        reject(new Error(`Failed to start validation: ${err.message}`));
      });
    });
  }

  /**
   * Convert validation result to database-friendly format
   */
  formatForDatabase(result: ValidationResult) {
    return {
      validationErrors: JSON.stringify(result.errors),
      validationWarnings: JSON.stringify(result.warnings),
      rowsTotal: result.rows_checked,
      status: result.valid ? 'valid' : 'invalid'
    };
  }

  /**
   * Convert validation result to validation log entries
   */
  createValidationLogs(uploadId: string, result: ValidationResult) {
    const logs: any[] = [];

    // Add errors
    result.errors.forEach(error => {
      logs.push({
        uploadId,
        rowNumber: error.row,
        logType: 'error',
        fieldName: error.field,
        issueType: error.issue,
        message: `${error.field}: ${error.issue}`,
        value: error.value || null
      });
    });

    // Add warnings
    result.warnings.forEach(warning => {
      logs.push({
        uploadId,
        rowNumber: null, // Warnings might not have specific row numbers
        logType: 'warning',
        fieldName: null,
        issueType: warning.type,
        message: warning.message,
        value: JSON.stringify(warning)
      });
    });

    return logs;
  }
}

export default new ValidationService();
