#!/usr/bin/env python3
"""
Master CSV Manager
==================

Manages a master CSV file that accumulates all scraped stores from all brands.
Handles deduplication and merging of stores with the same address, tracking
which brands each store sells.

Usage:
    from master_csv_manager import append_to_master_csv
    
    # Append new stores to master CSV, merging stores with same address
    result = append_to_master_csv(
        new_stores_csv="path/to/new_stores.csv",
        master_csv="path/to/master_stores.csv",
        brand_name="rolex_retailers"
    )
"""

import csv
import os
import re
import math
import sys
import time
import copy
from datetime import datetime
from typing import List, Dict, Set, Tuple, Optional
from pathlib import Path

# Geocoding support (optional - only used if geopy is available)
try:
    from geopy.geocoders import Nominatim
    from geopy.exc import GeocoderTimedOut, GeocoderServiceError, GeocoderUnavailable
    GEOPY_AVAILABLE = True
except ImportError:
    GEOPY_AVAILABLE = False
    Nominatim = None


def log_sync(message: str, level: str = "INFO"):
    """
    Log sync operations to stdout (captured by admin console)
    
    Args:
        message: Log message
        level: Log level (INFO, SUCCESS, WARN, ERROR)
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    prefix = {
        "INFO": "[SYNC INFO]",
        "SUCCESS": "[SYNC ✓]",
        "WARN": "[SYNC ⚠]",
        "ERROR": "[SYNC ✗]"
    }.get(level, "[SYNC]")
    
    # Print to stdout so it's captured by Node.js backend
    print(f"{timestamp} {prefix} {message}", flush=True)


def normalize_brand_name(brand_config_name: str) -> str:
    """
    Convert brand config name (e.g., "rolex_retailers") to display name (e.g., "ROLEX")
    
    Args:
        brand_config_name: Brand name from config (e.g., "rolex_retailers", "omega_stores")
    
    Returns:
        Normalized brand display name (e.g., "ROLEX", "OMEGA")
    """
    # Remove common suffixes
    name = brand_config_name.replace('_stores', '').replace('_retailers', '').replace('_dealers', '')
    
    # Convert snake_case to Title Case, then uppercase
    name = name.replace('_', ' ').title().upper()
    
    # Handle special cases
    brand_mappings = {
        'ALANGE SOEHNE': 'A. LANGE & SÖHNE',
        'BAUME ET MERCIER': 'BAUME & MERCIER',
        'BELL ROSS': 'BELL & ROSS',
        'TAG HEUER': 'TAG HEUER',
        'GRAND SEIKO': 'GRAND SEIKO',
        'AUDEMARS PIGUET': 'AUDEMARS PIGUET',
        'BLANCPAIN': 'BLANCPAIN',
    }
    
    return brand_mappings.get(name, name)


def extract_brands_from_custom_brands(custom_brands_str: str) -> Set[str]:
    """
    Extract brand names from Custom Brands column (HTML format)
    
    Args:
        custom_brands_str: HTML-formatted brand string like '<a href="...">BRAND</A>, <a href="...">BRAND</A>'
    
    Returns:
        Set of brand names (uppercase)
    """
    if not custom_brands_str or not custom_brands_str.strip():
        return set()
    
    # Extract text between > and </A> tags
    brands = re.findall(r'>([^<]+)</A>', custom_brands_str, re.IGNORECASE)
    
    # Clean and normalize brand names
    normalized_brands = set()
    for brand in brands:
        brand = brand.strip().upper()
        if brand:
            normalized_brands.add(brand)
    
    return normalized_brands


def extract_all_brands_from_store(store: Dict[str, str]) -> Set[str]:
    """
    Extract all brands from a store record, checking both Custom Brands and Brands columns
    
    Args:
        store: Store dictionary
    
    Returns:
        Set of brand names (uppercase)
    """
    brands = set()
    
    # Extract from Custom Brands column (HTML format)
    custom_brands_str = store.get('Custom Brands', '').strip()
    if custom_brands_str:
        brands.update(extract_brands_from_custom_brands(custom_brands_str))
    
    # Extract from Brands column (plain text, comma-separated)
    brands_str = store.get('Brands', '').strip()
    if brands_str:
        # Split by comma and clean
        for brand in brands_str.split(','):
            brand = brand.strip().upper()
            if brand:
                brands.add(brand)
    
    return brands


def format_brands_for_custom_brands(brands: Set[str]) -> str:
    """
    Format brand names as HTML links for Custom Brands column
    
    Args:
        brands: Set of brand names
    
    Returns:
        HTML-formatted string like '<a href="...">BRAND</A>, <a href="...">BRAND</A>'
    """
    if not brands:
        return ""
    
    # Sort brands for consistency
    sorted_brands = sorted(brands)
    
    # Format as HTML links
    brand_links = []
    for brand in sorted_brands:
        # Create URL-friendly brand name (for href)
        brand_slug = brand.replace(' & ', '-').replace(' ', '-').replace('.', '').upper()
        brand_link = f'<a href="https://watchdna.com/blogs/history/{brand_slug}">{brand}</A>'
        brand_links.append(brand_link)
    
    return ', '.join(brand_links)


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate distance between two coordinates using Haversine formula
    
    Returns distance in meters
    """
    # Earth radius in meters
    R = 6371000
    
    # Convert to radians
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    # Haversine formula
    a = math.sin(delta_phi / 2) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c


# =============================================================================
# GEOCODING FUNCTIONS (for coordinate validation)
# =============================================================================

# Global geocoder instance (lazy initialization)
_geocoder = None
_last_geocode_time = 0
_geocode_cache = {}  # Cache geocoding results to avoid duplicate API calls

def get_geocoder():
    """Get or create Nominatim geocoder instance"""
    global _geocoder
    if not GEOPY_AVAILABLE:
        return None
    
    if _geocoder is None:
        # Use Nominatim (OpenStreetMap) - free, no API key required
        # User agent is required by Nominatim usage policy
        _geocoder = Nominatim(
            user_agent="WatchDNA-StoreLocator/1.0 (https://watchdna.com)",
            timeout=10  # 10 second timeout
        )
    
    return _geocoder


def geocode_address(
    address: str,
    city: str = "",
    state: str = "",
    country: str = ""
) -> Optional[Tuple[float, float]]:
    """
    Geocode an address to get latitude and longitude using Nominatim (OpenStreetMap).
    
    This is a free geocoding service that doesn't require an API key.
    Rate limit: 1 request per second (enforced automatically).
    
    Args:
        address: Address line 1
        city: City name
        state: State/Province/Region
        country: Country name
    
    Returns:
        Tuple of (latitude, longitude) if found, None otherwise
    """
    if not GEOPY_AVAILABLE:
        return None
    
    # Build full address string
    address_parts = []
    if address:
        address_parts.append(address)
    if city:
        address_parts.append(city)
    if state:
        address_parts.append(state)
    if country:
        address_parts.append(country)
    
    if not address_parts:
        return None
    
    full_address = ", ".join(address_parts)
    
    # Check cache first
    cache_key = full_address.lower().strip()
    if cache_key in _geocode_cache:
        return _geocode_cache[cache_key]
    
    geocoder = get_geocoder()
    if not geocoder:
        return None
    
    # Rate limiting: Nominatim requires max 1 request per second
    global _last_geocode_time
    current_time = time.time()
    time_since_last = current_time - _last_geocode_time
    if time_since_last < 1.0:
        time.sleep(1.0 - time_since_last)
    
    try:
        _last_geocode_time = time.time()
        location = geocoder.geocode(full_address, exactly_one=True, timeout=10)
        
        if location:
            lat = location.latitude
            lon = location.longitude
            result = (lat, lon)
            # Cache the result
            _geocode_cache[cache_key] = result
            return result
        else:
            # Cache None result to avoid retrying failed addresses
            _geocode_cache[cache_key] = None
            return None
            
    except (GeocoderTimedOut, GeocoderServiceError, GeocoderUnavailable) as e:
        # Log but don't fail - geocoding is optional
        return None
    except Exception as e:
        # Any other error - return None
        return None


def verify_coordinates_match_address(
    store: Dict[str, str],
    tolerance_meters: float = 1000.0
) -> Tuple[bool, Optional[float], Optional[str]]:
    """
    Verify that the coordinates in a store record match the address using geocoding.
    
    Args:
        store: Store dictionary with Latitude, Longitude, Address Line 1, City, State/Province/Region, Country
        tolerance_meters: Maximum distance in meters between provided coordinates and geocoded address (default: 1000m = 1km)
    
    Returns:
        Tuple of (is_valid, distance_meters, error_message)
        - is_valid: True if coordinates match address within tolerance, False otherwise
        - distance_meters: Distance between provided and geocoded coordinates (None if geocoding failed)
        - error_message: Error message if validation failed (None if valid)
    """
    # Get coordinates from store
    lat_str = store.get('Latitude', '').strip()
    lon_str = store.get('Longitude', '').strip()
    
    if not lat_str or not lon_str:
        return (False, None, "Missing coordinates")
    
    try:
        provided_lat = float(lat_str)
        provided_lon = float(lon_str)
    except (ValueError, TypeError):
        return (False, None, "Invalid coordinate format")
    
    # Get address components
    address = store.get('Address Line 1', '').strip()
    city = store.get('City', '').strip()
    state = store.get('State/Province/Region', '').strip()
    country = store.get('Country', '').strip()
    
    if not address and not city:
        return (False, None, "Insufficient address information")
    
    # Geocode the address
    geocoded_coords = geocode_address(address, city, state, country)
    
    if geocoded_coords is None:
        return (False, None, "Could not geocode address")
    
    geocoded_lat, geocoded_lon = geocoded_coords
    
    # Calculate distance between provided and geocoded coordinates
    distance = calculate_distance(provided_lat, provided_lon, geocoded_lat, geocoded_lon)
    
    # Check if within tolerance
    is_valid = distance <= tolerance_meters
    
    if is_valid:
        return (True, distance, None)
    else:
        return (False, distance, f"Coordinates mismatch: {distance:.0f}m from geocoded address (tolerance: {tolerance_meters:.0f}m)")


def normalize_store_name(name: str) -> str:
    """
    Normalize store name for comparison (remove common words, lowercase, etc.)
    """
    if not name:
        return ""
    
    # Convert to lowercase and remove extra spaces
    normalized = re.sub(r'\s+', ' ', name.lower().strip())
    
    # Remove common prefixes/suffixes that might differ between brands
    prefixes = ['boutique', 'store', 'shop', 'retailer', 'dealer']
    for prefix in prefixes:
        if normalized.startswith(prefix + ' '):
            normalized = normalized[len(prefix) + 1:].strip()
        if normalized.endswith(' ' + prefix):
            normalized = normalized[:-len(prefix) - 1].strip()
    
    # Remove brand names (OMEGA, ROLEX, etc.) for comparison
    normalized = re.sub(r'\b(omega|rolex|alpina|tag heuer|breitling|patek philippe|audemars piguet)\b', '', normalized)
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    
    return normalized


def names_similar(name1: str, name2: str, threshold: float = 0.7) -> bool:
    """
    Check if two store names are similar enough to be the same store
    
    Uses normalized names and simple similarity check
    """
    norm1 = normalize_store_name(name1)
    norm2 = normalize_store_name(name2)
    
    if not norm1 or not norm2:
        return False
    
    # Exact match after normalization
    if norm1 == norm2:
        return True
    
    # Check if one contains the other (for cases like "OMEGA Boutique" vs "Boutique")
    if norm1 in norm2 or norm2 in norm1:
        return True
    
    # Simple word overlap check
    words1 = set(norm1.split())
    words2 = set(norm2.split())
    
    if not words1 or not words2:
        return False
    
    # Calculate Jaccard similarity
    intersection = len(words1 & words2)
    union = len(words1 | words2)
    similarity = intersection / union if union > 0 else 0
    
    return similarity >= threshold


def get_address_key(store: Dict[str, str]) -> Optional[str]:
    """
    Generate a key based on address for identifying same physical location
    
    Uses address + city + coordinates (if available) for matching
    
    Args:
        store: Store dictionary with normalized fields
    
    Returns:
        Address-based key string, or None if insufficient data
    """
    addr = store.get('Address Line 1', '').strip().lower()
    city = store.get('City', '').strip().lower()
    country = store.get('Country', '').strip().lower()
    lat = store.get('Latitude', '').strip()
    lng = store.get('Longitude', '').strip()
    
    # If we have coordinates, use them (most reliable)
    # Round to 3 decimal places (~100 meters precision) for initial grouping
    # This allows slight coordinate differences while still grouping nearby stores
    if lat and lng:
        try:
            lat_rounded = round(float(lat), 3)
            lng_rounded = round(float(lng), 3)
            return f"coords:{lat_rounded}|{lng_rounded}"
        except (ValueError, TypeError):
            pass
    
    # Fallback to address + city + country
    if addr and city:
        return f"addr:{addr}|{city}|{country}"
    
    return None


def find_matching_store(
    new_store: Dict[str, str],
    existing_stores: List[Dict[str, str]],
    coordinate_tolerance_meters: float = 100.0,
    brand_name: str = ""
) -> Optional[Dict[str, str]]:
    """
    Find a matching store from existing stores using name + coordinate matching
    
    Args:
        new_store: New store to match
        existing_stores: List of existing stores to search
        coordinate_tolerance_meters: Maximum distance in meters to consider a match (default: 100m)
        brand_name: Brand name for logging purposes
    
    Returns:
        Matching store dictionary if found, None otherwise
    """
    new_name = new_store.get('Name', '').strip()
    new_lat_str = new_store.get('Latitude', '').strip()
    new_lng_str = new_store.get('Longitude', '').strip()
    new_addr = new_store.get('Address Line 1', '').strip()
    new_city = new_store.get('City', '').strip()
    new_country = new_store.get('Country', '').strip()
    
    # Try to get coordinates
    new_lat = None
    new_lng = None
    if new_lat_str and new_lng_str:
        try:
            new_lat = float(new_lat_str)
            new_lng = float(new_lng_str)
        except (ValueError, TypeError):
            pass
    
    # PRIORITY 1: If we have coordinates, use coordinate matching FIRST (geolocation is most reliable)
    # Coordinates are the primary matching criteria - name/address are secondary
    if new_lat is not None and new_lng is not None:
        for existing_store in existing_stores:
            existing_name = existing_store.get('Name', '').strip()
            existing_lat_str = existing_store.get('Latitude', '').strip()
            existing_lng_str = existing_store.get('Longitude', '').strip()
            existing_brands = existing_store.get('Brands', '').strip()
            
            # Check coordinates if available - THIS IS THE PRIMARY MATCHING CRITERIA
            if existing_lat_str and existing_lng_str:
                try:
                    existing_lat = float(existing_lat_str)
                    existing_lng = float(existing_lng_str)
                    
                    # Calculate distance
                    distance = calculate_distance(new_lat, new_lng, existing_lat, existing_lng)
                    
                    # If within tolerance, it's a match (same physical location)
                    # Name similarity is checked for logging but NOT required - coordinates are primary
                    if distance <= coordinate_tolerance_meters:
                        # Check name similarity for logging purposes
                        names_match = names_similar(new_name, existing_name)
                        
                        # Log the match
                        if names_match:
                            log_sync(
                                f"MATCH FOUND (coordinate + name): '{new_name}' ({brand_name}) matches existing store '{existing_name}'",
                                "SUCCESS"
                            )
                        else:
                            log_sync(
                                f"MATCH FOUND (coordinate only): '{new_name}' ({brand_name}) matches existing store '{existing_name}'",
                                "SUCCESS"
                            )
                            log_sync(
                                f"  ⚠️  Names differ but coordinates match (same physical location)",
                                "WARN"
                            )
                        
                        log_sync(
                            f"  Location: {new_addr}, {new_city}, {new_country}",
                            "INFO"
                        )
                        log_sync(
                            f"  Coordinates: ({new_lat_str}, {new_lng_str}) vs ({existing_lat_str}, {existing_lng_str})",
                            "INFO"
                        )
                        log_sync(
                            f"  Distance: {distance:.2f} meters (tolerance: {coordinate_tolerance_meters}m)",
                            "INFO"
                        )
                        if existing_brands:
                            log_sync(
                                f"  Existing brands: {existing_brands} → Will merge with {brand_name}",
                                "INFO"
                            )
                        else:
                            log_sync(
                                f"  Existing brands: None → Will add {brand_name}",
                                "INFO"
                            )
                        return existing_store
                except (ValueError, TypeError):
                    pass
    
    # Fallback: use address-based matching if no coordinates
    new_addr_key = get_address_key(new_store)
    if new_addr_key:
        for existing_store in existing_stores:
            existing_addr_key = get_address_key(existing_store)
            if existing_addr_key == new_addr_key:
                # Also check name similarity for address matches
                existing_name = existing_store.get('Name', '').strip()
                existing_brands = existing_store.get('Brands', '').strip()
                if names_similar(new_name, existing_name):
                    # Log the match
                    log_sync(
                        f"MATCH FOUND (by address): '{new_name}' ({brand_name}) matches existing store '{existing_name}'",
                        "SUCCESS"
                    )
                    log_sync(
                        f"  Location: {new_addr}, {new_city}, {new_country}",
                        "INFO"
                    )
                    if existing_brands:
                        log_sync(
                            f"  Existing brands: {existing_brands} → Will merge with {brand_name}",
                            "INFO"
                        )
                    else:
                        log_sync(
                            f"  Existing brands: None → Will add {brand_name}",
                            "INFO"
                        )
                    return existing_store
    
    return None


def merge_store_data(existing_store: Dict[str, str], new_store: Dict[str, str], new_brand: str = None) -> Dict[str, str]:
    """
    Merge two store records, combining brands and keeping most complete data
    
    Args:
        existing_store: Existing store from master CSV
        new_store: New store being added
        new_brand: Optional brand name for the new store (if None, extracts from new_store)
    
    Returns:
        Merged store dictionary
    """
    # Use deep copy to avoid mutating nested structures in the original store
    merged = copy.deepcopy(existing_store)
    
    # Extract existing brands from both columns
    existing_brands = extract_all_brands_from_store(existing_store)
    
    # Extract brands from new store
    new_store_brands = extract_all_brands_from_store(new_store)
    
    # If new_brand is provided, add it
    if new_brand:
        new_brand_normalized = normalize_brand_name(new_brand)
        new_store_brands.add(new_brand_normalized)
    
    # Combine all brands
    all_brands = existing_brands.union(new_store_brands)
    
    # Update brands columns
    merged['Custom Brands'] = format_brands_for_custom_brands(all_brands)
    merged['Brands'] = ', '.join(sorted(all_brands))  # Simple comma-separated for easy reading
    
    # Merge other fields: prefer non-empty values, new store takes precedence for conflicts
    for key, new_value in new_store.items():
        if key in ['Custom Brands', 'Brands']:
            continue  # Already handled
        
        existing_value = merged.get(key, '').strip()
        new_value_str = str(new_value).strip() if new_value else ''
        
        # If existing is empty and new has value, use new
        if not existing_value and new_value_str:
            merged[key] = new_value_str
        # If both have values, prefer new (assumes newer data is more accurate)
        elif existing_value and new_value_str and existing_value != new_value_str:
            # For critical fields, keep existing if it's more complete
            if key in ['Name', 'Address Line 1', 'City', 'Country']:
                # Keep existing if it's longer (more complete)
                if len(existing_value) >= len(new_value_str):
                    continue
            merged[key] = new_value_str
    
    return merged


def read_csv_to_dict_list(filename: str) -> List[Dict[str, str]]:
    """
    Read CSV file into list of dictionaries
    
    Args:
        filename: Path to CSV file
    
    Returns:
        List of dictionaries (one per row)
    """
    if not os.path.exists(filename):
        return []
    
    with open(filename, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        return list(reader)


def write_dict_list_to_csv(data: List[Dict[str, str]], filename: str, fieldnames: List[str] = None):
    """
    Write list of dictionaries to CSV file
    
    Args:
        data: List of dictionaries
        filename: Output CSV file path
        fieldnames: Optional list of field names (uses data keys if not provided)
    """
    os.makedirs(os.path.dirname(filename) if os.path.dirname(filename) else '.', exist_ok=True)
    
    if not data:
        # Create empty CSV with header
        if fieldnames:
            with open(filename, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator='\n')
                writer.writeheader()
        return
    
    # Get fieldnames from first row or provided list
    if not fieldnames:
        fieldnames = list(data[0].keys())
    
    # Ensure Custom Brands and Brands columns exist
    if 'Custom Brands' not in fieldnames:
        fieldnames.append('Custom Brands')
    if 'Brands' not in fieldnames:
        fieldnames.append('Brands')
    
    with open(filename, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator='\n')
        writer.writeheader()
        
        # Ensure all rows have Custom Brands and Brands columns
        for row in data:
            if 'Custom Brands' not in row:
                row['Custom Brands'] = ''
            if 'Brands' not in row:
                row['Brands'] = ''
            writer.writerow(row)
    
    # Post-process to ensure Unix line endings
    with open(filename, 'rb') as f:
        content = f.read()
    content = content.replace(b'\r\n', b'\n')
    with open(filename, 'wb') as f:
        f.write(content)


def append_to_master_csv(
    new_stores_csv: str,
    master_csv: str,
    brand_name: str,
    merge_by_address: bool = True
) -> Dict[str, any]:
    """
    Append new stores to master CSV with address-based merging and brand tracking
    
    Strategy:
    1. Read existing master CSV (if exists)
    2. Read new stores CSV
    3. For each new store:
       - If merge_by_address is True, check if store with same address exists
       - If found, merge stores and combine brands
       - If not found, add new store with brand info
    4. Write updated master CSV
    
    Args:
        new_stores_csv: Path to CSV file with new stores
        master_csv: Path to master CSV file
        brand_name: Name of the brand being scraped (e.g., "rolex_retailers")
        merge_by_address: If True, merge stores with same address; if False, only remove exact duplicates
    
    Returns:
        Dictionary with statistics:
        {
            "master_stores_before": int,
            "new_stores": int,
            "stores_merged": int,
            "stores_added": int,
            "master_stores_after": int
        }
    """
    # Read existing master CSV
    master_stores = read_csv_to_dict_list(master_csv)
    master_stores_before = len(master_stores)
    
    # Read new stores
    new_stores = read_csv_to_dict_list(new_stores_csv)
    new_stores_count = len(new_stores)
    
    if not new_stores:
        return {
            "master_stores_before": master_stores_before,
            "new_stores": 0,
            "stores_merged": 0,
            "stores_added": 0,
            "master_stores_after": master_stores_before
        }
    
    # Normalize brand name
    normalized_brand = normalize_brand_name(brand_name)
    
    # Log sync start
    log_sync("=" * 80, "INFO")
    log_sync(f"Starting sync for brand: {normalized_brand} ({brand_name})", "INFO")
    log_sync(f"Master CSV: {master_csv}", "INFO")
    log_sync(f"New stores CSV: {new_stores_csv}", "INFO")
    log_sync(f"Master stores before: {master_stores_before}", "INFO")
    log_sync(f"New stores to process: {new_stores_count}", "INFO")
    log_sync("=" * 80, "INFO")
    
    # Create a list of all existing master stores for matching
    # We'll use the improved matching logic that handles coordinate tolerance
    master_store_list: List[Dict[str, str]] = master_stores.copy()
    
    # Process new stores
    stores_merged = 0
    stores_added = 0
    
    for idx, new_store in enumerate(new_stores, 1):
        new_store_name = new_store.get('Name', '').strip()
        new_store_addr = new_store.get('Address Line 1', '').strip()
        new_store_city = new_store.get('City', '').strip()
        
        # Add brand info to new store
        new_store_brands = {normalized_brand}
        new_store['Custom Brands'] = format_brands_for_custom_brands(new_store_brands)
        new_store['Brands'] = normalized_brand
        
        if merge_by_address:
            # Use improved matching logic (name + coordinate tolerance)
            # Use 50m tolerance for matching - prioritizes geolocation over name/address
            matching_store = find_matching_store(
                new_store, 
                master_store_list, 
                coordinate_tolerance_meters=50.0,  # 50 meters - handles GPS variations while being precise
                brand_name=normalized_brand
            )
            
            if matching_store:
                # Merge with existing store
                existing_brands_before = matching_store.get('Brands', '').strip()
                merged_store = merge_store_data(matching_store, new_store, brand_name)
                existing_brands_after = merged_store.get('Brands', '').strip()
                
                # Replace the matching store with merged version
                index = master_store_list.index(matching_store)
                master_store_list[index] = merged_store
                stores_merged += 1
                
                # Log successful merge
                log_sync(
                    f"✓ MERGED [{idx}/{new_stores_count}]: '{new_store_name}' → '{matching_store.get('Name', '').strip()}'",
                    "SUCCESS"
                )
                log_sync(
                    f"  Brands updated: {existing_brands_before} → {existing_brands_after}",
                    "INFO"
                )
            else:
                # New store - add to master
                master_store_list.append(new_store)
                stores_added += 1
                log_sync(
                    f"+ ADDED [{idx}/{new_stores_count}]: '{new_store_name}' ({new_store_addr}, {new_store_city})",
                    "INFO"
                )
        else:
            # Simple append (no merging)
            master_store_list.append(new_store)
            stores_added += 1
            log_sync(
                f"+ ADDED [{idx}/{new_stores_count}]: '{new_store_name}' ({new_store_addr}, {new_store_city})",
                "INFO"
            )
    
    # Final list of stores
    updated_master = master_store_list
    master_stores_after = len(updated_master)
    
    # Get fieldnames from schema
    if updated_master:
        fieldnames = list(updated_master[0].keys())
        # Ensure Custom Brands and Brands are in fieldnames
        if 'Custom Brands' not in fieldnames:
            fieldnames.append('Custom Brands')
        if 'Brands' not in fieldnames:
            fieldnames.append('Brands')
    else:
        # Use canonical schema if empty
        from data_normalizer import SCHEMA
        fieldnames = SCHEMA.copy()
        if 'Custom Brands' not in fieldnames:
            fieldnames.append('Custom Brands')
        if 'Brands' not in fieldnames:
            fieldnames.append('Brands')
    
    # Write updated master CSV
    log_sync("Writing updated master CSV...", "INFO")
    write_dict_list_to_csv(updated_master, master_csv, fieldnames)
    
    # Log sync summary
    log_sync("=" * 80, "INFO")
    log_sync("SYNC COMPLETE", "SUCCESS")
    log_sync(f"  Brand: {normalized_brand} ({brand_name})", "INFO")
    log_sync(f"  New stores from this brand: {new_stores_count}", "INFO")
    log_sync(f"  → Matched existing stores: {stores_merged}", "SUCCESS" if stores_merged > 0 else "INFO")
    log_sync(f"  → New unique stores added: {stores_added}", "SUCCESS" if stores_added > 0 else "INFO")
    log_sync(f"  Master stores after sync: {master_stores_after}", "INFO")
    log_sync("=" * 80, "INFO")
    
    # Automatically validate and deduplicate after merging
    log_sync("", "INFO")  # Empty line for spacing
    validate_result = validate_and_deduplicate_master_csv(master_csv)
    
    # Update return stats with validation results
    final_stores_count = validate_result.get("stores_after", master_stores_after)
    
    # Log final comprehensive summary
    log_sync("", "INFO")  # Empty line
    log_sync("=" * 80, "INFO")
    log_sync("FINAL SUMMARY", "SUCCESS")
    log_sync("=" * 80, "INFO")
    log_sync(f"  Brand processed: {normalized_brand}", "INFO")
    log_sync(f"  New stores scraped: {new_stores_count}", "INFO")
    log_sync(f"  Stores matched & merged: {stores_merged}", "SUCCESS")
    log_sync(f"  New stores added: {stores_added}", "SUCCESS")
    log_sync("", "INFO")
    log_sync(f"  Master CSV before: {master_stores_before} stores", "INFO")
    log_sync(f"  Master CSV after sync: {master_stores_after} stores", "INFO")
    log_sync(f"  Duplicates removed (location): {validate_result.get('duplicates_by_location', 0)}", "INFO")
    log_sync(f"  Duplicates removed (name): {validate_result.get('duplicates_by_name', 0)}", "INFO")
    log_sync(f"  Master CSV final: {final_stores_count} stores", "SUCCESS")
    log_sync(f"  Total deduplicated: {master_stores_after - final_stores_count} stores", "SUCCESS")
    final_warnings = validate_result.get("warnings", [])
    if final_warnings:
        log_sync("", "INFO")
        log_sync("WARNINGS (data quality):", "INFO")
        for msg in final_warnings:
            log_sync(f"  ⚠️  {msg}", "INFO")
    log_sync("=" * 80, "INFO")
    
    return {
        "master_stores_before": master_stores_before,
        "new_stores": new_stores_count,
        "stores_merged": stores_merged,
        "stores_added": stores_added,
        "master_stores_after": master_stores_after,
        "validation": {
            "stores_before_validation": validate_result.get("stores_before", master_stores_after),
            "duplicates_by_location": validate_result.get("duplicates_by_location", 0),
            "duplicates_by_name": validate_result.get("duplicates_by_name", 0),
            "stores_after_validation": final_stores_count
        }
    }


def validate_and_deduplicate_master_csv(master_csv: str, coordinate_validation_tolerance_meters: float = 1000.0) -> Dict[str, any]:
    """
    Validate and deduplicate the master CSV file
    
    This function:
    1. Deduplicates by location (same lat/lon with tolerance) - keeps one per location, preferring entries with phone numbers
    2. Deduplicates by store name - prefers entries with phone numbers and more complete data
    3. Uses coordinates directly for matching (no geocoding - fast and efficient)
    4. Logs all deduplication actions
    
    Args:
        master_csv: Path to master CSV file
        coordinate_validation_tolerance_meters: Maximum distance in meters for coordinate matching (default: 1000m = 1km)
                                                Used for deduplication tolerance, not geocoding validation
    
    Returns:
        Dictionary with statistics:
        {
            "stores_before": int,
            "duplicates_by_location": int,
            "duplicates_by_name": int,
            "coordinate_mismatches": int,
            "coordinate_validation_failed": int,
            "stores_after": int
        }
    """
    if not os.path.exists(master_csv):
        log_sync(f"Master CSV file not found: {master_csv}", "WARN")
        return {
            "stores_before": 0,
            "duplicates_by_location": 0,
            "duplicates_by_name": 0,
            "coordinate_mismatches": 0,
            "coordinate_validation_failed": 0,
            "stores_after": 0
        }
    
    log_sync("=" * 80, "INFO")
    log_sync("Starting master CSV validation and deduplication", "INFO")
    log_sync(f"Master CSV: {master_csv}", "INFO")
    
    # Read master CSV
    stores = read_csv_to_dict_list(master_csv)
    stores_before = len(stores)
    log_sync(f"Stores before validation: {stores_before}", "INFO")
    
    if not stores:
        log_sync("No stores to validate", "WARN")
        return {
            "stores_before": 0,
            "duplicates_by_location": 0,
            "duplicates_by_name": 0,
            "coordinate_mismatches": 0,
            "coordinate_validation_failed": 0,
            "stores_after": 0
        }
    
    # First pass: Deduplicate by location (lat/lon) with tolerance
    # Use coordinate tolerance to handle slight GPS variations (e.g., 50 meters)
    log_sync("-" * 80, "INFO")
    log_sync("Step 1: Deduplicating by location (coordinates with tolerance)", "INFO")
    log_sync(f"  Coordinate tolerance: {coordinate_validation_tolerance_meters:.0f} meters", "INFO")
    
    # Use a smaller tolerance for deduplication (50m) - stricter than validation tolerance
    dedup_tolerance_meters = min(50.0, coordinate_validation_tolerance_meters / 2)
    
    deduplicated_stores = []
    processed_indices = set()
    duplicates_by_location = 0
    
    for i, store in enumerate(stores):
        if i in processed_indices:
            continue
            
        lat_str = store.get('Latitude', '').strip()
        lon_str = store.get('Longitude', '').strip()
        
        if not lat_str or not lon_str:
            # Store without coordinates - will handle in name deduplication
            deduplicated_stores.append(store)
            processed_indices.add(i)  # Track that we've processed this store
            continue
        
        try:
            lat = float(lat_str)
            lon = float(lon_str)
            
            # Find all stores within tolerance distance
            matching_stores = [store]  # Start with current store
            matching_indices = [i]
            
            for j, other_store in enumerate(stores[i+1:], start=i+1):
                if j in processed_indices:
                    continue
                    
                other_lat_str = other_store.get('Latitude', '').strip()
                other_lon_str = other_store.get('Longitude', '').strip()
                
                if not other_lat_str or not other_lon_str:
                    continue
                
                try:
                    other_lat = float(other_lat_str)
                    other_lon = float(other_lon_str)
                    
                    # Calculate distance
                    distance = calculate_distance(lat, lon, other_lat, other_lon)
                    
                    # If within tolerance, it's a match (same physical location)
                    if distance <= dedup_tolerance_meters:
                        matching_stores.append(other_store)
                        matching_indices.append(j)
                except (ValueError, TypeError):
                    continue
            
            # If we found matches, merge them
            if len(matching_stores) > 1:
                duplicates_by_location += len(matching_stores) - 1
                
                # Merge all matching stores
                # IMPORTANT: Create a deep copy to avoid mutating nested structures in the original store dictionary
                merged_store = copy.deepcopy(matching_stores[0])
                existing_name = merged_store.get('Name', '').strip()
                
                # Combine all brands from all matching stores
                all_brands = extract_all_brands_from_store(merged_store)
                for idx, matching_store in enumerate(matching_stores[1:], start=1):
                    current_name = matching_store.get('Name', '').strip()
                    matching_brands = extract_all_brands_from_store(matching_store)
                    all_brands = all_brands.union(matching_brands)
                    
                    # Calculate distance for logging
                    matching_lat_str = matching_store.get('Latitude', '').strip()
                    matching_lon_str = matching_store.get('Longitude', '').strip()
                    match_distance = None
                    if matching_lat_str and matching_lon_str:
                        try:
                            matching_lat = float(matching_lat_str)
                            matching_lon = float(matching_lon_str)
                            match_distance = calculate_distance(lat, lon, matching_lat, matching_lon)
                        except (ValueError, TypeError):
                            pass
                    
                    # Merge store data (combines brands and other fields)
                    merged_store = merge_store_data(merged_store, matching_store)
                    
                    if match_distance is not None:
                        log_sync(
                            f"  Location match: '{current_name}' merged with '{existing_name}' (distance: {match_distance:.1f}m)",
                            "INFO"
                        )
                    else:
                        log_sync(
                            f"  Location match: '{current_name}' merged with '{existing_name}'",
                            "INFO"
                        )
                
                # Update brands in merged store
                merged_store['Custom Brands'] = format_brands_for_custom_brands(all_brands)
                merged_store['Brands'] = ', '.join(sorted(all_brands))
                
                # Prefer entry with phone number for base data
                best_store = merged_store
                best_has_phone = bool(merged_store.get('Phone', '').strip())
                best_addr_len = len(merged_store.get('Address Line 1', '').strip())
                
                # Check if any other matching store has better data
                for matching_store in matching_stores:
                    has_phone = bool(matching_store.get('Phone', '').strip())
                    addr_len = len(matching_store.get('Address Line 1', '').strip())
                    
                    if (has_phone and not best_has_phone) or \
                       (has_phone == best_has_phone and addr_len > best_addr_len):
                        # Re-merge with this store as base
                        # Use deep copy to avoid mutating nested structures
                        temp_merged = copy.deepcopy(matching_store)
                        for other_store in matching_stores:
                            if other_store is not matching_store:
                                temp_merged = merge_store_data(temp_merged, other_store)
                        # Restore brands
                        temp_merged['Custom Brands'] = format_brands_for_custom_brands(all_brands)
                        temp_merged['Brands'] = ', '.join(sorted(all_brands))
                        best_store = temp_merged
                        best_has_phone = has_phone
                        best_addr_len = addr_len
                
                # Log brand merge
                all_brands_str = ', '.join(sorted(all_brands)) if all_brands else 'None'
                log_sync(
                    f"    Brands combined: {all_brands_str}",
                    "SUCCESS"
                )
                
                deduplicated_stores.append(best_store)
                # Mark all matching stores as processed
                processed_indices.update(matching_indices)
            else:
                # No matches found, add as-is
                deduplicated_stores.append(store)
                processed_indices.add(i)
                
        except (ValueError, TypeError):
            # Invalid coordinates - skip location deduplication for this store
            deduplicated_stores.append(store)
            processed_indices.add(i)
            continue
    
    deduplicated_by_location = deduplicated_stores
    
    log_sync(f"  Removed {duplicates_by_location} duplicate(s) by location (within {dedup_tolerance_meters:.0f}m)", "SUCCESS")
    log_sync(f"  Stores after location deduplication: {len(deduplicated_by_location)}", "INFO")
    
    # Second pass: Deduplicate by store name (only if coordinates are close)
    log_sync("-" * 80, "INFO")
    log_sync("Step 2: Deduplicating by store name (with coordinate check)", "INFO")
    log_sync(f"  Coordinate tolerance: {dedup_tolerance_meters:.0f} meters", "INFO")
    name_map = {}
    duplicates_by_name = 0
    stores_without_name = []  # Track stores without names to add them to final output
    
    for store in deduplicated_by_location:
        name = (store.get('Name', '') or '').strip().lower()
        if not name:
            # Store without name - add directly to final output (can't deduplicate by name)
            stores_without_name.append(copy.deepcopy(store))
            continue
        
        existing = name_map.get(name)
        
        if not existing:
            # Use deep copy to avoid mutating nested structures
            name_map[name] = copy.deepcopy(store)
        else:
            # Handle case where existing might be a list (multiple stores with same name)
            existing_stores = existing if isinstance(existing, list) else [existing]
            
            # Check if any existing store has coordinates close to current store
            current_lat_str = store.get('Latitude', '').strip()
            current_lon_str = store.get('Longitude', '').strip()
            
            coordinates_close = False
            distance = None
            matching_existing = None
            
            # Check against all existing stores with the same name
            for existing_store in existing_stores:
                existing_lat_str = existing_store.get('Latitude', '').strip()
                existing_lon_str = existing_store.get('Longitude', '').strip()
                
                # Only merge if both have coordinates and they're close
                if existing_lat_str and existing_lon_str and current_lat_str and current_lon_str:
                    try:
                        existing_lat = float(existing_lat_str)
                        existing_lon = float(existing_lon_str)
                        current_lat = float(current_lat_str)
                        current_lon = float(current_lon_str)
                        
                        # Calculate distance
                        dist = calculate_distance(existing_lat, existing_lon, current_lat, current_lon)
                        
                        # Only merge if coordinates are within tolerance
                        if dist <= dedup_tolerance_meters:
                            coordinates_close = True
                            distance = dist
                            matching_existing = existing_store
                            break  # Found a match, stop searching
                    except (ValueError, TypeError):
                        # Invalid coordinates - continue checking other stores
                        continue
            
            # Only merge stores with same name if coordinates are close
            if coordinates_close and matching_existing:
                duplicates_by_name += 1
                existing_name = matching_existing.get('Name', '').strip()
                current_name = store.get('Name', '').strip()
                
                # Extract brands from both stores
                existing_brands_before = extract_all_brands_from_store(matching_existing)
                current_brands = extract_all_brands_from_store(store)
                combined_brands = existing_brands_before.union(current_brands)
                
                # Merge the stores, combining brands
                merged_store = merge_store_data(matching_existing, store)
                
                # Prefer entry with phone number for base data
                existing_has_phone = bool(matching_existing.get('Phone', '').strip())
                current_has_phone = bool(store.get('Phone', '').strip())
                
                if current_has_phone and not existing_has_phone:
                    # Use current store as base, but keep merged brands
                    merged_store = merge_store_data(store, matching_existing)
                    log_sync(
                        f"  Name duplicate (coordinates close): Merging '{current_name}' + '{existing_name}' (keeping '{current_name}' as base - has phone, distance: {distance:.1f}m)",
                        "INFO"
                    )
                elif not current_has_phone and existing_has_phone:
                    # Use existing store as base (already merged above)
                    log_sync(
                        f"  Name duplicate (coordinates close): Merging '{existing_name}' + '{current_name}' (keeping '{existing_name}' as base - has phone, distance: {distance:.1f}m)",
                        "INFO"
                    )
                else:
                    # Both have phone or both don't - prefer one with more complete data
                    existing_addr = len(matching_existing.get('Address Line 1', '').strip())
                    current_addr = len(store.get('Address Line 1', '').strip())
                    
                    if current_addr > existing_addr:
                        merged_store = merge_store_data(store, matching_existing)
                        log_sync(
                            f"  Name duplicate (coordinates close): Merging '{current_name}' + '{existing_name}' (keeping '{current_name}' as base - more complete, distance: {distance:.1f}m)",
                            "INFO"
                        )
                    else:
                        log_sync(
                            f"  Name duplicate (coordinates close): Merging '{existing_name}' + '{current_name}' (keeping '{existing_name}' as base - more complete, distance: {distance:.1f}m)",
                            "INFO"
                        )
                
                # Log brand merge
                existing_brands_str = ', '.join(sorted(existing_brands_before)) if existing_brands_before else 'None'
                current_brands_str = ', '.join(sorted(current_brands)) if current_brands else 'None'
                merged_brands_str = ', '.join(sorted(combined_brands)) if combined_brands else 'None'
                
                log_sync(
                    f"    Brands merged: [{existing_brands_str}] + [{current_brands_str}] → [{merged_brands_str}]",
                    "SUCCESS"
                )
                
                # Replace the matching store in the list, or replace single store
                if isinstance(name_map[name], list):
                    # Replace the matching store in the list with merged version
                    index = existing_stores.index(matching_existing)
                    existing_stores[index] = merged_store
                    name_map[name] = existing_stores
                else:
                    # Replace single store with merged version
                    name_map[name] = merged_store
            else:
                # Same name but coordinates not close (or missing) - keep both as separate stores
                # Store as list to handle multiple stores with same name but different locations
                if isinstance(name_map[name], list):
                    name_map[name].append(copy.deepcopy(store))
                else:
                    # Convert single store to list and add both
                    existing_store = name_map[name]
                    name_map[name] = [existing_store, copy.deepcopy(store)]
    
    # Flatten name_map - handle both single stores and lists of stores with same name
    final_stores = []
    for value in name_map.values():
        if isinstance(value, list):
            # Multiple stores with same name but different locations - keep all
            final_stores.extend(value)
        else:
            # Single store
            final_stores.append(value)
    
    # Add stores without names that were skipped during name deduplication
    if stores_without_name:
        final_stores.extend(stores_without_name)
        log_sync(f"  Added {len(stores_without_name)} store(s) without names to final output", "INFO")
    
    stores_after = len(final_stores)
    
    log_sync(f"  Removed {duplicates_by_name} duplicate(s) by name", "SUCCESS")
    log_sync(f"  Stores after name deduplication: {stores_after}", "INFO")
    
    # Step 3: Skip geocoding validation - use coordinates directly
    # We trust the coordinates provided and use them for matching/deduplication
    # Geocoding is slow and unnecessary since we match by coordinates directly
    log_sync("-" * 80, "INFO")
    log_sync("Step 3: Coordinate validation skipped (using coordinates directly)", "INFO")
    log_sync("  Using provided coordinates for matching - no geocoding performed", "INFO")
    log_sync("  All stores with coordinates are kept (fast and efficient)", "SUCCESS")
    
    validated_stores = final_stores
    coordinate_mismatches = 0
    coordinate_validation_failed = 0
    stores_after_validation = len(validated_stores)
    removed_by_validation = 0
    
    final_stores = validated_stores
    stores_after = stores_after_validation
    
    # Write deduplicated CSV back
    if stores_after < stores_before:
        log_sync("-" * 80, "INFO")
        log_sync("Writing validated master CSV...", "INFO")
        
        # Get fieldnames
        if final_stores:
            fieldnames = list(final_stores[0].keys())
            if 'Custom Brands' not in fieldnames:
                fieldnames.append('Custom Brands')
            if 'Brands' not in fieldnames:
                fieldnames.append('Brands')
        else:
            from data_normalizer import SCHEMA
            fieldnames = SCHEMA.copy()
            if 'Custom Brands' not in fieldnames:
                fieldnames.append('Custom Brands')
            if 'Brands' not in fieldnames:
                fieldnames.append('Brands')
        
        write_dict_list_to_csv(final_stores, master_csv, fieldnames)
        log_sync("Validated master CSV written successfully", "SUCCESS")
    
    # Collect data-quality warnings for final summary
    warnings_list = []
    no_name_count = len(stores_without_name)
    no_coords_count = sum(
        1 for s in final_stores
        if not (s.get('Latitude') or '').strip() or not (s.get('Longitude') or '').strip()
    )
    no_address_count = sum(1 for s in final_stores if not (s.get('Address Line 1') or '').strip())
    no_phone_count = sum(1 for s in final_stores if not (s.get('Phone') or '').strip())
    if no_name_count:
        warnings_list.append(f"{no_name_count} store(s) have no name")
    if no_coords_count:
        warnings_list.append(f"{no_coords_count} store(s) have missing or invalid coordinates")
    if no_address_count:
        warnings_list.append(f"{no_address_count} store(s) have no address")
    if no_phone_count:
        warnings_list.append(f"{no_phone_count} store(s) have no phone number")
    
    # Log summary
    log_sync("=" * 80, "INFO")
    log_sync("DEDUPLICATION COMPLETE", "SUCCESS")
    log_sync(f"  Stores before deduplication: {stores_before}", "INFO")
    log_sync(f"  Duplicates removed (by location): {duplicates_by_location}", "SUCCESS" if duplicates_by_location > 0 else "INFO")
    log_sync(f"  Duplicates removed (by name): {duplicates_by_name}", "SUCCESS" if duplicates_by_name > 0 else "INFO")
    log_sync(f"  Stores after deduplication: {stores_after}", "SUCCESS")
    log_sync(f"  Total duplicates removed: {stores_before - stores_after}", "SUCCESS" if (stores_before - stores_after) > 0 else "INFO")
    if warnings_list:
        log_sync("", "INFO")
        log_sync("WARNINGS (data quality):", "INFO")
        for msg in warnings_list:
            log_sync(f"  ⚠️  {msg}", "INFO")
    log_sync("=" * 80, "INFO")
    
    return {
        "stores_before": stores_before,
        "duplicates_by_location": duplicates_by_location,
        "duplicates_by_name": duplicates_by_name,
        "coordinate_mismatches": 0,  # Geocoding validation disabled - using coordinates directly
        "coordinate_validation_failed": 0,  # Geocoding validation disabled - using coordinates directly
        "stores_after": stores_after,
        "warnings": warnings_list
    }


if __name__ == "__main__":
    # Test the function
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python3 master_csv_manager.py <new_stores.csv> <master_stores.csv> [brand_name]")
        print("  or:   python3 master_csv_manager.py --validate-only <master_stores.csv>")
        sys.exit(1)
    
    # Check if this is a validation-only call
    if sys.argv[1] == '--validate-only':
        if len(sys.argv) < 3:
            print("Usage: python3 master_csv_manager.py --validate-only <master_stores.csv>")
            sys.exit(1)
        master_csv = sys.argv[2]
        result = validate_and_deduplicate_master_csv(master_csv)
        print(f"\n{'='*80}")
        print(f"DEDUPLICATION SUMMARY")
        print(f"{'='*80}")
        print(f"  Stores before deduplication: {result['stores_before']}")
        print(f"  Duplicates removed (by location): {result['duplicates_by_location']}")
        print(f"  Duplicates removed (by name): {result['duplicates_by_name']}")
        print(f"  Stores after deduplication: {result['stores_after']}")
        print(f"  Total duplicates removed: {result['stores_before'] - result['stores_after']}")
        print(f"{'='*80}")
    else:
        if len(sys.argv) < 3:
            print("Usage: python3 master_csv_manager.py <new_stores.csv> <master_stores.csv> [brand_name]")
            sys.exit(1)
        
        new_csv = sys.argv[1]
        master_csv = sys.argv[2]
        brand_name = sys.argv[3] if len(sys.argv) > 3 else "unknown"
        
        result = append_to_master_csv(new_csv, master_csv, brand_name)
        
        print(f"\n{'='*80}")
        print(f"MASTER CSV SYNC SUMMARY")
        print(f"{'='*80}")
        print(f"  Brand: {brand_name}")
        print(f"  New stores scraped: {result['new_stores']}")
        print(f"  → Matched existing stores: {result['stores_merged']}")
        print(f"  → New unique stores added: {result['stores_added']}")
        print(f"")
        print(f"  Master CSV before sync: {result['master_stores_before']} stores")
        print(f"  Master CSV after sync: {result['master_stores_after']} stores")
        
        # Validation results are included in the return value
        if 'validation' in result:
            val = result['validation']
            print(f"")
            print(f"  Deduplication:")
            print(f"    Stores before deduplication: {val['stores_before_validation']}")
            print(f"    Duplicates removed (location): {val['duplicates_by_location']}")
            print(f"    Duplicates removed (name): {val['duplicates_by_name']}")
            print(f"    Stores after deduplication: {val['stores_after_validation']}")
            print(f"    Total removed: {val['stores_before_validation'] - val['stores_after_validation']}")
        print(f"{'='*80}")
