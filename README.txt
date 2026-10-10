PISO WIFI CASHIER LOGIN INSTANT FIX

Replace the deployed files:
  js/cashier.js
  cashier.html (or cashier/index.html if that is the page deployed)

The form now explicitly waits for Firebase sign-in, then opens the Cashier portal immediately after role/active-account verification. It prevents duplicate profile loading. It does not bypass Firebase authentication or cashier role checks. If forcePasswordChange is true, the required first-login password change screen remains.

Cache build: 2026-10-10-LOGIN-INSTANT-002
Local validation: node --check passed.
This package is not deployed to Cloudflare automatically.
