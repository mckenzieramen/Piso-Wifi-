import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

/*
 * PISO WIFI — ADMIN LOGIN AUTHENTICATION
 *
 * IMPORTANT:
 * This file is used ONLY by /admin/index.html.
 * The official customer login is / (root) and is handled by client-login.js.
 *
 * Admin login must NEVER redirect to the customer portal.
 * An authenticated Firebase user is not automatically an admin; the
 * Firestore users/{uid} document must explicitly have role === "admin"
 * and active === true.
 */

const form = document.querySelector("#loginForm");
const msg = document.querySelector("#loginMessage");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const loginButton = form?.querySelector('button[type="submit"]');

let routing = false;

function setMessage(text, type = "") {
  if (!msg) return;
  msg.textContent = text;
  msg.className = `login-message ${type}`.trim();
}

function setLoading(loading) {
  if (!loginButton) return;
  loginButton.disabled = loading;
  loginButton.textContent = loading ? "Signing in…" : "Log In";
}

/**
 * Verify that the currently authenticated Firebase user is an ACTIVE ADMIN.
 * No client-account fallback is allowed here.
 */
async function getAdminAuthorization(user) {
  if (!user) return { ok: false, reason: "NO_USER" };

  const roleSnap = await getDoc(doc(db, "users", user.uid));

  if (!roleSnap.exists()) {
    return { ok: false, reason: "NO_PROFILE" };
  }

  const data = roleSnap.data() || {};
  const role = String(data.role || "").toLowerCase();
  const active = data.active !== false;

  if (role !== "admin") {
    return { ok: false, reason: "NOT_ADMIN" };
  }

  if (!active) {
    return { ok: false, reason: "INACTIVE" };
  }

  return { ok: true, data };
}

/**
 * Route a signed-in user from the ADMIN login page.
 *
 * ADMIN  -> /admin/dashboard.html
 * CLIENT -> signed out + remains on /admin
 * UNKNOWN/ERROR -> signed out + remains on /admin
 */
async function routeSignedInUser(user) {
  if (!user || routing) return;

  routing = true;
  setLoading(true);
  setMessage("Checking administrator access…");

  try {
    const result = await getAdminAuthorization(user);

    if (result.ok) {
      // This is the ONLY successful admin destination.
      window.location.replace("/admin/dashboard.html");
      return;
    }

    // Never send a customer/unknown account to "/" from the Admin login.
    await signOut(auth);

    if (result.reason === "NOT_ADMIN") {
      setMessage("This is a Customer Account. Please use the Customer Account login.", "error");
    } else if (result.reason === "INACTIVE") {
      setMessage("This administrator account is inactive. Please contact the account owner.", "error");
    } else if (result.reason === "NO_PROFILE") {
      setMessage("This account is not authorized as an administrator.", "error");
    } else {
      setMessage("This account is not authorized as an administrator.", "error");
    }
  } catch (error) {
    console.error("[PISO WIFI ADMIN AUTH]", error);

    // Security-first behavior: do not guess a role and do not redirect.
    try {
      await signOut(auth);
    } catch (_) {}

    setMessage(
      "Unable to verify administrator access. Please check your connection and try again.",
      "error"
    );
  } finally {
    routing = false;
    setLoading(false);
  }
}

/*
 * If an old Firebase session exists while the user opens /admin,
 * verify it as ADMIN before allowing any redirect.
 */
onAuthStateChanged(auth, (user) => {
  if (user) {
    routeSignedInUser(user);
  }
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (routing) return;

  const email = emailInput?.value.trim().toLowerCase() || "";
  const password = passwordInput?.value || "";

  if (!email || !password) {
    setMessage("Enter your email address and password.", "error");
    return;
  }

  setLoading(true);
  setMessage("Signing in…");

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    await routeSignedInUser(credential.user);
  } catch (error) {
    console.error("[PISO WIFI ADMIN LOGIN]", error);

    const code = error?.code || "";

    if (code === "auth/invalid-credential" || code === "auth/invalid-login-credentials") {
      setMessage("Login failed. Please check your email and password.", "error");
    } else if (code === "auth/too-many-requests") {
      setMessage("Too many login attempts. Please wait and try again later.", "error");
    } else {
      setMessage("Login failed. Please check your email and password.", "error");
    }

    setLoading(false);
  }
});

const togglePassword = document.querySelector("#togglePassword");
if (togglePassword) {
  togglePassword.onclick = () => {
    if (!passwordInput) return;
    passwordInput.type = passwordInput.type === "password" ? "text" : "password";
    togglePassword.textContent = passwordInput.type === "password" ? "Show" : "Hide";
    togglePassword.setAttribute(
      "aria-label",
      passwordInput.type === "password" ? "Show password" : "Hide password"
    );
  };
}

document.querySelector("#resetPassword")?.addEventListener("click", async () => {
  const email = emailInput?.value.trim() || "";

  if (!email) {
    setMessage("Enter your email first.", "error");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    setMessage("If an account exists for that email, password reset instructions have been sent.");
  } catch (error) {
    // Do not reveal whether an email exists in Firebase Auth.
    console.warn("[PISO WIFI PASSWORD RESET]", error);
    setMessage("If an account exists for that email, password reset instructions have been sent.");
  }
});
