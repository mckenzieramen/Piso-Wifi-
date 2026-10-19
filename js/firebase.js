import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// Keep Admin and Customer credentials in separate Firebase Auth stores.
const portalAppName = location.pathname.startsWith("/admin/") ? "piso-admin" : location.pathname.startsWith("/client/") ? "piso-customer" : "piso-main";
const app = initializeApp(firebaseConfig, portalAppName);
export const auth = getAuth(app);
export const db = getFirestore(app);