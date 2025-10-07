#!/usr/bin/env python3
"""
CSV Validator for WatchDNA Store Locator
Validates CSV files for header correctness and row-level data quality.
"""

import csv
import sys
import math
import json
import argparse
import os
from pathlib import Path
from typing import List, Dict, Tuple, Set, Any, Optional
from collections import defaultdict

# Handle Windows console encoding
if sys.platform == 'win32':
    # Try to set UTF-8 encoding for Windows console
    try:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass


# All known headers from locations.csv schema
ALL_HEADERS = [
    "Handle", "Name", "Status", "Address Line 1", "Address Line 2",
    "Postal/ZIP Code", "City", "State/Province/Region", "Country",
    "Phone", "Email", "Website", "Image URL",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    "Page Title", "Page Description", "Meta Title", "Meta Description",
    "Latitude", "Longitude", "Priority",
    "Name - FR", "Page Title - FR", "Page Description - FR",
    "Name - ZH-CN", "Page Title - ZH-CN", "Page Description - ZH-CN",
    "Name - ES", "Page Title - ES", "Page Description - ES",
    " Tags",  # Note: has leading space in actual CSV
    "Custom Brands", "Custom Brands - FR", "Custom Brands - ZH-CN", "Custom Brands - ES",
    "Custom Button title 1", "Custom Button title 1 - FR", "Custom Button title 1 - ZH-CN", "Custom Button title 1 - ES",
    "Custom Button URL 1", "Custom Button URL 1 - FR", "Custom Button URL 1 - ZH-CN", "Custom Button URL 1 - ES",
    "Custom Button title 2", "Custom Button title 2 - FR", "Custom Button title 2 - ZH-CN", "Custom Button title 2 - ES",
    "Custom Button URL 2", "Custom Button URL 2 - FR", "Custom Button URL 2 - ZH-CN", "Custom Button URL 2 - ES"
]

# Default required headers
DEFAULT_REQUIRED = ["Name", "Latitude", "Longitude", "City", "Country"]

# Default duplicate key fields
DEFAULT_DUPLICATE_KEY = ["Name", "Address Line 1", "City"]

# Exit codes
EXIT_OK = 0
EXIT_USAGE = 1
EXIT_SCHEMA = 2
EXIT_DATA = 3
EXIT_EXCEPTION = 4

# Warnings
MAX_ROWS_WARNING = 10000
COORDINATE_PRECISION_WARNING = 7


class ValidationError:
    """Represents a validation error"""
    def __init__(self, row: int, field: str, issue: str, value: Any = None):
        self.row = row
        self.field = field
        self.issue = issue
        self.value = value

    def to_dict(self) -> Dict[str, Any]:
        d = {"row": self.row, "field": self.field, "issue": self.issue}
        if self.value is not None:
            d["value"] = str(self.value)
        return d

    def __str__(self) -> str:
        if self.value is not None:
            return f"Row {self.row}: {self.field}: {self.issue} (value: {self.value})"
        return f"Row {self.row}: {self.field}: {self.issue}"


class ValidationWarning:
    """Represents a validation warning"""
    def __init__(self, warning_type: str, message: str, details: Optional[Dict[str, Any]] = None):
        self.warning_type = warning_type
        self.message = message
        self.details = details or {}

    def to_dict(self) -> Dict[str, Any]:
        d = {"type": self.warning_type, "message": self.message}
        d.update(self.details)
        return d

    def __str__(self) -> str:
        return self.message


class CSVValidator:
    """Main CSV validator class"""

    def __init__(self,
                 required_headers: List[str],
                 warn_duplicates: bool = True,
                 fail_duplicates: bool = False,
                 show_bad: bool = False,
                 limit: Optional[int] = None,
                 max_rows: Optional[int] = MAX_ROWS_WARNING):
        self.required_headers = required_headers
        self.warn_duplicates = warn_duplicates
        self.fail_duplicates = fail_duplicates
        self.show_bad = show_bad
        self.limit = limit
        self.max_rows = max_rows

        self.errors: List[ValidationError] = []
        self.warnings: List[ValidationWarning] = []
        self.rows_checked = 0
        self.file_path = ""

    def validate_headers(self, fieldnames: List[str]) -> bool:
        """Validate CSV headers. Returns True if valid, False otherwise."""
        # Check for duplicate headers
        seen = set()
        duplicates = []
        for header in fieldnames:
            if header in seen:
                duplicates.append(header)
            seen.add(header)

        if duplicates:
            print(f"❌ Duplicate headers found: {', '.join(duplicates)}")
            return False

        # Check for missing required headers
        missing = [h for h in self.required_headers if h not in fieldnames]
        if missing:
            print(f"❌ Missing required headers: {', '.join(missing)}")
            return False

        # Note any unknown headers (not in ALL_HEADERS)
        unknown = [h for h in fieldnames if h not in ALL_HEADERS]
        if unknown:
            self.warnings.append(ValidationWarning(
                "unknown_headers",
                f"Unknown headers (not in schema): {', '.join(unknown)}",
                {"headers": unknown}
            ))

        return True

    def validate_coordinate(self, value: str, is_latitude: bool) -> Tuple[bool, Optional[float], Optional[str]]:
        """
        Validate a coordinate value.
        Returns: (is_valid, parsed_value, error_message)
        """
        if not value or value.strip() == "":
            return False, None, "empty"

        try:
            coord = float(value)

            # Check for NaN or infinity
            if math.isnan(coord) or math.isinf(coord):
                return False, None, "invalid_number"

            # Range check
            if is_latitude:
                if not (-90 <= coord <= 90):
                    return False, coord, "out_of_range"
            else:  # longitude
                if not (-180 <= coord <= 180):
                    return False, coord, "out_of_range"

            return True, coord, None

        except (ValueError, TypeError):
            return False, None, "not_a_number"

    def check_coordinate_precision(self, value: float, field: str, row_num: int):
        """Warn if coordinate has too many decimal places"""
        str_value = str(value)
        if '.' in str_value:
            decimals = len(str_value.split('.')[1])
            if decimals > COORDINATE_PRECISION_WARNING:
                self.warnings.append(ValidationWarning(
                    "precision",
                    f"Row {row_num}: {field} has {decimals} decimal places (>{COORDINATE_PRECISION_WARNING})",
                    {"row": row_num, "field": field, "decimals": decimals}
                ))

    def validate_row(self, row: Dict[str, str], row_num: int) -> bool:
        """
        Validate a single data row.
        Returns True if valid, False if errors found.
        """
        has_errors = False

        # Validate required fields are non-empty
        for field in self.required_headers:
            value = row.get(field, "").strip()
            if not value:
                self.errors.append(ValidationError(row_num, field, "empty"))
                has_errors = True

        # Validate Latitude
        lat_valid, lat_value, lat_error = self.validate_coordinate(
            row.get("Latitude", ""), is_latitude=True
        )
        if not lat_valid:
            self.errors.append(ValidationError(
                row_num, "Latitude", lat_error, row.get("Latitude", "")
            ))
            has_errors = True
        elif lat_value is not None:
            self.check_coordinate_precision(lat_value, "Latitude", row_num)

        # Validate Longitude
        lon_valid, lon_value, lon_error = self.validate_coordinate(
            row.get("Longitude", ""), is_latitude=False
        )
        if not lon_valid:
            self.errors.append(ValidationError(
                row_num, "Longitude", lon_error, row.get("Longitude", "")
            ))
            has_errors = True
        elif lon_value is not None:
            self.check_coordinate_precision(lon_value, "Longitude", row_num)

        # If show_bad is enabled and there are errors, print the full row
        if has_errors and self.show_bad:
            print(f"\nFull row {row_num} content:")
            for key, value in row.items():
                print(f"  {key}: {value}")

        return not has_errors

    def detect_duplicates(self, rows: List[Dict[str, str]]) -> List[Tuple[Tuple[str, ...], List[int]]]:
        """
        Detect duplicate rows based on key fields.
        Returns list of (key_tuple, [row_numbers])
        """
        key_fields = DEFAULT_DUPLICATE_KEY
        duplicates_map: Dict[Tuple[str, ...], List[int]] = defaultdict(list)

        for idx, row in enumerate(rows, start=2):  # Start at 2 (after header)
            # Build key tuple from key fields
            key = tuple(row.get(field, "").strip() for field in key_fields)

            # Only track if all key fields are non-empty
            if all(k for k in key):
                duplicates_map[key].append(idx)

        # Return only keys that have duplicates
        return [(key, rows) for key, rows in duplicates_map.items() if len(rows) > 1]

    def validate_file(self, file_path: str) -> int:
        """
        Validate a CSV file.
        Returns exit code.
        """
        self.file_path = file_path

        # Check if file exists
        if not Path(file_path).exists():
            print(f"❌ File not found: {file_path}")
            return EXIT_USAGE

        try:
            with open(file_path, 'r', newline='', encoding='utf-8') as f:
                reader = csv.DictReader(f)

                # Validate headers
                print("=" * 60)
                print("CSV VALIDATION")
                print("=" * 60)
                print(f"File: {file_path}")
                print()

                if reader.fieldnames is None:
                    print("❌ Empty file or no headers found")
                    return EXIT_SCHEMA

                print(f"Headers found: {len(reader.fieldnames)}")
                if not self.validate_headers(reader.fieldnames):
                    return EXIT_SCHEMA

                print("✅ Header validation passed")
                print()

                # Read all rows into memory (needed for duplicate detection)
                all_rows = list(reader)
                total_rows = len(all_rows)

                # Check for empty file
                if total_rows == 0:
                    self.warnings.append(ValidationWarning(
                        "empty_file",
                        "No data rows found in file"
                    ))

                # Check for suspiciously large files
                if self.max_rows and total_rows > self.max_rows:
                    self.warnings.append(ValidationWarning(
                        "large_file",
                        f"File has {total_rows} rows (>{self.max_rows})",
                        {"rows": total_rows, "threshold": self.max_rows}
                    ))

                # Validate rows
                rows_to_check = all_rows[:self.limit] if self.limit else all_rows
                self.rows_checked = len(rows_to_check)

                print(f"Validating {self.rows_checked} rows...")
                print()

                for idx, row in enumerate(rows_to_check, start=2):
                    self.validate_row(row, idx)

                # Detect duplicates
                if self.warn_duplicates or self.fail_duplicates:
                    duplicates = self.detect_duplicates(all_rows)
                    for key, row_nums in duplicates:
                        key_str = ", ".join(f"{k}" for k in key)
                        message = f"Duplicate found: ({key_str}) in rows {row_nums}"

                        if self.fail_duplicates:
                            self.errors.append(ValidationError(
                                row_nums[0], "duplicate", message
                            ))
                        else:
                            self.warnings.append(ValidationWarning(
                                "duplicate",
                                message,
                                {"key": list(key), "rows": row_nums}
                            ))

                return EXIT_OK

        except IOError as e:
            print(f"❌ IO Error: {e}")
            return EXIT_EXCEPTION
        except Exception as e:
            print(f"❌ Unexpected error: {e}")
            import traceback
            traceback.print_exc()
            return EXIT_EXCEPTION

    def print_report(self):
        """Print human-readable validation report"""
        print("=" * 60)
        print("VALIDATION REPORT")
        print("=" * 60)
        print(f"Rows checked: {self.rows_checked}")
        print()

        if self.errors:
            print(f"❌ ERRORS ({len(self.errors)}):")
            for error in self.errors:
                print(f"  {error}")
            print()

        if self.warnings:
            print(f"⚠️  WARNINGS ({len(self.warnings)}):")
            for warning in self.warnings:
                print(f"  {warning}")
            print()

        print("=" * 60)
        if self.errors:
            print(f"❌ VALIDATION FAILED: {len(self.errors)} error(s), {len(self.warnings)} warning(s)")
        else:
            if self.warnings:
                print(f"✅ VALIDATION PASSED with {len(self.warnings)} warning(s)")
            else:
                print("✅ VALIDATION PASSED")
        print("=" * 60)

    def get_json_report(self) -> Dict[str, Any]:
        """Generate JSON validation report"""
        status = "failed" if self.errors else "ok"
        exit_code = EXIT_DATA if self.errors else EXIT_OK

        return {
            "file": self.file_path,
            "rows_checked": self.rows_checked,
            "errors": [e.to_dict() for e in self.errors],
            "warnings": [w.to_dict() for w in self.warnings],
            "status": status,
            "exit_code": exit_code
        }


def parse_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(
        description="Validate CSV files for WatchDNA Store Locator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exit Codes:
  0 - Validation passed
  1 - Usage/argument error
  2 - Schema/header errors
  3 - Data validation errors
  4 - Unexpected exception/IO error

Examples:
  %(prog)s locations.csv
  %(prog)s data/locations_2025-10-06.csv --json
  %(prog)s locations.csv --fail-duplicates --show-bad
  %(prog)s locations.csv --required Name,Latitude,Longitude --limit 100
        """
    )

    parser.add_argument(
        "file",
        help="Path to CSV file to validate"
    )

    parser.add_argument(
        "--required",
        default=",".join(DEFAULT_REQUIRED),
        help=f"Comma-separated list of required columns (default: {','.join(DEFAULT_REQUIRED)})"
    )

    parser.add_argument(
        "--warn-duplicates",
        action="store_true",
        default=True,
        help="Report duplicates as warnings (default: true)"
    )

    parser.add_argument(
        "--no-warn-duplicates",
        action="store_false",
        dest="warn_duplicates",
        help="Disable duplicate warnings"
    )

    parser.add_argument(
        "--fail-duplicates",
        action="store_true",
        default=False,
        help="Treat duplicates as errors (default: false)"
    )

    parser.add_argument(
        "--show-bad",
        action="store_true",
        default=False,
        help="Print full row content for rows with errors"
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only check first N data rows"
    )

    parser.add_argument(
        "--max-rows",
        type=int,
        default=MAX_ROWS_WARNING,
        help=f"Warn if file exceeds this many rows (default: {MAX_ROWS_WARNING})"
    )

    parser.add_argument(
        "--json",
        action="store_true",
        default=False,
        help="Output JSON format in addition to console text"
    )

    return parser.parse_args()


def main():
    """Main entry point"""
    args = parse_args()

    # Parse required headers
    required_headers = [h.strip() for h in args.required.split(",") if h.strip()]

    # Create validator
    validator = CSVValidator(
        required_headers=required_headers,
        warn_duplicates=args.warn_duplicates,
        fail_duplicates=args.fail_duplicates,
        show_bad=args.show_bad,
        limit=args.limit,
        max_rows=args.max_rows
    )

    # Validate file
    exit_code = validator.validate_file(args.file)

    # If schema errors, exit early
    if exit_code == EXIT_SCHEMA or exit_code == EXIT_EXCEPTION:
        sys.exit(exit_code)

    # Print report
    validator.print_report()

    # Output JSON if requested
    if args.json:
        json_report = validator.get_json_report()
        print()
        print("JSON OUTPUT:")
        print(json.dumps(json_report, indent=2))

    # Determine final exit code
    if validator.errors:
        sys.exit(EXIT_DATA)
    else:
        sys.exit(EXIT_OK)


if __name__ == "__main__":
    main()
