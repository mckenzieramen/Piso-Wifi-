# PISO WIFI Management System

Firebase-powered Piso WiFi business management dashboard based on the supplied Master Full-System Implementation Prompt.

## Implemented
- Firebase Authentication + admin authorization
- Dashboard with dynamic KPIs and six-month sales trend
- Global month selector
- Units / Clients: add, edit, search, status/payment filters, activate/deactivate
- Monthly Gross Sales: record, edit, delete with confirmation
- Automatic calculation: Gross Sales -> Internet Cost -> Net Sales -> Owner/Client shares -> Electricity -> Amount Due
- Payment recording with balance and Paid/Partial/Unpaid status
- Client Profile: Overview, Monthly Sales, Payments, Statement
- Client Statements with print and PDF download
- Monthly Reports with CSV, Excel and print export
- Notifications with unread/read state and Mark all as read
- Activity Log
- Configurable business settings
- Historical monthly records (one sales record per unit/month)
- Responsive desktop/tablet/mobile layout
- Firestore persistence and admin-only Firestore rules

## Firebase collections
`users`, `units`, `monthlyRecords`, `payments`, `settings`, `notifications`, `activities`

## Deployment
Upload/push the project files to the connected GitHub repository used by Cloudflare Pages. Cloudflare Pages should build it as a static site with no build command and the repository root as the output directory.

Before using Notifications and Activity Log in production, publish the included `firestore.rules` in Firebase Console.

### If the dashboard says "Missing or insufficient permissions"
The website now loads the core financial data independently from the newer Notifications/Activity collections, so adding those collections cannot blank the dashboard. If the error still appears, the Firebase Console rules for `users`, `units`, `monthlyRecords`, `payments`, or `settings` are not the current admin rules. Publish the included `firestore.rules` and make sure the authenticated admin UID is `u3Vjej0CrFgDSekt3NpXuHERpJM2`.

## Important
The Firebase web config is client-side configuration. Keep private service-account credentials out of the repository.
