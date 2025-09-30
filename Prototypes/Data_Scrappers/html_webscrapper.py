import requests
from bs4 import BeautifulSoup
import csv
# basic HTML scraper using BeautifulSoup, needs tweaking
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
    try:
        response = requests.get(LOCATOR_URL, timeout=10)
        response.raise_for_status()
    except Exception as e:
        print(f"Failed to fetch HTML from {LOCATOR_URL}: {e}")
        return []

    soup = BeautifulSoup(response.text, 'html.parser')
    store_cards = soup.select('.store-card') or soup.select('.location') or []

    results = []
    for card in store_cards:
        # start with an explicit empty row for all expected columns
        row = {k: "" for k in fieldnames}

        # Common selectors (adjust to match your site's HTML)
        name = card.select_one('.store-name') or card.select_one('.name')
        address1 = card.select_one('.address-line1') or card.select_one('.address')
        address2 = card.select_one('.address-line2')
        city = card.select_one('.city')
        state = card.select_one('.state')
        postal = card.select_one('.postal') or card.select_one('.zip')
        country = card.select_one('.country')
        phone = card.select_one('.phone')
        email = card.select_one('.email')
        website = card.select_one('.website a') or card.select_one('.website')

        row['Name'] = name.get_text(strip=True) if name else ''
        row['Address Line 1'] = address1.get_text(strip=True) if address1 else ''
        row['Address Line 2'] = address2.get_text(strip=True) if address2 else ''
        row['City'] = city.get_text(strip=True) if city else ''
        row['State/Province/Region'] = state.get_text(strip=True) if state else ''
        row['Postal/ZIP Code'] = postal.get_text(strip=True) if postal else ''
        row['Country'] = country.get_text(strip=True) if country else ''
        row['Phone'] = phone.get_text(strip=True) if phone else ''
        row['Email'] = email.get_text(strip=True) if email else ''
        row['Website'] = website.get('href') if website and website.has_attr('href') else (website.get_text(strip=True) if website else '')

        # data attributes for lat/long and handle
        row['Latitude'] = card.get('data-latitude', '') or card.get('data-lat', '')
        row['Longitude'] = card.get('data-longitude', '') or card.get('data-lng', '')
        row['Handle'] = card.get('data-handle', '')
        active = card.get('data-active')
        if active is not None:
            row['Status'] = 'TRUE' if active.lower() in ('1', 'true', 'yes') else 'FALSE'

        # Page & meta if present inside card
        page_title = card.select_one('.page-title') or soup.select_one('title')
        meta_desc = card.select_one('meta[name="description"]') or soup.select_one('meta[name="description"]')
        row['Page Title'] = page_title.get_text(strip=True) if page_title else ''
        row['Page Description'] = meta_desc.get('content', '') if meta_desc and meta_desc.has_attr('content') else ''

        # Hours (look for structured list)
        hours = {}
        hrs = card.select('.hours li') or card.select('.hours p')
        if hrs:
            for h in hrs:
                text = h.get_text(" ", strip=True)
                # naive parse: look for Day: times
                if ':' in text:
                    parts = text.split(':', 1)
                    day = parts[0].strip()
                    val = parts[1].strip()
                    if day.lower().startswith('mon'):
                        row['Monday'] = val
                    elif day.lower().startswith('tue'):
                        row['Tuesday'] = val
                    elif day.lower().startswith('wed'):
                        row['Wednesday'] = val
                    elif day.lower().startswith('thu'):
                        row['Thursday'] = val
                    elif day.lower().startswith('fri'):
                        row['Friday'] = val
                    elif day.lower().startswith('sat'):
                        row['Saturday'] = val
                    elif day.lower().startswith('sun'):
                        row['Sunday'] = val

        # Tags / brands
        tag_nodes = card.select('.tags .tag') or card.select('.tags')
        if tag_nodes:
            tags = [t.get_text(strip=True) for t in tag_nodes]
            row[' Tags'] = ",".join(tags)

        brand_nodes = card.select('.brands .brand')
        if brand_nodes:
            row['Custom Brands'] = ",".join([b.get_text(strip=True) for b in brand_nodes])

        # Custom buttons
        btns = card.select('.custom-button') or card.select('a.button')
        if btns:
            if len(btns) > 0:
                b = btns[0]
                row['Custom Button title 1'] = b.get_text(strip=True)
                row['Custom Button URL 1'] = b.get('href', '')
            if len(btns) > 1:
                b = btns[1]
                row['Custom Button title 2'] = b.get_text(strip=True)
                row['Custom Button URL 2'] = b.get('href', '')

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
