import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form = document.querySelector("#clientLoginForm");
const msg = document.querySelector("#clientLoginMessage");
const submit = document.querySelector("#clientLoginButton");
const UNIT_AUTH_DOMAIN = "@client-login.pisowifi.local";

function message(text, type = "") {
  if (!msg) return;
  msg.textContent = text;
  msg.className = `client-login-message ${type}`;
}

function normalizeUnitId(value) {
  return String(value || "").trim().toUpperCase();
}

function authEmailFromUnitId(unitId) {
  return `${unitId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}${UNIT_AUTH_DOMAIN}`;
}

async function getAccount(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    role: String(data.role || "").toLowerCase(),
    active: data.active !== false
  };
}

// CUSTOMER LOGIN IS CUSTOMER-ONLY.
// An admin account must never be redirected into the admin dashboard from here.
async function handleCustomerUser(user) {
  if (!user) return false;

  try {
    const account = await getAccount(user);

    if (account?.role !== "client" || account.active !== true) {
      await signOut(auth);
      message(
        account?.role === "admin"
          ? "This is an Admin Account. Please use the Admin Portal."
          : "This account is not authorized for the Customer Account."
      , "error");
      return false;
    }

    location.replace("/client");
    return true;
  } catch (error) {
    console.error("[PISO WIFI Customer Auth]", error);
    await signOut(auth).catch(() => {});
    message("Unable to verify Customer Account access. Please try again.", "error");
    return false;
  }
}

onAuthStateChanged(auth, user => {
  if (user) handleCustomerUser(user);
});

form?.addEventListener("submit", async e => {
  e.preventDefault();

  const unitId = normalizeUnitId(document.querySelector("#clientEmail")?.value);
  const password = document.querySelector("#clientPassword")?.value || "";

  if (!unitId || !password) {
    message("Enter your Unit ID and password.", "error");
    return;
  }

  submit.disabled = true;
  submit.textContent = "Signing in…";
  message("Authenticating…");

  try {
    const cred = await signInWithEmailAndPassword(
      auth,
      authEmailFromUnitId(unitId),
      password
    );

    await handleCustomerUser(cred.user);
  } catch (err) {
    console.error("[PISO WIFI Customer Login]", err);
    message(
      "Invalid Unit ID or password. If this is your first login, use the temporary password provided by Admin.",
      "error"
    );
    submit.disabled = false;
    submit.textContent = "Login";
  }
});

document.querySelector("#clientTogglePassword")?.addEventListener("click", () => {
  const p = document.querySelector("#clientPassword");
  if (!p) return;
  p.type = p.type === "password" ? "text" : "password";
  document.querySelector("#clientTogglePassword").textContent =
    p.type === "password" ? "Show" : "Hide";
});

document.querySelector("#clientForgotPassword")?.addEventListener("click", () => {
  message(
    "For security, password recovery is handled by Admin. Please contact Admin to reset your access.",
    "success"
  );
});
