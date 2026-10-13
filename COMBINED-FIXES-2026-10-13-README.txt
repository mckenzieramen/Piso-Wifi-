PISO WIFI COMBINED FIXES — 2026-10-13

This package is based on the latest available Piso-Wifi--main (13) project archive.

Implemented in this pass:
1. Cashier account creation remains email-free and shows a simple success alert after account creation.
2. Cashier payment confirmation is a website modal (not browser confirm) showing the customer earnings amount and requiring the registered customer's full name as an acknowledgment. The acknowledgment and timestamp are saved on the transaction.
3. Remit totals now use distinct customer/unit count, gross sales, fixed ₱1,000 internet share per customer, fixed ₱100 owner electricity share per customer, customer earnings = 30% of gross + electricity share, and expected cash = gross - internet share - electricity share.
4. Fixed Firestore REST commit document resource names for monthlyRecords and payments. The commit payload requires resource names like projects/{project}/databases/(default)/documents/... rather than a full https URL; this was the source of the reported Firestore 400 error.
5. Bumped cashier JavaScript cache version.

Validation performed:
- node --check passed for all .js files under js/ and functions/.

Not verified here:
- Live Firebase login and Firestore rules/permissions.
- Live email delivery, which requires Cloudflare Pages secrets RESEND_API_KEY and RECEIPT_FROM_EMAIL (plus Firebase API key setting for authenticated endpoint).
- Visual source of the stray standalone } at bottom of the Cashier page was not conclusively located in this archive and should be checked in browser after deploy.

Deploy the changed project to a staging/test deployment first. Do not assume live email works until tested with a real test payment.
