PISO WIFI — CASHIER PERMANENT DELETE + IMMEDIATE DASHBOARD REMOVAL

This package keeps the server-side permanent-delete endpoint at:
  functions/api/admin/delete-cashier.js

The Admin dashboard now removes the Cashier row immediately after the endpoint confirms the Firebase Authentication account and Firestore users/{uid} profile were deleted. The page refreshes the list in the background and retains existing sales/history.

REQUIRED for actual Firebase deletion:
Cloudflare Pages environment secrets must be configured:
- FIREBASE_PROJECT_ID = piso-wifi-f2b5c
- FIREBASE_API_KEY = existing Firebase Web API key
- FIREBASE_SERVICE_ACCOUNT_JSON = dedicated service-account JSON, stored as a secret, never in public source.

Deploy together:
- admin/dashboard.html
- js/dashboard.js
- functions/api/admin/delete-cashier.js

Do not deploy only the JavaScript: the server-side function must be included at the exact path above. After deploy, test with a disposable Cashier. If Cloudflare secrets are missing, the endpoint will correctly refuse deletion and the row will remain; the UI must not pretend the account was deleted.
Existing sales/history are intentionally preserved.
This package is not deployed to the live site from this environment.
