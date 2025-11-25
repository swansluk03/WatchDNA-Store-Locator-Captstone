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
from datetime import datetime
from typing import List, Dict, Set, Tuple, Optional
from pathlib import Path


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
    
    # If we have coordinates, use coordinate + name matching
    if new_lat is not None and new_lng is not None:
        for existing_store in existing_stores:
            existing_name = existing_store.get('Name', '').strip()
            existing_lat_str = existing_store.get('Latitude', '').strip()
            existing_lng_str = existing_store.get('Longitude', '').strip()
            existing_brands = existing_store.get('Brands', '').strip()
            
            # Check if names are similar
            if not names_similar(new_name, existing_name):
                continue
            
            # Check coordinates if available
            if existing_lat_str and existing_lng_str:
                try:
                    existing_lat = float(existing_lat_str)
                    existing_lng = float(existing_lng_str)
                    
                    # Calculate distance
                    distance = calculate_distance(new_lat, new_lng, existing_lat, existing_lng)
                    
                    # If within tolerance and names are similar, it's a match
                    if distance <= coordinate_tolerance_meters:
                        # Log the match
                        log_sync(
                            f"MATCH FOUND: '{new_name}' ({brand_name}) matches existing store '{existing_name}'",
                            "SUCCESS"
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


def merge_store_data(existing_store: Dict[str, str], new_store: Dict[str, str], new_brand: str) -> Dict[str, str]:
    """
    Merge two store records, combining brands and keeping most complete data
    
    Args:
        existing_store: Existing store from master CSV
        new_store: New store being added
        new_brand: Brand name for the new store
    
    Returns:
        Merged store dictionary
    """
    merged = existing_store.copy()
    
    # Extract existing brands
    existing_brands_str = existing_store.get('Custom Brands', '') or existing_store.get('Brands', '')
    existing_brands = extract_brands_from_custom_brands(existing_brands_str)
    
    # Add new brand
    new_brand_normalized = normalize_brand_name(new_brand)
    existing_brands.add(new_brand_normalized)
    
    # Update brands column
    merged['Custom Brands'] = format_brands_for_custom_brands(existing_brands)
    merged['Brands'] = ', '.join(sorted(existing_brands))  # Simple comma-separated for easy reading
    
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
            matching_store = find_matching_store(
                new_store, 
                master_store_list, 
                coordinate_tolerance_meters=100.0,
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
    log_sync(f"  Master stores before: {master_stores_before}", "INFO")
    log_sync(f"  New stores processed: {new_stores_count}", "INFO")
    log_sync(f"  Stores merged: {stores_merged}", "SUCCESS")
    log_sync(f"  Stores added: {stores_added}", "SUCCESS")
    log_sync(f"  Master stores after: {master_stores_after}", "INFO")
    log_sync("=" * 80, "INFO")
    
    return {
        "master_stores_before": master_stores_before,
        "new_stores": new_stores_count,
        "stores_merged": stores_merged,
        "stores_added": stores_added,
        "master_stores_after": master_stores_after
    }


if __name__ == "__main__":
    # Test the function
    import sys
    
    if len(sys.argv) < 3:
        print("Usage: python3 master_csv_manager.py <new_stores.csv> <master_stores.csv> [brand_name]")
        sys.exit(1)
    
    new_csv = sys.argv[1]
    master_csv = sys.argv[2]
    brand_name = sys.argv[3] if len(sys.argv) > 3 else "unknown"
    
    result = append_to_master_csv(new_csv, master_csv, brand_name)
    
    print(f"Master CSV Update Results:")
    print(f"  Master stores before: {result['master_stores_before']}")
    print(f"  New stores: {result['new_stores']}")
    print(f"  Stores merged: {result['stores_merged']}")
    print(f"  Stores added: {result['stores_added']}")
    print(f"  Master stores after: {result['master_stores_after']}")
