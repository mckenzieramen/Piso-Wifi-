import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form = document.querySelector("#clientLoginForm");
const msg = document.querySelector("#clientLoginMessage");
const submit = document.querySelector("#clientLoginButton");
const CLIENT_REMEMBER_KEY = "pisoWifiRememberedClientId";
const INTERNAL_DOMAIN = "@client-login.pisowifi.local";

function message(text, type = "") {
  msg.textContent = text;
  msg.className = `client-login-message ${type}`.trim();
}
function normalizeClientId(value) { return String(value || "").trim().toUpperCase(); }
function internalTempPassword(unitCode) { return `PISO-${String(unitCode || "").padStart(3,"0")}-TEMP`; }
async function getRole(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() ? snap.data() : null;
}
async function getLoginDirectory(clientId) {
  const snap = await getDoc(doc(db, "clientLoginDirectory", clientId));
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
    await signOut(auth);
    message("This account is not a Customer Account.", "error");
  } catch (e) {
    console.error("[PISO WIFI CUSTOMER AUTH]", e);
    try { await signOut(auth); } catch {}
  }
}

const savedClientId = localStorage.getItem(CLIENT_REMEMBER_KEY);
if (savedClientId) {
  document.querySelector("#clientEmail").value = savedClientId;
  const remember = document.querySelector("#clientRemember");
  if (remember) remember.checked = true;
}

onAuthStateChanged(auth, user => { if (user) routeUser(user); });

form.addEventListener("submit", async e => {
  e.preventDefault();
  const clientId = normalizeClientId(document.querySelector("#clientEmail").value);
  const enteredPassword = document.querySelector("#clientPassword").value;
  const remember = document.querySelector("#clientRemember")?.checked === true;

  if (!/^C-\d{3,}$/.test(clientId) || !enteredPassword) {
    message("Enter your Client ID (for example C-001) and password.", "error");
    return;
  }

  if (remember) localStorage.setItem(CLIENT_REMEMBER_KEY, clientId);
  else localStorage.removeItem(CLIENT_REMEMBER_KEY);

  submit.disabled = true;
  submit.textContent = "Signing in…";
  message("Authenticating…");

  try {
    const directory = await getLoginDirectory(clientId);
    if (!directory?.authEmail || directory.active === false) {
      throw new Error("Invalid Client ID or inactive account.");
    }

    await setPersistence(auth, browserSessionPersistence);
    let cred;
    try {
      cred = await signInWithEmailAndPassword(auth, directory.authEmail, enteredPassword);
    } catch (firstError) {
      // On first login only, the customer types the Unit Code (001–050).
      // Firebase requires a longer password internally, so the website maps
      // that temporary value to the private internal credential.
      const unitCode = directory.unitCode || "";
      if (!unitCode || enteredPassword !== String(unitCode).padStart(3,"0")) throw firstError;
      cred = await signInWithEmailAndPassword(auth, directory.authEmail, internalTempPassword(unitCode));
    }

    const profile = await getRole(cred.user);
    if (profile?.role !== "client" || profile?.active === false) {
      await signOut(auth);
      throw new Error("This account is not a Customer Account.");
    }
    window.location.replace("/client");
  } catch (err) {
    console.error("[PISO WIFI CUSTOMER LOGIN]", err);
    message("Invalid Client ID or password. If this is your first login, use your Unit Code as the temporary password.", "error");
    submit.disabled = false;
    submit.textContent = "Login";
  }
});

document.querySelector("#clientTogglePassword").onclick = () => {
  const p = document.querySelector("#clientPassword");
  p.type = p.type === "password" ? "text" : "password";
  document.querySelector("#clientTogglePassword").textContent = p.type === "password" ? "Show" : "Hide";
};

document.querySelector("#clientForgotPassword").onclick = () => {
  message("Enter your Client ID and registered Gmail, then contact Admin to approve the password reset request.", "success");
};
