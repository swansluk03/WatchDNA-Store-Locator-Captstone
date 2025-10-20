#!/usr/bin/env python3
"""
Omega Worldwide Store Scraper
Complete all-in-one script: Download, Extract, Normalize, Validate

Usage:
    python scrape_omega.py
    python scrape_omega.py -o custom_output.csv
"""
import requests
import re
import argparse
import sys
import os
import time
from data_normalizer import batch_normalize, write_normalized_csv

# Optional: Selenium for bypassing bot protection
try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False


def download_with_selenium(url, cache_file, wait_seconds=10):
    """
    Download page using Selenium (bypasses bot protection)
    
    Args:
        url: URL to download
        cache_file: Where to save the HTML
        wait_seconds: How long to wait for page to load
    
    Returns:
        HTML content or None
    """
    if not SELENIUM_AVAILABLE:
        print("❌ Selenium not installed. Run: pip install selenium")
        return None
    
    print(f"🌐 Using browser automation to download page...")
    print(f"   (This bypasses bot protection)")
    
    options = Options()
    options.add_argument('--headless')  # Run in background
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-blink-features=AutomationControlled')
    options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36')
    
    driver = None
    try:
        driver = webdriver.Chrome(options=options)
        driver.get(url)
        
        # Wait for the page to load
        print(f"⏳ Waiting {wait_seconds}s for page to load...")
        time.sleep(wait_seconds)
        
        # Get the page source
        html_content = driver.page_source
        
        # Save to cache
        with open(cache_file, 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print(f"✅ Downloaded {len(html_content)} bytes")
        print(f"💾 Saved to cache: {cache_file}")
        
        return html_content
        
    except Exception as e:
        print(f"❌ Selenium error: {e}")
        return None
    finally:
        if driver:
            driver.quit()


def download_omega_page(url, timeout=120, max_retries=3):
    """
    Download the Omega store locator page with retry logic
    
    Args:
        url: URL of Omega store locator
        timeout: Request timeout in seconds
        max_retries: Maximum number of retry attempts
    
    Returns:
        HTML content as string, or None if failed
    """
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
    
    print(f"🔍 Downloading Omega store data from: {url}")
    
    for attempt in range(1, max_retries + 1):
        try:
            if attempt > 1:
                print(f"   Retry attempt {attempt}/{max_retries}...")
            
            response = requests.get(url, headers=headers, timeout=timeout)
            response.raise_for_status()
            print(f"✅ Downloaded {len(response.text)} bytes")
            return response.text
            
        except requests.exceptions.Timeout:
            print(f"⏱️  Timeout on attempt {attempt}/{max_retries}")
            if attempt == max_retries:
                print(f"❌ Failed after {max_retries} attempts - timeout")
                return None
                
        except Exception as e:
            print(f"❌ Failed to download page: {e}")
            return None
    
    return None


def clean_html_entities(text):
    """Clean common HTML entities from strings"""
    if not isinstance(text, str):
        return text
    
    replacements = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#x20;': ' ',
        '&deg;': '°',
        '<br />': ', ',
        '<br/>': ', ',
        '<br>': ', ',
    }
    
    result = text
    for old, new in replacements.items():
        result = result.replace(old, new)
    
    return result


def extract_stores_from_html(html_content):
    """
    Extract all store data from Omega's HTML page
    Store data is embedded in JavaScript variables
    
    Args:
        html_content: Full HTML as string
    
    Returns:
        List of store dictionaries
    """
    print("\n🔍 Extracting store data from JavaScript...")
    
    # Pattern to find store objects with name, city, country, coordinates
    # Omega embeds stores in JavaScript variables with this structure
    pattern = r'"name":"([^"]+)"[^}]*?"cityName":"([^"]*)"[^}]*?"countryName":"([^"]+)"[^}]*?"latitude":([^,]+),"longitude":([^,}]+)'
    
    matches = re.finditer(pattern, html_content)
    
    stores = []
    for match in matches:
        name = clean_html_entities(match.group(1))
        city = clean_html_entities(match.group(2))
        country = clean_html_entities(match.group(3))
        lat = match.group(4)
        lon = match.group(5)
        
        # Extract full context around this match to get all fields
        start = max(0, match.start() - 500)
        end = min(len(html_content), match.end() + 500)
        context = html_content[start:end]
        
        # Initialize store with basic data
        store = {
            'name': name,
            'cityName': city,
            'countryName': country,
            'latitude': lat,
            'longitude': lon,
        }
        
        # Extract additional fields from context
        field_patterns = {
            'adr': r'"adr":"([^"]*)"',
            'zipcode': r'"zipcode":"([^"]*)"',
            'stateName': r'"stateName":"([^"]*)"',
            'stateCode': r'"stateCode":"([^"]*)"',
            'id': r'"id":"([^"]*)"',
            'countryCode': r'"countryCode":"([^"]*)"',
            'websiteUrl': r'"websiteUrl":"([^"]*)"',
        }
        
        for field, pat in field_patterns.items():
            field_match = re.search(pat, context)
            if field_match:
                store[field] = clean_html_entities(field_match.group(1))
        
        # Extract phone/email from contacts object
        contacts_pattern = r'"contacts":\{"phone":"([^"]*)","fax":"([^"]*)","email":"([^"]*)"\}'
        contacts_match = re.search(contacts_pattern, context)
        if contacts_match:
            if contacts_match.group(1):
                store['phone'] = clean_html_entities(contacts_match.group(1))
            if contacts_match.group(3):
                store['email'] = clean_html_entities(contacts_match.group(3))
        
        stores.append(store)
    
    print(f"✅ Extracted {len(stores)} stores")
    return stores


def normalize_omega_stores(stores):
    """
    Normalize Omega store data to canonical CSV format
    
    Args:
        stores: List of raw store dictionaries
    
    Returns:
        List of normalized store dictionaries
    """
    print("\n🔧 Normalizing data to canonical format...")
    
    # Field mapping from Omega's format to our canonical schema
    field_mapping = {
        "Handle": ["id", "storeId"],
        "Name": "name",
        "Status": "TRUE",  # All stores are active
        "Address Line 1": ["adr", "address"],
        "City": ["cityName", "city"],
        "State/Province/Region": ["stateName", "state", "stateCode"],
        "Country": ["countryName", "country", "countryCode"],
        "Postal/ZIP Code": ["zipcode", "postalCode", "zip"],
        "Phone": "phone",
        "Email": "email",
        "Website": ["websiteUrl", "website"],
        "Latitude": ["latitude", "lat"],
        "Longitude": ["longitude", "lng"],
        "Custom Brands": "OMEGA"
    }
    
    # Use the definitive normalizer
    normalized = batch_normalize(stores, field_mapping)
    
    print(f"✅ Normalized {len(normalized)} stores")
    return normalized


def validate_csv_file(csv_path, remove_duplicates=True):
    """
    Validate the output CSV using the existing validator
    
    Args:
        csv_path: Path to CSV file to validate
        remove_duplicates: If True, automatically remove duplicates
    
    Returns:
        True if validation passed, False otherwise
    """
    print(f"\n🔍 Validating output with validate_csv.py...")
    
    # Use the existing validation tool
    validator_path = "../../tools/validate_csv.py"
    
    # Add --remove-duplicates flag if requested
    flags = "--remove-duplicates" if remove_duplicates else ""
    exit_code = os.system(f"python3 {validator_path} {csv_path} {flags}")
    
    return exit_code == 0


def print_summary(stores):
    """Print summary statistics"""
    print(f"\n📊 Summary:")
    print(f"   Total stores: {len(stores)}")
    
    # Count by country
    countries = {}
    for store in stores:
        country = store.get('countryName', 'Unknown')
        countries[country] = countries.get(country, 0) + 1
    
    print(f"   Countries: {len(countries)}")
    print(f"\n   Top 10 countries:")
    top = sorted(countries.items(), key=lambda x: x[1], reverse=True)[:10]
    for country, count in top:
        print(f"     • {country:<35} {count:>3} stores")


def main():
    """Main execution function"""
    parser = argparse.ArgumentParser(
        description='Scrape all Omega stores worldwide',
        epilog='Example: python scrape_omega.py -o output/omega_all.csv'
    )
    parser.add_argument(
        '-o', '--output',
        default='output/omega_worldwide.csv',
        help='Output CSV file (default: output/omega_worldwide.csv)'
    )
    parser.add_argument(
        '--url',
        default='https://www.omegawatches.com/en-us/store?countryCode=US&lat=42.44742563265204&lng=-114.43460907059999&mode=all&zoom=5',
        help='Omega store locator URL (default: US with mode=all for worldwide data)'
    )
    parser.add_argument(
        '--no-validate',
        action='store_true',
        help='Skip validation step'
    )
    parser.add_argument(
        '--cached',
        default='omega_page_source.html',
        help='Path to cached HTML file'
    )
    parser.add_argument(
        '--use-cache',
        action='store_true',
        help='Use existing cached HTML instead of downloading fresh (faster but may be outdated)'
    )
    parser.add_argument(
        '--no-selenium',
        action='store_true',
        help='Disable Selenium browser automation (use simple HTTP request)'
    )
    parser.add_argument(
        '--append',
        action='store_true',
        help='Append to existing CSV instead of overwriting'
    )
    
    args = parser.parse_args()
    
    print("=" * 70)
    print("OMEGA WORLDWIDE STORE SCRAPER")
    print("=" * 70)
    print()
    
    # Step 1: Get HTML content (always download fresh by default)
    html_content = None
    
    # Only use cache if explicitly requested with --use-cache
    if args.use_cache and os.path.exists(args.cached):
        print(f"📂 Using cached file: {args.cached}")
        print(f"   (Use without --use-cache to download fresh data)")
        try:
            with open(args.cached, 'r', encoding='utf-8') as f:
                html_content = f.read()
            print(f"✅ Loaded {len(html_content)} bytes from cache")
        except Exception as e:
            print(f"⚠️  Failed to read cache: {e}")
            print("   Will download fresh instead...")
    
    # Download fresh data (default behavior)
    if not html_content:
        print("🔄 Downloading fresh data from Omega...")
        print(f"   (This ensures you have the latest stores)")
        print()
        
        # Try Selenium first (best for bot protection)
        use_selenium = not args.no_selenium and SELENIUM_AVAILABLE
        
        if use_selenium:
            html_content = download_with_selenium(args.url, args.cached)
        
        # Fallback to regular requests if Selenium fails or disabled
        if not html_content:
            if not args.no_selenium and not SELENIUM_AVAILABLE:
                print("\n⚠️  Selenium not available. Install with: pip install selenium")
                print("   Trying regular HTTP request...\n")
            
            html_content = download_omega_page(args.url)
            if html_content:
                # Save to cache for future use
                try:
                    with open(args.cached, 'w', encoding='utf-8') as f:
                        f.write(html_content)
                    print(f"💾 Saved to cache: {args.cached}")
                except Exception as e:
                    print(f"⚠️  Failed to save cache: {e}")
        
        # If still failed, provide manual instructions
        if not html_content:
            print("\n❌ Failed to download page")
            print("\n💡 MANUAL WORKAROUND:")
            print("   1. Open this URL in your browser:")
            print(f"   {args.url}")
            print("   2. Save the page (Ctrl+S) as '{args.cached}'")
            print("   3. Run this script again with --use-cache")
            sys.exit(1)
    
    # Step 2: Extract stores
    stores = extract_stores_from_html(html_content)
    if not stores:
        print("\n❌ No stores found")
        sys.exit(1)
    
    # Step 3: Normalize data
    normalized = normalize_omega_stores(stores)
    
    # Step 4: Write to CSV (append or overwrite)
    if args.append and os.path.exists(args.output):
        print(f"\n📝 Appending {len(normalized)} stores to {args.output}...")
        # Read existing data
        import csv
        existing_data = []
        with open(args.output, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            existing_data = list(reader)
        
        print(f"   Found {len(existing_data)} existing stores")
        
        # Combine and write
        combined = existing_data + normalized
        write_normalized_csv(combined, args.output)
        print(f"   Total after append: {len(combined)} stores")
    else:
        print(f"\n💾 Writing {len(normalized)} stores to {args.output}...")
        write_normalized_csv(normalized, args.output)
    
    # Step 5: Validate (with duplicate removal)
    if not args.no_validate:
        validation_passed = validate_csv_file(args.output)
        if not validation_passed:
            print("\n⚠️  Validation had warnings/errors (see above)")
    
    # Step 6: Summary
    print_summary(stores)
    
    print(f"\n✅ Success! {len(normalized)} Omega stores extracted")
    print(f"📁 Output: {args.output}")
    print("\n💡 View on map: Copy to ../../locations.csv and open prototype.html")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

