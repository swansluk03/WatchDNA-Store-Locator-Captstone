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
from typing import Dict, List, Any, Optional
from urllib.parse import urlparse

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


def validate_url(url: Any) -> str:
    """
    Validate and normalize URL
    
    Ensures URL has a scheme (defaults to https://)
    """
    if not url:
        return ""
    
    url_str = str(url).strip()
    
    # If it's a relative URL or missing scheme, add https://
    if url_str and not urlparse(url_str).scheme:
        url_str = f"https://{url_str}"
    
    # Basic validation
    parsed = urlparse(url_str)
    if parsed.scheme and parsed.netloc:
        return url_str
    
    return ""


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

def extract_field(raw_data: Dict, field_config: Any) -> Any:
    """
    Extract a field value from raw data using various accessor methods
    
    Args:
        raw_data: Raw scraped data dictionary
        field_config: Can be:
            - str: Direct key lookup
            - list: Try multiple keys in order, return first non-empty
            - dict: {"key": "field_name", "default": "value", "transform": func}
    
    Returns:
        Extracted value or empty string
    """
    # Simple string key
    if isinstance(field_config, str):
        return raw_data.get(field_config, "")
    
    # List of alternative keys (try in order)
    if isinstance(field_config, list):
        for key in field_config:
            value = raw_data.get(key, "")
            if value:
                return value
        return ""
    
    # Dict with advanced options
    if isinstance(field_config, dict):
        key = field_config.get("key", "")
        default = field_config.get("default", "")
        
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
    normalized["Address Line 1"] = clean_html_tags(mapped_data.get("Address Line 1", ""))
    normalized["Address Line 2"] = clean_html_tags(mapped_data.get("Address Line 2", ""))
    normalized["Postal/ZIP Code"] = clean_html_tags(mapped_data.get("Postal/ZIP Code", ""))
    normalized["City"] = clean_html_tags(mapped_data.get("City", ""))
    normalized["State/Province/Region"] = clean_html_tags(mapped_data.get("State/Province/Region", ""))
    normalized["Country"] = clean_html_tags(mapped_data.get("Country", ""))
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
    deduplicate: bool = True
) -> List[Dict[str, str]]:
    """
    Normalize a batch of locations
    
    Args:
        raw_data_list: List of raw data dictionaries
        field_mapping: Optional field mapping
        deduplicate: If True, ensures unique handles
    
    Returns:
        List of normalized location dictionaries
    """
    existing_handles = set() if deduplicate else None
    normalized_list = []
    
    for raw_data in raw_data_list:
        normalized = normalize_location(raw_data, field_mapping, existing_handles)
        normalized_list.append(normalized)
    
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

