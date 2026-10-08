# Cashier Portal — Deployment Notes

This build adds a separate `/cashier` portal and `/admin/cashiers` management area while preserving the existing Admin/Customer routes.

## Firebase

Deploy both Firestore and Storage rules from this project:

```bash
firebase deploy --only firestore:rules,storage
```

The existing Firebase project is retained as the single source of truth.

## Roles

Admin remains `pisonet@admin.com`. Cashier accounts are created by Admin and receive a `users/{uid}` document with `role: cashier` and an active flag.

## Remittance security

Cashiers can submit a remittance request, but only Admin can finalize it. This prevents a cashier from self-approving a remittance. The browser never stores an Admin password in Firestore.

## Routes

- `/admin` — existing Admin login
- `/admin/cashiers` — Admin Cashier management
- `/cashier` — Cashier login and portal
- `/client` — existing Customer portal
