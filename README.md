# PISO WIFI — Baseline Premium Build

This build is based on the uploaded `Piso-Wifi--main.zip` baseline.

Preserved from the baseline:
- Firebase authentication and Firestore data flow
- Existing dashboard/business logic
- Existing calculations
- Existing navigation/hash routing
- Existing logout handler
- Existing pages and section renderers

Premium visual layer:
- Uses the verified Premium stylesheet from the earlier V11 build.
- No Cloudflare `_redirects` file is included.
- Explicit `index.html` and `dashboard.html` entry points are retained.

Do not add pretty-URL redirects until the application is verified.
