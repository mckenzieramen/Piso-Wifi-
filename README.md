# PISO WIFI Management System

This build keeps the existing Firebase Email/Password login and adds a navigable Firebase/Firestore admin dashboard based on the supplied PISO WIFI recreation specification.

## Navigation
Dashboard, Units / Clients, Monthly Reports, Payments, Client Statements, Settings, Logout.

## Firestore collections
- `users/{UID}` — admin authorization (`role: admin`, `active: true`)
- `units`
- `monthlyRecords`
- `payments`
- `settings/business`

## Current admin UID
`ZhP8E64YOXcTgOUKPMcap3a24Gk2`

## Deployment
Cloudflare Pages can deploy the repository directly from GitHub. No build command is required; publish the repository root.

## Important
The Firebase web configuration in `js/firebase-config.js` is client-side configuration. Do not put Firebase Admin SDK/service-account private keys in this repository.
