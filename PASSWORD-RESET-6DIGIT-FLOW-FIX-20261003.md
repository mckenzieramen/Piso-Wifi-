# Password recovery flow fix

The 6-digit code is verification only. After verification, the customer creates a new password.

The Cloudflare function supports a private server-to-server bridge using PASSWORD_RESET_MAILER_SECRET. It also forwards browser recovery actions to the deployed Apps Script URL.

Required Cloudflare environment variables:
- PASSWORD_RESET_MAILER_SECRET: same secret as Apps Script
- FIREBASE_SERVICE_ACCOUNT_JSON: Firebase service account JSON
- PISO_APPS_SCRIPT_URL: optional, defaults to the deployed Apps Script URL
