import requests
from bs4 import BeautifulSoup
import csv

import time
from requests.adapters import HTTPAdapter, Retry

session = requests.Session()
session.headers.update({"User-Agent":"WatchDNA-485/1.0"})
session.mount("https://", HTTPAdapter(max_retries=Retry(total=3, backoff_factor=0.5)))

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
    from requests.adapters import HTTPAdapter, Retry

    # Retry-capable session
    session = requests.Session()
    session.headers.update({"User-Agent": "WatchDNA-485/1.0 (+scraper)"})
    adapter = HTTPAdapter(max_retries=Retry(total=3, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504]))
    session.mount("http://", adapter)
    session.mount("https://", adapter)

    # Fetch
    try:
        resp = session.get(LOCATOR_URL, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        print(f"Failed to fetch HTML from {LOCATOR_URL}: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")

    # Try a couple of common wrappers for store cards
    store_cards = soup.select(".store-card") or soup.select(".location") or []
    results = []

    for card in store_cards:
        # Start with a blank row matching the CSV schema
        row = {k: "" for k in fieldnames}

        # Basic fields (adjust selectors to your DOM)
        name      = card.select_one(".store-name, .name")
        address1  = card.select_one(".address-line1, .address")
        address2  = card.select_one(".address-line2")
        city      = card.select_one(".city")
        state     = card.select_one(".state, .region")
        postal    = card.select_one(".postal, .zip")
        country   = card.select_one(".country")
        phone     = card.select_one(".phone")
        email     = card.select_one(".email")
        website   = card.select_one(".website a, .website")

        row["Name"]                    = name.get_text(strip=True) if name else ""
        row["Address Line 1"]          = address1.get_text(strip=True) if address1 else ""
        row["Address Line 2"]          = address2.get_text(strip=True) if address2 else ""
        row["City"]                    = city.get_text(strip=True) if city else ""
        row["State/Province/Region"]   = state.get_text(strip=True) if state else ""
        row["Postal/ZIP Code"]         = postal.get_text(strip=True) if postal else ""
        row["Country"]                 = country.get_text(strip=True) if country else ""
        row["Phone"]                   = phone.get_text(strip=True) if phone else ""
        row["Email"]                   = email.get_text(strip=True) if email else ""
        row["Website"]                 = (
            website.get("href")
            if website and website.has_attr("href")
            else (website.get_text(strip=True) if website else "")
        )

        # Data attributes often hold these
        row["Latitude"]  = (card.get("data-latitude") or card.get("data-lat") or "").strip()
        row["Longitude"] = (card.get("data-longitude") or card.get("data-lng") or "").strip()
        row["Handle"]    = (card.get("data-handle") or "").strip()
        active           = card.get("data-active")
        if active is not None:
            row["Status"] = "TRUE" if str(active).lower() in ("1", "true", "yes") else "FALSE"

        # Page/meta (fallback to document-level <title>/<meta>)
        page_title = card.select_one(".page-title") or soup.select_one("title")
        meta_desc  = card.select_one('meta[name="description"]') or soup.select_one('meta[name="description"]')
        row["Page Title"]       = page_title.get_text(strip=True) if page_title else ""
        row["Page Description"] = meta_desc.get("content", "") if meta_desc and meta_desc.has_attr("content") else ""

        # Hours parsing (expects "Mon: 10–6" style)
        hrs = card.select(".hours li, .hours p")
        if hrs:
            for h in hrs:
                text = h.get_text(" ", strip=True)
                if ":" in text:
                    day, val = text.split(":", 1)
                    d = day.strip().lower()
                    val = val.strip()
                    if d.startswith("mon"): row["Monday"] = val
                    elif d.startswith("tue"): row["Tuesday"] = val
                    elif d.startswith("wed"): row["Wednesday"] = val
                    elif d.startswith("thu"): row["Thursday"] = val
                    elif d.startswith("fri"): row["Friday"] = val
                    elif d.startswith("sat"): row["Saturday"] = val
                    elif d.startswith("sun"): row["Sunday"] = val

        # Tags / brands
        tag_nodes = card.select(".tags .tag") or card.select(".tags")
        if tag_nodes:
            texts = [t.get_text(strip=True) for t in tag_nodes]
            row[" Tags"] = ",".join([t for t in texts if t])

        brand_nodes = card.select(".brands .brand")
        if brand_nodes:
            row["Custom Brands"] = ",".join([b.get_text(strip=True) for b in brand_nodes if b.get_text(strip=True)])

        # Custom buttons
        btns = card.select(".custom-button, a.button")
        if btns:
            if len(btns) > 0:
                b = btns[0]
                row["Custom Button title 1"] = b.get_text(strip=True)
                row["Custom Button URL 1"]   = b.get("href", "")
            if len(btns) > 1:
                b = btns[1]
                row["Custom Button title 2"] = b.get_text(strip=True)
                row["Custom Button URL 2"]   = b.get("href", "")

        # Normalize coordinates to float strings; blank if invalid
        for k in ("Latitude", "Longitude"):
            v = str(row.get(k, "")).strip()
            try:
                row[k] = f"{float(v):.7f}"
            except Exception:
                row[k] = ""

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
