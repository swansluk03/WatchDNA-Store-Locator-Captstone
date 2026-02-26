#!/usr/bin/env python3
"""Analyzes network requests to identify store locator API endpoints."""

import json
import re
from typing import Dict, List, Optional, Any
from urllib.parse import urlparse, parse_qs, urljoin, urlencode
import requests

DISCOVERY_SAMPLE_LIMIT = 15


def _url_with_sample_limit(url: str, limit: int = DISCOVERY_SAMPLE_LIMIT) -> str:
    parsed = urlparse(url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    param_keys_lower = [k.lower() for k in params.keys()]
    limit_params = ['limit', 'per', 'per_page', 'take', 'page_size']
    if any(p in param_keys_lower for p in limit_params):
        return url  # Already has limit, don't modify
    sep = '&' if parsed.query else '?'
    return f"{url}{sep}limit={limit}"


class NetworkAnalyzer:
    STORE_KEYWORDS = [
        'store', 'location', 'retailer', 'establishment', 'point', 'dealer',
        'boutique', 'outlet', 'shop', 'branch', 'venue', 'place'
    ]
    API_PATTERNS = [
        r'/api/',
        r'\.json',
        r'\.yext',
        r'/search',
        r'/locator',
        r'/stores',
        r'/locations',
        r'/find',
        r'/establishments',
        r'/retailers'
    ]
    
    def __init__(self):
        pass

    def analyze_requests(self, requests: List[Dict], base_url: str) -> List[Dict]:
        analyzed = []
        
        for req in requests:
            url = req.get('url', '')
            if not url:
                continue
            
            # Skip non-relevant URLs
            if self._should_skip_url(url):
                continue
            
            # Analyze the endpoint
            analysis = self._analyze_endpoint(url, req, base_url)
            if analysis:
                # Try to find base URL without location-specific parameters
                base_variations = self._find_base_url_variations(url, req, base_url)
                
                # Test each variation and keep the best one
                best_analysis = analysis
                best_store_count = analysis.get('store_count', 0) or 0
                
                for variation_url in base_variations:
                    variation_analysis = self._analyze_endpoint(variation_url, req, base_url)
                    if variation_analysis:
                        variation_store_count = variation_analysis.get('store_count', 0) or 0
                        
                        # Prefer variation if it has more stores or same stores but cleaner URL
                        if variation_store_count > best_store_count or \
                           (variation_store_count == best_store_count and 
                            len(variation_url) < len(best_analysis['url'])):
                            best_analysis = variation_analysis
                            best_store_count = variation_store_count
                            best_analysis['is_base_url'] = True
                            best_analysis['original_url'] = url
                
                analyzed.append(best_analysis)
        
        # Sort by confidence score, then by store count
        analyzed.sort(key=lambda x: (x.get('confidence', 0), x.get('store_count', 0) or 0), reverse=True)
        
        return analyzed
    
    def _should_skip_url(self, url: str) -> bool:
        """Check if URL should be skipped"""
        skip_patterns = [
            r'\.css$',
            r'\.js$',
            r'\.png$',
            r'\.jpg$',
            r'\.gif$',
            r'\.svg$',
            r'\.woff',
            r'\.ttf',
            r'analytics',
            r'tracking',
            r'ads',
            r'advertising',
            r'facebook',
            r'twitter',
            r'google-analytics',
            r'googletagmanager',
            r'fonts\.googleapis',
            r'fonts\.gstatic',
            r'go-mpulse',  # Akamai monitoring
            r'userway',  # Accessibility widget
            r'manifest\.json',  # PWA manifest
            r'maps\.googleapis\.com/maps/api/js',  # Google Maps JavaScript API (library, not data)
            r'maps\.googleapis\.com/maps/api/place',  # Google Places API (autocomplete, not store data)
            r'maps\.googleapis\.com/maps/vt',  # Google Maps tiles
            r'maps\.googleapis\.com/maps/api/geocode',  # Geocoding API
            r'contentsquare',  # Analytics
            r'c\.contentsquare\.net'  # Analytics
        ]
        
        url_lower = url.lower()
        return any(re.search(pattern, url_lower) for pattern in skip_patterns)
    
    def _find_base_url_variations(self, url: str, request: Dict, base_url: str) -> List[str]:
        """
        Find base URL variations by removing location-specific parameters
        
        Args:
            url: Original URL with parameters
            request: Request dictionary
            base_url: Base URL of the page
            
        Returns:
            List of URL variations to test
        """
        variations = []
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        
        # Location-specific parameters to remove (country-region, per, offset are filters - kept)
        location_params = [
            'keyword', 'query', 'q', 'search', 'location', 'city', 'zip', 'zipcode',
            'postal', 'address', 'state', 'region', 'country', 'lat', 'lng', 
            'latitude', 'longitude', 'coord', 'coordinates'
        ]
        
        # Check if URL has location-specific parameters
        has_location_params = any(param.lower() in [p.lower() for p in params.keys()] 
                                 for param in location_params)
        
        if not has_location_params:
            return variations  # No location params to remove
        
        # Create base URL without location parameters
        base_params = {k: v for k, v in params.items() 
                      if k.lower() not in [p.lower() for p in location_params]}
        
        # Variation 1: Remove all location params
        if base_params != params:
            if base_params:
                # Properly encode query parameters using urlencode
                # Convert parse_qs format (list values) to urlencode format
                encode_params = {}
                for k, v in base_params.items():
                    if isinstance(v, list) and len(v) == 1:
                        encode_params[k] = v[0]
                    elif isinstance(v, list):
                        encode_params[k] = v  # urlencode handles lists
                    else:
                        encode_params[k] = v
                base_query = urlencode(encode_params, doseq=True)
                variation_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}?{base_query}"
            else:
                variation_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
            variations.append(variation_url)
        
        # Variation 2: Try just the path without any query params
        if params:
            variation_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
            variations.append(variation_url)
        
        # Variation 3: Try common base paths (e.g., /api/search/store/locator)
        path_parts = parsed.path.split('/')
        if len(path_parts) > 2:
            # Try removing last part (e.g., /api/search?keyword=X -> /api/search)
            if any(keyword in path_parts[-1].lower() for keyword in ['search', 'locator', 'store', 'location']):
                base_path = '/'.join(path_parts[:-1])
                variation_url = f"{parsed.scheme}://{parsed.netloc}{base_path}"
                variations.append(variation_url)
            
            # Try /api/search/store/locator pattern
            if 'api' in path_parts and 'search' in path_parts:
                # Look for /api/search/store/locator or similar
                api_index = path_parts.index('api')
                if api_index + 1 < len(path_parts):
                    # Try /api/search/store/locator
                    potential_paths = [
                        '/api/search/store/locator',
                        '/api/store/locator',
                        '/api/locator',
                        '/api/stores',
                        '/api/locations'
                    ]
                    for potential_path in potential_paths:
                        variation_url = f"{parsed.scheme}://{parsed.netloc}{potential_path}"
                        variations.append(variation_url)
        
        # Remove duplicates while preserving order
        seen = set()
        unique_variations = []
        for var in variations:
            if var not in seen:
                seen.add(var)
                unique_variations.append(var)
        
        return unique_variations
    
    def _analyze_endpoint(self, url: str, request: Dict, base_url: str) -> Optional[Dict]:
        """
        Analyze a single endpoint
        
        Args:
            url: Endpoint URL
            request: Request dictionary
            base_url: Base URL
            
        Returns:
            Analysis dictionary or None
        """
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        
        # Calculate confidence score
        confidence = 0.0
        indicators = []
        
        # Check URL for store-related keywords
        url_lower = url.lower()
        for keyword in self.STORE_KEYWORDS:
            if keyword in url_lower:
                confidence += 0.2
                indicators.append(f"keyword:{keyword}")
        
        # Check for API patterns
        for pattern in self.API_PATTERNS:
            if re.search(pattern, url_lower):
                confidence += 0.15
                indicators.append(f"pattern:{pattern}")
        
        # Check for JSON in URL or content type (but reduce confidence for Google Maps API)
        mime_type = request.get('mimeType', '').lower()
        is_google_maps_api = 'maps.googleapis.com' in url_lower and ('/api/js' in url_lower or '/api/place' in url_lower)
        
        if 'json' in mime_type or '.json' in url_lower:
            if is_google_maps_api:
                # Google Maps API endpoints are libraries, not store data - reduce confidence
                confidence += 0.05
                indicators.append("content_type:json_google_maps_library")
            else:
                confidence += 0.3
                indicators.append("content_type:json")
        
        # Check URL parameters for viewport/region indicators
        viewport_params = ['viewport', 'bounds', 'bbox', 'ne_lat', 'sw_lat', 'northeast', 'southwest', 
                          'by_viewport', 'northeastlat', 'northeastlng', 'southwestlat', 'southwestlng',
                          'ne_lat', 'ne_lng', 'sw_lat', 'sw_lng']
        if any(param.lower() in [p.lower() for p in params.keys()] for param in viewport_params):
            confidence += 0.25
            indicators.append("type:viewport")
        
        radius_params = ['radius', 'distance', 'r']
        if any(param in params for param in radius_params):
            confidence += 0.2
            indicators.append("type:radius")
        
        pagination_params = ['page', 'offset', 'limit', 'per_page', 'skip', 'take', 'pagetoken']
        if any(param in params for param in pagination_params):
            confidence += 0.15
            indicators.append("type:paginated")
        
        # Try to fetch and analyze the endpoint
        store_count = None
        endpoint_type = self._detect_endpoint_type(url, params, mime_type)
        
        # For HTML endpoints, always check for embedded store data (even with low initial confidence)
        # This is important because HTML pages often have store data embedded in JavaScript
        should_fetch = confidence > 0.3 or endpoint_type == 'html'
        
        if should_fetch:  # Fetch HTML pages even with low confidence
            try:
                response = self._fetch_endpoint(url, request)
                if response:
                    store_count = self._count_stores(response)
                    
                    # Special handling for HTML content - check for embedded store data
                    # (country_filter URLs like ?country-region=US can also return HTML)
                    if isinstance(response, dict) and 'html' in response:
                        html_content = response['html']
                        # Check for embedded store data patterns
                        store_patterns = [
                            r'"stores?"\s*:\s*\[',
                            r'"locations?"\s*:\s*\[',
                            r'"points?"\s*:\s*\[',
                            r'"establishments?"\s*:\s*\[',
                            r'"retailers?"\s*:\s*\[',
                            r'data-lat.*data-lng',  # Data attributes
                            r'latitude.*longitude',  # Coordinate patterns
                        ]
                        found_patterns = sum(1 for pattern in store_patterns if re.search(pattern, html_content, re.IGNORECASE))
                        
                        if found_patterns > 0:
                            # HTML page has embedded store data - significantly boost confidence
                            confidence += 0.5
                            indicators.append(f"html_with_store_data:{found_patterns}_patterns")
                            # Estimate store count from patterns (rough heuristic)
                            if not store_count:
                                # Count store-like objects in the HTML
                                store_matches = len(re.findall(r'\{[^{}]*"(?:name|title)"[^{}]*"(?:lat|latitude)"[^{}]*\}', html_content, re.IGNORECASE))
                                if store_matches > 0:
                                    store_count = store_matches
                    
                    if store_count and store_count > 0:
                        confidence += 0.3
                        indicators.append(f"stores_found:{store_count}")
                        
                        # If it's a viewport endpoint with stores, boost confidence
                        if endpoint_type == 'viewport':
                            confidence += 0.15
                            indicators.append("viewport_with_stores")
            except Exception as e:
                pass  # Silently fail - endpoint might require auth or specific params
        
        if confidence < 0.2:  # Too low confidence, skip
            return None
        
        return {
            'url': url,
            'type': endpoint_type,
            'confidence': min(confidence, 1.0),
            'indicators': indicators,
            'store_count': store_count,
            'method': request.get('method', 'GET'),
            'status': request.get('status', 0),
            'params': {k: v[0] if isinstance(v, list) and len(v) == 1 else v 
                      for k, v in params.items()}
        }
    
    def _detect_endpoint_type(self, url: str, params: Dict, mime_type: str) -> str:
        """Detect the type of endpoint"""
        url_lower = url.lower()
        param_keys_lower = [k.lower() for k in params.keys()]
        
        # Check for viewport-based (highest priority)
        viewport_params = ['viewport', 'bounds', 'bbox', 'ne_lat', 'sw_lat', 'northeast', 'southwest',
                          'northeastlat', 'northeastlng', 'southwestlat', 'southwestlng',
                          'ne_lat', 'ne_lng', 'sw_lat', 'sw_lng', 'by_viewport']
        if any(param.lower() in param_keys_lower for param in viewport_params) or 'by_viewport' in url_lower:
            return 'viewport'
        
        # Check for radius-based
        if any(param.lower() in param_keys_lower for param in ['radius', 'distance', 'r']) or 'r=' in url_lower:
            return 'radius'
        
        # Check for country-based (including hyphenated variants like country-region)
        country_params = ['country', 'countrycode', 'region', 'state', 'country-region', 'country_region']
        if any(param.lower() in param_keys_lower for param in country_params):
            return 'country_filter'
        
        # Check for paginated
        pagination_params = ['page', 'offset', 'limit', 'per_page', 'skip', 'take', 'pagetoken']
        if any(param.lower() in param_keys_lower for param in pagination_params):
            return 'paginated'
        
        # Check for HTML
        if 'text/html' in mime_type or url.endswith('.html') or (not url.endswith('.json') and 'json' not in url_lower and '/api/' not in url_lower):
            return 'html'
        
        # Default to JSON
        return 'json'
    
    def _fetch_endpoint(self, url: str, request: Dict) -> Optional[Dict]:
        """
        Try to fetch endpoint data. Uses sample limit first for large APIs (avoids 1600+ store downloads).
        
        Args:
            url: Endpoint URL
            request: Request dictionary
            
        Returns:
            Response data or None
        """
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json, text/html, */*'
        }
        req_headers = request.get('headers', {})
        if 'accept' in req_headers:
            headers['Accept'] = req_headers['accept']
        timeout = 15 if 'html' in request.get('mimeType', '').lower() else 10
        
        # Try limited URL first for JSON/API endpoints (avoids fetching 1600+ stores)
        mime = request.get('mimeType', '').lower()
        url_lower = url.lower()
        is_json_api = 'json' in mime or '/api/' in url_lower or 'location' in url_lower or 'store' in url_lower
        if is_json_api:
            limited_url = _url_with_sample_limit(url)
            if limited_url != url:
                try:
                    response = requests.get(limited_url, headers=headers, timeout=timeout)
                    response.raise_for_status()
                    data = self._parse_response(response)
                    count = self._count_stores(data) if data else None
                    if count is not None and count > 0:
                        return data  # Limit worked, use smaller payload
                except Exception:
                    pass  # Fall through to full URL
        try:
            response = requests.get(url, headers=headers, timeout=timeout)
            response.raise_for_status()
            return self._parse_response(response)
        except requests.exceptions.Timeout:
            return None
        except Exception:
            return None
    
    def _parse_response(self, response: requests.Response) -> Optional[Dict]:
        """Parse response into dict (JSON) or html wrapper."""
        content_type = response.headers.get('content-type', '').lower()
        if 'json' in content_type:
            return response.json()
        if 'html' in content_type or 'text/html' in content_type:
            return {'html': response.text}
        try:
            return response.json()
        except Exception:
            if 'text' in content_type or len(response.text) > 100:
                return {'html': response.text}
            return None
    
    def _count_stores(self, data: Any, depth: int = 0) -> Optional[int]:
        """
        Count stores in data structure
        
        Args:
            data: Data to analyze
            depth: Recursion depth
            
        Returns:
            Number of stores found or None
        """
        if depth > 5:
            return None
        
        if isinstance(data, dict):
            # Look for store arrays
            for key, value in data.items():
                key_lower = str(key).lower()
                if any(keyword in key_lower for keyword in self.STORE_KEYWORDS):
                    if isinstance(value, list):
                        return len(value)
                    elif isinstance(value, dict):
                        # Might be a single store object
                        if self._has_store_fields(value):
                            return 1
            
            # Recursively search
            for value in data.values():
                count = self._count_stores(value, depth + 1)
                if count is not None:
                    return count
        
        elif isinstance(data, list):
            # Check if list contains stores
            if len(data) > 0:
                sample = data[0]
                if isinstance(sample, dict) and self._has_store_fields(sample):
                    return len(data)
                else:
                    # Recursively check
                    for item in data:
                        count = self._count_stores(item, depth + 1)
                        if count is not None:
                            return count
        
        return None
    
    def _has_store_fields(self, obj: Dict) -> bool:
        """Check if object has store-related fields"""
        keys = ' '.join(str(k).lower() for k in obj.keys())
        
        # Required fields for a store
        required = ['address', 'lat', 'lng', 'latitude', 'longitude', 'city', 'name']
        found = sum(1 for field in required if field in keys)
        
        return found >= 2  # At least 2 required fields

