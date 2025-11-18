#!/usr/bin/env python3
"""
Master CSV Manager
==================

Manages a master CSV file that accumulates all scraped stores from all brands.
Handles deduplication and merging of new data with existing data.

Usage:
    from master_csv_manager import append_to_master_csv
    
    # Append new stores to master CSV, removing duplicates
    result = append_to_master_csv(
        new_stores_csv="path/to/new_stores.csv",
        master_csv="path/to/master_stores.csv",
        brand_name="rolex_retailers"
    )
"""

import csv
import os
from typing import List, Dict, Set, Tuple
from pathlib import Path


def get_store_key(store: Dict[str, str]) -> str:
    """
    Generate a unique key for a store for deduplication
    
    Uses Handle first (most reliable), then falls back to Name+Address+City
    
    Args:
        store: Store dictionary with normalized fields
    
    Returns:
        Unique key string for deduplication
    """
    handle = store.get('Handle', '').strip()
    if handle:
        return f"handle:{handle}"
    
    # Fallback to name + address + city
    name = store.get('Name', '').strip().lower()
    addr = store.get('Address Line 1', '').strip().lower()
    city = store.get('City', '').strip().lower()
    
    if name and addr:
        return f"name_addr:{name}|{addr}|{city}"
    
    # Last resort: name + coordinates
    lat = store.get('Latitude', '').strip()
    lng = store.get('Longitude', '').strip()
    if name and lat and lng:
        return f"name_coords:{name}|{lat}|{lng}"
    
    # If we can't create a key, use a hash of all fields
    return f"hash:{hash(str(store))}"


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
    
    with open(filename, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator='\n')
        writer.writeheader()
        writer.writerows(data)
    
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
    deduplication_strategy: str = "handle_then_name_addr"
) -> Dict[str, any]:
    """
    Append new stores to master CSV with deduplication
    
    Strategy:
    1. Read existing master CSV (if exists)
    2. Read new stores CSV
    3. Deduplicate: Remove stores from master that match new stores (by Handle or Name+Address+City)
    4. Append new stores to master
    5. Write updated master CSV
    
    Args:
        new_stores_csv: Path to CSV file with new stores
        master_csv: Path to master CSV file
        brand_name: Name of the brand being scraped (for tracking)
        deduplication_strategy: How to deduplicate ("handle_then_name_addr" or "name_addr_only")
    
    Returns:
        Dictionary with statistics:
        {
            "master_stores_before": int,
            "new_stores": int,
            "duplicates_removed": int,
            "master_stores_after": int,
            "stores_added": int
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
            "duplicates_removed": 0,
            "master_stores_after": master_stores_before,
            "stores_added": 0
        }
    
    # Create lookup for new stores by key
    new_store_keys: Set[str] = set()
    new_stores_by_key: Dict[str, Dict[str, str]] = {}
    
    for store in new_stores:
        key = get_store_key(store)
        new_store_keys.add(key)
        new_stores_by_key[key] = store
    
    # Remove duplicates from master (stores that match new stores)
    # This handles the case where a job is re-run - we want to replace old data with new
    master_stores_filtered = []
    duplicates_removed = 0
    
    for store in master_stores:
        key = get_store_key(store)
        if key in new_store_keys:
            # This store exists in new data - remove from master (will be replaced)
            duplicates_removed += 1
        else:
            # Keep this store (not in new data)
            master_stores_filtered.append(store)
    
    # Combine: existing stores (minus duplicates) + new stores
    updated_master = master_stores_filtered + new_stores
    master_stores_after = len(updated_master)
    stores_added = master_stores_after - master_stores_before + duplicates_removed
    
    # Get fieldnames from schema (use new stores if master is empty)
    if updated_master:
        fieldnames = list(updated_master[0].keys())
    else:
        # Use canonical schema if both are empty
        from data_normalizer import SCHEMA
        fieldnames = SCHEMA
    
    # Write updated master CSV
    write_dict_list_to_csv(updated_master, master_csv, fieldnames)
    
    return {
        "master_stores_before": master_stores_before,
        "new_stores": new_stores_count,
        "duplicates_removed": duplicates_removed,
        "master_stores_after": master_stores_after,
        "stores_added": stores_added
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
    print(f"  Duplicates removed: {result['duplicates_removed']}")
    print(f"  Master stores after: {result['master_stores_after']}")
    print(f"  Stores added: {result['stores_added']}")

