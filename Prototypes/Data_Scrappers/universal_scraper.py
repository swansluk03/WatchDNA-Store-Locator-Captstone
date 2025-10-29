#!/usr/bin/env python3
"""
Universal Store Locator Scraper
================================

ONE script that handles EVERYTHING:
- Auto-detects if endpoint is region-specific or returns all stores
- Auto-detects viewport/country/pagination patterns
- Auto-expands to get worldwide data if needed
- Auto-maps fields
- Normalizes and validates

Usage:
    python3 universal_scraper.py --url "ANY_STORE_LOCATOR_URL"
"""

import argparse
import sys
import os
import time
import json
from datetime import datetime
from typing import Dict, List, Any, Optional

# Debug logging helper
def log_debug(message: str, level: str = "INFO"):
    """Print timestamped debug message"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    prefix = {
        "INFO": "ℹ️ ",
        "SUCCESS": "✅",
        "ERROR": "❌",
        "WARN": "⚠️ ",
        "DEBUG": "🔍"
    }.get(level, "  ")
    print(f"[{timestamp}] {prefix} {message}", flush=True)

# Add paths
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))

from locator_type_detector import detect_locator_type
from pattern_detector import detect_data_pattern
from data_normalizer import batch_normalize, write_normalized_csv
from validate_csv import validate_csv


def fetch_data(url: str) -> Any:
    """Fetch data from URL"""
    import requests
    log_debug(f"Fetching data from: {url[:100]}...", "DEBUG")
    start_time = time.time()
    
    response = requests.get(url, timeout=30, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    })
    response.raise_for_status()
    
    elapsed = time.time() - start_time
    log_debug(f"Response received: {response.status_code} | Size: {len(response.content)} bytes | Time: {elapsed:.2f}s", "DEBUG")
    
    try:
        data = response.json()
        log_debug(f"Response type: JSON | Top-level keys: {list(data.keys()) if isinstance(data, dict) else 'array'}", "DEBUG")
        return data
    except:
        log_debug(f"Response type: HTML/Text | Length: {len(response.text)} chars", "DEBUG")
        return response.text


def extract_stores_from_html_js(html_content: str) -> List[Dict]:
    """Extract stores from HTML pages with embedded JavaScript"""
    import re
    
    pattern = r'"name":"([^"]+)"[^}]*?"cityName":"([^"]*)"[^}]*?"countryName":"([^"]+)"[^}]*?"latitude":([^,]+),"longitude":([^,}]+)'
    matches = re.finditer(pattern, html_content)
    stores = []
    
    for match in matches:
        start = max(0, match.start() - 500)
        end = min(len(html_content), match.end() + 500)
        context = html_content[start:end]
        
        store = {
            'name': match.group(1),
            'cityName': match.group(2),
            'countryName': match.group(3),
            'latitude': match.group(4),
            'longitude': match.group(5),
        }
        
        field_patterns = {
            'adr': r'"adr":"([^"]*)"',
            'address': r'"address":"([^"]*)"',
            'streetAddress': r'"streetAddress":"([^"]*)"',
            'zipcode': r'"zipcode":"([^"]*)"',
            'postalCode': r'"postalCode":"([^"]*)"',
            'stateName': r'"stateName":"([^"]*)"',
            'id': r'"id":"([^"]*)"',
            'phone': r'"phone":"([^"]*)"',
            'email': r'"email":"([^"]*)"',
            'websiteUrl': r'"websiteUrl":"([^"]*)"',
        }
        
        for field, pat in field_patterns.items():
            field_match = re.search(pat, context)
            if field_match:
                store[field] = field_match.group(1)
        
        stores.append(store)
    
    return stores


def scrape_single_call(url: str) -> List[Dict]:
    """Scrape from single endpoint - handles both JSON and HTML"""
    print("📡 Fetching stores...")
    log_debug("Starting single-call scrape strategy", "DEBUG")
    
    data = fetch_data(url)
    
    # Try JSON first
    if isinstance(data, (list, dict)):
        if isinstance(data, list):
            log_debug(f"Data is array | Length: {len(data)}", "DEBUG")
            return data
        
        # Find data array in dict
        log_debug(f"Data is object | Searching for store array in keys: {list(data.keys())}", "DEBUG")
        for key in ["data", "results", "items", "stores", "locations", "dealers", "retailers"]:
            if key in data and isinstance(data[key], list):
                log_debug(f"Found stores array in key '{key}' | Length: {len(data[key])}", "SUCCESS")
                return data[key]
        
        log_debug("No stores array found in standard keys", "WARN")
        return []
    
    # Try HTML with JS
    log_debug("Attempting HTML/JavaScript extraction", "DEBUG")
    return extract_stores_from_html_js(data)


def scrape_viewport_expansion(url: str, url_params: Dict, region: str = "world") -> List[Dict]:
    """Expand viewport-based API using grid scraping"""
    from viewport_grid import scrape_viewport_api, get_region_preset
    
    print(f"🗺️  Viewport API detected - expanding to {region}")
    
    viewport_params = {
        "northEastLat": "northEastLat",
        "northEastLng": "northEastLng",
        "southWestLat": "southWestLat",
        "southWestLng": "southWestLng"
    }
    
    additional_params = {k: v for k, v in url_params.items() 
                        if k not in ["northEastLat", "northEastLng", "southWestLat", "southWestLng", "lat", "lng"]}
    
    grid_size = 10
    grid_type = "world" if region == "world" else "focused"
    focus_region = None if region == "world" else get_region_preset(region)
    
    stores = scrape_viewport_api(
        base_url=url.split('?')[0],
        viewport_params=viewport_params,
        grid_type=grid_type,
        grid_size=grid_size,
        data_path="",
        additional_params=additional_params,
        delay_between_requests=0.5,
        focus_region=focus_region
    )
    
    return stores


def scrape_country_expansion(url: str, url_params: Dict, region: str = "world") -> List[Dict]:
    """Expand country-filter API by iterating through countries"""
    import requests
    
    all_countries = [
        "US", "CA", "GB", "FR", "DE", "IT", "ES", "CH", "AT", "BE", "NL", "SE", "NO", "DK", "FI",
        "IE", "PT", "GR", "PL", "CZ", "HU", "RO", "BG", "HR", "SI", "SK", "EE", "LV", "LT",
        "JP", "CN", "KR", "TW", "HK", "SG", "MY", "TH", "ID", "PH", "VN", "IN", "AU", "NZ",
        "AE", "SA", "QA", "KW", "BH", "OM", "IL", "TR", "ZA", "EG", "BR", "MX", "AR", "CL", "CO"
    ]
    
    if region == "north_america":
        countries = ["US", "CA", "MX"]
    elif region == "europe":
        countries = ["GB", "FR", "DE", "IT", "ES", "CH", "AT", "BE", "NL", "SE", "NO", "DK"]
    else:
        countries = all_countries
    
    print(f"🌍 Country filter detected - iterating {len(countries)} countries")
    
    country_param = None
    for key in url_params.keys():
        if "country" in key.lower():
            country_param = key
            break
    if not country_param:
        country_param = "country"
    
    all_stores = []
    seen_ids = set()
    
    for i, country_code in enumerate(countries, 1):
        params = url_params.copy()
        params[country_param] = country_code
        
        try:
            response = requests.get(url.split('?')[0], params=params, timeout=10, headers={
                "User-Agent": "Mozilla/5.0"
            })
            response.raise_for_status()
            data = response.json()
            
            if isinstance(data, list):
                stores = data
            elif isinstance(data, dict):
                for key in ["data", "results", "items", "stores", "locations"]:
                    if key in data:
                        stores = data[key] if isinstance(data[key], list) else []
                        break
                else:
                    stores = []
            else:
                stores = []
            
            new_stores = 0
            for store in stores:
                store_id = store.get("id") or store.get("store_id") or str(store)
                if store_id not in seen_ids:
                    all_stores.append(store)
                    seen_ids.add(store_id)
                    new_stores += 1
            
            if new_stores > 0:
                print(f"  [{i}/{len(countries)}] {country_code}: +{new_stores} stores (total: {len(all_stores)})")
            
            time.sleep(0.3)
        
        except Exception as e:
            continue
    
    return all_stores


def scrape_paginated(url: str, url_params: Dict) -> List[Dict]:
    """Expand paginated API by following all pages"""
    import requests
    
    print("📄 Pagination detected - following pages")
    
    page_param = None
    limit_param = None
    
    for key in url_params.keys():
        if "page" in key.lower():
            page_param = key
        if "limit" in key.lower() or "per_page" in key.lower():
            limit_param = key
    
    if not page_param:
        page_param = "page"
    if not limit_param:
        limit_param = "limit"
    
    if limit_param not in url_params:
        url_params[limit_param] = 100
    
    all_stores = []
    page = 1
    max_pages = 1000
    
    while page <= max_pages:
        params = url_params.copy()
        params[page_param] = page
        
        try:
            response = requests.get(url.split('?')[0], params=params, timeout=10, headers={
                "User-Agent": "Mozilla/5.0"
            })
            response.raise_for_status()
            data = response.json()
            
            if isinstance(data, list):
                stores = data
            elif isinstance(data, dict):
                for key in ["data", "results", "items", "stores", "locations"]:
                    if key in data:
                        stores = data[key] if isinstance(data[key], list) else []
                        break
                else:
                    stores = []
            else:
                stores = []
            
            if not stores:
                break
            
            all_stores.extend(stores)
            print(f"  Page {page}: +{len(stores)} stores (total: {len(all_stores)})")
            
            if isinstance(data, dict):
                if "has_more" in data and not data["has_more"]:
                    break
                if "next" in data and not data["next"]:
                    break
            
            page += 1
            time.sleep(0.2)
        
        except Exception as e:
            break
    
    return all_stores


def universal_scrape(
    url: str,
    output_file: str = "output/stores.csv",
    region: str = "world",
    force_type: Optional[str] = None,
    validate_output: bool = True
) -> Dict[str, Any]:
    """
    Universal scraper - auto-detects and handles everything
    
    Args:
        url: Store locator URL/endpoint
        output_file: Output CSV file
        region: Region to scrape if expansion needed
        force_type: Force specific type (viewport, country, pagination, single)
        validate_output: Validate output CSV
    
    Returns:
        Dict with results
    """
    results = {
        "success": False,
        "url": url,
        "detected_type": None,
        "is_region_specific": False,
        "expansion_used": False,
        "stores_found": 0,
        "stores_normalized": 0,
        "output_file": output_file
    }
    
    print("=" * 80)
    print("🌍 UNIVERSAL STORE SCRAPER")
    print("=" * 80)
    print()
    log_debug(f"Starting scraper | URL: {url[:100]}", "INFO")
    log_debug(f"Region: {region} | Force type: {force_type or 'auto-detect'}", "INFO")
    
    # Step 1: Fetch sample and detect
    print("🔍 Analyzing endpoint...")
    log_debug("PHASE 1: Endpoint Analysis", "INFO")
    
    try:
        log_debug("Fetching sample data for detection...", "DEBUG")
        sample_data = fetch_data(url)
        log_debug(f"Sample data retrieved successfully", "SUCCESS")
    except Exception as e:
        log_debug(f"Failed to fetch sample data: {e}", "ERROR")
        print(f"❌ Failed to fetch: {e}")
        return results
    
    # Detect locator type
    log_debug("Running locator type detection...", "DEBUG")
    if not force_type:
        locator_analysis = detect_locator_type(url, sample_data)
        detected_type = locator_analysis["detected_type"]
        is_region_specific = locator_analysis["is_region_specific"]
        log_debug(f"Detected type: {detected_type} | Region-specific: {is_region_specific}", "DEBUG")
    else:
        detected_type = force_type
        is_region_specific = force_type in ["viewport", "country_filter", "radius_search"]
        log_debug(f"Forced type: {detected_type} | Region-specific: {is_region_specific}", "DEBUG")
    
    results["detected_type"] = detected_type
    results["is_region_specific"] = is_region_specific
    
    print(f"   Type: {detected_type}")
    print(f"   Region-specific: {is_region_specific}")
    
    # Detect field mapping
    log_debug("Running field mapping detection...", "DEBUG")
    pattern = detect_data_pattern(url, sample_data)
    field_mapping = pattern["field_mapping"]
    log_debug(f"Field mapping confidence: {pattern['mapping_score']['confidence']}", "DEBUG")
    log_debug(f"Mapped fields: {len(field_mapping)} | Fields: {list(field_mapping.keys())[:5]}...", "DEBUG")
    print(f"   Field mapping: {pattern['mapping_score']['confidence'].upper()} confidence")
    print()
    
    # Step 2: Scrape with appropriate strategy
    print("📡 Scraping...")
    log_debug("PHASE 2: Data Collection", "INFO")
    scrape_start = time.time()
    
    try:
        if not is_region_specific or detected_type == "single_call":
            # Single call
            log_debug("Strategy: Single API call", "INFO")
            stores = scrape_single_call(url)
            results["expansion_used"] = False
        
        elif detected_type == "viewport":
            # Viewport expansion
            log_debug(f"Strategy: Viewport expansion (region={region})", "INFO")
            stores = scrape_viewport_expansion(url, locator_analysis["url_params"], region)
            results["expansion_used"] = True
        
        elif detected_type == "country_filter":
            # Country expansion
            log_debug(f"Strategy: Country iteration (region={region})", "INFO")
            stores = scrape_country_expansion(url, locator_analysis["url_params"], region)
            results["expansion_used"] = True
        
        elif detected_type == "paginated":
            # Pagination
            log_debug("Strategy: Paginated scraping", "INFO")
            stores = scrape_paginated(url, locator_analysis["url_params"])
            results["expansion_used"] = True
        
        else:
            # Default to single call
            log_debug("Strategy: Default single call", "INFO")
            stores = scrape_single_call(url)
            results["expansion_used"] = False
        
        scrape_time = time.time() - scrape_start
        results["stores_found"] = len(stores)
        log_debug(f"Data collection complete | {len(stores)} stores found | Time: {scrape_time:.2f}s", "SUCCESS")
        print(f"✅ Found {len(stores)} stores")
        print(f"   📊 Raw data collected from endpoint")
        print()
    
    except Exception as e:
        log_debug(f"Scraping failed: {e}", "ERROR")
        print(f"❌ Scraping error: {e}")
        import traceback
        traceback.print_exc()
        return results
    
    if not stores:
        print("❌ No stores found")
        return results
    
    # Step 3: Normalize
    print("🔧 Normalizing data...")
    log_debug("PHASE 3: Data Normalization", "INFO")
    norm_start = time.time()
    print(f"   Processing {len(stores)} raw store records...")
    log_debug(f"Input: {len(stores)} raw records", "DEBUG")
    log_debug(f"Field mapping rules: {len(field_mapping)} fields", "DEBUG")
    
    normalized = batch_normalize(stores, field_mapping)
    results["stores_normalized"] = len(normalized)
    norm_time = time.time() - norm_start
    
    # Calculate how many were filtered out
    filtered_count = len(stores) - len(normalized)
    log_debug(f"Normalization complete | Output: {len(normalized)} records | Filtered: {filtered_count} | Time: {norm_time:.2f}s", "SUCCESS")
    
    print(f"   ✅ {len(normalized)} stores normalized successfully")
    if filtered_count > 0:
        print(f"   ⚠️  {filtered_count} records filtered out (missing required fields)")
        log_debug(f"Filter reason: Missing required fields (name, address, coordinates)", "DEBUG")
    print()
    
    # Step 4: Write CSV
    print(f"💾 Writing to {output_file}...")
    log_debug("PHASE 4: CSV Export", "INFO")
    print(f"   Creating CSV file with {len(normalized)} records...")
    log_debug(f"Output file: {output_file}", "DEBUG")
    
    os.makedirs(os.path.dirname(output_file) if os.path.dirname(output_file) else ".", exist_ok=True)
    write_start = time.time()
    write_normalized_csv(normalized, output_file)
    write_time = time.time() - write_start
    
    file_size = os.path.getsize(output_file) / 1024  # KB
    log_debug(f"CSV export complete | Size: {file_size:.1f} KB | Time: {write_time:.2f}s", "SUCCESS")
    print(f"   ✅ Saved {len(normalized)} records ({file_size:.1f} KB)")
    print()
    
    # Step 5: Validate
    if validate_output:
        print("📋 Validating...")
        try:
            valid = validate_csv(output_file)
            print(f"   {'✅ Valid' if valid else '⚠️  Has warnings'}")
        except Exception as e:
            print(f"   ⚠️  Validation error: {e}")
        print()
    
    results["success"] = True
    
    # Final summary with performance metrics
    total_time = time.time() - scrape_start
    log_debug("=" * 60, "INFO")
    log_debug("SCRAPING SUMMARY", "INFO")
    log_debug("=" * 60, "INFO")
    log_debug(f"Status: SUCCESS", "SUCCESS")
    log_debug(f"Total Time: {total_time:.2f}s", "INFO")
    log_debug(f"Strategy: {detected_type} (expansion={results['expansion_used']})", "INFO")
    log_debug(f"Records: {results['stores_found']} found → {results['stores_normalized']} normalized", "INFO")
    log_debug(f"Output: {output_file} ({file_size:.1f} KB)", "INFO")
    log_debug("=" * 60, "INFO")
    
    return results


def main():
    parser = argparse.ArgumentParser(
        description='Universal store scraper - auto-detects everything',
        epilog="""
Examples:
  # Auto-detect and scrape (simplest)
  python3 universal_scraper.py --url "https://api.example.com/stores"
  
  # Specify output
  python3 universal_scraper.py --url "..." -o output/my_stores.csv
  
  # Force specific type
  python3 universal_scraper.py --url "..." --type viewport
  
  # Different region (if expansion needed)
  python3 universal_scraper.py --url "..." --region north_america

This ONE script handles:
  ✅ Single endpoints (returns all stores)
  ✅ Viewport APIs (Rolex-style)
  ✅ Country filters (Cartier-style)  
  ✅ HTML + JavaScript (Omega-style)
  ✅ Pagination
  
Auto-detects everything and uses the right strategy!
        """
    )
    
    parser.add_argument('--url', required=True, help='Store locator URL/endpoint')
    parser.add_argument('-o', '--output', default='output/stores.csv', help='Output CSV file')
    parser.add_argument('--region', default='world', help='Region to scrape (world, north_america, europe, etc.)')
    parser.add_argument('--type', choices=['viewport', 'country_filter', 'paginated', 'single_call'], 
                       help='Force specific scraper type (auto-detects if not specified)')
    parser.add_argument('--no-validate', action='store_true', help='Skip validation')
    parser.add_argument('--json-output', help='Also save results as JSON')
    
    args = parser.parse_args()
    
    # Run universal scraper
    results = universal_scrape(
        url=args.url,
        output_file=args.output,
        region=args.region,
        force_type=args.type,
        validate_output=not args.no_validate
    )
    
    # Summary
    print("=" * 80)
    if results["success"]:
        print("✅ SUCCESS")
        print(f"   Type: {results['detected_type']}")
        print(f"   Expansion: {'Yes' if results['expansion_used'] else 'No'}")
        print(f"   Stores: {results['stores_found']} found, {results['stores_normalized']} normalized")
        print(f"   Output: {results['output_file']}")
    else:
        print("❌ FAILED")
    print("=" * 80)
    
    # Optional JSON output
    if args.json_output:
        with open(args.json_output, 'w') as f:
            json.dump(results, f, indent=2)
        print(f"\n📊 Results saved to: {args.json_output}")
    
    return 0 if results["success"] else 1


if __name__ == "__main__":
    sys.exit(main())

