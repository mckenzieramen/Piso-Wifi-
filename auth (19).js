import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut,
  setPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form = document.querySelector("#loginForm");
const msg = document.querySelector("#loginMessage");
const REMEMBER_ADMIN_KEY = "pisoWifi.rememberedAdminEmail";
const rememberAdmin = document.querySelector("#rememberAdmin");
let routing = false;
let signingIn = false;

try {
  const savedAdminEmail = localStorage.getItem(REMEMBER_ADMIN_KEY);
  if (savedAdminEmail && document.querySelector("#email")) {
    document.querySelector("#email").value = savedAdminEmail;
    if (rememberAdmin) rememberAdmin.checked = true;
  }
} catch {}

function showMessage(text, type = "") {
  if (!msg) return;
  msg.textContent = text;
  msg.className = `login-message ${type}`.trim();
}

async function getRole(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() ? snap.data() : null;
}

async function routeSignedInUser(user) {
  if (!user || routing || signingIn) return;
  routing = true;

  try {
    const profile = await getRole(user);

    if (profile?.role === "admin" && profile?.active !== false) {
      const currentEmail = (document.querySelector("#email")?.value || user.email || "").trim().toLowerCase();
      try {
        if (rememberAdmin?.checked && currentEmail) {
          localStorage.setItem(REMEMBER_ADMIN_KEY, currentEmail);
        } else if (!rememberAdmin?.checked) {
          localStorage.removeItem(REMEMBER_ADMIN_KEY);
        }
      } catch {}

      window.location.replace("/admin/dashboard.html");
      return;
    }

    await signOut(auth);
    routing = false;
    showMessage(
      "This account is a Customer Account. Please use the Customer Account login.",
      "error"
    );
  } catch (e) {
    console.error("[PISO WIFI ADMIN AUTH] Authorization failed:", e);
    await signOut(auth).catch(() => {});
    routing = false;
    showMessage(
      "This account is not authorized for the Admin Portal.",
      "error"
    );
  }
}

onAuthStateChanged(auth, user => {
  if (user && !signingIn) routeSignedInUser(user);
});

form?.addEventListener("submit", async e => {
  e.preventDefault();
  if (signingIn) return;

  const email = document.querySelector("#email")?.value.trim().toLowerCase();
  const password = document.querySelector("#password")?.value || "";

  if (!email || !password) {
    showMessage("Enter your email and password.", "error");
    return;
  }

  signingIn = true;
  showMessage("Signing in…");

  try {
    await setPersistence(auth, browserSessionPersistence);
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const profile = await getRole(cred.user);

    if (profile?.role !== "admin" || profile?.active === false) {
      await signOut(auth);
      signingIn = false;
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
    signingIn = false;
    showMessage("Login failed. Please check your Admin email and password.", "error");
  }
});

document.querySelector("#togglePassword")?.addEventListener("click", () => {
  const p = document.querySelector("#password");
  if (!p) return;
  p.type = p.type === "password" ? "text" : "password";
  document.querySelector("#togglePassword").textContent =
    p.type === "password" ? "Show" : "Hide";
});

document.querySelector("#resetPassword")?.addEventListener("click", async () => {
  const email = document.querySelector("#email")?.value.trim();
  if (!email) {
    showMessage("Enter your Admin email first.", "error");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
  } catch (_) {}
  showMessage("If an Admin account exists for that email, password reset instructions have been sent.", "success");
});
