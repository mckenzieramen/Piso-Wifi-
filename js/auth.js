import { auth } from "./firebase.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const form = document.querySelector("#loginForm");
const msg = document.querySelector("#loginMessage");

onAuthStateChanged(auth, user => {
  if (user) window.location.href = "dashboard.html";
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
    window.location.href = "dashboard.html";
  } catch (err) {
    msg.textContent = "Login failed. Please check your email and password.";
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