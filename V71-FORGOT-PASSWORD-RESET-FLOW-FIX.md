# V71 — Forgot Password Reset Flow Fix

Locked baseline: V70.

Changed ONLY the Forgot Password reset-link handling:
- `js/client-login.js`: `handleCodeInApp` changed from `true` to `false` so the web email-action handler is used for the browser reset flow.
- `reset-password.html`: accepts the Firebase `oobCode` from the normal query string, hash, or nested `continueUrl` when present.
- `_redirects`: explicit `/reset-password` and `/reset-password/` routes to `reset-password.html`.

Normal first-login temporary-password flow was not changed.
Admin/customer login logic was not changed.
