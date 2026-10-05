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


Support chat added in this SafeEdit version: customer ↔ admin real-time chat via supportChats, typing indicators, unread flags, Open/Solved/Closed statuses, and preserved conversation history.


## V16 Support Chat Root-Cause Fix
- Customer support conversations now use the authenticated customer's UID as the stable default document ID.
- Existing conversations created by earlier versions are recovered by `authUserId` lookup.
- Customer support access no longer depends on unit-linkage fields at the time a chat is created; access remains restricted to the signed-in owner or Admin.
- Admin opening a conversation clears the Admin unread flag.
- Publish the included `firestore.rules` to the same Firebase project used by the site before testing support chat.
