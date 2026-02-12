#!/usr/bin/env python3
"""
Definitive Data Normalizer for Store Locations
===============================================

This module provides the standard algorithm for transforming any scraped data
into the canonical locations.csv format. It handles:
- Field mapping from source schemas to target schema
- Data validation (coordinates, phone numbers, URLs, etc.)
- Data normalization (formatting, cleaning, type conversion)
- Handle generation for missing handles
- Status/boolean field standardization

Usage:
    from data_normalizer import normalize_location, batch_normalize

    # Single location
    raw_data = {"store_name": "Example Store", "lat": "40.7128", ...}
    normalized = normalize_location(raw_data, field_mapping)

    # Batch processing
    normalized_batch = batch_normalize(raw_data_list, field_mapping)
"""

import re
import csv
import os
import json
import time
from typing import Dict, List, Any, Optional, Tuple
from urllib.parse import urlparse, urljoin
from urllib.parse import urlparse

# Geocoding support (optional - only used if geopy is available)
try:
    from geopy.geocoders import Nominatim
    from geopy.exc import GeocoderTimedOut, GeocoderServiceError, GeocoderUnavailable
    GEOPY_AVAILABLE = True
except ImportError:
    GEOPY_AVAILABLE = False
    Nominatim = None

# The canonical schema for locations.csv (loaded from root locations.csv)
CANONICAL_SCHEMA = [
    "Handle", "Name", "Status", "Address Line 1", "Address Line 2", "Postal/ZIP Code",
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
    "Custom Button URL 2 - ES"
]

# Try to load schema from the repository's locations2.csv (the master template)
def load_canonical_schema():
    """Load the canonical schema from locations2.csv if it exists"""
    # Try locations2.csv first (this is the master template with correct formatting)
    csv_path2 = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "locations2.csv"))
    if os.path.exists(csv_path2):
        try:
            with open(csv_path2, newline='', encoding='utf-8') as f:
                header_line = f.readline().strip()
                if header_line:
                    # Don't strip individual headers - preserve spaces like " Tags"
                    return [h for h in header_line.split(',')]
        except Exception as e:
            print(f"⚠️  Could not load schema from locations2.csv: {e}")
    
    # Fall back to locations.csv if locations2.csv doesn't exist
    csv_path = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "locations.csv"))
    if os.path.exists(csv_path):
        try:
            with open(csv_path, newline='', encoding='utf-8') as f:
                header_line = f.readline().strip()
                if header_line:
                    return [h for h in header_line.split(',')]
        except Exception as e:
            print(f"⚠️  Could not load schema from locations.csv: {e}")
    
    return CANONICAL_SCHEMA

SCHEMA = load_canonical_schema()


# =============================================================================
# DATA VALIDATION FUNCTIONS
# =============================================================================

def clean_html_tags(text: Any) -> str:
    """
    Remove HTML tags and Unicode control characters from text
    
    Args:
        text: Text that may contain HTML tags or Unicode control chars
    
    Returns:
        Cleaned text string
    """
    if not text:
        return ""
    
    text_str = str(text).strip()
    
    # Replace common HTML tags
    import re
    # Replace <br>, <br/>, <br />, etc. with space
    text_str = re.sub(r'<br\s*/?>', ' ', text_str, flags=re.IGNORECASE)
    # Remove any other HTML tags
    text_str = re.sub(r'<[^>]+>', '', text_str)
    
    # Remove Unicode control characters (like RTL/LTR marks)
    # These include: U+200E, U+200F, U+202A-U+202E, U+2066-U+2069
    text_str = re.sub(r'[\u200E\u200F\u202A-\u202E\u2066-\u2069]', '', text_str)
    
    # Clean up multiple spaces
    text_str = re.sub(r'\s+', ' ', text_str)
    
    return text_str.strip()


def clean_address(address: Any) -> str:
    """
    Clean and normalize address strings by fixing common backslash issues
    
    Fixes:
    - Backslash before forward slash (\\/ -> /)
    - Double backslashes (\\\\ -> , ) for address separators
    - Spanish Calle abbreviation (C\\/ -> C/)
    
    Args:
        address: Address string that may contain backslash issues
    
    Returns:
        Cleaned address string
    """
    if not address:
        return ""
    
    address_str = str(address).strip()
    
    # Fix backslash before forward slash (\/ -> /)
    # This is the most common issue: 1\/F -> 1/F, C\/ -> C/, MA-66\/103 -> MA-66/103, etc.
    address_str = address_str.replace('\\/', '/')
    
    # Fix Spanish Calle abbreviation (C\/ -> C/)
    # This handles cases where C\/ wasn't caught by the above (shouldn't happen, but safe)
    address_str = re.sub(r'\bC\\/', 'C/', address_str)
    
    # Fix double backslashes (\\ -> , ) for address separators
    # Common pattern: "Mall \\ Location" should be "Mall, Location"
    # Replace \\ with comma and space, but preserve single \ that might be part of Unicode escapes
    # We'll do a simple replacement: \\ -> , 
    # Note: In the CSV string, \\ represents a literal backslash, so we need to match literal \\
    address_str = re.sub(r'\\\\+', ', ', address_str)
    
    # Clean up any double spaces or spaces before commas that might have been created
    address_str = re.sub(r'\s+', ' ', address_str)
    address_str = re.sub(r'\s*,', ',', address_str)  # Remove space before comma
    address_str = re.sub(r',\s*,', ',', address_str)  # Remove double commas
    
    return address_str.strip()


def validate_coordinate(value: Any, coord_type: str = "latitude") -> Optional[str]:
    """
    Validate and normalize a coordinate value
    
    Args:
        value: Raw coordinate value (string, float, int, etc.)
        coord_type: "latitude" or "longitude"
    
    Returns:
        Normalized coordinate string with 7 decimal places, or empty string if invalid
    """
    if value is None or value == "":
        return ""
    
    try:
        coord = float(str(value).strip())
        
        # Validate range
        if coord_type.lower() == "latitude":
            if not (-90 <= coord <= 90):
                return ""
        else:  # longitude
            if not (-180 <= coord <= 180):
                return ""
        
        # Check for NaN/Inf
        if not (-180 <= coord <= 180):  # Catches NaN and Inf
            return ""
        
        return f"{coord:.7f}"
    except (ValueError, TypeError):
        return ""


def validate_phone(phone: Any) -> str:
    """
    Normalize phone number format
    
    Accepts various formats and standardizes them
    Examples: 
        "(555) 123-4567" -> "(555) 123-4567"
        "555.123.4567" -> "555-123-4567"
        "+1-555-123-4567" -> "+1-555-123-4567"
    """
    if not phone:
        return ""
    
    phone_str = str(phone).strip()
    
    # Remove common unwanted chars but preserve valid ones
    # Keep: digits, +, -, (, ), spaces, x/ext for extensions
    phone_str = re.sub(r'[^\d+\-()xX\s]', '', phone_str)
    
    return phone_str


def validate_email(email: Any) -> str:
    """
    Basic email validation
    
    Returns cleaned email or empty string if invalid
    """
    if not email:
        return ""
    
    email_str = str(email).strip().lower()
    
    # Basic email pattern
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    
    if re.match(pattern, email_str):
        return email_str
    
    return ""


def validate_url(url: Any, validate_http: bool = False) -> str:
    """
    Validate and normalize URL
    
    Ensures URL has a scheme (defaults to https://)
    Converts relative Omega store detail URLs to full URLs
    Optionally validates URLs via HTTP request
    
    Args:
        url: URL string to validate
        validate_http: If True, make HTTP request to verify URL is accessible
    
    Returns:
        Validated and normalized URL, or empty string if invalid
    """
    if not url:
        return ""
    
    url_str = str(url).strip()
    
    # Fix escaped slashes (\/ -> /)
    url_str = url_str.replace('\\/', '/').replace('\\', '/')
    
    # Check if this is an Omega store detail URL (relative or absolute)
    # Pattern: store/storedetails/XXXX or /store/storedetails/XXXX
    omega_store_pattern = r'(?:^|/)(?:store[/\\]storedetails[/\\])(\d+[^/]*)/?$'
    omega_match = re.search(omega_store_pattern, url_str, re.IGNORECASE)
    
    if omega_match:
        # This is an Omega store detail page - convert to full URL
        store_id = omega_match.group(1)
        url_str = f"https://www.omegawatches.com/en-us/store/storedetails/{store_id}"
    
    # If it's a relative URL or missing scheme, add https://
    if url_str and not urlparse(url_str).scheme:
        url_str = f"https://{url_str}"
    
    # Basic validation - must have scheme and netloc
    parsed = urlparse(url_str)
    if not (parsed.scheme and parsed.netloc):
        return ""
    
    # Optional HTTP validation
    if validate_http:
        try:
            import requests
            response = requests.head(url_str, timeout=5, allow_redirects=True)
            if response.status_code >= 400:
                # If HEAD fails, try GET
                response = requests.get(url_str, timeout=5, allow_redirects=True, stream=True)
                if response.status_code >= 400:
                    return ""  # URL not accessible
        except Exception:
            # If validation fails (network error, etc.), still return the URL
            # as it might be valid but temporarily unavailable
            pass
    
    return url_str


def validate_boolean(value: Any, default: bool = True) -> str:
    """
    Convert various boolean representations to "TRUE" or "FALSE"
    
    Args:
        value: Any value that might represent a boolean
        default: Default value if conversion fails
    
    Returns:
        "TRUE" or "FALSE"
    """
    if value is None:
        return "TRUE" if default else "FALSE"
    
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    
    str_val = str(value).strip().lower()
    
    # True values
    if str_val in ("1", "true", "yes", "y", "active", "enabled", "on"):
        return "TRUE"
    
    # False values
    if str_val in ("0", "false", "no", "n", "inactive", "disabled", "off"):
        return "FALSE"
    
    return "TRUE" if default else "FALSE"


def generate_handle(name: str, city: str = "", existing_handles: set = None) -> str:
    """
    Generate a URL-friendly handle from name and city
    
    Args:
        name: Store name
        city: Store city (optional, helps with uniqueness)
        existing_handles: Set of handles already in use (for uniqueness)
    
    Returns:
        URL-friendly handle string
    """
    if not name:
        name = "store"
    
    # Combine name and city
    base = f"{name}-{city}" if city else name
    
    # Convert to lowercase and replace spaces/special chars with hyphens
    handle = re.sub(r'[^\w\s-]', '', base.lower())
    handle = re.sub(r'[-\s]+', '-', handle)
    handle = handle.strip('-')
    
    # Ensure uniqueness if existing_handles provided
    if existing_handles is not None:
        if handle in existing_handles:
            counter = 1
            while f"{handle}-{counter}" in existing_handles:
                counter += 1
            handle = f"{handle}-{counter}"
        existing_handles.add(handle)
    
    return handle


# =============================================================================
# FIELD MAPPING AND EXTRACTION
# =============================================================================

def get_nested_value(obj: Dict, path: str) -> Any:
    """
    Extract nested value from dict using dot notation path
    
    Args:
        obj: Dictionary to extract from
        path: Dot-notation path (e.g., "address.city" or "yextDisplayCoordinate.latitude")
    
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


def extract_field(raw_data: Dict, field_config: Any) -> Any:
    """
    Extract a field value from raw data using various accessor methods
    
    Args:
        raw_data: Raw scraped data dictionary
        field_config: Can be:
            - str: Direct key lookup or dot-notation path (e.g., "address.city")
            - list: Try multiple keys in order, return first non-empty
            - dict: {"key": "field_name", "default": "value", "transform": func}
    
    Returns:
        Extracted value or empty string
    """
    # Simple string key (supports dot notation for nested paths and array indices)
    if isinstance(field_config, str):
        if '.' in field_config:
            # Use dot notation for nested paths (supports array indices like "emails.0")
            parts = field_config.split('.')
            value = raw_data
            for part in parts:
                if value is None:
                    return ""
                if isinstance(value, dict):
                    value = value.get(part)
                elif isinstance(value, list):
                    try:
                        idx = int(part)
                        if 0 <= idx < len(value):
                            value = value[idx]
                        else:
                            return ""
                    except ValueError:
                        return ""
                else:
                    return ""
            return value if value is not None else ""
        else:
            return raw_data.get(field_config, "")
    
    # List of alternative keys (try in order, supports dot notation)
    if isinstance(field_config, list):
        for key in field_config:
            if '.' in key:
                value = get_nested_value(raw_data, key)
            else:
                value = raw_data.get(key, "")
            if value:
                return value
        return ""
    
    # Dict with advanced options
    if isinstance(field_config, dict):
        key = field_config.get("key", "")
        default = field_config.get("default", "")
        
        if '.' in key:
            value = get_nested_value(raw_data, key)
            value = value if value is not None else default
        else:
            value = raw_data.get(key, default)
        
        # Apply transformation if provided
        transform = field_config.get("transform")
        if transform and callable(transform):
            value = transform(value)
        
        return value
    
    return ""


def apply_field_mapping(raw_data: Dict, field_mapping: Dict[str, Any]) -> Dict[str, str]:
    """
    Apply field mapping to transform raw data into canonical schema
    
    Args:
        raw_data: Raw scraped data dictionary
        field_mapping: Dictionary mapping canonical field names to source field configs
    
    Returns:
        Dictionary with canonical field names and extracted values
    """
    mapped_data = {}
    
    for canonical_field, source_config in field_mapping.items():
        mapped_data[canonical_field] = extract_field(raw_data, source_config)
    
    return mapped_data


# =============================================================================
# COUNTRY INFERENCE FUNCTION
# =============================================================================

def infer_country_from_address(
    address: str,
    city: str = "",
    state: str = "",
    country: str = ""
) -> str:
    """
    Infer country from address fields by matching country names and common patterns.
    
    Args:
        address: Address line 1
        city: City name
        state: State/Province/Region
        country: Existing country (if already set, return it)
    
    Returns:
        Country name if found, empty string otherwise
    """
    # If country is already set, return it
    if country and country.strip():
        return country.strip()
    
    # Load country names from watch_store_countries.json
    countries_file = os.path.join(os.path.dirname(__file__), "watch_store_countries.json")
    country_names = []
    country_codes_to_names = {}
    
    try:
        if os.path.exists(countries_file):
            with open(countries_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if "countries" in data:
                    # Get country code to name mapping
                    country_codes_to_names = data["countries"]
                    # Get all country names (values)
                    country_names = list(country_codes_to_names.values())
                    # Also add common variations
                    country_variations = {
                        "United States": ["USA", "US", "U.S.", "U.S.A.", "United States of America"],
                        "United Kingdom": ["UK", "U.K.", "Great Britain", "Britain", "England", "Scotland", "Wales"],
                        "United Arab Emirates": ["UAE", "U.A.E."],
                        "South Korea": ["Korea", "South Korea", "Republic of Korea"],
                        "Czech Republic": ["Czechia"],
                        "Hong Kong": ["HK"],
                    }
                    for main_name, variations in country_variations.items():
                        if main_name in country_names:
                            country_names.extend(variations)
    except Exception:
        # Fallback to common country names if file not found
        country_names = [
            "United States", "Canada", "Mexico", "United Kingdom", "France", "Germany",
            "Italy", "Spain", "Switzerland", "Japan", "China", "Hong Kong", "Singapore",
            "Australia", "United Arab Emirates", "Saudi Arabia", "Brazil", "Argentina"
        ]
    
    # Combine all address fields into one search string
    search_text = f"{address} {city} {state}".lower()
    
    # Search for country names (longest first to match "United States" before "States")
    # But avoid false matches like "Wales" in "New South Wales"
    country_names_sorted = sorted(country_names, key=len, reverse=True)
    
    # Exclude "Wales" from matching (to avoid matching "New South Wales")
    excluded_matches = {"wales"}  # Can add more if needed
    
    for country_name in country_names_sorted:
        country_lower = country_name.lower()
        if country_lower in excluded_matches:
            continue  # Skip excluded matches
        if country_lower in search_text:
            # Additional check: if matching "Wales", make sure it's not part of "New South Wales" or similar
            if country_lower == "wales":
                if "new south wales" in search_text or "south wales" in search_text:
                    continue
            return country_name
    
    # Try to infer from Australian states first (to avoid WA conflict)
    australian_states_abbrev = {"NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"}
    if state and state.strip().upper() in australian_states_abbrev:
        return "Australia"
    
    # Try to infer from US state abbreviations (common pattern)
    # Note: WA is excluded here as it could be Western Australia
    us_states = {
        "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
        "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
        "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
        "VA", "WV", "WI", "WY"
    }
    if state and state.strip().upper() in us_states:
        return "United States"
    
    # Handle WA specifically - check city for context
    if state and state.strip().upper() == "WA":
        # If city is known Australian city, it's Australia; otherwise assume US
        australian_cities = {"perth", "fremantle", "bunbury", "geraldton", "kalgoorlie"}
        if city and city.lower().strip() in australian_cities:
            return "Australia"
        else:
            return "United States"  # Default to US (Washington)
    
    # Try to infer from Canadian provinces
    canadian_provinces = {
        "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"
    }
    if state and state.strip().upper() in canadian_provinces:
        return "Canada"
    
    # Try to infer from Australian states/territories (full names)
    australian_states_full = {
        "New South Wales", "Victoria", "Queensland", "Western Australia",
        "South Australia", "Tasmania", "Australian Capital Territory", "Northern Territory"
    }
    if state and state.strip() in australian_states_full:
        return "Australia"
    # Also check if state contains Australian state name
    state_lower = state.lower() if state else ""
    if "queensland" in state_lower or "new south wales" in state_lower or "western australia" in state_lower:
        return "Australia"
    
    # Common city-to-country mappings (for well-known cities)
    city_country_map = {
        "london": "United Kingdom",
        "paris": "France",
        "tokyo": "Japan",
        "berlin": "Germany",
        "rome": "Italy",
        "madrid": "Spain",
        "amsterdam": "Netherlands",
        "vienna": "Austria",
        "zurich": "Switzerland",
        "geneva": "Switzerland",
        "milan": "Italy",
        "barcelona": "Spain",
        "munich": "Germany",
        "frankfurt": "Germany",
        "brussels": "Belgium",
        "copenhagen": "Denmark",
        "stockholm": "Sweden",
        "oslo": "Norway",
        "helsinki": "Finland",
        "dublin": "Ireland",
        "lisbon": "Portugal",
        "athens": "Greece",
        "warsaw": "Poland",
        "prague": "Czech Republic",
        "budapest": "Hungary",
        "bucharest": "Romania",
        "sydney": "Australia",
        "melbourne": "Australia",
        "auckland": "New Zealand",
        "singapore": "Singapore",
        "hong kong": "Hong Kong",
        "dubai": "United Arab Emirates",
        "riyadh": "Saudi Arabia",
        "doha": "Qatar",
        "kuwait city": "Kuwait",
        "manama": "Bahrain",
        "muscat": "Oman",
        "tel aviv": "Israel",
        "istanbul": "Turkey",
        "cairo": "Egypt",
        "johannesburg": "South Africa",
        "cape town": "South Africa",
        "sao paulo": "Brazil",
        "rio de janeiro": "Brazil",
        "buenos aires": "Argentina",
        "santiago": "Chile",  # Most common Santiago is in Chile
        "lima": "Peru",
        "bogota": "Colombia",
        "mexico city": "Mexico",
        "moscow": "Russia",
        "beijing": "China",
        "shanghai": "China",
        "seoul": "South Korea",
        "taipei": "Taiwan",
        "bangkok": "Thailand",
        "kuala lumpur": "Malaysia",
        "jakarta": "Indonesia",
        "manila": "Philippines",
        "ho chi minh city": "Vietnam",
        "mumbai": "India",
        "delhi": "India",
        "karachi": "Pakistan",
        "marigot": "France",  # Saint Martin (French territory)
    }
    
    city_lower = city.lower().strip()
    if city_lower in city_country_map:
        return city_country_map[city_lower]
    
    # Check for US territories and special cases
    us_territories = {
        "saipan": "United States",  # Northern Mariana Islands (US territory)
        "guam": "United States",
        "puerto rico": "United States",
        "us virgin islands": "United States",
    }
    
    search_lower = search_text.lower()
    for territory, country in us_territories.items():
        if territory in search_lower:
            return country
    
    return ""


# =============================================================================
# GEOCODING FUNCTION (for missing coordinates)
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


# =============================================================================
# MAIN NORMALIZATION FUNCTION
# =============================================================================

def normalize_location(
    raw_data: Dict[str, Any],
    field_mapping: Optional[Dict[str, Any]] = None,
    existing_handles: Optional[set] = None
) -> Dict[str, str]:
    """
    The definitive algorithm for normalizing store location data
    
    This function transforms any raw scraped data into the canonical format.
    
    Args:
        raw_data: Raw data dictionary from scraper
        field_mapping: Optional mapping of canonical fields to source fields
                      If None, assumes raw_data already uses canonical field names
        existing_handles: Set of existing handles (for uniqueness)
    
    Returns:
        Normalized dictionary matching the canonical schema
    """
    # Initialize with empty values for all canonical fields
    normalized = {field: "" for field in SCHEMA}
    
    # Apply field mapping if provided
    if field_mapping:
        mapped_data = apply_field_mapping(raw_data, field_mapping)
    else:
        mapped_data = raw_data
    
    # Basic fields (direct copy with cleaning - also clean HTML tags)
    normalized["Name"] = clean_html_tags(mapped_data.get("Name", ""))
    # Address fields need special cleaning for backslash issues
    normalized["Address Line 1"] = clean_address(clean_html_tags(mapped_data.get("Address Line 1", "")))
    normalized["Address Line 2"] = clean_address(clean_html_tags(mapped_data.get("Address Line 2", "")))
    normalized["Postal/ZIP Code"] = clean_html_tags(mapped_data.get("Postal/ZIP Code", ""))
    normalized["City"] = clean_html_tags(mapped_data.get("City", ""))
    normalized["State/Province/Region"] = clean_html_tags(mapped_data.get("State/Province/Region", ""))
    country_raw = clean_html_tags(mapped_data.get("Country", ""))
    
    # If country is missing, try to infer it from address
    if not country_raw or not country_raw.strip():
        inferred_country = infer_country_from_address(
            normalized["Address Line 1"],
            normalized["City"],
            normalized["State/Province/Region"],
            country_raw
        )
        if inferred_country:
            normalized["Country"] = inferred_country
        else:
            normalized["Country"] = ""
    else:
        normalized["Country"] = country_raw
    
    normalized["Priority"] = clean_html_tags(mapped_data.get("Priority", ""))
    
    # Validated fields
    normalized["Status"] = validate_boolean(mapped_data.get("Status", True), default=True)
    normalized["Phone"] = validate_phone(mapped_data.get("Phone", ""))
    normalized["Email"] = validate_email(mapped_data.get("Email", ""))
    normalized["Website"] = validate_url(mapped_data.get("Website", ""))
    normalized["Image URL"] = validate_url(mapped_data.get("Image URL", ""))
    
    # Coordinates (critical for mapping)
    normalized["Latitude"] = validate_coordinate(mapped_data.get("Latitude", ""), "latitude")
    normalized["Longitude"] = validate_coordinate(mapped_data.get("Longitude", ""), "longitude")
    
    # Generate handle if missing
    normalized["Handle"] = str(mapped_data.get("Handle", "")).strip()
    if not normalized["Handle"]:
        normalized["Handle"] = generate_handle(
            normalized["Name"],
            normalized["City"],
            existing_handles
        )
    elif existing_handles is not None:
        existing_handles.add(normalized["Handle"])
    
    # Store hours (typically left empty, but include if provided)
    for day in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]:
        normalized[day] = str(mapped_data.get(day, "")).strip()
    
    # Page metadata
    normalized["Page Title"] = str(mapped_data.get("Page Title", "")).strip()
    normalized["Page Description"] = str(mapped_data.get("Page Description", "")).strip()
    normalized["Meta Title"] = str(mapped_data.get("Meta Title", "")).strip()
    normalized["Meta Description"] = str(mapped_data.get("Meta Description", "")).strip()
    
    # Tags and brands (handle lists or comma-separated strings)
    tags = mapped_data.get(" Tags", mapped_data.get("Tags", ""))  # Support both with and without space
    if isinstance(tags, list):
        normalized[" Tags"] = ",".join([str(t).strip() for t in tags if t])
    else:
        normalized[" Tags"] = str(tags).strip()
    
    brands = mapped_data.get("Custom Brands", "")
    if isinstance(brands, list):
        normalized["Custom Brands"] = ",".join([str(b).strip() for b in brands if b])
    else:
        normalized["Custom Brands"] = str(brands).strip()
    
    # Localized fields (FR, ZH-CN, ES)
    localized_prefixes = [
        ("Name", "Name"),
        ("Page Title", "Page Title"),
        ("Page Description", "Page Description"),
        ("Custom Brands", "Custom Brands")
    ]
    
    for base, field_prefix in localized_prefixes:
        for lang in [" - FR", " - ZH-CN", " - ES"]:
            field_name = f"{field_prefix}{lang}"
            normalized[field_name] = str(mapped_data.get(field_name, "")).strip()
    
    # Custom buttons (up to 2 buttons with localization)
    for btn_num in ["1", "2"]:
        # English
        normalized[f"Custom Button title {btn_num}"] = str(mapped_data.get(f"Custom Button title {btn_num}", "")).strip()
        normalized[f"Custom Button URL {btn_num}"] = validate_url(mapped_data.get(f"Custom Button URL {btn_num}", ""))
        
        # Localized
        for lang in [" - FR", " - ZH-CN", " - ES"]:
            title_key = f"Custom Button title {btn_num}{lang}"
            url_key = f"Custom Button URL {btn_num}{lang}"
            normalized[title_key] = str(mapped_data.get(title_key, "")).strip()
            normalized[url_key] = validate_url(mapped_data.get(url_key, ""))
    
    return normalized


def batch_normalize(
    raw_data_list: List[Dict[str, Any]],
    field_mapping: Optional[Dict[str, Any]] = None,
    deduplicate: bool = True,
    geocode_missing: bool = True
) -> List[Dict[str, str]]:
    """
    Normalize a batch of locations with comprehensive deduplication.
    Attempts to geocode stores missing coordinates, then excludes stores without coordinates and logs them clearly.
    
    Args:
        raw_data_list: List of raw data dictionaries
        field_mapping: Optional field mapping
        deduplicate: If True, ensures unique handles and removes duplicates by name+address+city
        geocode_missing: If True, attempt to geocode stores missing coordinates (default: True)
    
    Returns:
        List of normalized location dictionaries (deduplicated, excluding stores without coordinates)
    """
    existing_handles = set() if deduplicate else None
    normalized_list = []
    seen_combinations = set()  # Track name+address+city combinations
    excluded_stores = []  # Track stores excluded due to missing coordinates
    
    for raw_data in raw_data_list:
        normalized = normalize_location(raw_data, field_mapping, existing_handles)
        
        # Check if coordinates are missing (critical - store cannot be mapped without coordinates)
        lat = normalized.get("Latitude", "").strip()
        lon = normalized.get("Longitude", "").strip()
        
        # If coordinates are missing, try to geocode the address
        if (not lat or not lon) and geocode_missing:
            store_address = normalized.get("Address Line 1", "").strip()
            store_city = normalized.get("City", "").strip()
            store_state = normalized.get("State/Province/Region", "").strip()
            store_country = normalized.get("Country", "").strip()
            
            # Try geocoding if we have address information
            if store_address or store_city:
                geocoded = geocode_address(store_address, store_city, store_state, store_country)
                if geocoded:
                    lat, lon = geocoded
                    normalized["Latitude"] = f"{lat:.7f}"
                    normalized["Longitude"] = f"{lon:.7f}"
                    # Update lat/lon variables for the check below
                    lat = normalized["Latitude"]
                    lon = normalized["Longitude"]
        
        # If still no coordinates after geocoding attempt, exclude the store
        if not lat or not lon:
            store_name = normalized.get("Name", "Unknown").strip()
            store_address = normalized.get("Address Line 1", "").strip()
            store_city = normalized.get("City", "").strip()
            store_country = normalized.get("Country", "").strip()
            
            # Build address string for logging
            address_parts = [store_address, store_city, store_country]
            address_str = ", ".join([p for p in address_parts if p])
            if not address_str:
                address_str = "Address not available"
            
            excluded_stores.append({
                "name": store_name,
                "address": address_str,
                "reason": "Missing coordinates (Latitude/Longitude) - geocoding failed or insufficient address data"
            })
            continue  # Skip this store - exclude from output
        
        # Additional deduplication by name+address+city (even if handles differ)
        if deduplicate:
            name = normalized.get("Name", "").strip().lower()
            addr = normalized.get("Address Line 1", "").strip().lower()
            city = normalized.get("City", "").strip().lower()
            
            if name and addr:  # Only deduplicate if we have name and address
                combo_key = f"{name}|{addr}|{city}"
                if combo_key in seen_combinations:
                    # Duplicate found - skip this store
                    continue
                seen_combinations.add(combo_key)
        
        normalized_list.append(normalized)
    
    # Log excluded stores clearly (flush immediately so it appears in scraper output)
    if excluded_stores:
        import sys
        print("\n" + "=" * 80, flush=True)
        print(f"⚠️  EXCLUDED STORES (Missing Coordinates): {len(excluded_stores)} store(s)", flush=True)
        print("=" * 80, flush=True)
        print("These stores were excluded because they lack Latitude/Longitude coordinates.", flush=True)
        print("This may indicate closed stores, old data, or incomplete records.", flush=True)
        print("Please verify these stores manually:\n", flush=True)
        
        for i, store in enumerate(excluded_stores, 1):
            print(f"{i}. Store Name: {store['name']}", flush=True)
            print(f"   Address: {store['address']}", flush=True)
            print(f"   Reason: {store['reason']}", flush=True)
            print(flush=True)
        
        print("=" * 80, flush=True)
        print(flush=True)
    
    return normalized_list


# =============================================================================
# CSV I/O FUNCTIONS
# =============================================================================

def write_normalized_csv(data: List[Dict[str, str]], filename: str = "output/locations.csv"):
    """
    Write normalized data to CSV using the canonical schema with Unix line endings
    
    Args:
        data: List of normalized location dictionaries
        filename: Output CSV file path
    """
    os.makedirs(os.path.dirname(filename) if os.path.dirname(filename) else '.', exist_ok=True)
    
    # Write CSV with standard newline handling
    with open(filename, 'w', newline='', encoding='utf-8') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=SCHEMA, lineterminator='\n')
        writer.writeheader()
        for row in data:
            writer.writerow(row)
    
    # Post-process to ensure Unix line endings (\n only, no \r\n)
    # This is necessary because csv module may still write \r\n on some systems
    with open(filename, 'rb') as f:
        content = f.read()
    content = content.replace(b'\r\n', b'\n')  # Convert Windows to Unix
    with open(filename, 'wb') as f:
        f.write(content)
    
    print(f"✅ Exported {len(data)} normalized locations to {filename}")


def read_csv_to_dict(filename: str) -> List[Dict[str, str]]:
    """
    Read a CSV file into a list of dictionaries
    
    Args:
        filename: Input CSV file path
    
    Returns:
        List of dictionaries (one per row)
    """
    with open(filename, 'r', newline='', encoding='utf-8') as csvfile:
        reader = csv.DictReader(csvfile)
        return list(reader)


# =============================================================================
# EXAMPLE USAGE
# =============================================================================

if __name__ == "__main__":
    # Example 1: Normalize with direct field names
    print("Example 1: Direct normalization")
    raw_store = {
        "Name": "Example Watch Store",
        "Address Line 1": "123 Main St",
        "City": "New York",
        "Country": "USA",
        "Latitude": "40.7128",
        "Longitude": "-74.0060",
        "Phone": "555.123.4567",
        "Status": "1"
    }
    
    normalized = normalize_location(raw_store)
    print(f"  Name: {normalized['Name']}")
    print(f"  Handle: {normalized['Handle']}")
    print(f"  Phone: {normalized['Phone']}")
    print(f"  Status: {normalized['Status']}")
    print(f"  Coords: {normalized['Latitude']}, {normalized['Longitude']}")
    
    # Example 2: Normalize with field mapping
    print("\nExample 2: With field mapping")
    raw_api_data = {
        "store_name": "Another Store",
        "street": "456 Oak Ave",
        "city_name": "Boston",
        "lat": 42.3601,
        "lng": -71.0589,
        "is_active": True
    }
    
    field_mapping = {
        "Name": "store_name",
        "Address Line 1": "street",
        "City": "city_name",
        "Latitude": "lat",
        "Longitude": "lng",
        "Status": "is_active"
    }
    
    normalized2 = normalize_location(raw_api_data, field_mapping)
    print(f"  Name: {normalized2['Name']}")
    print(f"  Handle: {normalized2['Handle']}")
    print(f"  Address: {normalized2['Address Line 1']}, {normalized2['City']}")
    print(f"  Coords: {normalized2['Latitude']}, {normalized2['Longitude']}")
    
    # Example 3: Batch normalization
    print("\nExample 3: Batch normalization")
    batch_data = [raw_store, raw_api_data]
    normalized_batch = batch_normalize(batch_data, field_mapping=None)
    print(f"  Normalized {len(normalized_batch)} locations")
    print(f"  Handles: {[loc['Handle'] for loc in normalized_batch]}")

