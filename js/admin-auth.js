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
let routing = false;

function show(text, type="") {
  if (!msg) return;
  msg.textContent = text;
  msg.className = `login-message ${type}`;
}

async function getRole(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) return null;
  return snap.data();
}

async function adminOnly(user) {
  if (!user || routing) return;
  routing = true;
  try {
    const profile = await getRole(user);
    if (!profile || profile.role !== "admin" || profile.active === false) {
      await signOut(auth);
      routing = false;
      show("Access denied. This login is for Admin accounts only.", "error");
      return;
    }
    window.location.replace("/admin/dashboard.html");
  } catch (err) {
    console.error("Admin authorization failed:", err);
    await signOut(auth).catch(() => {});
    routing = false;
    show("Unable to verify Admin access. Please try again.", "error");
  }
}

onAuthStateChanged(auth, user => {
  if (user) adminOnly(user);
});

form?.addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.querySelector("#email")?.value.trim().toLowerCase();
  const password = document.querySelector("#password")?.value || "";
  if (!email || !password) {
    show("Enter your email and password.", "error");
    return;
  }
  show("Signing in…");
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const profile = await getRole(cred.user);
    if (!profile || profile.role !== "admin" || profile.active === false) {
      await signOut(auth);
      show("Access denied. This login is for Admin accounts only.", "error");
      return;
    }
    window.location.replace("/admin/dashboard.html");
  } catch (err) {
    console.error(err);
    show("Login failed. Please check your email and password.", "error");
  }
});

document.querySelector("#togglePassword")?.addEventListener("click", () => {
  const p = document.querySelector("#password");
  p.type = p.type === "password" ? "text" : "password";
  document.querySelector("#togglePassword").textContent = p.type === "password" ? "Show" : "Hide";
});

document.querySelector("#resetPassword")?.addEventListener("click", async () => {
  const email = document.querySelector("#email")?.value.trim();
  if (!email) { show("Enter your email first.", "error"); return; }
  try { await sendPasswordResetEmail(auth, email); } catch (_) {}
  show("If an Admin account exists for that email, password reset instructions have been sent.");
});
