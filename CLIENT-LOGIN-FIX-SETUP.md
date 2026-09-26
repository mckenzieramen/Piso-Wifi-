# PISO WIFI Client Login Fix

The Client Login now accepts:

- Registered Gmail
- Admin-generated Username (example: SandyCID-021)
- Client ID (example: CID-021)

The actual Firebase password remains the temporary password created by Admin (for the current system this is the Client ID, e.g. CID-021).

## Cloudflare requirement

The new `functions/api/client-login.js` uses the existing `FIREBASE_SERVICE_ACCOUNT_JSON` Cloudflare Pages secret. No private key is placed in frontend code.

After deploying the updated project to Cloudflare Pages, test:

1. Registered Gmail + temporary password
2. Username + temporary password
3. Client ID + temporary password

After successful first login, the existing Customer Portal first-login modal forces the customer to create a private password.
