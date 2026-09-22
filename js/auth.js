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

function showMessage(text) {
  if (msg) msg.textContent = text;
}

async function getUserRole(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    role: String(data.role || "").toLowerCase(),
    active: data.active !== false
  };
}

// ADMIN LOGIN IS ADMIN-ONLY.
// A client account must never be redirected to the customer portal from here.
async function handleAdminUser(user) {
  if (!user) return false;

  try {
    const account = await getUserRole(user);

    if (account?.role !== "admin" || account.active !== true) {
      await signOut(auth);
      showMessage(
        account?.role === "client"
          ? "This is a Customer Account. Please use the Customer Account login."
          : "This account is not authorized for the Admin Portal."
      );
      return false;
    }

    window.location.replace("/admin/dashboard.html");
    return true;
  } catch (error) {
    console.error("[PISO WIFI Admin Auth]", error);
    await signOut(auth).catch(() => {});
    showMessage("Unable to verify Admin access. Please try again.");
    return false;
  }
}

onAuthStateChanged(auth, user => {
  if (user) handleAdminUser(user);
});

form?.addEventListener("submit", async e => {
  e.preventDefault();
  showMessage("Signing in...");

  const email = document.querySelector("#email")?.value.trim().toLowerCase();
  const password = document.querySelector("#password")?.value || "";

  if (!email || !password) {
    showMessage("Enter your email and password.");
    return;
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await handleAdminUser(cred.user);
  } catch (err) {
    console.error("[PISO WIFI Admin Login]", err);
    showMessage("Login failed. Please check your email and password.");
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
  const email = document.querySelector("#email")?.value.trim().toLowerCase();
  if (!email) {
    showMessage("Enter your email first.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    showMessage("If an account exists for that email, password reset instructions have been sent.");
  } catch {
    showMessage("If an account exists for that email, password reset instructions have been sent.");
  }
});
