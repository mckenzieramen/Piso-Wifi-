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
