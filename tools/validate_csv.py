import csv, sys, math

REQUIRED = {"Handle","Name","Latitude","Longitude","City","Country"}
ALL = [...]  # paste your full header list here in order

def main(path="locations.csv"):
    with open(path, newline='', encoding="utf-8") as f:
        r = csv.DictReader(f)
        missing = [h for h in REQUIRED if h not in r.fieldnames]
        extra = [h for h in r.fieldnames if h not in ALL]
        if missing: 
            print("❌ Missing headers:", missing); sys.exit(2)
        if extra:
            print("⚠️ Extra headers (ok but check):", extra)
        bad = 0
        for i,row in enumerate(r, start=2):
            lat, lon = row.get("Latitude",""), row.get("Longitude","")
            try:
                lat, lon = float(lat), float(lon)
                if not (-90<=lat<=90 and -180<=lon<=180) or math.isnan(lat) or math.isnan(lon):
                    raise ValueError()
            except Exception:
                print(f"❌ Row {i}: invalid coords → {lat},{lon} ({row.get('Name','')})")
                bad += 1
        print("✅ OK" if bad==0 else f"⚠️ {bad} bad rows")
if __name__ == "__main__": main(sys.argv[1] if len(sys.argv)>1 else "locations.csv")
