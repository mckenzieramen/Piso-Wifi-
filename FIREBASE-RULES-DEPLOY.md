# PISO WIFI — Firebase Rules Deployment

The support chat root-cause fix is in `firestore.rules`. The site cannot change Firebase Security Rules by itself.

Before testing V16:
1. Open the Firebase project used by PISO WIFI.
2. Open Firestore Database → Rules.
3. Replace/publish the rules with the included `firestore.rules`.
4. Wait for the rules publication to finish.
5. Hard refresh the Admin and Customer pages.

The support chat rule is intentionally scoped to:
- Admin: authenticated Admin role + active account.
- Customer: authenticated customer may read/update only a conversation whose `authUserId` equals the customer's Firebase Auth UID.

Do not add public read/write access to `supportChats`.
