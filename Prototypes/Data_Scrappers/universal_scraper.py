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
from typing import Dict, List, Any, Optional, Tuple
from urllib.parse import urlparse

from scraper_utils import log_debug

# Request/retry constants
DEFAULT_REQUEST_TIMEOUT = 120
DEFAULT_RETRIES = 3
DEFAULT_BACKOFF_FACTOR = 2
DEFAULT_VIEWPORT_GRID_SIZE = 20
DEFAULT_DELAY_BETWEEN_REQUESTS = 0.5

# Add paths
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))

from locator_type_detector import detect_locator_type


def _print_technique_comparison(technique_metrics: Dict[str, Any]) -> None:
    """Print comparison table of extraction technique results."""
    print("\n📊 EXTRACTION TECHNIQUE COMPARISON")
    print("=" * 60)
    for name, m in technique_metrics.items():
        total = m.get("total", 0)
        score = m.get("completeness_score", 0)
        pcts = m.get("pcts", {})
        print(f"\n  {name}:")
        print(f"    Stores: {total}  |  Completeness: {score}%")
        if pcts:
            parts = [f"{k.replace('_pct','')}:{v}%" for k, v in list(pcts.items())[:6]]
            print(f"    Fields: {', '.join(parts)}")
    print("=" * 60)


def _collect_data_quality_warnings(stores: List[Dict[str, Any]]) -> List[str]:
    """Scan normalized stores for data-quality issues and return warning messages."""
    if not stores:
        return []
    no_name = sum(1 for s in stores if not (s.get("Name") or "").strip())
    no_coords = sum(
        1
        for s in stores
        if not (s.get("Latitude") or "").strip() or not (s.get("Longitude") or "").strip()
    )
    no_address = sum(1 for s in stores if not (s.get("Address Line 1") or "").strip())
    no_phone = sum(1 for s in stores if not (s.get("Phone") or "").strip())
    warnings = []
    if no_name:
        warnings.append(f"{no_name} store(s) have no name")
    if no_coords:
        warnings.append(f"{no_coords} store(s) have missing or invalid coordinates")
    if no_address:
        warnings.append(f"{no_address} store(s) have no address")
    if no_phone:
        warnings.append(f"{no_phone} store(s) have no phone number")
    return warnings
from pattern_detector import detect_data_pattern
from data_normalizer import batch_normalize, write_normalized_csv
from validate_csv import CSVValidator, DEFAULT_REQUIRED
from extraction_techniques import (
    extract_stores_from_html_generic,
    enrich_stores_from_detail_pages,
    compute_extraction_metrics,
    run_extraction_with_techniques,
)


def fetch_data(url: str, headers: Optional[Dict] = None, timeout: int = DEFAULT_REQUEST_TIMEOUT, retries: int = DEFAULT_RETRIES) -> Any:
    """
    Fetch data from URL with retry logic and configurable timeout
    
    Args:
        url: URL to fetch
        headers: Optional custom headers
        timeout: Request timeout in seconds (default: 120)
        retries: Number of retry attempts (default: 3)
    
    Returns:
        Parsed JSON data or HTML/text content
    """
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
    
    log_debug(f"Fetching data from: {url[:100]}...", "DEBUG")
    start_time = time.time()
    
    # Default headers
    default_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    
    # Merge with custom headers if provided
    if headers:
        default_headers.update(headers)
    
    # Create session with retry strategy
    session = requests.Session()
    
    # Configure retry strategy
    retry_strategy = Retry(
        total=retries,
        backoff_factor=DEFAULT_BACKOFF_FACTOR,
        status_forcelist=[429, 500, 502, 503, 504],  # Retry on these status codes
        allowed_methods=["GET", "HEAD"]  # Only retry safe methods
    )
    
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    
    # Attempt request with retries
    last_error = None
    for attempt in range(retries + 1):
        try:
            if attempt > 0:
                wait_time = 2 ** attempt  # Exponential backoff: 2, 4, 8 seconds
                log_debug(f"Retry attempt {attempt}/{retries} after {wait_time}s...", "WARN")
                time.sleep(wait_time)
            
            response = session.get(url, timeout=timeout, headers=default_headers)
            response.raise_for_status()
            
            elapsed = time.time() - start_time
            log_debug(f"Response received: {response.status_code} | Size: {len(response.content)} bytes | Time: {elapsed:.2f}s", "DEBUG")
            
            try:
                data = response.json()
                log_debug(f"Response type: JSON | Top-level keys: {list(data.keys()) if isinstance(data, dict) else 'array'}", "DEBUG")
                return data
            except (ValueError, json.JSONDecodeError):
                # Try JSONP (e.g. callback([...]) or SMcallback2([...]))
                data = _parse_jsonp(response.text)
                if data is not None:
                    log_debug(f"Response type: JSONP | Parsed successfully", "DEBUG")
                    return data
                log_debug(f"Response type: HTML/Text | Length: {len(response.text)} chars", "DEBUG")
                return response.text
                
        except requests.exceptions.Timeout as e:
            last_error = e
            if attempt < retries:
                log_debug(f"Request timed out after {timeout}s (attempt {attempt + 1}/{retries + 1})", "WARN")
                continue
            else:
                log_debug(f"Request timed out after {retries + 1} attempts", "ERROR")
                raise
        except requests.exceptions.RequestException as e:
            last_error = e
            if attempt < retries:
                log_debug(f"Request failed: {str(e)[:100]} (attempt {attempt + 1}/{retries + 1})", "WARN")
                continue
            else:
                raise
    
    # If we get here, all retries failed
    if last_error:
        raise last_error
    raise Exception("Failed to fetch data after all retries")


def _parse_jsonp(text: str):
    """
    Parse JSONP response (e.g. callback([...]) or SMcallback2([...])).
    Returns parsed JSON or None if not valid JSONP.
    """
    text = text.strip()
    start = text.find('(')
    if start == -1:
        return None
    i = start + 1
    depth = 1
    in_string = False
    escape = False
    quote_char = None
    while i < len(text):
        c = text[i]
        if escape:
            escape = False
            i += 1
            continue
        if in_string:
            if c == '\\':
                escape = True
            elif c == quote_char:
                in_string = False
            i += 1
            continue
        if c in '"\'':
            in_string = True
            quote_char = c
            i += 1
            continue
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start + 1:i])
                except json.JSONDecodeError:
                    return None
        i += 1
    return None


def _extract_stores_from_html_cards(soup) -> List[Dict]:
    """
    Generic fallback: extract store/retailer cards from HTML when no API or JSON found.
    Tries multiple patterns to find containers with: heading (name) + address block + optional maps link.
    Works with various page structures (Tailwind, Bootstrap, custom CSS, etc.).
    """
    import re
    stores = []

    def _parse_card(card) -> Optional[Dict]:
        """Parse a single card element into a store dict, or None if invalid."""
        # Name: from h2, h3, or h4 (first one found)
        heading = card.find(['h2', 'h3', 'h4'])
        if not heading:
            return None
        name = heading.get_text(strip=True)
        if not name or len(name) < 2 or len(name) > 120:
            return None
        store = {'Name': name}
        # Address block: p tags (common pattern)
        ps = card.find_all('p')
        if len(ps) >= 1:
            store['Address Line 1'] = ps[0].get_text(strip=True)
        if len(ps) >= 2:
            city_state_zip = ps[1].get_text(strip=True)
            store['City'] = city_state_zip.split(',')[0].strip() if ',' in city_state_zip else city_state_zip
            parts = re.split(r',\s*', city_state_zip, 2)
            if len(parts) >= 2:
                store['State/Province/Region'] = re.sub(r'\s*\d{4,6}(?:-\d{4})?\s*$', '', parts[1]).strip()
            zip_match = re.search(r'\b(\d{4,6}(?:-\d{4})?)\b', city_state_zip)
            if zip_match:
                store['Postal/ZIP Code'] = zip_match.group(1)
        if len(ps) >= 3:
            store['Country'] = ps[2].get_text(strip=True)
        # Coords: Google Maps destination=lat,lng (or maps.google.com, openstreetmap, etc.)
        for link in card.find_all('a', href=True):
            href = link.get('href', '')
            m = re.search(r'destination=([-\d.]+),([-\d.]+)', href)
            if not m:
                m = re.search(r'@([-\d.]+),([-\d.]+)', href)  # Google Maps @lat,lng
            if not m:
                m = re.search(r'!3d([-\d.]+)!4d([-\d.]+)', href)  # Google Maps embed
            if m:
                store['Latitude'] = m.group(1)
                store['Longitude'] = m.group(2)
                break
        if store.get('Name'):
            return store
        return None

    # Strategy 1: Card-like containers (common class patterns)
    card_patterns = [
        lambda c: c and 'group' in str(c) and 'cursor-pointer' in str(c),
        lambda c: c and ('card' in str(c) or 'store-card' in str(c) or 'retailer' in str(c)),
        lambda c: c and ('border' in str(c) or 'rounded') and ('p-4' in str(c) or 'p-5' in str(c) or 'padding' in str(c)),
        lambda c: c and 'location' in str(c).lower() and ('item' in str(c) or 'card' in str(c)),
    ]
    for pattern in card_patterns:
        cards = soup.find_all('div', class_=pattern)
        for card in cards:
            s = _parse_card(card)
            if s:
                stores.append(s)
        if len(stores) >= 2:  # Need at least 2 to confirm we found a list
            return stores
        stores.clear()

    # Strategy 2: Broader search - containers with heading + address-like content
    addr_hint = re.compile(r'\d|street|st\.|ave|road|rd\.|boulevard|blvd|suite|floor|no\.|n°', re.I)
    seen = set()
    for elem in soup.find_all(['div', 'section', 'article']):
        s = _parse_card(elem)
        if s and (s.get('Address Line 1') or s.get('City')):
            text = elem.get_text()
            if addr_hint.search(text) or s.get('Postal/ZIP Code'):
                key = (s.get('Name', ''), s.get('Address Line 1', ''))
                if key not in seen:
                    seen.add(key)
                    stores.append(s)
    if len(stores) >= 2:
        return stores

    return stores


def extract_stores_from_html_js(html_content: str) -> List[Dict]:
    """Extract stores from HTML pages with embedded JavaScript or structured HTML"""
    import re
    
    stores = []
    
    # Method 1: Try to find JSON patterns in HTML (original method)
    pattern = r'"name":"([^"]+)"[^}]*?"cityName":"([^"]*)"[^}]*?"countryName":"([^"]+)"[^}]*?"latitude":([^,]+),"longitude":([^,}]+)'
    matches = re.finditer(pattern, html_content)
    
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
        
        # Map to canonical field names that the normalizer expects
        normalized_store = {
            'Name': store.get('name', ''),
            'City': store.get('cityName', ''),
            'Country': store.get('countryName', ''),
            'Latitude': store.get('latitude', ''),
            'Longitude': store.get('longitude', ''),
            'Address Line 1': store.get('streetAddress') or store.get('address') or store.get('adr', ''),
            'Postal/ZIP Code': store.get('postalCode') or store.get('zipcode', ''),
            'State/Province/Region': store.get('stateName', ''),
            'Phone': store.get('phone', ''),
            'Email': store.get('email', ''),
            'Website': store.get('websiteUrl', ''),
            'Handle': store.get('id', ''),
        }
        
        stores.append(normalized_store)
    
    # Method 2: Try to extract JSON from script tags (e.g., Drupal JSON data)
    if not stores:
        try:
            import json
            from bs4 import BeautifulSoup
            
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # Look for script tags with JSON data (e.g., Drupal settings)
            script_tags = soup.find_all('script', type='application/json')
            
            for script_tag in script_tags:
                try:
                    script_data = json.loads(script_tag.string)
                    
                    # Check for Blancpain points of sale data
                    if isinstance(script_data, dict):
                        # Look for points_of_sale in various possible locations
                        pos_data = None
                        if 'blancpain_points_of_sale' in script_data:
                            pos_data = script_data['blancpain_points_of_sale']
                        elif 'points_of_sale' in script_data:
                            pos_data = script_data['points_of_sale']
                        elif 'data' in script_data and 'points_of_sale' in script_data['data']:
                            pos_data = script_data['data']['points_of_sale']
                        
                        if pos_data and isinstance(pos_data, dict) and 'points_of_sale' in pos_data:
                            pos_list = pos_data['points_of_sale']
                        elif isinstance(pos_data, list):
                            pos_list = pos_data
                        else:
                            continue
                        
                        # Extract stores from the JSON array
                        for pos in pos_list:
                            if not isinstance(pos, dict):
                                continue
                            
                            store = {}
                            
                            # Map fields from JSON to canonical format
                            store['Name'] = pos.get('title', '')
                            store['Address Line 1'] = pos.get('address_1', '')
                            store['Address Line 2'] = pos.get('address_2', '')
                            store['City'] = pos.get('city', '')
                            store['State/Province/Region'] = pos.get('state', '')
                            store['Country'] = pos.get('country', '')
                            store['Postal/ZIP Code'] = pos.get('zip', '')
                            store['Phone'] = pos.get('phone', '')
                            store['Email'] = pos.get('email', '')
                            store['Website'] = pos.get('website', '')
                            
                            # Handle URL (might be relative)
                            url = pos.get('url', '')
                            if url and not url.startswith('http'):
                                url = 'https://www.blancpain.com' + url
                            if url and not store.get('Website'):
                                store['Website'] = url
                            
                            # Handle coordinates (array format: [lng, lat])
                            coords = pos.get('coordinates', [])
                            if isinstance(coords, list) and len(coords) >= 2:
                                store['Longitude'] = str(coords[0])
                                store['Latitude'] = str(coords[1])
                            
                            # Handle ID as handle
                            if pos.get('id'):
                                store['Handle'] = str(pos.get('id'))
                            
                            # Only add if we have at least a name
                            if store.get('Name'):
                                stores.append(store)
                        
                        if stores:
                            log_debug(f"Extracted {len(stores)} stores from JSON script tag", "SUCCESS")
                            break
                            
                except (json.JSONDecodeError, AttributeError, KeyError) as e:
                    continue
            
            # Method 3: Generic HTML fallback - parse store/retailer cards from any page structure
            if not stores:
                stores = _extract_stores_from_html_cards(soup)
                if stores:
                    log_debug(f"Extracted {len(stores)} stores from HTML cards (generic fallback)", "SUCCESS")

            # Method 4: Look for headings with boutique/store names (Blancpain-style)
            if not stores:
                headings = soup.find_all(['h2', 'h3'], string=re.compile(r'Boutique|Store|Retailer', re.I))
                
                for heading in headings:
                    store = {}
                    
                    # Get name from heading
                    name_link = heading.find('a')
                    if name_link:
                        name = name_link.get_text().strip()
                        store['Name'] = name
                        href = name_link.get('href', '')
                        if href and not href.startswith('http'):
                            href = 'https://www.blancpain.com' + href
                        store['Website'] = href
                    else:
                        name = heading.get_text().strip()
                        store['Name'] = name
                    
                    # Extract city and country from name (e.g., "Blancpain Boutique Zürich, Switzerland")
                    name_parts = re.match(r'.*?Boutique\s+([^,]+),?\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)$', name, re.I)
                    if name_parts:
                        store['City'] = name_parts.group(1).strip()
                        store['Country'] = name_parts.group(2).strip()
                    
                    # Get parent container
                    parent = heading.find_parent(['div', 'section', 'article'])
                    if parent:
                        # Get text content, but exclude the heading itself
                        heading_text = heading.get_text()
                        text = parent.get_text()
                        # Remove heading text from parent text to avoid duplication
                        text = text.replace(heading_text, '', 1).strip()
                        
                        # Extract address (look for street patterns, exclude store name)
                        address_patterns = [
                            r'([A-Z][a-z]+.*?(?:Road|Street|Avenue|Rue|Boulevard|Building|Shop|Floor|No-).*?)(?:\n|,|$)',
                            r'(Building No-[0-9]+.*?)(?:\n|,|$)',
                            r'(Shop [A-Z0-9]+.*?)(?:\n|,|$)',
                        ]
                        
                        for pattern in address_patterns:
                            addr_match = re.search(pattern, text, re.MULTILINE)
                            if addr_match:
                                addr = addr_match.group(1).strip()
                                # Clean up address (remove store name if present)
                                addr = re.sub(r'^.*?Boutique\s+', '', addr, flags=re.I)
                                if addr and len(addr) > 5:  # Only use if meaningful
                                    store['Address Line 1'] = addr
                                    break
                        
                        # If city/country not extracted from name, try from text
                        if not store.get('City'):
                            city_country_match = re.search(r'([A-Z][a-z]+(?: [A-Z][a-z]+)?),?\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)', text)
                            if city_country_match:
                                store['City'] = city_country_match.group(1).strip()
                                store['Country'] = city_country_match.group(2).strip()
                        
                        # Extract postal code (4-6 digits)
                        postal_match = re.search(r'\b(\d{4,6})\b', text)
                        if postal_match:
                            store['Postal/ZIP Code'] = postal_match.group(1)
                    
                    # Only add if we have at least a name
                    if store.get('Name'):
                        stores.append(store)
                    
        except ImportError:
            # BeautifulSoup not available, skip HTML parsing
            pass
        except Exception as e:
            log_debug(f"HTML parsing error: {e}", "WARN")
    
    return stores


def scrape_single_call(
    url: str,
    custom_headers: Optional[Dict] = None,
    compare_techniques: bool = False,
) -> Tuple[List[Dict], Optional[Dict[str, Any]]]:
    """Scrape from single endpoint - handles both JSON and HTML"""
    print("📡 Fetching stores...")
    log_debug("Starting single-call scrape strategy", "DEBUG")

    data = fetch_data(url, headers=custom_headers)

    # Try JSON first
    if isinstance(data, (list, dict)):
        if isinstance(data, list):
            log_debug(f"Data is array | Length: {len(data)}", "DEBUG")
            return data, None

        log_debug(f"Data is object | Searching for store array in keys: {list(data.keys())}", "DEBUG")
        nested_paths = ["response.entities", "response.data", "response.results",
                       "response.stores", "data.stores", "data.results"]
        for path in nested_paths:
            keys = path.split('.')
            value = data
            for k in keys:
                if isinstance(value, dict) and k in value:
                    value = value[k]
                else:
                    break
            else:
                if isinstance(value, list):
                    log_debug(f"Found stores array in nested path '{path}' | Length: {len(value)}", "SUCCESS")
                    return value, None

        for key in ["entities", "data", "results", "items", "stores", "locations", "dealers", "retailers"]:
            if key in data and isinstance(data[key], list):
                log_debug(f"Found stores array in key '{key}' | Length: {len(data[key])}", "SUCCESS")
                return data[key], None

        log_debug("No stores array found in standard keys", "WARN")
        return [], None

    # HTML with JS - use multi-technique or single
    log_debug("Attempting HTML/JavaScript extraction", "DEBUG")
    if compare_techniques:
        def _fetch(u):
            r = fetch_data(u, headers=custom_headers)
            return r if isinstance(r, str) else ""
        stores, metrics = run_extraction_with_techniques(
            data,
            extract_html_fn=extract_stores_from_html_js,
            fetch_fn=_fetch,
            is_html=True,
        )
        _print_technique_comparison(metrics)
        return stores, metrics
    # Default: try original, then generic if few stores
    stores = extract_stores_from_html_js(data)
    if len(stores) < 5:
        generic = extract_stores_from_html_generic(data)
        if len(generic) > len(stores):
            log_debug(f"Generic extraction found more stores ({len(generic)} vs {len(stores)})", "SUCCESS")
            stores = generic
    return stores, None


def scrape_radius_expansion(url: str, url_params: Dict, region: str = "world", custom_headers: Optional[Dict] = None) -> List[Dict]:
    """Expand radius-based API using multiple center points worldwide"""
    import requests
    
    print(f"🌍 Radius-based API detected - expanding to {region} using multiple center points")
    
    # Major cities worldwide for maximum coverage
    # These are strategically placed to cover all continents and ensure complete coverage
    major_cities = [
        # Europe (expanded for better coverage)
        ("Paris", 48.8566, 2.3522),
        ("London", 51.5074, -0.1278),
        ("Berlin", 52.5200, 13.4050),
        ("Madrid", 40.4168, -3.7038),
        ("Rome", 41.9028, 12.4964),
        ("Amsterdam", 52.3676, 4.9041),
        ("Vienna", 48.2082, 16.3738),
        ("Zurich", 47.3769, 8.5417),
        ("Moscow", 55.7558, 37.6173),
        ("Stockholm", 59.3293, 18.0686),
        ("Copenhagen", 55.6761, 12.5683),
        ("Warsaw", 52.2297, 21.0122),
        ("Prague", 50.0755, 14.4378),
        ("Athens", 37.9838, 23.7275),
        ("Lisbon", 38.7223, -9.1393),
        ("Dublin", 53.3498, -6.2603),
        ("Brussels", 50.8503, 4.3517),
        ("Oslo", 59.9139, 10.7522),
        ("Helsinki", 60.1699, 24.9384),
        
        # Americas (expanded for better coverage)
        ("New York", 40.7128, -74.0060),
        ("Los Angeles", 34.0522, -118.2437),
        ("Chicago", 41.8781, -87.6298),
        ("San Francisco", 37.7749, -122.4194),
        ("Houston", 29.7604, -95.3698),
        ("Toronto", 43.6532, -79.3832),
        ("Vancouver", 49.2827, -123.1207),
        ("Mexico City", 19.4326, -99.1332),
        ("São Paulo", -23.5505, -46.6333),
        ("Rio de Janeiro", -22.9068, -43.1729),
        ("Buenos Aires", -34.6037, -58.3816),
        ("Miami", 25.7617, -80.1918),
        ("Bogotá", 4.7110, -74.0721),
        ("Lima", -12.0464, -77.0428),
        ("Santiago", -33.4489, -70.6693),
        
        # Asia-Pacific (expanded for better coverage)
        ("Tokyo", 35.6762, 139.6503),
        ("Shanghai", 31.2304, 121.4737),
        ("Beijing", 39.9042, 116.4074),
        ("Hong Kong", 22.3193, 114.1694),
        ("Singapore", 1.3521, 103.8198),
        ("Bangkok", 13.7563, 100.5018),
        ("Kuala Lumpur", 3.1390, 101.6869),
        ("Jakarta", -6.2088, 106.8456),
        ("Manila", 14.5995, 120.9842),
        ("Mumbai", 19.0760, 72.8777),
        ("Delhi", 28.6139, 77.2090),
        ("Bangalore", 12.9716, 77.5946),
        ("Dubai", 25.2048, 55.2708),
        ("Sydney", -33.8688, 151.2093),
        ("Melbourne", -37.8136, 144.9631),
        ("Seoul", 37.5665, 126.9780),
        ("Taipei", 25.0330, 121.5654),
        
        # Middle East & Africa (expanded)
        ("Riyadh", 24.7136, 46.6753),
        ("Jeddah", 21.4858, 39.1925),
        ("Cairo", 30.0444, 31.2357),
        ("Johannesburg", -26.2041, 28.0473),
        ("Cape Town", -33.9249, 18.4241),
        ("Lagos", 6.5244, 3.3792),
        ("Nairobi", -1.2921, 36.8219),
        ("Tel Aviv", 32.0853, 34.7818),
        ("Istanbul", 41.0082, 28.9784),
    ]
    
    # Filter by region if specified
    if region == "north_america":
        major_cities = [c for c in major_cities if c[0] in ["New York", "Los Angeles", "Chicago", "Toronto", "Miami", "Mexico City"]]
    elif region == "europe":
        major_cities = [c for c in major_cities if c[0] in ["Paris", "London", "Berlin", "Madrid", "Rome", "Amsterdam", "Vienna", "Zurich", "Moscow"]]
    elif region == "asia":
        major_cities = [c for c in major_cities if c[0] in ["Tokyo", "Shanghai", "Hong Kong", "Singapore", "Bangkok", "Mumbai", "Dubai", "Seoul", "Taipei"]]
    
    # Extract radius and other params
    radius = url_params.get('r', '2000')  # Default 2000km
    per = url_params.get('per', '50')  # API supports max 50 per page
    lang = url_params.get('l', 'en')
    
    # Remove center point params (q, lat, long) and pagination params (offset) - we'll add our own
    base_params = {k: v for k, v in url_params.items() 
                   if k not in ['q', 'offset', 'qp', 'lat', 'long', 'latitude', 'longitude']}
    
    all_stores = []
    seen_ids = set()
    
    print(f"   Using {len(major_cities)} center points with radius={radius}km")
    print(f"   Starting multi-point radius expansion...")
    
    for i, (city_name, lat, lng) in enumerate(major_cities, 1):
        print(f"   [{i}/{len(major_cities)}] {city_name}...", end=" ", flush=True)
        
        # Fetch all pages from this center point
        offset = 0
        page = 1
        stores_from_city = []
        
        while True:
            params = base_params.copy()
            params['q'] = f"{lat},{lng}"
            params['r'] = radius
            params['per'] = per
            params['offset'] = str(offset)
            if lang:
                params['l'] = lang
            
            try:
                response = requests.get(url.split('?')[0], params=params, timeout=15, headers=custom_headers or {})
                response.raise_for_status()
                data = response.json()
                
                # Extract stores (support nested paths like response.entities)
                entities = []
                if isinstance(data, dict):
                    response_data = data.get('response', data)
                    entities = response_data.get('entities', []) or response_data.get('data', []) or response_data.get('results', [])
                elif isinstance(data, list):
                    entities = data
                
                if not entities:
                    break
                
                # Deduplicate using multiple strategies to ensure no duplicates
                new_stores = []
                for store in entities:
                    if not isinstance(store, dict):
                        continue
                    
                    # Strategy 1: Use profile.meta.id (most reliable)
                    store_id = None
                    profile = store.get('profile', {})
                    if isinstance(profile, dict):
                        meta = profile.get('meta', {})
                        if isinstance(meta, dict):
                            store_id = meta.get('id')
                    
                    # Strategy 2: Use top-level id
                    if not store_id:
                        store_id = store.get('id')
                    
                    # Strategy 3: Use name + address + city (most comprehensive fallback)
                    if not store_id:
                        name = store.get('name') or (profile.get('name') if isinstance(profile, dict) else '')
                        addr = ''
                        city = ''
                        if isinstance(profile, dict):
                            addr_obj = profile.get('address', {})
                            if isinstance(addr_obj, dict):
                                addr = addr_obj.get('line1', '')
                                city = addr_obj.get('city', '')
                        # Normalize for comparison (lowercase, strip whitespace)
                        name = str(name).lower().strip() if name else ''
                        addr = str(addr).lower().strip() if addr else ''
                        city = str(city).lower().strip() if city else ''
                        if name and addr:
                            store_id = f"{name}|{addr}|{city}"
                    
                    # Strategy 4: Use name + coordinates as last resort
                    if not store_id:
                        name = store.get('name') or (profile.get('name') if isinstance(profile, dict) else '')
                        lat = None
                        lng = None
                        if isinstance(profile, dict):
                            geo = profile.get('geocodedCoordinate', {})
                            if isinstance(geo, dict):
                                lat = geo.get('lat')
                                lng = geo.get('long')
                        if name and lat and lng:
                            store_id = f"{str(name).lower().strip()}|{lat}|{lng}"
                    
                    # Add store if unique
                    if store_id:
                        if store_id not in seen_ids:
                            seen_ids.add(store_id)
                            new_stores.append(store)
                        # else: duplicate detected and skipped
                    else:
                        # No ID found - still add it but log warning
                        log_debug(f"Store without ID found: {store.get('name', 'Unknown')}", "WARN")
                        new_stores.append(store)
                
                stores_from_city.extend(new_stores)
                
                # Check if more pages
                count = data.get('response', {}).get('count', len(entities)) if isinstance(data, dict) else len(entities)
                # Continue if we got fewer stores than expected (might be more pages)
                if len(entities) < int(per):
                    # Last page if we got fewer than per-page limit
                    break
                
                # Check if we've reached the total count
                if count and len(stores_from_city) >= int(count):
                    break
                
                offset += int(per)
                page += 1
                
                if page > 100:  # Increased safety limit (was 50) to ensure we get all stores
                    log_debug(f"Reached page limit (100) for {city_name}, stopping", "WARN")
                    break
                
                time.sleep(0.3)
            except Exception as e:
                log_debug(f"Error fetching from {city_name}: {e}", "WARN")
                break
        
        all_stores.extend(stores_from_city)
        print(f"+{len(stores_from_city)} stores (total: {len(all_stores)})")
    
    print(f"   ✅ Multi-point expansion complete: {len(all_stores)} unique stores")
    return all_stores


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
    
    # Use larger grid size to reduce API calls and focus on land areas
    grid_size = DEFAULT_VIEWPORT_GRID_SIZE
    grid_type = "world" if region == "world" else "focused"
    focus_region = None if region == "world" else get_region_preset(region)

    stores = scrape_viewport_api(
        base_url=url.split('?')[0],
        viewport_params=viewport_params,
        grid_type=grid_type,
        grid_size=grid_size,
        data_path="",
        additional_params=additional_params,
        delay_between_requests=DEFAULT_DELAY_BETWEEN_REQUESTS,
        focus_region=focus_region
    )
    
    return stores


def scrape_country_expansion(url: str, url_params: Dict, region: str = "world", countries_dict: Dict = None, brand_config: Dict = None, use_watch_countries: bool = False) -> List[Dict]:
    """Expand country-filter API by iterating through countries, with optional pagination support"""
    import requests
    
    # Try to load comprehensive watch store countries list
    watch_countries_file = os.path.join(os.path.dirname(__file__), "watch_store_countries.json")
    watch_countries_data = None
    if os.path.exists(watch_countries_file):
        try:
            with open(watch_countries_file, 'r') as f:
                watch_countries_data = json.load(f)
        except (OSError, json.JSONDecodeError):
            pass
    
    # Priority: custom countries > watch_store_countries > fallback
    # Use countries from brand config if provided (and not using watch_store_countries)
    if countries_dict and not use_watch_countries:
        countries_list = list(countries_dict.keys())
        country_names = countries_dict
        print(f"🌍 Country filter detected - iterating {len(countries_list)} countries (from brand config)")
    elif use_watch_countries and watch_countries_data and watch_countries_data.get("countries"):
        # Use comprehensive watch store countries list
        all_watch_countries = watch_countries_data["countries"]
        countries_list = list(all_watch_countries.keys())
        country_names = all_watch_countries
        
        # Filter by region if specified
        if region != "world" and watch_countries_data.get("regions") and region in watch_countries_data["regions"]:
            region_codes = watch_countries_data["regions"][region]
            countries_list = [code for code in countries_list if code in region_codes]
            country_names = {code: all_watch_countries[code] for code in countries_list if code in all_watch_countries}
        
        print(f"🌍 Country filter detected - iterating {len(countries_list)} countries (from watch_store_countries.json)")
    else:
        # Fallback to hardcoded list
        all_countries = [
            "US", "CA", "GB", "FR", "DE", "IT", "ES", "CH", "AT", "BE", "NL", "SE", "NO", "DK", "FI",
            "IE", "PT", "GR", "PL", "CZ", "HU", "RO", "BG", "HR", "SI", "SK", "EE", "LV", "LT",
            "JP", "CN", "KR", "TW", "HK", "SG", "MY", "TH", "ID", "PH", "VN", "IN", "AU", "NZ",
            "AE", "SA", "QA", "KW", "BH", "OM", "IL", "TR", "ZA", "EG", "BR", "MX", "AR", "CL", "CO"
        ]
        
        if region == "north_america":
            countries_list = ["US", "CA", "MX"]
        elif region == "europe":
            countries_list = ["GB", "FR", "DE", "IT", "ES", "CH", "AT", "BE", "NL", "SE", "NO", "DK"]
        else:
            countries_list = all_countries
        
        country_names = {code: code for code in countries_list}
        print(f"🌍 Country filter detected - iterating {len(countries_list)} countries")
    
    country_param = None
    qp_param = None
    for key in url_params.keys():
        if "country" in key.lower():
            country_param = key
        if key.lower() == "qp":
            qp_param = key
    if not country_param:
        country_param = "country"

    # OpenCart/other APIs use numeric country_id - map ISO codes via country_id_map
    country_id_map = brand_config.get("country_id_map", {}) if brand_config else {}
    if country_id_map and country_param and "country_id" in country_param.lower():
        countries_list = [c for c in countries_list if c in country_id_map]
        country_names = {c: country_names.get(c, c) for c in countries_list}
        print(f"   Using country_id_map: {len(countries_list)} countries (ISO->numeric)")
    
    # Check if pagination is needed (has offset or per parameter)
    has_pagination = "offset" in url_params or "per" in url_params or "per_page" in url_params
    per_page = int(url_params.get("per", url_params.get("per_page", 50)))
    
    all_stores = []
    seen_ids = set()
    
    for i, country_code in enumerate(countries_list, 1):
        country_name = country_names.get(country_code, country_code)
        param_value = country_id_map.get(country_code, country_code) if country_id_map else country_code

        # Handle pagination for this country
        if has_pagination:
            offset = 0
            country_stores = []
            
            while True:
                params = url_params.copy()
                params[country_param] = param_value
                if qp_param:
                    params[qp_param] = country_name
                if "offset" in url_params:
                    params["offset"] = str(offset)
                
                try:
                    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
                    if brand_config and brand_config.get("headers"):
                        headers.update(brand_config["headers"])
                    
                    response = requests.get(url.split('?')[0], params=params, timeout=30, headers=headers)
                    response.raise_for_status()
                    data = response.json()
                    
                    # Extract stores using data_path from brand_config if available
                    stores = []
                    if brand_config and brand_config.get("data_path"):
                        data_path = brand_config["data_path"].split(".")
                        current = data
                        for key in data_path:
                            if isinstance(current, dict):
                                current = current.get(key)
                            else:
                                current = None
                                break
                        if isinstance(current, list):
                            stores = current
                    else:
                        # Fallback: try common paths
                        if isinstance(data, list):
                            stores = data
                        elif isinstance(data, dict):
                            response_data = data.get('response', data)
                            stores = response_data.get('entities', []) or response_data.get('results', []) or response_data.get('data', [])
                    
                    if not stores:
                        break
                    
                    country_stores.extend(stores)
                    
                    # Check if we've reached the end
                    total_count = data.get('response', {}).get('count', 0) if isinstance(data, dict) else 0
                    if len(stores) < per_page or (total_count > 0 and len(country_stores) >= total_count):
                        break
                    
                    offset += per_page
                    time.sleep(0.5)  # Rate limiting
                    
                except Exception as e:
                    log_debug(f"Error fetching {country_code} offset {offset}: {e}", "WARN")
                    break
            
            # Deduplicate stores for this country
            new_stores = 0
            for store in country_stores:
                store_id = None
                if isinstance(store, dict):
                    # Try multiple ID extraction strategies
                    profile = store.get('profile', {})
                    if isinstance(profile, dict):
                        meta = profile.get('meta', {})
                        if isinstance(meta, dict):
                            store_id = meta.get('id')
                    if not store_id:
                        store_id = store.get('id') or store.get('uid') or store.get('entityId')
                    if not store_id:
                        # Use name + address as fallback
                        name = store.get('name') or (profile.get('name') if isinstance(profile, dict) else '')
                        addr = ''
                        if isinstance(profile, dict):
                            addr_obj = profile.get('address', {})
                            if isinstance(addr_obj, dict):
                                addr = addr_obj.get('line1', '')
                        if name and addr:
                            store_id = f"{name}|{addr}"
                
                if store_id and store_id not in seen_ids:
                    all_stores.append(store)
                    seen_ids.add(store_id)
                    new_stores += 1
            
            if new_stores > 0:
                print(f"  [{i}/{len(countries_list)}] {country_code}: +{new_stores} stores (total: {len(all_stores)})")
        else:
            # No pagination - single request per country
            params = url_params.copy()
            params[country_param] = param_value
            if qp_param:
                params[qp_param] = country_name
            
            try:
                headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
                if brand_config and brand_config.get("headers"):
                    headers.update(brand_config["headers"])
                
                response = requests.get(url.split('?')[0], params=params, timeout=30, headers=headers)
                response.raise_for_status()
                data = response.json()
                
                # Extract stores
                stores = []
                if brand_config and brand_config.get("data_path"):
                    data_path = brand_config["data_path"].split(".")
                    current = data
                    for key in data_path:
                        if isinstance(current, dict):
                            current = current.get(key)
                        else:
                            current = None
                            break
                    if isinstance(current, list):
                        stores = current
                else:
                    if isinstance(data, list):
                        stores = data
                    elif isinstance(data, dict):
                        response_data = data.get('response', data)
                        stores = response_data.get('entities', []) or response_data.get('results', []) or response_data.get('data', [])
                
                new_stores = 0
                for store in stores:
                    store_id = store.get("id") or store.get("store_id") or str(store)
                    if store_id not in seen_ids:
                        all_stores.append(store)
                        seen_ids.add(store_id)
                        new_stores += 1
                
                if new_stores > 0:
                    print(f"  [{i}/{len(countries_list)}] {country_code}: +{new_stores} stores (total: {len(all_stores)})")
                
                time.sleep(0.3)
            
            except Exception as e:
                log_debug(f"Error fetching {country_code}: {e}", "WARN")
                continue
    
    return all_stores


def scrape_paginated(url: str, url_params: Dict, is_token_based: bool = False, custom_headers: Optional[Dict] = None) -> List[Dict]:
    """Expand paginated API by following all pages (supports both page numbers, tokens, and offset)"""
    import requests
    
    print("📄 Pagination detected - following pages")
    
    # Check if this is token-based pagination (pageToken) or number-based (page)
    # Can be passed explicitly or detected from URL params
    if not is_token_based:
        is_token_based = any("token" in k.lower() for k in url_params.keys())
    
    page_param = None
    limit_param = None
    token_param = None
    offset_param = None
    
    for key in url_params.keys():
        if "page" in key.lower() and "token" not in key.lower():
            page_param = key
        if "token" in key.lower():
            token_param = key
            is_token_based = True
        if "limit" in key.lower() or "per_page" in key.lower() or key.lower() == "per":
            limit_param = key
        if key.lower() == "offset":
            offset_param = key
    
    if not page_param and not is_token_based and not offset_param:
        page_param = "page"
    if not token_param and is_token_based:
        token_param = "pageToken"
    if not limit_param:
        limit_param = "limit"
    if not offset_param and "offset" in str(url_params):
        offset_param = "offset"
    
    if limit_param and limit_param not in url_params:
        url_params[limit_param] = 50  # Default limit
    
    # Prepare headers
    request_headers = {"User-Agent": "Mozilla/5.0"}
    if custom_headers:
        request_headers.update(custom_headers)
    
    all_stores = []
    page = 1
    page_token = None
    offset = 0
    max_pages = 1000
    seen_ids = set()  # For deduplication
    
    while page <= max_pages:
        params = url_params.copy()
        
        if is_token_based:
            # Token-based pagination
            if page_token:
                params[token_param] = page_token
            # Remove page number and offset params if they exist
            if page_param and page_param in params:
                del params[page_param]
            if offset_param and offset_param in params:
                del params[offset_param]
        elif offset_param:
            # Offset-based pagination
            params[offset_param] = offset
            # Remove page number param if it exists
            if page_param and page_param in params:
                del params[page_param]
        else:
            # Number-based pagination
            params[page_param] = page
            # Remove token and offset params if they exist
            if token_param and token_param in params:
                del params[token_param]
            if offset_param and offset_param in params:
                del params[offset_param]
        
        try:
            response = requests.get(url.split('?')[0], params=params, timeout=15, headers=request_headers)
            response.raise_for_status()
            data = response.json()
            
            # Extract stores from response (support nested paths like response.entities)
            stores = []
            if isinstance(data, list):
                stores = data
            elif isinstance(data, dict):
                # Try common keys for store arrays (including nested paths)
                for key_path in ["response.entities", "response.data", "response.results", 
                                "entities", "data", "results", "items", "stores", "locations"]:
                    keys = key_path.split('.')
                    value = data
                    for k in keys:
                        if isinstance(value, dict) and k in value:
                            value = value[k]
                        else:
                            break
                    else:
                        if isinstance(value, list):
                            stores = value
                            break
                else:
                    stores = []
            else:
                stores = []
            
            if not stores:
                break
            
            # Deduplicate stores
            new_stores = []
            for store in stores:
                # Try to get unique ID (handle nested structures)
                store_id = None
                if isinstance(store, dict):
                    # Try various ID paths
                    profile = store.get('profile', {})
                    if isinstance(profile, dict):
                        meta = profile.get('meta', {})
                        if isinstance(meta, dict):
                            store_id = meta.get('id')
                    
                    if not store_id:
                        store_id = store.get('id')
                    
                    if not store_id:
                        meta = store.get('meta', {})
                        if isinstance(meta, dict):
                            store_id = meta.get('id')
                    
                    # Fallback to name + address for uniqueness
                    if not store_id:
                        name = store.get('name') or (profile.get('name') if isinstance(profile, dict) else '')
                        address = ''
                        if isinstance(profile, dict):
                            addr = profile.get('address', {})
                            if isinstance(addr, dict):
                                address = addr.get('line1', '')
                        elif isinstance(store.get('address'), dict):
                            address = store.get('address', {}).get('line1', '')
                        store_id = f"{name}|{address}"
                
                if store_id and store_id not in seen_ids:
                    seen_ids.add(store_id)
                    new_stores.append(store)
                elif not store_id:
                    # If no ID found, still add it (might be first occurrence)
                    new_stores.append(store)
            
            all_stores.extend(new_stores)
            print(f"  Page {page}: +{len(new_stores)} stores (total: {len(all_stores)})")
            
            # Check for pagination continuation
            if isinstance(data, dict):
                # Token-based: check for next token
                if is_token_based:
                    page_token = data.get(token_param) if token_param else data.get("pageToken")
                    if not page_token:
                        break  # No more pages
                elif offset_param:
                    # Offset-based: check total count
                    response_data = data.get('response', data)
                    total = response_data.get('count') or response_data.get('total') or response_data.get('totalCount')
                    if total and len(all_stores) >= int(total):
                        break
                    # Get limit value (handle string/int conversion)
                    limit_val = 50
                    if limit_param:
                        limit_val = int(url_params.get(limit_param, 50))
                    if len(new_stores) < limit_val:
                        break  # Last page
                    offset += limit_val
                else:
                    # Number-based: check for has_more, next, or total
                    if "has_more" in data and not data["has_more"]:
                        break
                    if "next" in data and not data["next"]:
                        break
                    total = data.get("total") or data.get("count")
                    if total and len(all_stores) >= total:
                        break
            
            page += 1
            time.sleep(0.3)
            
        except Exception as e:
            log_debug(f"Pagination error on page {page}: {e}", "WARN")
            break
    
    return all_stores


def universal_scrape(
    url: str,
    output_file: str = "output/stores.csv",
    region: str = "world",
    force_type: Optional[str] = None,
    validate_output: bool = True,
    brand_config: Optional[Dict] = None,
    compare_techniques: bool = False,
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
        "output_file": output_file,
        "technique_metrics": None,  # Populated when compare_techniques=True
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
    
    # Check if custom headers are needed for initial fetch (e.g., Bell & Ross requires Accept: application/json)
    initial_headers = None
    if "bellross.com" in url or "stores.bellross.com" in url:
        initial_headers = {"Accept": "application/json"}
    
    try:
        log_debug("Fetching sample data for detection...", "DEBUG")
        sample_data = fetch_data(url, headers=initial_headers)
        log_debug(f"Sample data retrieved successfully", "SUCCESS")
    except Exception as e:
        log_debug(f"Failed to fetch sample data: {e}", "ERROR")
        print(f"❌ Failed to fetch: {e}")
        return results
    
    # Detect locator type
    log_debug("Running locator type detection...", "DEBUG")
    locator_analysis = detect_locator_type(url, sample_data)
    if not force_type:
        detected_type = locator_analysis["detected_type"]
        is_region_specific = locator_analysis["is_region_specific"]
        log_debug(f"Detected type: {detected_type} | Region-specific: {is_region_specific}", "DEBUG")
    else:
        detected_type = force_type
        is_region_specific = force_type in ["viewport", "country_filter", "radius_search"]
        locator_analysis["detected_type"] = detected_type
        locator_analysis["is_region_specific"] = is_region_specific
        log_debug(f"Forced type: {detected_type} | Region-specific: {is_region_specific}", "DEBUG")
    
    results["detected_type"] = detected_type
    results["is_region_specific"] = is_region_specific
    
    print(f"   Type: {detected_type}")
    print(f"   Region-specific: {is_region_specific}")
    
    # Detect field mapping (use brand config if provided, otherwise auto-detect)
    log_debug("Running field mapping detection...", "DEBUG")
    
    if brand_config and brand_config.get("field_mapping"):
        # Use field mapping from brand config
        field_mapping = brand_config.get("field_mapping", {})
        log_debug(f"Using field mapping from brand config: {len(field_mapping)} fields", "DEBUG")
        print(f"   Field mapping: From brand config ({len(field_mapping)} fields)")
    else:
        # Auto-detect field mapping
        pattern = detect_data_pattern(url, sample_data)
        field_mapping = pattern.get("field_mapping", {})
        
        # Handle HTML pages where pattern detection may not work
        is_html_page = isinstance(sample_data, str) and not isinstance(sample_data, (list, dict))
        if is_html_page and not field_mapping:
            log_debug("HTML page detected - pattern detection skipped (will use HTML extraction)", "DEBUG")
            print(f"   Field mapping: HTML/JavaScript extraction (auto-detected)")
        else:
            confidence = pattern.get('mapping_score', {}).get('confidence', 'unknown')
            log_debug(f"Field mapping confidence: {confidence}", "DEBUG")
            log_debug(f"Mapped fields: {len(field_mapping)} | Fields: {list(field_mapping.keys())[:5]}...", "DEBUG")
            print(f"   Field mapping: {confidence.upper()} confidence")
    print()
    
    # Step 2: Scrape with appropriate strategy
    print("📡 Scraping...")
    log_debug("PHASE 2: Data Collection", "INFO")
    scrape_start = time.time()
    
    # Check URL params for radius-based detection (used in multiple branches)
    url_params = locator_analysis["url_params"]
    has_radius = "r" in url_params or "radius" in url_params or "distance" in url_params
    has_center = "q" in url_params or "lat" in url_params or "latitude" in url_params
    
    try:
        if detected_type == "paginated":
            # Pagination (check this first before single_call)
            log_debug("Strategy: Paginated scraping", "INFO")
            
            # Check if this is actually a radius-based API that needs multi-point expansion
            # Some APIs use pagination but need multiple center points for worldwide coverage
            # Support both q=... and lat/long=... center point formats
            # If paginated endpoint has radius and center params, treat it as radius-based
            is_radius_based = has_radius and has_center
            
            if is_radius_based:
                # Use radius expansion instead of simple pagination
                log_debug("Radius-based pagination detected - using multi-point expansion", "INFO")
                custom_headers = {"Accept": "application/json"} if "bellross.com" in url else None
                stores = scrape_radius_expansion(url, url_params, region, custom_headers=custom_headers)
                results["expansion_used"] = True
            else:
                # Standard pagination
                is_token_based = locator_analysis.get("has_token_pagination", False) or "pageToken" in str(sample_data)
                if is_token_based:
                    log_debug("Token-based pagination detected (using pageToken)", "DEBUG")
                
                # Check if custom headers are needed (e.g., Accept: application/json for Bell & Ross)
                custom_headers = None
                if "bellross.com" in url or "stores.bellross.com" in url:
                    custom_headers = {"Accept": "application/json"}
                    log_debug("Adding Accept: application/json header for Bell & Ross API", "DEBUG")
                
                stores = scrape_paginated(url, url_params, is_token_based=is_token_based, custom_headers=custom_headers)
                results["expansion_used"] = True
        
        elif detected_type == "viewport":
            # Viewport expansion
            log_debug(f"Strategy: Viewport expansion (region={region})", "INFO")
            stores = scrape_viewport_expansion(url, locator_analysis["url_params"], region)
            results["expansion_used"] = True
        
        elif detected_type == "radius" or (has_radius and has_center):
            # Radius-based API - use multi-point expansion
            log_debug("Strategy: Radius-based multi-point expansion", "INFO")
            custom_headers = {"Accept": "application/json"} if "bellross.com" in url or "stores.bellross.com" in url else None
            stores = scrape_radius_expansion(url, url_params, region, custom_headers=custom_headers)
            results["expansion_used"] = True
        
        elif detected_type == "country_filter":
            # Country expansion
            log_debug(f"Strategy: Country iteration (region={region})", "INFO")
            
            # Priority order for country list:
            # 1. Brand config with use_watch_store_countries: true -> use comprehensive list
            # 2. Brand config with custom countries -> use custom list
            # 3. Auto-detect: use comprehensive list by default for country-based endpoints
            countries_dict = None
            use_watch_countries = False
            
            if brand_config:
                # Check if brand config explicitly wants comprehensive list
                if brand_config.get("use_watch_store_countries", False):
                    use_watch_countries = True
                    log_debug("Using comprehensive watch store countries (from brand config)", "DEBUG")
                # Or if custom countries provided
                elif brand_config.get("countries"):
                    countries_dict = brand_config.get("countries")
                    log_debug(f"Using countries from brand config: {len(countries_dict)} countries", "DEBUG")
            
            # Auto-apply comprehensive list if no brand config preference and country_filter detected
            if not countries_dict and not use_watch_countries:
                use_watch_countries = True
                log_debug("Auto-applying comprehensive watch store countries (country_filter detected)", "DEBUG")
                print("   💡 Auto-detected country-based endpoint - using comprehensive 88-country list")
            
            stores = scrape_country_expansion(url, locator_analysis["url_params"], region, 
                                             countries_dict=countries_dict, brand_config=brand_config,
                                             use_watch_countries=use_watch_countries)
            results["expansion_used"] = True
        
        elif not is_region_specific or detected_type == "single_call":
            # Single call
            log_debug("Strategy: Single API call", "INFO")
            custom_headers = None
            if "bellross.com" in url or "stores.bellross.com" in url:
                custom_headers = {"Accept": "application/json"}
            stores, tech_metrics = scrape_single_call(url, custom_headers=custom_headers, compare_techniques=compare_techniques)
            results["technique_metrics"] = tech_metrics
            results["expansion_used"] = False

        else:
            # Default to single call
            log_debug("Strategy: Default single call", "INFO")
            custom_headers = None
            if "bellross.com" in url or "stores.bellross.com" in url:
                custom_headers = {"Accept": "application/json"}
            stores, tech_metrics = scrape_single_call(url, custom_headers=custom_headers, compare_techniques=compare_techniques)
            results["technique_metrics"] = tech_metrics
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
    
    # Add base URL for resolving partial store URLs (e.g. Bulgari: en-us/storelocator/...)
    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}/" if parsed.scheme and parsed.netloc else None
    if base_url:
        field_mapping = dict(field_mapping)  # Copy so we don't mutate brand config
        field_mapping["_base_url"] = base_url
    
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
    
    # Step 5: Validate and Auto-Fix Data Quality Issues
    if validate_output:
        print("📋 Validating and fixing data quality issues...")
        try:
            # Use CSVValidator with auto-fix enabled to clean up common issues
            validator = CSVValidator(
                required_headers=DEFAULT_REQUIRED,
                warn_duplicates=True,
                fail_duplicates=False,
                show_bad=False
            )
            
            # Auto-fix data quality issues (backslashes, control characters, etc.)
            exit_code = validator.validate_file(output_file, auto_fix=True)
            
            # Remove duplicates if any were found
            duplicates_removed = validator.remove_duplicates_from_file(output_file)
            if duplicates_removed > 0:
                print(f"   🔧 Removed {duplicates_removed} duplicate row(s)")
            
            # Re-validate after fixes
            validator = CSVValidator(
                required_headers=DEFAULT_REQUIRED,
                warn_duplicates=True,
                fail_duplicates=False,
                show_bad=False
            )
            exit_code = validator.validate_file(output_file, auto_fix=False)
            
            results["validation_performed"] = True
            results["validation_passed"] = len(validator.errors) == 0
            results["validation_warnings"] = len(validator.warnings)
            results["duplicates_removed"] = duplicates_removed
            results["validation_errors"] = len(validator.errors)
            
            if len(validator.errors) == 0:
                if len(validator.warnings) > 0:
                    print(f"   ✅ Valid (with {len(validator.warnings)} warning(s))")
                else:
                    print(f"   ✅ Valid")
            else:
                print(f"   ⚠️  Has {len(validator.errors)} error(s), {len(validator.warnings)} warning(s)")
                # Print detailed validation errors so users can see what's wrong
                print(f"\n   📋 Validation Error Details:")
                # Group errors by type for better readability
                error_groups = {}
                for error in validator.errors:
                    error_type = error.issue
                    if error_type not in error_groups:
                        error_groups[error_type] = []
                    error_groups[error_type].append(error)
                
                # Show first 10 errors of each type
                for error_type, errors in error_groups.items():
                    print(f"      • {error_type.upper().replace('_', ' ')}: {len(errors)} occurrence(s)")
                    for error in errors[:10]:
                        value_preview = f" (value: {error.value})" if error.value else ""
                        print(f"        - Row {error.row}: {error.field}{value_preview}")
                    if len(errors) > 10:
                        print(f"        ... and {len(errors) - 10} more")
                
                if len(validator.warnings) > 0:
                    print(f"\n   ⚠️  Warnings: {len(validator.warnings)} warning(s)")
                    # Show first 5 warnings
                    for warning in validator.warnings[:5]:
                        print(f"      - {warning}")
                    if len(validator.warnings) > 5:
                        print(f"      ... and {len(validator.warnings) - 5} more")
        except Exception as e:
            results["validation_performed"] = True
            results["validation_passed"] = False
            results["validation_error"] = str(e)
            print(f"   ⚠️  Validation error: {e}")
        print()
    else:
        results["validation_performed"] = False
    
    results["success"] = True
    
    # Collect data-quality warnings from normalized output
    warnings_summary = _collect_data_quality_warnings(normalized)
    results["warnings"] = warnings_summary
    
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
    if warnings_summary:
        log_debug("", "INFO")
        log_debug("WARNINGS (data quality):", "INFO")
        for msg in warnings_summary:
            log_debug(f"  ⚠️  {msg}", "INFO")
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
    parser.add_argument('--brand-config', help='Brand configuration JSON string (for field mapping)')
    parser.add_argument('--compare-techniques', action='store_true',
                        help='Run multiple extraction techniques and compare data quality (HTML pages only)')
    args = parser.parse_args()
    
    # Parse brand config if provided
    brand_config = None
    if args.brand_config:
        try:
            brand_config = json.loads(args.brand_config)
        except json.JSONDecodeError:
            print(f"⚠️  Warning: Invalid brand-config JSON, ignoring")
            brand_config = None
    
    # Run universal scraper
    results = universal_scrape(
        url=args.url,
        output_file=args.output,
        region=args.region,
        force_type=args.type,
        validate_output=not args.no_validate,
        brand_config=brand_config,
        compare_techniques=args.compare_techniques,
    )
    
    # Summary
    print("=" * 80)
    if results["success"]:
        print("✅ SUCCESS")
        print(f"   Type: {results['detected_type']}")
        print(f"   Expansion: {'Yes' if results['expansion_used'] else 'No'}")
        print(f"   Stores: {results['stores_found']} found, {results['stores_normalized']} normalized")
        print(f"   Output: {results['output_file']}")
        warnings = results.get("warnings", [])
        if warnings:
            print()
            print("⚠️  WARNINGS (data quality):")
            for msg in warnings:
                print(f"   • {msg}")
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

