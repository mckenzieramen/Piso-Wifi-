# PISO WIFI — OUTSIDE-GITHUB PASSWORD RESET DEPLOYMENT

The GitHub/Cloudflare website alone is not enough for the custom password-reset email. The live site calls `/api/sendCustomPasswordReset`, which forwards to the Firebase Cloud Function `sendCustomPasswordReset`.

The previous deployment script only deployed `setClientTemporaryPassword`. That left `sendCustomPasswordReset` potentially undeployed and produced the browser `TypeError: Failed to fetch`.

## One-time backend deployment

Run:

`DEPLOY-PASSWORD-RESET-AND-RECOVERY.bat`

The script logs into Firebase, installs the function dependencies, and deploys both:

- `sendCustomPasswordReset`
- `setClientTemporaryPassword`

Firebase project: `piso-wifi-f2b5c`

The Cloudflare Pages Function remains responsible for forwarding `/api/sendCustomPasswordReset` to Firebase. The Google Apps Script Web App remains the custom HTML mailer.

## Expected live flow

Client Login → Forgot Password → Cloudflare `/api/sendCustomPasswordReset` → Firebase `sendCustomPasswordReset` → Firebase Admin SDK generates the one-time reset link → Google Apps Script sends the PISO WIFI HTML email → `reset-password.html`.

Do not put the Firebase service-account JSON into GitHub or frontend files.
