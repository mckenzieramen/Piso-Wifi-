PISO WIFI v68 — NO SECOND CHANGE-PASSWORD PROMPT

Base:
- Full PISO WIFI v67 package.

Fix:
- Server-side clientLogin now clears forcePasswordChange automatically when
  the customer successfully logs in with a password different from the
  Admin-created temporary Client ID password.
- This prevents the first-login Change Password modal from appearing again
  after the customer has already completed password setup.
- Client-side setup completion is also remembered locally.
- Password-reset success screen now says Congratulations and provides
  Go Back to Login.

The first-login password setup feature remains available for customers who
are still using the original temporary Client ID password.
