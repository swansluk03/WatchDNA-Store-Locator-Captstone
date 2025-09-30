import sys

def run_json_scraper():
    from json_webscrapper import main as json_main
    json_main()

def run_html_scraper():
    from html_webscrapper import main as html_main
    html_main()

def usage():
    print("Usage: python main.py [json|html]")
    print("  json : Run the JSON endpoint scraper")
    print("  html : Run the HTML BeautifulSoup scraper")
    sys.exit(1)

def main():
    if len(sys.argv) != 2:
        usage()
    arg = sys.argv[1].lower()
    if arg == "json":
        run_json_scraper()
    elif arg == "html":
        run_html_scraper()
    else:
        usage()

if __name__ == "__main__":
    main()
