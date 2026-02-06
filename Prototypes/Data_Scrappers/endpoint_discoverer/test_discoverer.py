#!/usr/bin/env python3
"""
Test Script for Endpoint Discoverer
====================================

Quick test script to verify the endpoint discoverer is working.
"""

import sys
import os
import json

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from endpoint_discoverer import EndpointDiscoverer


def test_simple_discovery():
    """Test with a simple store locator"""
    print("=" * 80)
    print("TEST 1: Simple Store Locator Discovery")
    print("=" * 80)
    print()
    
    # Test with a known working store locator
    test_url = "https://www.alange-soehne.com/us-en/store-locator"
    
    print(f"Testing URL: {test_url}")
    print("This should find the JSON API endpoint...")
    print()
    
    try:
        discoverer = EndpointDiscoverer(headless=True, timeout=30)
        result = discoverer.discover(test_url)
        
        print("\n" + "=" * 80)
        print("RESULTS")
        print("=" * 80)
        print()
        
        if result['success']:
            print("✅ Discovery completed successfully!")
            print()
            
            if result['endpoints']:
                print(f"Found {len(result['endpoints'])} potential endpoints:\n")
                for i, endpoint in enumerate(result['endpoints'][:5], 1):  # Show top 5
                    print(f"{i}. {endpoint.get('url', 'Unknown')[:100]}...")
                    print(f"   Type: {endpoint.get('type', 'unknown')}")
                    print(f"   Confidence: {endpoint.get('confidence', 0):.1%}")
                    if endpoint.get('store_count'):
                        print(f"   Stores detected: {endpoint.get('store_count')}")
                    print()
            else:
                print("⚠️  No endpoints found in network requests")
            
            if result.get('suggested_config'):
                print("\n📋 Suggested Brand Configuration:\n")
                print(json.dumps(result['suggested_config'], indent=2))
            else:
                print("\n⚠️  No configuration suggested")
        else:
            print("❌ Discovery failed")
            if result.get('errors'):
                print("\nErrors:")
                for error in result['errors']:
                    print(f"  - {error}")
        
        return result
        
    except Exception as e:
        print(f"\n❌ Error during discovery: {e}")
        import traceback
        traceback.print_exc()
        return None


def test_html_page():
    """Test with an HTML-based store locator"""
    print("\n" + "=" * 80)
    print("TEST 2: HTML Store Locator Discovery")
    print("=" * 80)
    print()
    
    test_url = "https://www.blancpain.com/en-us/service/points-sale"
    
    print(f"Testing URL: {test_url}")
    print("This should detect HTML with embedded data...")
    print()
    
    try:
        discoverer = EndpointDiscoverer(headless=True, timeout=30)
        result = discoverer.discover(test_url)
        
        print("\n" + "=" * 80)
        print("RESULTS")
        print("=" * 80)
        print()
        
        if result['success']:
            print("✅ Discovery completed!")
            
            if result.get('html_analysis'):
                print("\n📄 HTML Analysis:")
                print(json.dumps(result['html_analysis'], indent=2))
            
            if result.get('suggested_config'):
                print("\n📋 Suggested Configuration:\n")
                print(json.dumps(result['suggested_config'], indent=2))
        else:
            print("❌ Discovery failed")
            if result.get('errors'):
                for error in result['errors']:
                    print(f"  - {error}")
        
        return result
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None


def test_viewport_endpoint():
    """Test with a viewport-based endpoint (if we can find the page)"""
    print("\n" + "=" * 80)
    print("TEST 3: Viewport-Based Endpoint Discovery")
    print("=" * 80)
    print()
    
    # Note: Rolex doesn't have a public store locator page, so we'll skip this
    # or use a different example
    print("⚠️  Skipping viewport test (requires store locator page URL)")
    print("   To test viewport detection, use a store locator that uses map bounds")
    print()


def main():
    """Run all tests"""
    print("\n" + "=" * 80)
    print("ENDPOINT DISCOVERER TEST SUITE")
    print("=" * 80)
    print()
    print("This will test the endpoint discoverer with known store locators.")
    print("Make sure you have:")
    print("  1. Installed dependencies: pip install -r requirements.txt")
    print("  2. Chrome/Chromium browser installed")
    print("  3. Internet connection")
    print()
    
    input("Press Enter to start tests...")
    print()
    
    # Run tests
    results = []
    
    # Test 1: Simple JSON API
    result1 = test_simple_discovery()
    results.append(("Simple Discovery", result1))
    
    # Test 2: HTML page
    result2 = test_html_page()
    results.append(("HTML Discovery", result2))
    
    # Test 3: Viewport (skipped)
    test_viewport_endpoint()
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print()
    
    for name, result in results:
        if result:
            status = "✅ PASSED" if result.get('success') else "❌ FAILED"
            print(f"{name}: {status}")
        else:
            print(f"{name}: ❌ ERROR")
    
    print()
    print("=" * 80)
    print("Testing complete!")
    print("=" * 80)
    print()
    print("Next steps:")
    print("  1. Review the suggested configurations")
    print("  2. Test the endpoints manually")
    print("  3. Add to brand_configs.json if working correctly")
    print()


if __name__ == "__main__":
    main()

