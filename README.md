# PISO WIFI Management System — Premium V2

Premium Firebase-backed PISO WIFI management dashboard based on the supplied MASTER FULL-SYSTEM IMPLEMENTATION PROMPT.

## Included
- Premium navy/blue SaaS dashboard visual system
- Dashboard KPI cards, six-month sales trend, top units, outstanding payments
- Units / Clients management
- Add / Edit / Activate / Deactivate clients
- **Temporary permanent Delete Client / Unit feature** with `DELETE` confirmation
- Gross Sales record / edit / delete
- Automatic Internet / Net / Owner Share / Client Share / Electricity / Amount Due calculations
- Payments with Paid / Partial / Unpaid states
- Client Profile and Statement views
- Monthly Reports + CSV / Excel / Print
- Notifications and Activity Log
- Business Settings and configurable calculation rules
- Firebase Authentication + Firestore persistence
- Responsive desktop / tablet / mobile layout

## Temporarily enabled client deletion
In `js/dashboard.js`:

```js
const ENABLE_CLIENT_DELETE = true;
```

When the delete feature is no longer wanted, change it to:

```js
const ENABLE_CLIENT_DELETE = false;
```

This hides the Delete Client action without removing the rest of the management system.

## Important
Normal unit management should use **Deactivate**, which preserves historical financial records. The temporary Delete Client feature is a permanent administrative cleanup action and removes the selected unit together with its linked monthly sales and payment records after explicit `DELETE` confirmation.

## Firebase
Use the Firebase config already present in `js/firebase-config.js`. Publish `firestore.rules` in the Firebase Console.


## Client Portal — Added
The project now includes a real Firebase-backed Client Portal:
- `client-login.html` — dedicated client login
- `client.html` — authenticated client dashboard and portal routes
- `js/client-login.js` — client authentication / role routing
- `js/client.js` — client-only data loading, dashboard, units, sales, payments, statements, profile and notifications
- `css/client.css` — reference-matched responsive client UI
- `js/finance.js` — shared financial calculation logic used by both Admin and Client portals

### Client/Admin connection
Admin client/unit records now support:
- `clientCode`
- `email`
- `dateJoined`
- `address`
- `authUserId` (auto-linked after the client signs in)
- existing unit/location/contact/status fields

The Client Portal finds the authenticated client by the same email stored on the Admin client record and then establishes the Firebase UID link. A client can have multiple units using the same client email.

### Client security
`firestore.rules` now separates Admin and Client access. Client reads are scoped to their own unit records, monthly sales, payments and notifications. Client profile updates are limited to personal fields and the UID-link field; financial records, unit assignments, payments and business settings remain Admin-controlled.

### Important deployment step
Publish the updated `firestore.rules` in Firebase Console before testing the Client Portal. The client account must already exist in Firebase Authentication and use the same email entered by Admin in the client/unit record.
