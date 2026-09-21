import { auth } from "./firebase.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const form = document.querySelector("#loginForm");
const msg = document.querySelector("#loginMessage");

onAuthStateChanged(auth, user => {
  if (user) window.location.href = "dashboard";
});

form.addEventListener("submit", async e => {
  e.preventDefault();
  msg.textContent = "Signing in...";
  try {
    await signInWithEmailAndPassword(
      auth,
      document.querySelector("#email").value.trim(),
      document.querySelector("#password").value
    );
    window.location.href = "dashboard";
  } catch (err) {
    
    const code = err?.code || "";
    const messages = {
      "auth/invalid-credential": "Incorrect email or password.",
      "auth/invalid-login-credentials": "Incorrect email or password.",
      "auth/user-not-found": "No account was found for this email.",
      "auth/wrong-password": "Incorrect email or password.",
      "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
      "auth/network-request-failed": "Network error. Check your internet connection and try again."
    };
    msg.textContent = messages[code] || "Login failed. Please check your email and password.";
  }
});

document.querySelector("#togglePassword").onclick = () => {
  const p = document.querySelector("#password");
  p.type = p.type === "password" ? "text" : "password";
  document.querySelector("#togglePassword").textContent = p.type === "password" ? "Show" : "Hide";
};

document.querySelector("#resetPassword").onclick = async () => {
  const email = document.querySelector("#email").value.trim();
  if (!email) { msg.textContent = "Enter your email first."; return; }
  try {
    await sendPasswordResetEmail(auth, email);
    msg.textContent = "Password reset email sent.";
  } catch {
    msg.textContent = "Could not send the reset email.";
  }
};