import { auth } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const ADMIN_EMAIL = "pisonet@admin.com";
const form = document.querySelector("#loginForm");
const msg = document.querySelector("#loginMessage");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const submitButton = form?.querySelector('button[type="submit"]');
const togglePassword = document.querySelector("#togglePassword");
const resetPassword = document.querySelector("#resetPassword");
const rememberAdmin = document.querySelector("#rememberAdmin");
const KEY = "pisoWifi.rememberedAdminEmail";
let busy = false;
let redirecting = false;

function showMessage(text, type="") {
  if (!msg) return;
  msg.textContent = text;
  msg.className = `login-message ${type}`.trim();
}
function setBusy(value) {
  busy = value;
  if (submitButton) {
    submitButton.disabled = false;
    submitButton.style.pointerEvents = "auto";
    submitButton.textContent = value ? "Signing in…" : "Sign in to Admin";
  }
}
function timeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => {
      const e = new Error(label + " timed out after " + Math.round(ms/1000) + " seconds.");
      e.code = "piso/timeout";
      reject(e);
    }, ms))
  ]);
}
function isAdminUser(user) {
  return !!user && String(user.email || "").trim().toLowerCase() === ADMIN_EMAIL;
}
async function route(user) {
  if (!isAdminUser(user) || redirecting) return;
  redirecting = true;
  window.location.replace("/admin/dashboard.html");
}
try {
  const saved = localStorage.getItem(KEY);
  if (saved && emailInput) {
    emailInput.value = saved;
    if (rememberAdmin) rememberAdmin.checked = true;
  }
} catch (_) {}

let authRestoreTimer=null;
onAuthStateChanged(auth, user => {
  if (user && !busy) {
    if(authRestoreTimer) clearTimeout(authRestoreTimer);
    route(user);
  }
});

form?.addEventListener("submit", async e => {
  e.preventDefault();
  e.stopPropagation();
  if (busy || redirecting) return;

  const email = String(emailInput?.value || "").trim().toLowerCase();
  const password = String(passwordInput?.value || "");
  if (!email || !password) {
    showMessage("Enter your email and password.", "error");
    return;
  }
  if (email !== ADMIN_EMAIL) {
    showMessage("This login is for the authorized Admin account only.", "error");
    return;
  }

  setBusy(true);
  showMessage("Signing in…");

  try {
    const cred = await timeout(
      signInWithEmailAndPassword(auth, email, password),
      15000,
      "Firebase Admin sign-in"
    );

    // Firebase Authentication accepted the credentials.
    // Do not perform the Firestore users/{uid} lookup here: that read is
    // currently timing out and is the cause of the previous stuck login.
    try {
      if (rememberAdmin?.checked) localStorage.setItem(KEY, email);
      else localStorage.removeItem(KEY);
    } catch (_) {}

    redirecting = true;
    showMessage("Admin verified. Opening dashboard…", "success");
    window.location.replace("/admin/dashboard.html");
  } catch (err) {
    console.error("[PISO WIFI ADMIN LOGIN]", err);
    setBusy(false);
    const code = String(err?.code || "");
    let text = "Login failed. Please check your Admin email and password.";
    if (code === "piso/timeout") text = err.message;
    else if (["auth/invalid-credential","auth/wrong-password","auth/user-not-found"].includes(code))
      text = "Incorrect Admin email or password.";
    else if (code === "auth/too-many-requests")
      text = "Too many attempts. Please wait a moment and try again.";
    else if (code === "auth/network-request-failed")
      text = "Firebase network connection failed. Please check the connection and try again.";
    else if (code === "auth/operation-not-allowed")
      text = "Firebase Email/Password sign-in is not enabled for this project.";
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
  const email = String(emailInput?.value || "").trim().toLowerCase();
  if (!email) {
    showMessage("Enter your Admin email first.", "error");
    return;
  }
  try {
    await timeout(sendPasswordResetEmail(auth, email), 10000, "Password reset request");
  } catch (_) {}
  showMessage("If an Admin account exists for that email, password reset instructions have been sent.", "success");
});
