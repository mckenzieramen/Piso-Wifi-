import { auth } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const form = document.querySelector("#loginForm");
const msg = document.querySelector("#loginMessage");

onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("Firebase user detected:", user.uid);
    window.location.href = "dashboard.html";
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;

  msg.textContent = "Signing in...";

  try {
    const result = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

    console.log("LOGIN SUCCESS");
    console.log("UID:", result.user.uid);
    console.log("Email:", result.user.email);

    msg.textContent = "Login successful. Opening dashboard...";

    window.location.href = "dashboard.html";

  } catch (err) {
    console.error("FIREBASE LOGIN ERROR:", err);

    const errors = {
      "auth/invalid-credential":
        "Incorrect email or password.",

      "auth/user-not-found":
        "No Firebase account was found for this email.",

      "auth/wrong-password":
        "Incorrect password.",

      "auth/invalid-email":
        "The email address is invalid.",

      "auth/operation-not-allowed":
        "Email/Password login is not enabled in Firebase Authentication.",

      "auth/unauthorized-domain":
        "This website domain is not authorized in Firebase Authentication.",

      "auth/network-request-failed":
        "Network error. Please check your internet connection.",

      "auth/too-many-requests":
        "Too many login attempts. Please wait and try again."
    };

    msg.textContent =
      errors[err.code] ||
      `${err.code}: ${err.message}`;
  }
});

const resetBtn = document.querySelector("#resetPassword");

if (resetBtn) {
  resetBtn.addEventListener("click", async () => {
    const email = document.querySelector("#email").value.trim();

    if (!email) {
      msg.textContent = "Enter your email first.";
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      msg.textContent = "Password reset email sent.";
    } catch (err) {
      console.error("PASSWORD RESET ERROR:", err);
      msg.textContent = `${err.code}: ${err.message}`;
    }
  });
}
