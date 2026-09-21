# PISO WIFI Management System — V12 Navigation + Login Fix

This build preserves the Firebase authentication, Firestore data model, financial calculations, reports, statements, payments, settings, and client management.

## V12 fixes
- Removed malformed inline `onclick` JavaScript from the sidebar.
- Added direct capture-phase navigation handling for sidebar buttons.
- `window.pisoNavigate()` remains the app navigation API.
- Added hash + browser-history route state so navigation works after clicks and back/forward.
- Added Cloudflare Pages clean-route support: `/dashboard` serves `dashboard.html`.
- Added cache-busting query strings to the active CSS/JS files.
- Login now redirects to `/dashboard`.
- Improved Firebase login error messages.

## Temporary client delete
`ENABLE_CLIENT_DELETE` remains `true` in `js/dashboard.js`. Set it to `false` later to hide the Delete Client button.
