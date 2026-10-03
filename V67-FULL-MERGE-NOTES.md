PISO WIFI v67 — FULL MERGE / LOCKED BASELINE

BASE:
- v46 full project retained as the complete baseline.

MERGED FROM v64:
- Customer login auth-state race protection.
- Direct customer routing after the server-side clientLogin verification.
- Forgot Password confirmation X/Close click reliability.
- No automatic closing of the success confirmation.

PRESERVED FROM v46:
- Working Firebase password-reset email request.
- Working reset-password.html with New Password + Confirm New Password.
- Existing Client ID / Username / Gmail login support.
- All existing project files/features.

ADDITIONAL ROOT-CAUSE FIX:
- Successful password reset sets a browser completion marker.
- On the authenticated customer login/dashboard path, the customer unit's
  forcePasswordChange flag is cleared, so the customer is not asked to change
  the password a second time.
- The v64 undefined `cred` problem is not carried over; the authenticated
  credential is explicitly assigned.
