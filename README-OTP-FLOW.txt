PISO WIFI — WEBSITE OTP RECOVERY

This website package uses the deployed Google Apps Script backend for customer password recovery.

Frontend actions:
1. requestCode
2. verifyCode
3. resetPassword

Flow:
Client ID + registered Gmail -> 6-digit OTP email -> verify OTP -> Create New Password -> success.

Backend URL is configured in:
- js/client-login.js
- client-login.js

This ZIP intentionally does NOT include:
- Google Apps Script source
- Firebase Firestore/Storage rules
- service-account credentials
- private secrets

Do not replace the Apps Script with an older reset-link implementation.
