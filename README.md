# PISO WIFI — Clean Customer Login + Account Recovery Build

This package is the cleaned production structure for the PISO WIFI portal.

## Customer account flow

1. Admin creates a customer account.
2. Registered Gmail is required and must be unique.
3. Account is created Active.
4. System generates the Client ID automatically: `CID-001`, `CID-002`, etc.
5. System generates the full customer username from First Name + Client ID, for example `CliffCID-023`.
6. Temporary password is the Client ID, for example `CID-023`.
7. Customer signs in using the generated full username (registered Gmail remains supported) + temporary Client ID password.
8. On first login, the existing Customer Portal forces the customer to create a private password.
9. Admin never receives or stores the customer's final password.

## Gmail rule

The registered Gmail is required and unique. Duplicate Gmail addresses are rejected against both the customer records and Firebase Authentication.

## Forgot Password flow

The customer enters:
- Client ID
- Registered Gmail

No Admin authorization is required for the customer recovery request.

The secure Firebase function verifies the Client ID, active status, registered Gmail, and Firebase Authentication account, then generates a Firebase password-reset action code. It sends that code through the existing Google Apps Script mailer using the PISO WIFI custom HTML email.

The customer receives the PISO WIFI email with the **Reset My Password** button and is routed to `reset-password.html` to create a new private password.

## Routes

- Customer Login: `/`
- Customer Login alias: `/client-login`
- Customer Dashboard: `/client/`
- Admin Login: `/admin`
- Admin Dashboard: `/admin/dashboard.html`
- Password Reset: `/reset-password.html`

## Deployment order

1. Replace the website files with this clean package on Cloudflare Pages.
2. Deploy Firebase Functions from `functions/`.
3. Deploy the included Firestore rules.
4. Replace the existing Apps Script project code with `apps-script/Piso_WiFi_Backend.gs` and deploy it as the same Web App endpoint used by the Firebase function.

Do not mix the removed duplicate files from the previous project folder back into this build.
