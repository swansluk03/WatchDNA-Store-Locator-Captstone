# tools/add_test_row.py
import csv
from pathlib import Path

csv_path = Path("locations.csv")
if not csv_path.exists():
    raise SystemExit("locations.csv not found next to prototype.html")

# Read the header exactly as-is
with csv_path.open(newline="", encoding="utf-8") as f:
    reader = csv.reader(f)
    headers = next(reader)

# Build a row with only the fields we care about; others stay blank
row = {h: "" for h in headers}
row.update({
    "Handle": "asu-test",
    "Name": "ASU Test Store",
    "Status": "TRUE",
    "Address Line 1": "1151 S Forest Ave",
    "Postal/ZIP Code": "85281",
    "City": "Tempe",
    "State/Province/Region": "Arizona",
    "Country": "USA",
    "Phone": "(480) 965-2100",
    "Latitude": "33.42131",
    "Longitude": "-111.93313",
    "Custom Brands": "TESTBRAND"
})

# Overwrite locations.csv with just the header + this one row
with csv_path.open("w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=headers)
    w.writeheader()
    w.writerow(row)

print("✅ Wrote 1 test row to locations.csv")
