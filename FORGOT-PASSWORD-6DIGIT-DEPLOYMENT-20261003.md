# PISO WIFI — Forgot Password 6-Digit Update

This update uses the deployed Google Apps Script Web App as the recovery service.

Apps Script Web App:
https://script.google.com/macros/s/AKfycbw0V3j5VPpFq2Ui0Y28CAC9owTXLawEsjEllq12W9wtzpFjFgXLgI5VCRDHzc26raWJ/exec

Website files changed:
- js/client-login.js
- functions/api/password-reset-code.js

Flow:
1. Customer enters Client ID + registered Gmail.
2. Website calls /api/password-reset-code.
3. Cloudflare function proxies to Apps Script.
4. Apps Script validates the customer and emails a 6-digit code.
5. Customer verifies the code.
6. Customer sets a new password.

The 6-digit code is never the permanent password.
