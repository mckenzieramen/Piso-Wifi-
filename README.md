# PISO WIFI Management System — GitHub + Firebase starter

## Setup
1. Create a Firebase project.
2. Enable Authentication > Sign-in method > Email/Password.
3. Create your first admin user under Authentication > Users.
4. Create a Web App in Firebase and copy its config.
5. Copy `firebase-config.example.js` to `js/firebase-config.js` and replace the placeholders.
6. Create a Firestore database.
7. Upload this project to GitHub.
8. Enable GitHub Pages for the repository.
9. Open the GitHub Pages URL. Unauthenticated visitors are redirected to `index.html`.

## Important
Never place a Firebase Admin SDK service-account private key in this repository.
For production, use Firestore Security Rules so only authenticated/authorized users can read and write business data.

This starter implements the login gate and a connected dashboard shell. The remaining management pages and full CRUD/report/payment workflows can be added without changing the authentication flow.
