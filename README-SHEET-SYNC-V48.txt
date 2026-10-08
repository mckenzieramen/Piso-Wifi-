PISO WIFI v48 — GOOGLE SHEETS CLIENT SYNC

BASELINE:
- Existing Firebase client records are preserved.
- Existing CID sequence is preserved.
- No Firebase rules or Apps Script source is included in this website package.
- Apps Script endpoint remains the existing deployed Web App URL.

WHAT CHANGED:
1. Admin dashboard forces a fresh Firebase ID token before sync.
2. Client ID accepts clientCode/clientId fallback.
3. Existing clients are backfilled to Google Sheets on dashboard load every time; the old pisoSheetSyncV1 localStorage gate is removed.
4. Sync errors are logged clearly instead of being silently treated as success.
5. New/edit client save continues to sync immediately.

DEPLOY:
Upload this website_only package to the same Cloudflare Pages/GitHub website project.
After deploy, hard refresh the Admin Dashboard.
Then open Google Sheet > Clients.
