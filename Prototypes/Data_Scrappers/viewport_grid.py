#!/usr/bin/env python3
"""
Viewport-Based Worldwide Scraper
=================================

For APIs that require viewport coordinates (bounding boxes) to fetch store data.
This module divides the world into a grid and fetches data from each viewport.

Common for: Rolex, Google Maps-based APIs, viewport-based store locators

Usage:
    from viewport_scraper import scrape_viewport_api
    
    stores = scrape_viewport_api(
        base_url="https://api.example.com/stores",
        viewport_params={
            "northEastLat": "ne_lat",
            "northEastLng": "ne_lng",
            "southWestLat": "sw_lat",
            "southWestLng": "sw_lng"
        },
        grid_size=5,  # 5x5 degree boxes
        additional_params={"brand": "RLX"}
    )
"""

import requests
import time
import math
from datetime import datetime
from typing import List, Dict, Any, Optional
from urllib.parse import urlencode

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


def generate_world_grid(grid_size: int = 20) -> List[Dict[str, float]]:
    """
    Generate a grid of viewport coordinates covering the entire world
    
    Args:
        grid_size: Size of each grid box in degrees (default: 20)
                  Smaller = more boxes = more API calls = more complete data
                  Larger = fewer boxes = faster but might miss stores
    
    Returns:
        List of viewport dictionaries with ne_lat, ne_lng, sw_lat, sw_lng
    
    Grid size recommendations:
        - 30 degrees: ~108 boxes, very fast, focuses on major land areas
        - 20 degrees: ~180 boxes, fast, good balance (default)
        - 10 degrees: ~720 boxes, thorough but slower
        - 5 degrees:  ~2880 boxes, very thorough (use for dense regions only)
        - 3 degrees:  ~8000 boxes, exhaustive (use for specific regions only)
    """
    viewports = []
    
    # World bounds
    min_lat, max_lat = -90, 90
    min_lng, max_lng = -180, 180
    
    # Generate grid
    lat = min_lat
    while lat < max_lat:
        lng = min_lng
        while lng < max_lng:
            viewport = {
                "sw_lat": lat,
                "sw_lng": lng,
                "ne_lat": min(lat + grid_size, max_lat),
                "ne_lng": min(lng + grid_size, max_lng)
            }
            viewports.append(viewport)
            lng += grid_size
        lat += grid_size
    
    return viewports


def generate_focused_grid(
    center_lat: float,
    center_lng: float,
    radius_degrees: float = 10,
    grid_size: int = 5
) -> List[Dict[str, float]]:
    """
    Generate a grid focused on a specific region (e.g., USA, Europe, Asia)
    
    Args:
        center_lat: Latitude of region center
        center_lng: Longitude of region center
        radius_degrees: How far to extend from center (in degrees)
        grid_size: Size of each grid box in degrees
    
    Returns:
        List of viewport dictionaries
    
    Examples:
        USA: center_lat=39.8, center_lng=-98.6, radius_degrees=25
        Europe: center_lat=50.0, center_lng=10.0, radius_degrees=20
        Asia: center_lat=34.0, center_lng=100.0, radius_degrees=30
    """
    viewports = []
    
    min_lat = max(-90, center_lat - radius_degrees)
    max_lat = min(90, center_lat + radius_degrees)
    min_lng = max(-180, center_lng - radius_degrees)
    max_lng = min(180, center_lng + radius_degrees)
    
    lat = min_lat
    while lat < max_lat:
        lng = min_lng
        while lng < max_lng:
            viewport = {
                "sw_lat": lat,
                "sw_lng": lng,
                "ne_lat": min(lat + grid_size, max_lat),
                "ne_lng": min(lng + grid_size, max_lng)
            }
            viewports.append(viewport)
            lng += grid_size
        lat += grid_size
    
    return viewports


def generate_country_grid(country_bounds: Dict[str, float], grid_size: int = 3) -> List[Dict[str, float]]:
    """
    Generate a grid for a specific country/region
    
    Args:
        country_bounds: Dict with min_lat, max_lat, min_lng, max_lng
        grid_size: Size of each grid box in degrees
    
    Returns:
        List of viewport dictionaries
    
    Example country bounds:
        USA: {"min_lat": 24.5, "max_lat": 49.4, "min_lng": -125.0, "max_lng": -66.9}
        UK: {"min_lat": 49.9, "max_lat": 60.9, "min_lng": -8.2, "max_lng": 1.8}
        Japan: {"min_lat": 24.0, "max_lat": 46.0, "min_lng": 123.0, "max_lng": 154.0}
    """
    viewports = []
    
    lat = country_bounds["min_lat"]
    while lat < country_bounds["max_lat"]:
        lng = country_bounds["min_lng"]
        while lng < country_bounds["max_lng"]:
            viewport = {
                "sw_lat": lat,
                "sw_lng": lng,
                "ne_lat": min(lat + grid_size, country_bounds["max_lat"]),
                "ne_lng": min(lng + grid_size, country_bounds["max_lng"])
            }
            viewports.append(viewport)
            lng += grid_size
        lat += grid_size
    
    return viewports


def build_viewport_url(
    base_url: str,
    viewport: Dict[str, float],
    viewport_params: Dict[str, str],
    additional_params: Optional[Dict[str, str]] = None
) -> str:
    """
    Build a complete API URL with viewport coordinates
    
    Args:
        base_url: Base API URL (without query params)
        viewport: Dict with sw_lat, sw_lng, ne_lat, ne_lng
        viewport_params: Mapping of standard names to API param names
                        Example: {"northEastLat": "ne_lat", "southWestLat": "sw_lat", ...}
        additional_params: Extra query params (brand, language, etc.)
    
    Returns:
        Complete URL string
    """
    params = {}
    
    # Add viewport coordinates using API's parameter names
    if "northEastLat" in viewport_params:
        params[viewport_params["northEastLat"]] = viewport["ne_lat"]
    if "northEastLng" in viewport_params:
        params[viewport_params["northEastLng"]] = viewport["ne_lng"]
    if "southWestLat" in viewport_params:
        params[viewport_params["southWestLat"]] = viewport["sw_lat"]
    if "southWestLng" in viewport_params:
        params[viewport_params["southWestLng"]] = viewport["sw_lng"]
    
    # Add any additional params
    if additional_params:
        params.update(additional_params)
    
    # Build URL
    if "?" in base_url:
        return f"{base_url}&{urlencode(params)}"
    else:
        return f"{base_url}?{urlencode(params)}"


def fetch_viewport_data(
    url: str,
    data_path: str = "",
    timeout: int = 15,
    retry_count: int = 3
) -> List[Dict[str, Any]]:
    """
    Fetch data from a single viewport URL
    
    Args:
        url: Complete API URL with viewport params
        data_path: Path to stores array in response (empty = root array)
        timeout: Request timeout in seconds
        retry_count: Number of retries on failure
    
    Returns:
        List of store dictionaries, or empty list on failure
    """
    for attempt in range(retry_count):
        try:
            resp = requests.get(url, timeout=timeout)
            resp.raise_for_status()
            
            # Check if response is empty
            if not resp.text or resp.text.strip() == '':
                return []  # Empty response, likely no stores in this viewport
            
            # Try to parse JSON
            try:
                data = resp.json()
            except ValueError:
                # Response is not JSON (could be HTML error page)
                return []
            
            # Extract stores from response
            if data_path:
                # Navigate nested path
                keys = data_path.split('.')
                for key in keys:
                    if isinstance(data, dict):
                        data = data.get(key, [])
                    else:
                        return []
            
            # Ensure we have a list
            if isinstance(data, list):
                return data
            else:
                return []
                
        except requests.exceptions.Timeout:
            if attempt < retry_count - 1:
                time.sleep(1 * (attempt + 1))  # Exponential backoff
                continue
            else:
                # Only print timeout errors on final attempt
                return []
        except requests.exceptions.RequestException:
            # Network errors - silently return empty
            return []
        except Exception:
            # Any other error - silently return empty (likely empty viewport)
            return []
    
    return []


def deduplicate_stores(stores: List[Dict[str, Any]], key_field: str = "id") -> List[Dict[str, Any]]:
    """
    Remove duplicate stores based on a key field (e.g., store ID)
    
    Args:
        stores: List of store dictionaries
        key_field: Field to use for deduplication (tries multiple common fields)
    
    Returns:
        Deduplicated list of stores
    """
    seen = set()
    unique_stores = []
    
    # Try multiple possible ID fields
    possible_keys = [key_field, "id", "storeId", "rolexId", "dealerId", "handle", "Handle"]
    
    for store in stores:
        # Find the first available ID field
        store_id = None
        for key in possible_keys:
            if key in store and store[key]:
                store_id = str(store[key])
                break
        
        # If no ID found, use combination of name + lat/lng
        if not store_id:
            name = store.get("name", store.get("nameTranslated", store.get("Name", "")))
            lat = store.get("lat", store.get("latitude", store.get("Latitude", "")))
            lng = store.get("lng", store.get("longitude", store.get("Longitude", "")))
            store_id = f"{name}_{lat}_{lng}"
        
        if store_id not in seen:
            seen.add(store_id)
            unique_stores.append(store)
    
    return unique_stores


def scrape_viewport_api(
    base_url: str,
    viewport_params: Dict[str, str],
    grid_type: str = "world",
    grid_size: int = 20,
    data_path: str = "",
    additional_params: Optional[Dict[str, str]] = None,
    delay_between_requests: float = 0.5,
    progress_interval: int = 50,
    focus_region: Optional[Dict[str, float]] = None
) -> List[Dict[str, Any]]:
    """
    Scrape data from a viewport-based API by querying multiple regions
    
    Args:
        base_url: Base API URL (without viewport params)
        viewport_params: Mapping of standard names to API param names
                        Example: {"northEastLat": "ne_lat", "southWestLat": "sw_lat", ...}
        grid_type: "world" (entire world), "focused" (specific region), "country" (country bounds)
        grid_size: Size of each grid box in degrees (20 = fast/focused on land, 10 = balanced, 5 = thorough)
        data_path: Path to stores array in JSON response
        additional_params: Extra query params (brand, language, etc.)
        delay_between_requests: Seconds to wait between requests (be nice to APIs!)
        progress_interval: Print progress every N requests
        focus_region: For "focused" grid: {"center_lat": 40, "center_lng": -100, "radius": 25}
                     For "country" grid: {"min_lat": 24, "max_lat": 50, "min_lng": -125, "max_lng": -65}
    
    Returns:
        Deduplicated list of all stores found across all viewports
    """
    log_debug("Starting viewport API scraper", "INFO")
    log_debug(f"Grid type: {grid_type} | Grid size: {grid_size}° | Delay: {delay_between_requests}s", "DEBUG")
    
    # Generate viewports based on grid type
    if grid_type == "focused" and focus_region:
        log_debug(f"Generating focused grid: center=({focus_region['center_lat']}, {focus_region['center_lng']}) radius={focus_region.get('radius', 10)}°", "DEBUG")
        viewports = generate_focused_grid(
            focus_region["center_lat"],
            focus_region["center_lng"],
            focus_region.get("radius", 10),
            grid_size
        )
    elif grid_type == "country" and focus_region:
        log_debug(f"Generating country grid: bounds={focus_region}", "DEBUG")
        viewports = generate_country_grid(focus_region, grid_size)
    else:
        # Default to world grid
        log_debug("Generating world grid (full global coverage)", "DEBUG")
        viewports = generate_world_grid(grid_size)
    
    log_debug(f"Grid generated: {len(viewports)} viewports", "SUCCESS")
    print(f"🌍 Generated {len(viewports)} viewports (grid_size={grid_size}°)")
    print(f"   Estimated time: ~{len(viewports) * delay_between_requests / 60:.1f} minutes")
    print(f"   Starting viewport scraping...")
    
    all_stores = []
    empty_viewports = 0
    start_time = time.time()
    
    # Update progress more frequently for live logging
    update_interval = max(10, progress_interval // 5)  # Update every 10 requests or less
    
    for i, viewport in enumerate(viewports, 1):
        # Build URL for this viewport
        url = build_viewport_url(base_url, viewport, viewport_params, additional_params)
        
        # Fetch data
        stores = fetch_viewport_data(url, data_path)
        
        if stores:
            all_stores.extend(stores)
        else:
            empty_viewports += 1
        
        # Progress update - more frequent for live viewing
        if i % update_interval == 0 or i == len(viewports):
            total_found = len(all_stores)
            percent_complete = (i / len(viewports)) * 100
            elapsed = time.time() - start_time
            estimated_total = (elapsed / i) * len(viewports) if i > 0 else 0
            remaining = estimated_total - elapsed
            
            print(f"   [{percent_complete:5.1f}%] {i}/{len(viewports)} viewports | {total_found} stores | {empty_viewports} empty | ETA: {remaining/60:.1f}min")
        
        # Rate limiting
        if i < len(viewports):
            time.sleep(delay_between_requests)
    
    # Deduplicate
    print(f"\n🔍 Deduplicating results...")
    log_debug(f"Starting deduplication | Input: {len(all_stores)} stores", "DEBUG")
    dedup_start = time.time()
    
    unique_stores = deduplicate_stores(all_stores)
    dedup_time = time.time() - dedup_start
    
    duplicates_removed = len(all_stores) - len(unique_stores)
    log_debug(f"Deduplication complete | Output: {len(unique_stores)} unique | Removed: {duplicates_removed} duplicates | Time: {dedup_time:.2f}s", "SUCCESS")
    print(f"✅ Found {len(unique_stores)} unique stores ({duplicates_removed} duplicates removed)")
    
    total_time = time.time() - start_time
    log_debug(f"Viewport scraping complete | Total time: {total_time:.2f}s ({total_time/60:.1f} min)", "SUCCESS")
    
    return unique_stores


# =============================================================================
# PRE-CONFIGURED REGIONAL GRIDS
# =============================================================================

REGION_PRESETS = {
    "north_america": {
        "center_lat": 45.0,
        "center_lng": -100.0,
        "radius": 35
    },
    "usa": {
        "min_lat": 24.5,
        "max_lat": 49.4,
        "min_lng": -125.0,
        "max_lng": -66.9
    },
    "europe": {
        "center_lat": 50.0,
        "center_lng": 10.0,
        "radius": 25
    },
    "uk": {
        "min_lat": 49.9,
        "max_lat": 60.9,
        "min_lng": -8.2,
        "max_lng": 1.8
    },
    "asia": {
        "center_lat": 34.0,
        "center_lng": 100.0,
        "radius": 40
    },
    "japan": {
        "min_lat": 24.0,
        "max_lat": 46.0,
        "min_lng": 123.0,
        "max_lng": 154.0
    },
    "china": {
        "min_lat": 18.0,
        "max_lat": 54.0,
        "min_lng": 73.0,
        "max_lng": 135.0
    },
    "australia": {
        "min_lat": -44.0,
        "max_lat": -10.0,
        "min_lng": 113.0,
        "max_lng": 154.0
    },
    "middle_east": {
        "center_lat": 29.0,
        "center_lng": 47.0,
        "radius": 20
    }
}


def get_region_preset(region_name: str) -> Optional[Dict[str, float]]:
    """Get pre-configured region bounds"""
    return REGION_PRESETS.get(region_name.lower())


# =============================================================================
# EXAMPLE USAGE
# =============================================================================

if __name__ == "__main__":
    print("Viewport Scraper - Example Usage\n")
    
    # Example 1: Small test - just North America with large grid
    print("Example 1: Rolex retailers in North America (test)")
    
    stores = scrape_viewport_api(
        base_url="https://retailers.rolex.com/app/establishments/by_viewport/light",
        viewport_params={
            "northEastLat": "northEastLat",
            "northEastLng": "northEastLng",
            "southWestLat": "southWestLat",
            "southWestLng": "southWestLng"
        },
        grid_type="focused",
        grid_size=15,  # Large boxes for quick test
        additional_params={
            "brand": "RLX",
            "langCode": "en-us",
            "establishmentType": "STORE"
        },
        focus_region=get_region_preset("north_america"),
        delay_between_requests=0.3
    )
    
    print(f"\n✅ Test complete: {len(stores)} stores found")
    print(f"   First store: {stores[0].get('nameTranslated', 'N/A') if stores else 'None'}")

