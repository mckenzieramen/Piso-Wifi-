# PISO WIFI — PASSWORD RESET OUTSIDE-GITHUB SETUP

The custom password-reset email is a server-side flow. GitHub Pages/Cloudflare alone cannot generate the Firebase Admin reset link or safely call the Apps Script mailer.

## Required outside GitHub

1. **Firebase Cloud Functions**
   Deploy both:
   - `sendCustomPasswordReset`
   - `setClientTemporaryPassword`

   Use `DEPLOY-PASSWORD-RESET-AND-RECOVERY.bat`.

2. **Google Apps Script**
   The Web App used by the Firebase function must contain the supplied custom HTML mailer (`Piso_WiFi_Backend_CUSTOM_RESET_FULL.gs`) and remain deployed as a Web App.

3. **Cloudflare Pages**
   No password-reset proxy deployment is required for this version. The browser calls the Firebase HTTPS function directly.

## Final flow

Customer → Firebase callable `sendCustomPasswordReset` → Firebase Admin generates one-time reset link → Google Apps Script `MailApp` sends the branded PISO WIFI HTML email → `reset-password.html`.

## Important

Do not put the Apps Script mailer secret or any service-account JSON in the client-side website.
