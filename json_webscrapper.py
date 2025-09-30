import requests
import csv

# Put your actual endpoint URL here (for demonstration—a public endpoint is needed)
API_URL = "https://www.watchlink.com/pages/locations.json"  # Replace with your real JSON endpoint

# The column headers must match your template
fieldnames = [
    "Handle", "Name", "Status", "Address Line 1", "Address Line 2", "Postal/ZIP Code",
    "City", "State/Province/Region", "Country", "Phone", "Email", "Website", "Image URL",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Page Title",
    "Page Description", "Meta Title", "Meta Description", "Latitude", "Longitude", "Priority",
    "Name - FR", "Page Title - FR", "Page Description - FR", "Name - ZH-CN", "Page Title - ZH-CN",
    "Page Description - ZH-CN", "Name - ES", "Page Title - ES", "Page Description - ES", " Tags",
    "Custom Brands", "Custom Brands - FR", "Custom Brands - ZH-CN", "Custom Brands - ES",
    "Custom Button title 1", "Custom Button title 1 - FR", "Custom Button title 1 - ZH-CN",
    "Custom Button title 1 - ES", "Custom Button URL 1", "Custom Button URL 1 - FR",
    "Custom Button URL 1 - ZH-CN", "Custom Button URL 1 - ES", "Custom Button title 2",
    "Custom Button title 2 - FR", "Custom Button title 2 - ZH-CN", "Custom Button title 2 - ES",
    "Custom Button URL 2", "Custom Button URL 2 - FR", "Custom Button URL 2 - ZH-CN",
    "Custom Button URL 2 - ES"
]

def fetch_store_data():
    resp = requests.get(API_URL)
    print(resp.status_code)
    print(resp.text)
    stores = resp.json().get('stores', [])  # Adjust key if your API returns a different structure

    results = []
    for store in stores:
        # Map your store fields. This is an example mapping!
        row = {
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
            "Latitude": store.get("latitude", ""),
            "Longitude": store.get("longitude", "")
            # ... Populate other fields as needed, blank if not present in data
        }
        # Ensure all columns exist for CSV
        for key in fieldnames:
            row.setdefault(key, "")
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
