# PISO WIFI — Custom Password Reset Email (v4)

## What this version fixes

The customer recovery form now creates a pending recovery request, then calls the Firebase Cloud Function `sendCustomPasswordReset`.

The Cloud Function:
1. Verifies the request against the Firestore customer directory.
2. Verifies the Firebase Authentication account.
3. Uses Firebase Admin SDK to generate a one-time password-reset action link without sending Firebase's default email.
4. Converts that action code into the PISO WIFI `/reset-password.html` URL.
5. Calls the Google Apps Script mailer, which sends the supplied branded HTML email through `MailApp`.
6. Marks the request as having its reset email sent.

## Google Apps Script

The complete Apps Script is included in:

`Piso_WiFi_Backend_CUSTOM_RESET_FULL.gs`

Use the same Apps Script Web App deployment URL already configured for this project:

`https://script.google.com/macros/s/AKfycbzcBLoOP6LoXwTE8rhUUxd1q68ykDgVj-f4o-TD7YGPYmtXrepvhJ8dbPWdeCqQt9fM/exec`

If the Apps Script code has not yet been updated with the custom mailer endpoint, paste the complete `.gs` file into the Apps Script project, save, and deploy the Web App as the same deployment.

## Firebase deployment

Run:

`DEPLOY-PISO-WIFI-PASSWORD-RESET.bat`

This deploys the two HTTPS functions and the Firestore rules.

## Customer test

Use:

`CID-021`

and the registered Gmail for that client.

Expected result:

Client Login → Forgot Password → Send Reset Link → PISO WIFI HTML email → Reset My Password → `/reset-password.html` → new password saved.


## V14 transport fix
The customer browser now calls the Firebase callable function `sendCustomPasswordReset` using the Firebase callable protocol. The Cloudflare Pages proxy is no longer required for the customer password-reset request.
