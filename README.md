# PISO WIFI — FINAL CLEAN REDEPLOY 2026-10-07

This package is intentionally clean: only the files actually used by the deployed website are included. Old duplicate/legacy HTML and JS files were removed from the deployment package so they cannot accidentally be served instead of the current Admin/Client files.

## LOCKED / PRESERVED
- 6-digit OTP password recovery flow is preserved.
- Google Apps Script password recovery backend is included under `apps-script/Code.gs`.
- Firebase web configuration is preserved.
- Admin login remains `pisonet@admin.com`.
- Admin client creation uses a separate Firebase Auth instance with in-memory persistence.
- Admin session is not intentionally signed out during client creation.
- CID sequence remains no-reuse / highest-existing-ID + 1.
- Existing UI and dashboard sections are preserved.

## IMPORTANT
The website cannot deploy Firestore Security Rules by itself. The included `firestore.rules` must be published in Firebase Console before Add Client can write to Firestore.

DO NOT delete the Firebase project, Authentication users, Firestore data, Google Sheet, or Apps Script project.

## DEPLOY WEBSITE
1. Replace the contents of the GitHub Pages repository with the contents of this folder.
2. Commit/push.
3. Wait for Cloudflare Pages deployment to finish.
4. Hard refresh with Ctrl+Shift+R.

## PUBLISH FIRESTORE RULES
Firebase Console → Firestore Database → Rules → replace the rules with the included `firestore.rules` → Publish.

The Admin write check is intentionally restricted to the dedicated Admin email `pisonet@admin.com`.

## AFTER DEPLOYMENT TEST
1. Sign in to `/admin/`.
2. Open Units / Clients.
3. Add New Client.
4. Select a free Unit Code.
5. Fill First Name, Last Name, Registered Gmail.
6. Save Client.
7. Confirm the new CID appears and the Admin remains logged in.
8. Test the customer login separately.
9. Test the 6-digit password recovery separately.
