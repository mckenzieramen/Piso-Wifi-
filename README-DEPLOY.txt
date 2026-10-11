PISO WIFI — CASHIER LOGIN ERROR + ADMIN CASHIER DEACTIVATION
Build: 2026-10-11

Files:
- js/cashier.js: shows a clear incorrect email/password message for Firebase invalid-credential/wrong-password responses; adds friendly messages for rate limiting, connection failures, and disabled accounts.
- js/dashboard.js: adds Admin-only Deactivate / Remove action in Cashier Management.
- admin/dashboard.html and cashier.html: cache-bust the changed scripts.

Security behavior:
- The Admin action sets users/{cashierUid}.active=false. The existing Cashier portal checks role and active status before entering, so this blocks portal access while preserving existing sales/history.
- It does not delete the Firebase Authentication identity. Deleting another user's Auth account requires a trusted server/Admin SDK or Cloud Function; browser-only Admin code must not pretend a Firestore profile update deletes Auth.
- If Firestore Rules deny Admin updates to users/{uid}, the action will show an error. Do not weaken all rules to bypass it.

Deploy only these files into their matching paths, preserving the rest of the site. This patch has not been deployed to Cloudflare Pages.
