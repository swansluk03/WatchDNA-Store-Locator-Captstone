import requests
from bs4 import BeautifulSoup
import csv

LOCATOR_URL = "https://www.watchlink.com/pages/locations"   # Replace with your real locator page

fieldnames = ["Handle", "Name", "Status", "Address Line 1", "Address Line 2", "Postal/ZIP Code",
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
    "Custom Button URL 2 - ES" ] 

def fetch_store_data():
    response = requests.get(LOCATOR_URL)
    soup = BeautifulSoup(response.text, 'html.parser')
    store_cards = soup.select('.store-card')  # Adjust CSS select for your site

    results = []
    for card in store_cards:
        row = {
            "Name": card.select_one(".store-name").get_text(strip=True) if card.select_one(".store-name") else "",
            "Address Line 1": card.select_one(".address-line1").get_text(strip=True) if card.select_one(".address-line1") else "",
            "Latitude": card.get("data-latitude", ""),
            "Longitude": card.get("data-longitude", "")
            # ...more columns here
        }
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
