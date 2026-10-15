# PISO WIFI targeted repair — 14 October 2026

## Root causes identified from the screenshots/source
1. `functions/api/cashier-sync.js` in the previously packaged project accidentally contained the browser-side `js/cashier.js` module instead of a Cloudflare Pages API handler. That makes `/api/cashier-sync` fail, causing the cashier alert “Dashboard sync failed.” This package restores the actual server-side API handler.
2. The customer portal's `js/client.js` still used Firestore `onSnapshot` watch targets for dashboard data and support chat, the same listener/watch-stream path shown in the `ca9/b815` screenshot. Earlier mitigation did not remove all of those listeners. This package replaces customer-side realtime listeners with Firestore reads on a timer: dashboard data every 15 seconds and support conversation every 2.5 seconds while the chat subscription is active. Customer portal only; Admin and Cashier listener behavior is untouched.
3. Receipt email has a separate deployment configuration problem: `/api/send-receipt` explicitly requires Resend secrets. A ZIP cannot invent or install the account's private keys.

## Required Cloudflare Pages production secrets
For dashboard sync:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_API_KEY`
- `FIREBASE_SERVICE_ACCOUNT_JSON` (full JSON; same Firebase project)

For receipt email:
- `RESEND_API_KEY`
- `RECEIPT_FROM_EMAIL` (verified sender/domain in Resend)

Set these in Cloudflare Pages → project `piso-wifi` → Settings → Variables and Secrets. Keep secrets private. Redeploy after saving them.

## Deploy and verify
1. Deploy the contents of `Piso-Wifi--main` as the Pages project root and include `functions/`.
2. In the customer portal, hard refresh and check that the `ca9/b815` WatchChangeAggregator assertion no longer appears. Data refresh may take up to 15 seconds; support messages may take up to 2.5 seconds.
3. Use **Retry Dashboard Sync** on an existing test sale/payment; do not create duplicate sales to test.
4. After Resend secrets are configured, use **Resend Email** on an existing receipt.
5. Test customer support end-to-end: customer opens chat, cashier sees it under **PISO NETY Support**, cashier claims and replies, customer sees the cashier name, then cashier transfers it to Admin. Do not re-enter payments or sales for testing.

The code and ZIP are syntax/integrity checked. Live Firebase and Cloudflare secret configuration cannot be verified from this workspace.
