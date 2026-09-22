PISO WIFI — OFFICIAL ROUTE BUILD

The official customer/client website is the root URL:
https://piso-wifi.pages.dev/

The Admin portal is:
https://piso-wifi.pages.dev/admin

The authenticated client dashboard is:
https://piso-wifi.pages.dev/client

Deploy the contents of this package to the ROOT of the Cloudflare Pages project.
Do not nest the whole package inside another folder.

The customer account remains client-only and uses the existing Firebase authentication/data layer.
Each authenticated client must be authorized server-side to access only their own units, sales, payments, statements and notifications.


CUSTOMER ACCOUNT NAMING — V11
=============================
Customer-facing branding now uses "Customer Account" instead of "Client Portal".
Official customer login:
https://piso-wifi.pages.dev/

Admin:
https://piso-wifi.pages.dev/admin

The internal data/auth architecture may still use client/clientId terminology
where required by the existing backend; only the customer-facing wording was changed.


## Premium account architecture
- Admin portal: /admin
- Customer portal: /
- Customer login uses Client ID (C-001+) mapped to Firebase Authentication.
- Unit codes are searchable in a custom 001–050 combobox; active units cannot be duplicated.
- Temporary customer password is generated as PISO-<unit code> because Firebase requires a minimum password length; customer must create a private password on first login.
- Remember Me stores only the Client ID/admin email, never passwords.
- A new login updates the user session marker so older signed-in devices can be signed out by the dashboard session watcher.
