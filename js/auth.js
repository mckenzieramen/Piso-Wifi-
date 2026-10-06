import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form = document.querySelector("#loginForm");
const msg = document.querySelector("#loginMessage");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const submitButton = form?.querySelector('button[type="submit"]');
const togglePassword = document.querySelector("#togglePassword");
const resetPassword = document.querySelector("#resetPassword");
const rememberAdmin = document.querySelector("#rememberAdmin");
const REMEMBER_ADMIN_KEY = "pisoWifi.rememberedAdminEmail";
let redirecting = false;
let signingIn = false;

function showMessage(text, type = "") {
  if (!msg) return;
  msg.textContent = text;
  msg.className = `login-message ${type}`.trim();
}

function setBusy(busy) {
  signingIn = busy;
  if (submitButton) {
    submitButton.disabled = false;
    submitButton.style.pointerEvents = "auto";
    submitButton.textContent = busy ? "Signing in…" : "Sign in to Admin";
    submitButton.setAttribute("aria-busy", busy ? "true" : "false");
  }
}

async function getRole(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() ? snap.data() : null;
}

async function routeSignedInUser(user) {
  if (!user || redirecting || signingIn) return;
  redirecting = true;
  try {
    const profile = await getRole(user);
    if (profile?.role === "admin" && profile?.active !== false) {
      try {
        if (rememberAdmin?.checked && user.email) localStorage.setItem(REMEMBER_ADMIN_KEY, user.email.toLowerCase());
      } catch (_) {}
      window.location.replace("/admin/dashboard.html");
      return;
    }
    await signOut(auth).catch(() => {});
    redirecting = false;
    showMessage("This account is not authorized for the Admin Portal.", "error");
  } catch (e) {
    console.error("[PISO WIFI ADMIN AUTH]", e);
    await signOut(auth).catch(() => {});
    redirecting = false;
    showMessage("Unable to verify Admin access. Please try again.", "error");
  }
}

try {
  const saved = localStorage.getItem(REMEMBER_ADMIN_KEY);
  if (saved && emailInput) {
    emailInput.value = saved;
    if (rememberAdmin) rememberAdmin.checked = true;
  }
} catch (_) {}

// Restore an already-authenticated Admin session, but never block the login form.
onAuthStateChanged(auth, user => {
  if (user && !signingIn) routeSignedInUser(user);
});

form?.addEventListener("submit", async e => {
  e.preventDefault();
  e.stopPropagation();
  if (signingIn || redirecting) return;

  const email = String(emailInput?.value || "").trim().toLowerCase();
  const password = String(passwordInput?.value || "");
  if (!email || !password) {
    showMessage("Enter your email and password.", "error");
    return;
  }

  setBusy(true);
  showMessage("Signing in…");

  try {
    // Do not wait for a separate persistence API call; Firebase Auth can sign in immediately.
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const profile = await getRole(cred.user);

    if (profile?.role !== "admin" || profile?.active === false) {
      await signOut(auth).catch(() => {});
      setBusy(false);
      showMessage("Access denied. This account is not an active Admin account.", "error");
      return;
    }

    try {
      if (rememberAdmin?.checked) localStorage.setItem(REMEMBER_ADMIN_KEY, email);
      else localStorage.removeItem(REMEMBER_ADMIN_KEY);
    } catch (_) {}

    redirecting = true;
    showMessage("Admin verified. Opening dashboard…", "success");
    window.location.replace("/admin/dashboard.html");
  } catch (err) {
    console.error("[PISO WIFI ADMIN LOGIN]", err);
    setBusy(false);
    const code = String(err?.code || "");
    let text = "Login failed. Please check your Admin email and password.";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
      text = "Incorrect Admin email or password.";
    } else if (code === "auth/too-many-requests") {
      text = "Too many attempts. Please wait a moment and try again.";
    } else if (code === "auth/network-request-failed") {
      text = "Network connection failed. Please check your internet and try again.";
    }
    showMessage(text, "error");
  }
});

togglePassword?.addEventListener("click", e => {
  e.preventDefault();
  const p = passwordInput;
  if (!p) return;
  p.type = p.type === "password" ? "text" : "password";
  togglePassword.textContent = p.type === "password" ? "Show" : "Hide";
});

resetPassword?.addEventListener("click", async e => {
  e.preventDefault();
  const email = String(emailInput?.value || "").trim();
  if (!email) {
    showMessage("Enter your Admin email first.", "error");
    return;
  }
  try { await sendPasswordResetEmail(auth, email); } catch (_) {}
  showMessage("If an Admin account exists for that email, password reset instructions have been sent.", "success");
});
