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
const button = form?.querySelector('button[type="submit"]');

function message(text, type = "") {
  msg.textContent = text;
  msg.className = `login-message ${type}`;
}

async function getRole(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) return null;
  return snap.data();
}

async function authorizeAdmin(user) {
  if (!user) return { ok: false, reason: "No authenticated user." };

  const data = await getRole(user);

  if (!data || data.role !== "admin") {
    return { ok: false, reason: "This account is not an Admin account." };
  }

  // Existing projects may not have an active field yet.
  // Only an explicit active:false disables an admin.
  if (data.active === false) {
    return { ok: false, reason: "This Admin account is inactive." };
  }

  return { ok: true, data };
}

let routing = false;

async function handleExistingSession(user) {
  if (!user || routing) return;

  try {
    const result = await authorizeAdmin(user);
    if (result.ok) {
      routing = true;
      window.location.replace("/admin/dashboard.html");
      return;
    }

    await signOut(auth);
    message(result.reason, "error");
  } catch (error) {
    console.error("Admin authorization failed:", error);
    // Do NOT redirect to the Customer website on an Admin authorization error.
    await signOut(auth).catch(() => {});
    message("Admin authorization failed. Check the Admin users/{UID} record in Firestore and make sure role is 'admin'.", "error");
  }
}

onAuthStateChanged(auth, handleExistingSession);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (routing) return;

  const email = document.querySelector("#email").value.trim().toLowerCase();
  const password = document.querySelector("#password").value;

  if (!email || !password) {
    message("Enter your email and password.", "error");
    return;
  }

  button.disabled = true;
  button.textContent = "Signing in...";
  message("Signing in...", "");

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const result = await authorizeAdmin(cred.user);

    if (!result.ok) {
      await signOut(auth);
      message(result.reason + " Please use the correct portal for this account.", "error");
      button.disabled = false;
      button.textContent = "Log In";
      return;
    }

    routing = true;
    message("Admin verified. Opening dashboard...", "success");
    window.location.replace("/admin/dashboard.html");
  } catch (error) {
    console.error("Admin login failed:", error);
    message("Login failed. Check your Admin email and password.", "error");
    button.disabled = false;
    button.textContent = "Log In";
  }
});

document.querySelector("#togglePassword").onclick = () => {
  const p = document.querySelector("#password");
  p.type = p.type === "password" ? "text" : "password";
  document.querySelector("#togglePassword").textContent = p.type === "password" ? "Show" : "Hide";
};

document.querySelector("#resetPassword").onclick = async () => {
  const email = document.querySelector("#email").value.trim();
  if (!email) {
    message("Enter your email first.", "error");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    message("If an account exists for that email, password reset instructions have been sent.", "success");
  } catch {
    message("If an account exists for that email, password reset instructions have been sent.", "success");
  }
};
