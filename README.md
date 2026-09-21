# PISO WIFI Management System — Premium V8

V8 preserves the existing Firebase authentication, financial data model, Customer Net summary, reports, statements, payments, settings, and client management.

## Navigation fix
- Sidebar navigation now uses an explicit SPA route handler.
- Clicking Dashboard, Units / Clients, Monthly Reports, Payments, Client Statements, Notifications, Activity Log, or Settings renders the target section immediately.
- Browser hash navigation/back-forward remains supported.
- Navigation errors now show a useful error panel instead of a blank screen.

## Temporary client delete
`ENABLE_CLIENT_DELETE` remains `true` in `js/dashboard.js` and can later be set to `false` to hide the Delete Client button.


V10 fixes sidebar navigation by directly binding every navigation button; no hash links are used for the sidebar.
