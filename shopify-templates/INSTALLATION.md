# Shopify Store Locator Installation Guide

This guide will walk you through adding both OpenStreetMap and Mapbox store locators to your Shopify store.

## 📋 Prerequisites

- Access to your Shopify admin panel
- Theme editing permissions
- `locations.csv` file with store data

---

## 🚀 Step 1: Upload locations.csv to Shopify

1. Go to **Shopify Admin** → **Online Store** → **Themes**
2. Click **Actions** → **Edit code**
3. In the left sidebar, find the **Assets** folder
4. Click **Add a new asset**
5. Click **Upload file** and select `locations.csv` from this repository
6. Click **Upload asset**

✅ You should now see `locations.csv` in your Assets folder

---

## 🗺️ Step 2A: Add OpenStreetMap Version

### Create Template

1. Still in the theme code editor, find the **Templates** folder
2. Click **Add a new template**
3. Select template type: **page**
4. Template name: `store-locator-osm`
5. Click **Create template**
6. Copy the entire contents of `page.store-locator-osm.liquid` from this folder
7. Paste into the Shopify template editor
8. Click **Save**

### Create Page

1. Go to **Shopify Admin** → **Online Store** → **Pages**
2. Click **Add page**
3. Fill in:
   - **Title:** Store Locator (OpenStreetMap)
   - **Content:** Add any intro text you want above the map
4. On the right sidebar, under **Template**, select: `page.store-locator-osm`
5. Click **Save**

✅ View your page: `yourstore.myshopify.com/pages/store-locator-openstreetmap`

---

## 🗺️ Step 2B: Add Mapbox Version

### Create Template

1. In theme code editor, **Templates** folder
2. Click **Add a new template**
3. Select template type: **page**
4. Template name: `store-locator-mapbox`
5. Click **Create template**
6. Copy the entire contents of `page.store-locator-mapbox.liquid` from this folder
7. Paste into the Shopify template editor
8. Click **Save**

### Create Page

1. Go to **Shopify Admin** → **Online Store** → **Pages**
2. Click **Add page**
3. Fill in:
   - **Title:** Store Locator (Mapbox)
   - **Content:** Add any intro text you want above the map
4. On the right sidebar, under **Template**, select: `page.store-locator-mapbox`
5. Click **Save**

✅ View your page: `yourstore.myshopify.com/pages/store-locator-mapbox`

---

## 🔧 Customization Options

### Change Map Styles (Mapbox only)

In `page.store-locator-mapbox.liquid`, find line with `style: 'mapbox://styles/mapbox/streets-v12'`

Replace with:
- `mapbox://styles/mapbox/light-v11` - Light theme
- `mapbox://styles/mapbox/dark-v11` - Dark theme
- `mapbox://styles/mapbox/satellite-streets-v12` - Satellite view
- `mapbox://styles/mapbox/outdoors-v12` - Outdoor/topographic

### Adjust Map Height

Find `height: 640px` in the CSS and change to your preferred height (e.g., `800px`)

### Change Default Zoom

Find `zoom: 2` in the JavaScript and adjust (1-20, higher = closer)

---

## 🐛 Troubleshooting

### Map doesn't show
- Check browser console (F12) for errors
- Verify `locations.csv` is uploaded to Assets
- Check that CSV has valid Latitude/Longitude values

### No markers appear
- Verify CSV has rows with numeric lat/lon values
- Check console for "Valid locations: X" message
- Run the validation tool: `python tools/validate_csv.py`

### Mapbox map is blank
- Verify your Mapbox token is valid
- Check token permissions at https://account.mapbox.com/access-tokens/
- Ensure token has "Public" scopes enabled

### Filters don't work
- Check that CSV has data in `Custom Brands` or `Tags` columns
- Verify filter values match CSV data (case-sensitive)

---

## 📊 Adding Store Data

### Option 1: Manual CSV Editing
1. Download `locations.csv` from Shopify Assets
2. Edit in Excel/Google Sheets
3. Re-upload to Shopify Assets (will overwrite)

### Option 2: Use Web Scrapers
1. Configure scraper URLs in `Prototypes/Data_Scrappers/`
2. Run: `python Prototypes/Data_Scrappers/main.py json` or `html`
3. Upload generated `locations.csv` to Shopify Assets

---

## 🔐 Security Note

**Mapbox Token:** The token in `page.store-locator-mapbox.liquid` is a **public token** and is safe to expose in client-side code. However, you should:

1. Set URL restrictions in Mapbox dashboard
2. Monitor usage at https://account.mapbox.com/
3. Stay within free tier limits (50,000 loads/month)

---

## 📱 Adding to Navigation

To add store locator links to your site menu:

1. Go to **Shopify Admin** → **Online Store** → **Navigation**
2. Click on **Main menu** (or your desired menu)
3. Click **Add menu item**
4. Name: "Find Stores"
5. Link: Select **Pages** → your store locator page
6. Click **Save menu**

---

## 🆘 Need Help?

- Check the browser console for detailed error messages
- Verify all files are uploaded correctly
- Test locally first using the prototype HTML files
- Ensure your Shopify theme supports custom page templates

---

## ✅ Success Checklist

- [ ] `locations.csv` uploaded to Shopify Assets
- [ ] OpenStreetMap template created
- [ ] OpenStreetMap page created and published
- [ ] Mapbox template created
- [ ] Mapbox page created and published
- [ ] Maps load correctly in browser
- [ ] Markers appear on both maps
- [ ] Filters work as expected
- [ ] Popups show store information
- [ ] Added to site navigation (optional)

---

**Questions?** Review the prototype HTML files for reference implementations.
