#!/usr/bin/env python3
"""
Store Locator Type Detector & Strategy Planner
===============================================

Detects WHAT TYPE of store locator is being used and provides strategies
to scrape ALL locations worldwide, not just a single region.

Based on research of luxury watch retailers (Rolex, Omega, Cartier, Patek Philippe, etc.)
and common store locator patterns.

Common Store Locator Types:
1. Viewport/Bounds-based (requires lat/lng bounds) - Rolex, some Shopify
2. Country/Region filters (dropdown selections) - Omega, Cartier  
3. Search radius (center point + radius) - Many custom implementations
4. Paginated full list (all stores, but paginated) - REST APIs
5. Single endpoint (all stores in one call) - Simple APIs
6. ZIP/Postal code search - US-focused retailers
7. City/Location search - Google-like search
"""

import re
import requests
from typing import Dict, List, Any, Optional
from urllib.parse import urlparse, parse_qs
import json


# =============================================================================
# LOCATOR TYPE DEFINITIONS
# =============================================================================

LOCATOR_TYPES = {
    "viewport": {
        "name": "Viewport/Bounds-Based API",
        "description": "Requires lat/lng bounds to return stores in that area",
        "indicators": ["viewport", "bounds", "bbox", "ne_lat", "sw_lat", "northEast", "southWest", "by_viewport"],
        "examples": ["Rolex retailers", "Some Shopify stores"],
        "strategy": "grid_scraping",
        "complexity": "high",
        "can_get_all": True
    },
    "country_filter": {
        "name": "Country/Region Filter",
        "description": "Filters by country code or region parameter",
        "indicators": ["country", "countryCode", "country_code", "region", "regionCode"],
        "examples": ["Omega, Cartier, TAG Heuer"],
        "strategy": "iterate_countries",
        "complexity": "medium",
        "can_get_all": True
    },
    "radius_search": {
        "name": "Radius/Distance Search",
        "description": "Returns stores within radius of a coordinate",
        "indicators": ["radius", "distance", "within", "near"],
        "examples": ["Many custom implementations"],
        "strategy": "grid_points",
        "complexity": "high",
        "can_get_all": True
    },
    "paginated": {
        "name": "Paginated Full List",
        "description": "All stores available but split across pages",
        "indicators": ["page", "limit", "offset", "per_page", "skip", "take"],
        "examples": ["REST APIs", "WordPress stores"],
        "strategy": "pagination",
        "complexity": "low",
        "can_get_all": True
    },
    "single_call": {
        "name": "Single Endpoint (All Data)",
        "description": "Returns all stores in one API call",
        "indicators": [],
        "examples": ["Simple APIs", "Small chains"],
        "strategy": "direct_fetch",
        "complexity": "low",
        "can_get_all": True
    },
    "zip_search": {
        "name": "ZIP/Postal Code Search",
        "description": "Requires ZIP code to search",
        "indicators": ["zip", "zipcode", "postal", "postcode", "postalCode"],
        "examples": ["US-focused retailers"],
        "strategy": "zip_iteration",
        "complexity": "very_high",
        "can_get_all": False  # Impractical - too many ZIP codes
    },
    "city_search": {
        "name": "City/Location Text Search",
        "description": "Requires city name or address search",
        "indicators": ["city", "location", "address", "search", "q", "query"],
        "examples": ["Google-like search"],
        "strategy": "city_list",
        "complexity": "high",
        "can_get_all": True
    }
}


# =============================================================================
# DETECTION FUNCTIONS
# =============================================================================

def detect_locator_type(url: str, sample_response: Any = None) -> Dict[str, Any]:
    """
    Detect what type of store locator this is and if it's region-specific
    
    Args:
        url: The API endpoint URL
        sample_response: Optional sample response data
    
    Returns:
        Dict with type, confidence, strategy, and expansion needs
    """
    result = {
        "url": url,
        "detected_type": "unknown",
        "confidence": 0.0,
        "url_params": {},
        "is_region_specific": False,
        "can_expand_to_world": False,
        "expansion_strategy": None,
        "complexity": "unknown",
        "matched_indicators": [],
        "estimated_calls_world": 1,
        "estimated_time_min": 0
    }
    
    # Parse URL
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    result["url_params"] = {k: v[0] if len(v) == 1 else v for k, v in params.items()}
    
    # Score each locator type
    scores = {}
    
    for type_key, type_info in LOCATOR_TYPES.items():
        score = 0.0
        matched = []
        
        # Check URL parameters
        for indicator in type_info["indicators"]:
            if any(indicator.lower() in k.lower() for k in params.keys()):
                score += 1.0
                matched.append(indicator)
            
            # Check URL path
            if indicator.lower() in parsed.path.lower():
                score += 0.5
                if indicator not in matched:
                    matched.append(indicator)
        
        if score > 0:
            scores[type_key] = {
                "score": score,
                "matched": matched,
                "info": type_info
            }
    
    # Determine best match
    if scores:
        best = max(scores.items(), key=lambda x: x[1]["score"])
        result["detected_type"] = best[0]
        result["confidence"] = min(best[1]["score"] / 2.0, 1.0)
        result["matched_indicators"] = best[1]["matched"]
        result["expansion_strategy"] = best[1]["info"]["strategy"]
        result["complexity"] = best[1]["info"]["complexity"]
        result["can_expand_to_world"] = best[1]["info"]["can_get_all"]
        
        # Region-specific types
        if best[0] in ["viewport", "radius_search", "zip_search", "city_search", "country_filter"]:
            result["is_region_specific"] = True
    else:
        # No indicators - likely single endpoint
        result["detected_type"] = "single_call"
        result["confidence"] = 0.7
        result["expansion_strategy"] = "direct_fetch"
        result["complexity"] = "low"
        result["can_expand_to_world"] = True
    
    # Analyze response for clues
    if sample_response:
        response_analysis = analyze_response_clues(sample_response)
        result.update(response_analysis)
    
    # Get estimates
    estimates = get_scraping_estimates(result["detected_type"])
    result["estimated_calls_world"] = estimates["calls"]
    result["estimated_time_min"] = estimates["time_min"]
    
    return result


def analyze_response_clues(response: Any) -> Dict[str, Any]:
    """
    Analyze response to determine if it's partial/region-limited
    
    Returns:
        Dict with clues about data completeness
    """
    clues = {
        "appears_region_limited": False,
        "has_pagination": False,
        "returned_count": 0,
        "total_count": None,
        "likely_complete": False
    }
    
    # Extract data array
    if isinstance(response, list):
        data = response
    elif isinstance(response, dict):
        # Find data array
        for key in ["data", "results", "items", "stores", "locations", "dealers", "retailers"]:
            if key in response and isinstance(response[key], list):
                data = response[key]
                break
        else:
            data = []
        
        # Check for pagination/totals
        if "total" in response or "total_count" in response or "count" in response:
            clues["has_pagination"] = True
            clues["total_count"] = response.get("total") or response.get("total_count") or response.get("count")
        
        if "page" in response or "next" in response or "has_more" in response:
            clues["has_pagination"] = True
    else:
        data = []
    
    clues["returned_count"] = len(data)
    
    # Heuristics for region-limited data
    if clues["returned_count"] > 0:
        # Suspiciously round numbers suggest limits
        if clues["returned_count"] in [10, 25, 50, 100, 250, 500]:
            clues["appears_region_limited"] = True
        
        # If total != returned, it's partial
        if clues["total_count"] and clues["total_count"] != clues["returned_count"]:
            clues["appears_region_limited"] = True
        
        # If returned count is very small, might be region-limited
        if clues["returned_count"] < 20:
            clues["appears_region_limited"] = True
        
        # If returned count is very large (>500), likely complete
        if clues["returned_count"] > 500:
            clues["likely_complete"] = True
    
    return clues


def get_scraping_estimates(locator_type: str, region: str = "world") -> Dict[str, Any]:
    """
    Estimate API calls and time needed for complete scraping
    
    Returns:
        Dict with calls and time estimates
    """
    estimates = {
        "viewport": {"calls": 720, "time_min": 6},
        "country_filter": {"calls": 195, "time_min": 2},
        "radius_search": {"calls": 2000, "time_min": 20},
        "paginated": {"calls": "varies", "time_min": "varies"},
        "single_call": {"calls": 1, "time_min": 0.1},
        "city_search": {"calls": 5000, "time_min": 50},
        "zip_search": {"calls": 42000, "time_min": 350}  # ~42K ZIP codes in US alone
    }
    
    return estimates.get(locator_type, {"calls": "unknown", "time_min": "unknown"})


# =============================================================================
# PRETTY PRINTING
# =============================================================================

def print_analysis(analysis: Dict[str, Any]):
    """Pretty print the analysis results"""
    print("=" * 80)
    print("🔍 STORE LOCATOR TYPE DETECTION & EXPANSION ANALYSIS")
    print("=" * 80)
    print()
    
    type_info = LOCATOR_TYPES.get(analysis["detected_type"], {})
    
    print(f"📍 URL: {analysis['url'][:80]}...")
    print()
    
    print(f"🏷️  Detected Type: {type_info.get('name', analysis['detected_type'])}")
    print(f"   {type_info.get('description', 'Unknown type')}")
    print()
    
    print(f"🎯 Confidence: {analysis['confidence']:.0%}")
    print(f"⚙️  Complexity: {analysis['complexity'].upper()}")
    print()
    
    if analysis.get("matched_indicators"):
        print(f"🔑 Matched Indicators: {', '.join(analysis['matched_indicators'])}")
        print()
    
    # CRITICAL QUESTION: Is this region-specific?
    print("=" * 80)
    if analysis["is_region_specific"]:
        print("⚠️  REGION-SPECIFIC ENDPOINT DETECTED")
        print("=" * 80)
        print()
        print("   This endpoint only returns stores for a SPECIFIC REGION/AREA.")
        print("   A single API call will NOT give you all worldwide stores.")
        print()
        
        if analysis["can_expand_to_world"]:
            print(f"✅ CAN expand to worldwide data!")
            print(f"   Strategy: {analysis['expansion_strategy']}")
            print()
            
            print("📊 EXPANSION ESTIMATES (Worldwide):")
            print(f"   API calls needed: ~{analysis['estimated_calls_world']}")
            print(f"   Estimated time: ~{analysis['estimated_time_min']} minutes")
            print()
        else:
            print(f"❌ CANNOT practically expand to worldwide")
            print(f"   This type ({type_info.get('name')}) requires too many calls")
            print()
    else:
        print("✅ SINGLE ENDPOINT - ALL DATA")
        print("=" * 80)
        print()
        print("   This endpoint returns ALL stores in ONE API call.")
        print("   No expansion needed!")
        print()
    
    # Response analysis
    if "returned_count" in analysis:
        print("📦 SAMPLE RESPONSE ANALYSIS:")
        print(f"   Stores in sample: {analysis['returned_count']}")
        print(f"   Appears region-limited: {'YES' if analysis.get('appears_region_limited') else 'NO'}")
        
        if analysis.get("likely_complete"):
            print(f"   Likely complete dataset: ✅ YES")
        
        if analysis.get("has_pagination"):
            print(f"   Has pagination: YES")
            if analysis.get("total_count"):
                print(f"   Total count: {analysis['total_count']}")
        print()
    
    # Recommendations
    print("=" * 80)
    print("💡 RECOMMENDATIONS:")
    print("=" * 80)
    print()
    
    if not analysis["is_region_specific"]:
        print("   ✅ Use standard smart_scraper:")
        print(f'   python3 smart_scraper.py --url "{analysis["url"][:60]}..."')
    
    elif analysis["detected_type"] == "viewport":
        print("   ⚠️  Use viewport expansion scraper:")
        print(f"   python3 scrape_worldwide.py --url \"...\" --type viewport")
        print()
        print("   Or adapt scrape_rolex_worldwide.py for this API")
    
    elif analysis["detected_type"] == "country_filter":
        print("   ⚠️  Use country iteration:")
        print(f"   python3 scrape_worldwide.py --url \"...\" --type country")
    
    elif analysis["detected_type"] == "paginated":
        print("   ⚠️  Use pagination handler:")
        print(f"   python3 scrape_worldwide.py --url \"...\" --type paginated")
    
    else:
        print(f"   ⚠️  Need expansion strategy: {analysis['expansion_strategy']}")
        print(f"   This requires custom implementation")
    
    print()
    print("=" * 80)


# =============================================================================
# CLI
# =============================================================================

def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Detect if store locator is region-specific and how to expand it',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Detect from URL only
  python3 locator_type_detector.py --url "https://retailers.rolex.com/..."
  
  # Detect AND fetch sample data
  python3 locator_type_detector.py --url "..." --fetch

This will tell you:
  1. Is this endpoint region-specific? (NYC only, or worldwide?)
  2. Can we expand it to get ALL stores worldwide?
  3. What strategy to use?
  4. How many API calls needed?
        """
    )
    
    parser.add_argument('--url', required=True, help='Store locator API URL')
    parser.add_argument('--fetch', action='store_true', help='Fetch sample data to analyze')
    
    args = parser.parse_args()
    
    sample_data = None
    
    if args.fetch:
        print(f"🌐 Fetching sample data...\n")
        try:
            response = requests.get(args.url, timeout=10, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            response.raise_for_status()
            sample_data = response.json()
            print(f"✅ Sample data fetched\n")
        except Exception as e:
            print(f"⚠️  Could not fetch: {e}\n")
    
    # Run detection
    analysis = detect_locator_type(args.url, sample_data)
    
    # Print results
    print_analysis(analysis)
    
    # Save results
    with open("locator_analysis.json", "w") as f:
        json.dump(analysis, f, indent=2)
    
    print(f"💾 Full analysis saved to: locator_analysis.json\n")
    
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
