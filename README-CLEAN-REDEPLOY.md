# PISO WIFI — CLEAN FULL REDEPLOY PACKAGE

This package is based on the current stable PISO WIFI Admin/Client project.
Only the required stability fixes are included. The 6-digit OTP/password-recovery flow is preserved.

## IMPORTANT
Do NOT delete the Firebase project, Firestore database, Firebase Authentication users, or Google Sheet.
Delete/redeploy only the website repository/files if you want a clean website deployment.

## Website deployment
1. Create/clean the GitHub repository used by Cloudflare Pages.
2. Upload the CONTENTS of this folder to the repository root (do not create another nested `Piso-Wifi--main` folder).
3. Commit and push.
4. Let Cloudflare Pages deploy.
5. Open `https://piso-wifi.pages.dev/`.
6. Hard refresh with Ctrl+Shift+R.

## Firebase Firestore Rules — REQUIRED ONE-TIME DEPLOY
Cloudflare Pages does NOT publish Firebase Firestore Rules.

The included `firestore.rules` is the Admin-write fix. Publish it in Firebase Console:
Firebase Console → Firestore Database → Rules → replace the rules with the included `firestore.rules` → Publish.

The included `firebase.json` is also configured for Firebase CLI:
`firebase deploy --only firestore:rules`

## Admin
Email: `pisonet@admin.com`
Password: use the existing Firebase Authentication password.

## Critical preservation
- 6-digit OTP/password recovery remains intact.
- Admin login remains separate from customer account provisioning.
- Customer account provisioning uses a secondary in-memory Firebase Auth instance so it does not sign out the Admin.
- Existing Client IDs are not reused.
- Existing Firebase data is not deleted by this package.

## Add Client test
Admin → Units → Add New Client → fill required fields → Save Client.
Expected: client is created without logging out the Admin.
