# PISO WIFI — Account Recovery Temporary Password Function

The Admin recovery popup is already implemented in the website. The button calls this secure Firebase Cloud Function:

`setClientTemporaryPassword`

Project:

`piso-wifi-f2b5c`

Region:

`us-central1`

## Why “Failed to fetch” appeared

The website calls the Cloud Function, but the current deployment does not have a reachable `setClientTemporaryPassword` endpoint. The frontend cannot securely change another user's Firebase password by itself; that operation must run through a trusted server-side Firebase Admin SDK function.

## Deploy

Run `DEPLOY-RECOVERY-FUNCTION.bat` on a machine with internet access, or from this project folder run:

```text
npx firebase-tools@latest login
npx firebase-tools@latest deploy --only functions:setClientTemporaryPassword --project piso-wifi-f2b5c
```

After deployment, reload the Admin page and use **Approve & Set Password** again.

The temporary password is never written to Firestore. The function changes the Firebase Authentication password, marks the recovery request approved, and sets `forcePasswordChange=true`.
