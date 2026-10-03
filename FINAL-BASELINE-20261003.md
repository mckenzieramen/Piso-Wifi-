# PISO WIFI — FINAL BASELINE 2026-10-03

This is the cleaned deployment baseline. Old numbered/duplicate files are kept outside the deployment package.

## Canonical routes
- Customer login: `/` -> `index.html`
- Admin login: `/admin` -> `admin/index.html`
- Admin dashboard: `/admin/dashboard.html`
- Customer portal: `/client/` -> `client/index.html`

## Canonical JavaScript
- Customer login/recovery: `js/client-login.js`
- Admin login: `js/auth.js`
- Admin dashboard: `js/dashboard.js`
- Customer portal: `js/client.js`
- Firebase config: `js/firebase-config.js`
- Firebase app: `js/firebase.js`

## Client ID behavior
- New client modal shows the next `CID-###` immediately.
- The final ID is reserved atomically with a Firestore transaction when saved.
- Existing IDs are not reused.
- Username preview updates as the first name is typed.

## Customer forgot-password behavior
1. Customer clicks Forgot password.
2. Customer enters Client ID + registered Gmail.
3. The site sends the request to the same-origin Cloudflare Pages Function `/api/password-reset-code`.
4. The Pages Function calls the Google Apps Script Web App server-to-server.
5. Apps Script verifies the Client ID + Gmail, generates a 6-digit code, and sends the email using MailApp/GmailApp.
6. Code expires after 10 minutes and is limited to 5 incorrect attempts.
7. Customer enters the code.
8. Apps Script asks the Pages Function to set that 6-digit code as the temporary Firebase password and marks `forcePasswordChange=true`.
9. Customer logs in with Client ID + 6-digit temporary password.
10. Existing first-login password setup forces the customer to create a private password.

## Required Cloudflare Pages environment variables
Set these as **encrypted/secret variables** for the production Pages project:

- `APPS_SCRIPT_PASSWORD_RESET_URL` = the deployed Google Apps Script Web App `/exec` URL.
- `PASSWORD_RESET_MAILER_SECRET` = the exact value of `PASSWORD_RESET_MAILER_SECRET` in `PISO-WIFI-APPS-SCRIPT-MERGED-6DIGIT.gs`.
- `FIREBASE_SERVICE_ACCOUNT_JSON` = Firebase service-account JSON used by the private bridge. Never put this in browser files.

No paid service is required by this flow. Google Apps Script MailApp/GmailApp and Cloudflare Pages Functions are used for the bridge.

## Apps Script
Use `PISO-WIFI-APPS-SCRIPT-MERGED-6DIGIT.gs` as the single current Apps Script source. Deploy it as a Web App and use its `/exec` URL for `APPS_SCRIPT_PASSWORD_RESET_URL`.

Do not combine it with the archived scripts that also define `doPost`.

## Firebase
- Deploy the updated `clientLogin` function from `functions/index.js`.
- Publish the intended `firestore.rules` from this baseline.

Do not make Firestore public just to bypass permission errors.
