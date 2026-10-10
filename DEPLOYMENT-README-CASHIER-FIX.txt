PISO WIFI — COMPLETE WEBSITE PACKAGE (2026-10-10)

IMPORTANT: DO NOT DELETE YOUR WHOLE GITHUB REPOSITORY OR ERASE ALL CODE FIRST.
Keep a backup of the current repository. Upload/extract this package and replace the matching website files in the repository root.

Changes in this revision:
- Bumped the Cashier module URL version in /cashier/index.html and /cashier.html to force a fresh JavaScript download.
- Added a visible build marker (Build 2026-10-10-1622) in the signed-in Cashier header and a console build marker.
- Kept customer loading timeout/error handling in /js/cashier.js. If the new build is served, a stuck customer query should turn into a visible error instead of infinite loading.
- Bumped /admin/dashboard.html's dashboard.js URL version because this is the actual Admin page code that creates Cashier accounts.
- The actual Admin cashier creation flow in /js/dashboard.js sets forcePasswordChange: true; the Cashier portal checks this flag and asks for a new password.

Deployment steps:
1. Download this ZIP and extract it locally.
2. In the GitHub repository, upload the extracted contents to the repository root and choose to replace matching files. Do not upload the ZIP itself as a single file.
3. Commit the changes and wait for Cloudflare Pages deployment to succeed.
4. Open https://piso-wifi.pages.dev/cashier/ and hard refresh (Ctrl+Shift+R). After login, look for “Build 2026-10-10-1622” in the Cashier header.
5. If that build label is absent, Cloudflare is not serving the newly uploaded files. If present and the customer dropdown still fails, the message below the dropdown should show the actual error.

Firebase Rules are intentionally NOT included in this website package. Do not change Firestore Rules for this deployment step.
