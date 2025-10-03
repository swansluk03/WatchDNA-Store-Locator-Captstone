import requests
import csv
import os

# basic JSON scraper, needs tweaking
API_URL = "https://www.watchlink.com/pages/locations.json"

# Attempt to load headers from repository's locations.csv and normalize them
csv_path = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "locations.csv"))
if os.path.exists(csv_path):
    try:
        with open(csv_path, newline='', encoding='utf-8') as f:
            header_line = f.readline().strip()
            if header_line:
                fieldnames = [h.strip().replace(' Tags', 'Tags') for h in header_line.split(',')]
            else:
                raise Exception('empty header')
    except Exception:
        fieldnames = None
else:
    fieldnames = None

# fallback hardcoded list (normalized) if CSV header not found
if not fieldnames:
    fieldnames = [
        "Handle", "Name", "Status", "Address Line 1", "Address Line 2", "Postal/ZIP Code",
        "City", "State/Province/Region", "Country", "Phone", "Email", "Website", "Image URL",
        "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Page Title",
        "Page Description", "Meta Title", "Meta Description", "Latitude", "Longitude", "Priority",
        "Name - FR", "Page Title - FR", "Page Description - FR", "Name - ZH-CN", "Page Title - ZH-CN",
        "Page Description - ZH-CN", "Name - ES", "Page Title - ES", "Page Description - ES", "Tags",
        "Custom Brands", "Custom Brands - FR", "Custom Brands - ZH-CN", "Custom Brands - ES",
        "Custom Button title 1", "Custom Button title 1 - FR", "Custom Button title 1 - ZH-CN",
        "Custom Button title 1 - ES", "Custom Button URL 1", "Custom Button URL 1 - FR",
        "Custom Button URL 1 - ZH-CN", "Custom Button URL 1 - ES", "Custom Button title 2",
        "Custom Button title 2 - FR", "Custom Button title 2 - ZH-CN", "Custom Button title 2 - ES",
        "Custom Button URL 2", "Custom Button URL 2 - FR", "Custom Button URL 2 - ZH-CN",
        "Custom Button URL 2 - ES"
    ]

def fetch_store_data():
    try:
        resp = requests.get(API_URL, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        print(f"Failed to fetch JSON from {API_URL}: {e}")
        return []

    try:
        stores = resp.json().get('stores', [])  # Adjust key if your API returns a different structure
    except Exception:
        print("Response is not valid JSON")
        return []

    results = []
    for store in stores:
        # Start with an explicit empty row for all expected columns
        row = {k: "" for k in fieldnames}

        # Basic mappings (adjust keys to match the actual JSON structure if different)
        row.update({
            "Handle": store.get("slug", ""),
            "Name": store.get("name", ""),
            "Status": "TRUE" if store.get("active", True) else "FALSE",
            "Address Line 1": store.get("address1", ""),
            "Address Line 2": store.get("address2", ""),
            "Postal/ZIP Code": store.get("zip", ""),
            "City": store.get("city", ""),
            "State/Province/Region": store.get("state", ""),
            "Country": store.get("country", ""),
            "Phone": store.get("phone", ""),
            "Email": store.get("email", ""),
            "Website": store.get("website", ""),
            "Image URL": store.get("image", ""),
            "Latitude": str(store.get("latitude", "")),
            "Longitude": str(store.get("longitude", "")),
            "Page Title": store.get("page_title", ""),
            "Page Description": store.get("page_description", ""),
            "Meta Title": store.get("meta_title", ""),
            "Meta Description": store.get("meta_description", ""),
            "Priority": store.get("priority", "")
        })

        # Leave store hours blank by design (columns present but intentionally empty)
        row['Monday'] = ''
        row['Tuesday'] = ''
        row['Wednesday'] = ''
        row['Thursday'] = ''
        row['Friday'] = ''
        row['Saturday'] = ''
        row['Sunday'] = ''

        # Tags / brands
        tags = store.get('tags') or store.get('categories')
        if isinstance(tags, list):
            row['Tags'] = ",".join([str(t) for t in tags])
        elif tags:
            row['Tags'] = str(tags)

        brands = store.get('brands')
        if isinstance(brands, list):
            row['Custom Brands'] = ",".join([str(b) for b in brands])
        elif brands:
            row['Custom Brands'] = str(brands)

        # Localized fields (common naming patterns)
        row['Name - FR'] = store.get('name_fr', '') or store.get('name_fr_FR', '')
        row['Page Title - FR'] = store.get('page_title_fr', '')
        row['Page Description - FR'] = store.get('page_description_fr', '')
        row['Name - ZH-CN'] = store.get('name_zh', '') or store.get('name_zh_cn', '')
        row['Page Title - ZH-CN'] = store.get('page_title_zh', '')
        row['Page Description - ZH-CN'] = store.get('page_description_zh', '')
        row['Name - ES'] = store.get('name_es', '')
        row['Page Title - ES'] = store.get('page_title_es', '')
        row['Page Description - ES'] = store.get('page_description_es', '')

        # Custom buttons (expect a list of dicts)
        buttons = store.get('custom_buttons') or store.get('buttons') or []
        if isinstance(buttons, list):
            if len(buttons) > 0:
                b = buttons[0]
                row['Custom Button title 1'] = b.get('title', '')
                row['Custom Button URL 1'] = b.get('url', '')
                row['Custom Button title 1 - FR'] = b.get('title_fr', '')
                row['Custom Button URL 1 - FR'] = b.get('url_fr', '')
                row['Custom Button title 1 - ZH-CN'] = b.get('title_zh', '')
                row['Custom Button URL 1 - ZH-CN'] = b.get('url_zh', '')
                row['Custom Button title 1 - ES'] = b.get('title_es', '')
                row['Custom Button URL 1 - ES'] = b.get('url_es', '')
            if len(buttons) > 1:
                b = buttons[1]
                row['Custom Button title 2'] = b.get('title', '')
                row['Custom Button URL 2'] = b.get('url', '')
                row['Custom Button title 2 - FR'] = b.get('title_fr', '')
                row['Custom Button URL 2 - FR'] = b.get('url_fr', '')
                row['Custom Button title 2 - ZH-CN'] = b.get('title_zh', '')
                row['Custom Button URL 2 - ZH-CN'] = b.get('url_zh', '')
                row['Custom Button title 2 - ES'] = b.get('title_es', '')
                row['Custom Button URL 2 - ES'] = b.get('url_es', '')

        results.append(row)

    return results

def write_csv(data, filename="locations.csv"):
    with open(filename, 'w', newline='', encoding='utf-8') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        for row in data:
            writer.writerow(row)
    print(f"Exported {len(data)} locations to {filename}")

def main():
    store_data = fetch_store_data()
    write_csv(store_data)

if __name__ == "__main__":
    main()
