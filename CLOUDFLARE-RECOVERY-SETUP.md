# PISO WIFI — Spark-safe Temporary Password Recovery

This version no longer requires Firebase Cloud Functions or the Firebase Blaze plan for the Admin recovery action.

The Admin page calls the Cloudflare Pages Function:

`/api/set-client-temporary-password`

The function securely uses a Firebase service-account secret to update the Firebase Authentication password and Firestore recovery/unit records. The temporary password is never written to Firestore.

## One-time Cloudflare setup

1. In the Cloudflare dashboard, open the **PISO WIFI** Pages project.
2. Open **Settings → Variables and Secrets** (Production environment).
3. Add a secret named:

`FIREBASE_SERVICE_ACCOUNT_JSON`

4. In Firebase Console, open **Project settings → Service accounts → Firebase Admin SDK** and generate a new private key. Keep the downloaded JSON private.
5. Copy the **entire JSON file contents** into the Cloudflare secret value.
6. Redeploy the Pages project from the connected Git repository.

The service account must have permission to update Firebase Authentication users (`firebaseauth.users.update`) and read/write the PISO WIFI Firestore data used by this recovery flow. The normal Firebase Admin SDK service-account setup is the intended credential source.

## Security

- The service-account JSON must never be committed to GitHub or placed in website JavaScript.
- The browser only sends the signed-in Admin's Firebase ID token to the Cloudflare endpoint.
- The endpoint verifies the Firebase token, checks the Admin profile, verifies the recovery request and registered Gmail, then updates the customer's Firebase Authentication password server-side.
- The temporary password is not stored in Firestore or returned by the endpoint.
- The customer remains forced to create a private password after the next login.

## Firebase billing

Firebase Cloud Functions are not used by this recovery endpoint. The PISO WIFI Firebase project can remain on the Spark plan for this flow.
