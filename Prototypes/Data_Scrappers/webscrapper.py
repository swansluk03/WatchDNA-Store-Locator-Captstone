#!/usr/bin/env python3
"""
Unified Web Scraper - handles both JSON APIs and HTML pages
"""
import requests
from bs4 import BeautifulSoup
import csv
import os
from data_normalizer import batch_normalize, write_normalized_csv, SCHEMA

# Session setup for HTML scraping
session = requests.Session()
session.headers.update({"User-Agent": "WatchDNA-485/1.0"})
from requests.adapters import HTTPAdapter, Retry
session.mount("https://", HTTPAdapter(max_retries=Retry(total=3, backoff_factor=0.5)))


# ============================================================================
# JSON API SCRAPING
# ============================================================================

def get_nested_value(obj, path):
    """
    Extract nested value from dict using dot notation path
    
    Args:
        obj: Dictionary to extract from
        path: Dot-notation path (e.g., "location.address.street")
    
    Returns:
        Value at path or None if not found
    """
    if not path or not obj:
        return None
    
    keys = path.split('.')
    value = obj
    
    for key in keys:
        if isinstance(value, dict):
            value = value.get(key)
            if value is None:
                return None
        else:
            return None
    
    return value


def extract_hours_from_details(store_data):
    """
    Extract store hours from hoursTranslatedDetails array (Rolex API format)
    
    Args:
        store_data: Store data dict that may contain hoursTranslatedDetails
    
    Returns:
        Dict with Monday-Sunday keys and hour strings as values
    """
    hours = {}
    details = store_data.get('hoursTranslatedDetails', [])
    
    if not isinstance(details, list):
        return hours
    
    # Map day names to our canonical day names
    day_map = {
        'mon': 'Monday',
        'tue': 'Tuesday', 
        'wed': 'Wednesday',
        'thu': 'Thursday',
        'fri': 'Friday',
        'sat': 'Saturday',
        'sun': 'Sunday'
    }
    
    for day_info in details:
        if not isinstance(day_info, dict):
            continue
            
        day_name = day_info.get('dayNameTranslated', '').lower()
        hours_str = day_info.get('hoursDayTranslated', '').strip()
        
        # Map to canonical day name
        canonical_day = day_map.get(day_name[:3])  # Use first 3 chars
        if canonical_day:
            hours[canonical_day] = hours_str
    
    return hours


def scrape_json(api_url, field_mapping, data_path="stores"):
    """
    Fully dynamic JSON API scraper - works with ANY API structure
    
    Args:
        api_url: URL of the JSON API (required)
        field_mapping: Dict mapping canonical fields to API field names (required)
                      Supports nested paths with dot notation: "location.address.city"
                      Supports fallback arrays: {"Name": ["storeName", "name"]}
        data_path: Path to the array of stores in the JSON response
                  Supports dot notation: "data.locations.stores"
                  Default: "stores"
    
    Returns:
        List of normalized location dictionaries
    """
    if not field_mapping:
        print("❌ Error: field_mapping is required for JSON scraping")
        print("   Provide a dict mapping canonical fields to API field names")
        print("   Example: {'Name': 'storeName', 'City': 'cityName'}")
        return []
    
    try:
        resp = requests.get(api_url, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        print(f"❌ Failed to fetch JSON from {api_url}: {e}")
        return []

    try:
        json_data = resp.json()
    except Exception:
        print("❌ Response is not valid JSON")
        return []

    # Extract stores array using data_path
    if data_path:
        stores = get_nested_value(json_data, data_path)
        if stores is None:
            # Try direct access if dot notation failed
            stores = json_data.get(data_path, [])
    else:
        # If no data_path, assume response is the array itself
        stores = json_data if isinstance(json_data, list) else []
    
    if not stores:
        print(f"⚠️  No stores found at path: {data_path}")
        print(f"   Available keys: {list(json_data.keys()) if isinstance(json_data, dict) else 'N/A'}")
        return []
    
    if not isinstance(stores, list):
        print(f"❌ Data at path '{data_path}' is not a list")
        return []
    
    print(f"✅ Found {len(stores)} stores in JSON response")
    
    # Pre-process: Extract hours if hoursTranslatedDetails exists (e.g., Rolex API)
    for store in stores:
        if 'hoursTranslatedDetails' in store:
            hours_data = extract_hours_from_details(store)
            # Add hours directly to store data before normalization
            store.update(hours_data)
    
    # Normalize using the definitive algorithm with provided field mapping
    results = batch_normalize(stores, field_mapping)
    
    return results


# ============================================================================
# HTML SCRAPING
# ============================================================================

def extract_element_value(element, selector_config):
    """
    Extract value from an element based on selector configuration
    
    Args:
        element: BeautifulSoup element
        selector_config: Can be:
            - str: CSS selector (returns text)
            - str with |attr: CSS selector with attribute (e.g., "a|href")
            - dict: {"selector": "...", "attribute": "...", "multiple": True/False}
    
    Returns:
        Extracted value (string or list if multiple=True)
    """
    if not selector_config:
        return ""
    
    # Handle string selectors with optional attribute extraction
    if isinstance(selector_config, str):
        # Check for pipe notation: "selector|attribute"
        if "|" in selector_config:
            selector, attr = selector_config.split("|", 1)
            elem = element.select_one(selector)
            if elem:
                return elem.get(attr, "")
            return ""
        else:
            # Just text extraction
            elem = element.select_one(selector_config)
            return elem.get_text(strip=True) if elem else ""
    
    # Handle dict configuration
    if isinstance(selector_config, dict):
        selector = selector_config.get("selector", "")
        attribute = selector_config.get("attribute")
        multiple = selector_config.get("multiple", False)
        
        if multiple:
            # Return list of values
            elements = element.select(selector)
            if attribute:
                return [e.get(attribute, "") for e in elements if e.get(attribute)]
            else:
                return [e.get_text(strip=True) for e in elements if e.get_text(strip=True)]
        else:
            # Return single value
            elem = element.select_one(selector)
            if elem:
                if attribute:
                    return elem.get(attribute, "")
                return elem.get_text(strip=True)
            return ""
    
    return ""


def scrape_html(locator_url, card_selector, field_selectors, data_attributes=None):
    """
    Fully dynamic HTML scraper - works with ANY website structure
    
    Args:
        locator_url: URL of the HTML page (required)
        card_selector: CSS selector for store cards (required)
        field_selectors: Dict mapping canonical fields to CSS selectors (required)
            Examples:
                {"Name": ".store-name"}
                {"Website": "a.website|href"}  # Extract href attribute
                {"Tags": {"selector": ".tag", "multiple": True}}
        data_attributes: Dict mapping canonical fields to HTML data attributes
            Example: {"Latitude": "data-lat", "Longitude": "data-lng"}
    
    Returns:
        List of normalized location dictionaries
    """
    if not card_selector:
        print("❌ Error: card_selector is required for HTML scraping")
        print("   Specify the CSS selector for store/location cards")
        return []
    
    if not field_selectors:
        print("❌ Error: field_selectors is required for HTML scraping")
        print("   Provide a dict mapping canonical fields to CSS selectors")
        return []
    
    # Retry-capable session
    sess = requests.Session()
    sess.headers.update({"User-Agent": "WatchDNA-485/1.0 (+scraper)"})
    adapter = HTTPAdapter(max_retries=Retry(total=3, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504]))
    sess.mount("http://", adapter)
    sess.mount("https://", adapter)

    # Fetch
    try:
        resp = sess.get(locator_url, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        print(f"❌ Failed to fetch HTML from {locator_url}: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")

    # Find store cards using provided selector
    store_cards = soup.select(card_selector) or []
    
    if not store_cards:
        print(f"⚠️  No store cards found with selector: {card_selector}")
        return []

    print(f"✅ Found {len(store_cards)} store cards")
    raw_results = []

    for card in store_cards:
        row = {}

        # Extract fields using provided selectors
        for field_name, selector_config in field_selectors.items():
            row[field_name] = extract_element_value(card, selector_config)
        
        # Extract data attributes if provided
        if data_attributes:
            for field_name, attr_name in data_attributes.items():
                value = card.get(attr_name, "")
                if value:
                    row[field_name] = value
        
        # Extract page-level metadata (optional, uses common patterns)
        if "Meta Title" not in row or not row.get("Meta Title"):
            og_title = soup.select_one('meta[property="og:title"]')
            if og_title and og_title.has_attr("content"):
                row["Meta Title"] = og_title.get("content", "")
            else:
                title_tag = soup.select_one("title")
                if title_tag:
                    row["Meta Title"] = title_tag.get_text(strip=True)
        
        if "Meta Description" not in row or not row.get("Meta Description"):
            og_desc = soup.select_one('meta[property="og:description"]')
            if og_desc and og_desc.has_attr("content"):
                row["Meta Description"] = og_desc.get("content", "")
            else:
                meta_desc = soup.select_one('meta[name="description"]')
                if meta_desc and meta_desc.has_attr("content"):
                    row["Meta Description"] = meta_desc.get("content", "")

        raw_results.append(row)

    # Use the normalizer to validate and standardize all data
    normalized_results = batch_normalize(raw_results)
    
    return normalized_results


# ============================================================================
# SHARED UTILITIES
# ============================================================================

def write_csv(data, filename="output/locations.csv"):
    """Write normalized data to CSV (uses centralized writer)"""
    write_normalized_csv(data, filename)

