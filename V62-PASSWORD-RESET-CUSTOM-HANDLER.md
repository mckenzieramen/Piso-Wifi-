V62 PASSWORD RESET CUSTOM HANDLER

Fixed:
- Reset page reads Firebase email-action query parameters: mode and oobCode.
- Displays the password fields immediately when a valid reset code arrives.
- Uses the PISO WIFI transparent logo without the white filter artifact.
- After a successful reset, clears units.forcePasswordChange so the customer is not forced
  through the first-login password setup again.
- X and Return to Login both route to /.
- No automatic close.

IMPORTANT FIREBASE CONFIGURATION:
Firebase documents that a custom email action handler must be configured as the
email template Action URL. The generated email action URL then includes
mode=resetPassword and oobCode. If the project still uses the default
firebaseapp.com action handler, it can complete/handle the action before
redirecting to the continue URL, so the custom page will not receive the oobCode.

For this project, the intended custom handler is:
https://piso-wifi.pages.dev/reset-password.html

The Firebase console currently reports that email template updates are unavailable
for this project, so the Action URL may need to be changed by Firebase Support or
through an allowed project configuration path. The code fix alone cannot make the
Firebase-generated email link change its server-side action URL.
