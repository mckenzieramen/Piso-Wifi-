import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut,
  setPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form = document.querySelector("#loginForm");
const msg = document.querySelector("#loginMessage");
const REMEMBER_ADMIN_KEY = "pisoWifi.rememberedAdminEmail";
const rememberAdmin = document.querySelector("#rememberAdmin");
let routing = false;
try {
  const savedAdminEmail = localStorage.getItem(REMEMBER_ADMIN_KEY);
  if (savedAdminEmail && document.querySelector("#email")) {
    document.querySelector("#email").value = savedAdminEmail;
    if (rememberAdmin) rememberAdmin.checked = true;
  }
} catch {}

function showMessage(text, type = "") {
  msg.textContent = text;
  msg.className = `login-message ${type}`.trim();
}

async function getRole(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() ? snap.data() : null;
}

async function routeSignedInUser(user) {
  if (!user || routing) return;
  routing = true;

  try {
    const profile = await getRole(user);

    // ADMIN PORTAL IS STRICTLY ADMIN-ONLY.
    if (profile?.role === "admin" && profile?.active !== false) {
      try {
      if (rememberAdmin?.checked && user.email) localStorage.setItem(REMEMBER_ADMIN_KEY, user.email.toLowerCase());
      else if (!rememberAdmin?.checked) localStorage.removeItem(REMEMBER_ADMIN_KEY);
    } catch {}
    window.location.replace("/admin/dashboard.html");
      return;
    }

    // A customer must never be routed into the Admin portal.
    await signOut(auth);
    routing = false;
    showMessage(
      "This account is a Customer Account. Please use the Customer Account login.",
      "error"
    );
  } catch (e) {
    console.error("[PISO WIFI ADMIN AUTH]", e);
    try { await signOut(auth); } catch {}
    routing = false;
    showMessage(
      "This account is not authorized for the Admin Portal.",
      "error"
    );
  }
}

// Session persistence is per browser tab so Admin and Customer portals
// do not share an authentication session across tabs.
onAuthStateChanged(auth, user => {
  if (user) routeSignedInUser(user);
});

form.addEventListener("submit", async e => {
  e.preventDefault();
  if (routing) return;

  const email = document.querySelector("#email").value.trim().toLowerCase();
  const password = document.querySelector("#password").value;

  if (!email || !password) {
    showMessage("Enter your email and password.", "error");
    return;
  }

  showMessage("Signing in…");
  routing = true;

  try {
    await setPersistence(auth, browserSessionPersistence);
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const profile = await getRole(cred.user);

    if (profile?.role !== "admin" || profile?.active === false) {
      await signOut(auth);
      routing = false;
      showMessage(
        "Access denied. This account is not an active Admin account.",
        "error"
      );
      return;
    }

    try {
      if (rememberAdmin?.checked) localStorage.setItem(REMEMBER_ADMIN_KEY, email);
      else localStorage.removeItem(REMEMBER_ADMIN_KEY);
    } catch {}

    window.location.replace("/admin/dashboard.html");
  } catch (err) {
    console.error("[PISO WIFI ADMIN LOGIN]", err);
    routing = false;
    showMessage("Login failed. Please check your Admin email and password.", "error");
  }
});

document.querySelector("#togglePassword").onclick = () => {
  const p = document.querySelector("#password");
  p.type = p.type === "password" ? "text" : "password";
  document.querySelector("#togglePassword").textContent =
    p.type === "password" ? "Show" : "Hide";
};

document.querySelector("#resetPassword").onclick = async () => {
  const email = document.querySelector("#email").value.trim();
  if (!email) {
    showMessage("Enter your Admin email first.", "error");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    showMessage("If an Admin account exists for that email, password reset instructions have been sent.", "success");
  } catch {
    showMessage("If an Admin account exists for that email, password reset instructions have been sent.", "success");
  }
};
