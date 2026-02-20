# User Frontend — Prototype

This folder contains a lightweight static prototype used for quick map/UI experiments.

Purpose
- Simple demo page (`prototype.html`) for visualizing location data or testing map integrations.

How to open
- Double-click `prototype.html` in File Explorer to open in your default browser.
- Or serve the repository locally (recommended) and open the page in your browser:

```powershell
# from the repository root
python -m http.server 8000
# then open:
http://localhost:8000/user-frontend/prototype.html
```

Notes
- This folder is intentionally minimal — it is not a full React app. Use it for quick manual testing of CSVs or map visuals.
- The prototype may request data from the backend; start the backend before opening the page if you want live data. Example (from repo root):

```powershell
cd backend
npm install
copy .env.example .env
npm run dev
```

