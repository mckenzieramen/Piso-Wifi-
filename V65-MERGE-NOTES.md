PISO WIFI v65 — MERGED BASELINE

Source baseline:
- v46 complete project, preserved as the base.

Merged fixes:
- v64 customer-login race/login-after-reset fix.
- v64 Forgot Password confirmation close/X click fix.
- v46 functional password-reset page retained.
- Successful password reset now sets the browser completion marker used by the
  merged customer login flow, so the old temporary-password change prompt is
  not shown again after a password reset.

No v46 project directories/features were removed.
