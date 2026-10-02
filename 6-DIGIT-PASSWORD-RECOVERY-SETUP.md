PISO WIFI — 6-DIGIT PASSWORD RECOVERY

1. Open the existing Apps Script project used by PISO WIFI.
2. Replace the existing Code.gs contents with APPS-SCRIPT-6DIGIT-PASSWORD-RECOVERY.gs from this package.
3. Merge/replace the Apps Script manifest with APPS-SCRIPT-6DIGIT-appsscript.json.
4. In Google Cloud/Firebase project piso-wifi-f2b5c, make sure the Identity Toolkit API is enabled.
5. The Google account running this Apps Script must have permission to manage Firebase Authentication users (firebaseauth.users.get and firebaseauth.users.update).
6. Re-authorize the Apps Script when prompted because the Identity Platform scope is new.
7. Deploy the Apps Script as a Web app:
   - Execute as: Me
   - Who has access: Anyone
8. Keep the same Web App URL. The website already points to the existing PISO WIFI Apps Script URL.
9. Upload the website files from this package to GitHub Pages/Cloudflare.

FLOW
- Customer clicks Forgot Password.
- Enters Client ID + registered Gmail.
- Apps Script validates both against the Clients sheet.
- Apps Script sends an HTML 6-digit code email.
- Code expires after 10 minutes and has 5 attempts maximum.
- Verified code creates a short-lived one-time reset token.
- Customer enters a new password.
- Apps Script updates Firebase Authentication directly through Identity Platform admin REST API.
- The final password is never stored in Sheets or Apps Script Properties.

IMPORTANT
The normal first-login temporary-password flow is unchanged. This recovery flow is only for Forgot Password.
