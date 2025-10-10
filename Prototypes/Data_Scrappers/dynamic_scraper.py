#!/usr/bin/env python3
"""
Dynamic scraper that uses brand configs to scrape any website
Uses your existing json_webscrapper and html_webscrapper
"""
import json
import sys
import argparse
import csv
import math
import os
from pathlib import Path

# Get the directory where this script is located
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, 'brand_configs.json')

def load_brand_config(brand_name):
    """Load configuration for a specific brand"""
    with open(CONFIG_FILE, 'r') as f:
        configs = json.load(f)
    
    if brand_name not in configs:
        print(f"❌ Brand '{brand_name}' not found in configs")
        print(f"Available brands: {', '.join(configs.keys())}")
        sys.exit(1)
    
    return configs[brand_name]

def validate_csv_output(csv_file):
    """Validate CSV using the simple validator from tools"""
    # Try to import the simple validator
    try:
        tools_dir = os.path.join(os.path.dirname(os.path.dirname(SCRIPT_DIR)), 'tools')
        sys.path.insert(0, os.path.normpath(tools_dir))
        from validate_csv import validate_csv
        
        return validate_csv(csv_file)
    
    except ImportError:
        # Fallback to inline validation if module not found
        print("⚠️  Using fallback validation")
        REQUIRED = {"Handle", "Name", "Latitude", "Longitude", "City", "Country"}
        
        try:
            with open(csv_file, newline='', encoding="utf-8") as f:
                r = csv.DictReader(f)
                fieldnames = r.fieldnames
                
                # Check required fields
                missing = [h for h in REQUIRED if h not in fieldnames]
                if missing:
                    print(f"⚠️  Missing fields: {', '.join(missing)}")
                    return False
                
                # Validate coordinates
                bad = 0
                for i, row in enumerate(r, start=2):
                    lat, lon = row.get("Latitude", ""), row.get("Longitude", "")
                    try:
                        lat_f, lon_f = float(lat), float(lon)
                        if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180) or math.isnan(lat_f) or math.isnan(lon_f):
                            raise ValueError()
                    except Exception:
                        if lat or lon:  # Only warn if coords were provided
                            print(f"⚠️  Row {i}: invalid coords → {lat},{lon} ({row.get('Name', '')})")
                            bad += 1
                
                if bad > 0:
                    print(f"⚠️  {bad} rows with coordinate issues")
                else:
                    print("✅ All data validated")
                
                return True
        except Exception as e:
            print(f"⚠️  Validation error: {e}")
            return False

def scrape_json_site(config, output_file):
    """Scrape a JSON API site using config"""
    # Add script directory to path so imports work
    sys.path.insert(0, SCRIPT_DIR)
    from webscrapper import scrape_json, write_csv
    
    url = config['url']
    field_mapping = config.get('field_mapping')
    data_path = config.get('data_path', 'stores')
    
    print(f"🔍 Scraping JSON from: {url}")
    print(f"   Data path: {data_path}")
    if field_mapping:
        print(f"   Field mapping: {len(field_mapping)} fields configured")
    else:
        print("❌ Error: No field_mapping found in config")
        sys.exit(1)
    
    # Fetch data using unified scraper
    data = scrape_json(
        api_url=url,
        field_mapping=field_mapping,
        data_path=data_path
    )
    
    if data:
        write_csv(data, output_file)
        print(f"✅ Scraped {len(data)} locations → {output_file}")
        
        # Auto-validate
        print("\n📋 Validating output...")
        validate_csv_output(output_file)
    else:
        print("❌ No data found")
        sys.exit(1)

def scrape_html_site(config, output_file):
    """Scrape an HTML site using config"""
    # Add script directory to path so imports work
    sys.path.insert(0, SCRIPT_DIR)
    from webscrapper import scrape_html, write_csv
    
    url = config['url']
    card_selector = config.get('card_selector')
    field_selectors = config.get('selectors') or config.get('field_selectors')
    data_attributes = config.get('data_attributes')
    
    print(f"🔍 Scraping HTML from: {url}")
    print(f"   Card selector: {card_selector}")
    if field_selectors:
        print(f"   Field selectors: {len(field_selectors)} fields configured")
    else:
        print("❌ Error: No selectors found in config")
        sys.exit(1)
    
    if data_attributes:
        print(f"   Data attributes: {len(data_attributes)} attributes configured")
    
    # Fetch data using unified scraper
    data = scrape_html(
        locator_url=url,
        card_selector=card_selector,
        field_selectors=field_selectors,
        data_attributes=data_attributes
    )
    
    if data:
        write_csv(data, output_file)
        print(f"✅ Scraped {len(data)} locations → {output_file}")
        
        # Auto-validate
        print("\n📋 Validating output...")
        validate_csv_output(output_file)
    else:
        print("❌ No data found")
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(
        description='Dynamic store scraper - scrapes any brand using configs',
        epilog='Examples:\n'
               '  python dynamic_scraper.py --list\n'
               '  python dynamic_scraper.py watchlink_json\n'
               '  python dynamic_scraper.py watchlink_html -o stores.csv',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('brand', nargs='?', help='Brand name from brand_configs.json')
    parser.add_argument('--output', '-o', default='output/locations.csv', help='Output CSV file (default: output/locations.csv)')
    parser.add_argument('--list', '-l', action='store_true', help='List available brands')
    parser.add_argument('--no-validate', action='store_true', help='Skip validation after scraping')
    
    args = parser.parse_args()
    
    # List brands
    if args.list:
        with open(CONFIG_FILE, 'r') as f:
            configs = json.load(f)
        print("\n📋 Available brands:")
        for brand, config in configs.items():
            desc = config.get('description', '')
            desc_str = f" - {desc}" if desc else ""
            config_type = config.get('type', 'N/A')
            config_url = config.get('url', 'N/A')
            print(f"  • {brand:<25} ({config_type:<5}) → {config_url}{desc_str}")
        print(f"\nTotal: {len(configs)} brands configured\n")
        sys.exit(0)
    
    # Require brand name if not listing
    if not args.brand:
        parser.print_help()
        print("\n❌ Error: brand name required (use --list to see available brands)\n")
        sys.exit(1)
    
    # Load brand config
    config = load_brand_config(args.brand)
    
    print(f"\n🚀 Starting scrape for: {args.brand}")
    print(f"   Type: {config['type']}")
    print(f"   URL: {config['url']}\n")
    
    # Scrape based on type
    if config['type'] == 'json':
        scrape_json_site(config, args.output)
    elif config['type'] == 'html':
        scrape_html_site(config, args.output)
    else:
        print(f"❌ Unknown type: {config['type']}")
        sys.exit(1)
    
    print(f"\n🎉 Done! Output saved to: {args.output}")
    print(f"📍 View on map: Open prototype.html in browser\n")

if __name__ == "__main__":
    main()

