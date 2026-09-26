PISO WIFI v63 — PASSWORD RESET FLOW

The Firebase-hosted password reset screen performs the actual password change.
After the customer finishes changing the password, Firebase returns to:
/reset-password.html?reset=success

That page is now only a professional success/return-to-login page with the PISO WIFI logo.
It does not ask for the password again.

The success page sets a browser completion marker. On the next customer login, the client
portal clears forcePasswordChange on the customer unit, so the customer is not prompted
to change the password a second time.

Normal first-login temporary-password behavior remains unchanged when no password-reset
completion marker exists.
