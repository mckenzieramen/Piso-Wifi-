# PISO WIFI — Account Recovery Temporary Password

The website already contains the Admin recovery popup. The secure password change is performed by the Firebase Cloud Function:

`setClientTemporaryPassword`

Project:

`piso-wifi-f2b5c`

Region:

`us-central1`

The function uses Firebase Admin SDK to update the customer's Firebase Authentication password. It does **not** store the temporary password in Firestore and it sets `forcePasswordChange=true` on the customer unit record.

## One-time deployment

On Windows, double-click:

`DEPLOY-RECOVERY-FUNCTION.bat`

The script will:

1. Check Node.js/npm.
2. Open Firebase login.
3. Deploy only `setClientTemporaryPassword` to `piso-wifi-f2b5c`.

The Google account used for login must have permission to deploy Cloud Functions in the Firebase project.

After deployment, test:

Admin → Notifications → Account Recovery Request → Review → Approve & Set Password

The browser does not need to be given Firebase service-account credentials.
