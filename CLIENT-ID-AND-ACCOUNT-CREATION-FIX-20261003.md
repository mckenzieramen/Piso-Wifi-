# Client ID + Customer Account Creation Fix — 2026-10-03

Changes made to the active Admin dashboard file: `js/dashboard.js`.

1. Add New Client now displays the next Client ID immediately (for example `CID-008`) using `settings/clientSequence`.
2. Opening/canceling the form does not consume the sequence. The sequence is incremented only when the client is actually saved.
3. The save operation still uses a Firestore transaction, so two simultaneous saves do not intentionally reuse the same sequence number.
4. The `auth/email-already-in-use` error now correctly explains that the registered Gmail already has a Firebase Authentication account. The previous message incorrectly blamed the generated username.
5. No existing files were deleted from the supplied baseline ZIP.
