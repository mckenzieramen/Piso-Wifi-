# Customer Login CORS Fix — 2026-10-02

The customer login callable `clientLogin` is deployed in `us-central1`.

The function now explicitly permits the production Cloudflare Pages origin:
`https://piso-wifi.pages.dev`

The browser client also explicitly targets the `us-central1` Functions region.

## Deploy

From this folder:

```bash
cd functions
npm install
cd ..
firebase deploy --only functions:clientLogin
```

Then deploy the static site to Cloudflare Pages and hard-refresh the browser with Ctrl+Shift+R.

Do NOT make Firestore rules public to solve this CORS problem. CORS and Firestore permissions are separate.
