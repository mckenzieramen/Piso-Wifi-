PISO WIFI — V16 NAVIGATION STABILITY FIX

Built from the V15 Premium baseline.

Navigation changes only:
- Hash URL is the single source of truth.
- Real sidebar anchors navigate normally.
- No Cloudflare pathname rewrites.
- Removed double-render navigation behavior.
- Added a visible loading shell and route-error fallback so a renderer exception cannot leave a blank page.
- Premium UI, Firebase authentication, Firestore data model, financial calculations, and existing feature renderers are preserved.
