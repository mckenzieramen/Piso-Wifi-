# PISO WIFI — Forgot Password 6-Digit Deployment

Web App URL:
https://script.google.com/macros/s/AKfycbw0V3j5VPpFq2Ui0Y28CAC9owTXLawEsjEllq12W9wtzpFjFgXLgI5VCRDHzc26raWJ/exec

Customer flow:
1. Client ID + registered Gmail.
2. Get OTP.
3. Forgot Password modal closes.
4. OTP modal opens.
5. Correct OTP closes the OTP modal.
6. Create New Password modal opens.
7. New password + confirmation are submitted.
8. Firebase Authentication password is updated.

Security:
- 6-digit OTP
- 10-minute OTP expiry
- 5 maximum incorrect attempts
- 60-second resend cooldown
- OTP is verification only and is NEVER used as the customer password
- Verified reset token is short-lived and one-time
- Final password is never stored in Sheets or Apps Script Properties
- Normal first-login temporary password flow remains separate

Deployment:
- Keep the existing Apps Script Web App URL.
- Deploy the current Apps Script source from APPS-SCRIPT-6DIGIT-PASSWORD-RECOVERY.gs or the merged PISO-WIFI-APPS-SCRIPT-MERGED-6DIGIT.gs.
- Deploy the website package normally.
