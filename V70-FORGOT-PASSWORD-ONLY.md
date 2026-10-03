PISO WIFI v70 — FORGOT PASSWORD CONGRATULATIONS ONLY

This version keeps the FIRST LOGIN Change Password feature unchanged.

Only the Forgot Password flow has the completion screen:
1. Customer clicks Forgot Password.
2. Customer receives the Firebase reset email.
3. Customer clicks Reset My Password.
4. Customer enters and confirms the new password.
5. After confirmPasswordReset succeeds, the page shows:
   Congratulations!
   Your password was changed successfully.
   Go Back to Login

The reset completion marker is retained so the subsequent login clears the
old temporary-password flag and does not show the Change Password prompt again.

Do not move the Congratulations screen into the normal first-login password
setup modal.
