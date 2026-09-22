import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserSessionPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form = document.querySelector("#clientLoginForm");
const msg = document.querySelector("#clientLoginMessage");
const submit = document.querySelector("#clientLoginButton");
const UNIT_AUTH_DOMAIN = "@client-login.pisowifi.local";
const REMEMBER_KEY = "pisoCustomerRememberUnitId";
const SESSION_KEY = "pisoCustomerSessionId";

function newSessionId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
function sessionPersistence(remember) {
  return remember ? browserLocalPersistence : browserSessionPersistence;
}
function authEmailFromUnitId(unitId) {
  return `${unitId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}${UNIT_AUTH_DOMAIN}`;
}
function rememberedUnitId() {
  try { return localStorage.getItem(REMEMBER_KEY) || ""; } catch { return ""; }
}
function saveRememberedUnitId(unitId, remember) {
  try {
    if (remember) localStorage.setItem(REMEMBER_KEY, unitId);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {}
}

const unitInput = document.querySelector("#clientEmail");
const passwordInput = document.querySelector("#clientPassword");
if (unitInput) unitInput.value = rememberedUnitId();
if (passwordInput) passwordInput.value = "";

function message(text, type = "") {
  msg.textContent = text;
  msg.className = `client-login-message ${type}`.trim();
}

function normalizeUnitId(value) {
  return String(value || "").trim();
}


async function getRole(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() ? snap.data() : null;
}

async function routeUser(user) {
  if (!user) return;

  try {
    const profile = await getRole(user);

    if (profile?.role === "client" && profile?.active !== false) {
      window.location.replace("/client");
      return;
    }

    // Admin accounts must never be routed into the Customer portal.
    await signOut(auth);
    message(
      "This is an Admin Account. Please use the Admin Portal.",
      "error"
    );
  } catch (e) {
    console.error("[PISO WIFI CUSTOMER AUTH]", e);
    try { await signOut(auth); } catch {}
    message(
      "This account is not authorized for the Customer Account.",
      "error"
    );
  }
}

onAuthStateChanged(auth, user => {
  if (user) routeUser(user);
});

form.addEventListener("submit", async e => {
  e.preventDefault();

  const unitId = normalizeUnitId(document.querySelector("#clientEmail").value);
  const password = document.querySelector("#clientPassword").value;

  if (!unitId || !password) {
    message("Enter your Unit ID and password.", "error");
    return;
  }

  submit.disabled = true;
  submit.textContent = "Signing in…";
  message("Authenticating…");

  try {
    const remember = !!document.querySelector("#clientRememberMe")?.checked;
    await setPersistence(auth, sessionPersistence(remember));
    saveRememberedUnitId(unitId, remember);

    const cred = await signInWithEmailAndPassword(
      auth,
      authEmailFromUnitId(unitId),
      password
    );

    const profile = await getRole(cred.user);

    if (profile?.role !== "client" || profile?.active === false) {
      await signOut(auth);
      message(
        "Access denied. This account is not a Customer Account.",
        "error"
      );
      submit.disabled = false;
      submit.textContent = "Login";
      return;
    }

    const sessionId = newSessionId();
    try { sessionStorage.setItem(SESSION_KEY, sessionId); } catch {}
    await updateDoc(doc(db, "users", cred.user.uid), { sessionId, sessionUpdatedAt: serverTimestamp() });

    window.location.replace("/client");
  } catch (err) {
    console.error("[PISO WIFI CUSTOMER LOGIN]", err);
    message(
      "Invalid Unit ID or password. If this is your first login, use the temporary password provided by Admin.",
      "error"
    );
    submit.disabled = false;
    submit.textContent = "Login";
  }
});

document.querySelector("#clientTogglePassword").onclick = () => {
  const p = document.querySelector("#clientPassword");
  p.type = p.type === "password" ? "text" : "password";
  document.querySelector("#clientTogglePassword").textContent =
    p.type === "password" ? "Show" : "Hide";
};

document.querySelector("#clientForgotPassword").onclick = () => {
  message(
    "For security, password recovery is handled by Admin. Please contact Admin to reset your access.",
    "success"
  );
};
