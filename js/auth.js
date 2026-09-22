import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form = document.querySelector("#loginForm");
const msg = document.querySelector("#loginMessage");

async function checkAdmin(user) {
  if (!user) return false;
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() && snap.data().role === "admin" && snap.data().active !== false;
}

async function routeSignedInAdmin(user) {
  if (!user) return;
  try {
    const isAdmin = await checkAdmin(user);
    if (isAdmin) {
      window.location.replace("/admin/dashboard.html");
      return;
    }
    await signOut(auth);
    msg.textContent = "This account is not authorized for the Admin Portal.";
  } catch (error) {
    console.error("Admin authorization check failed:", error);
    try { await signOut(auth); } catch {}
    msg.textContent = "Unable to verify Admin access. Please try again.";
  }
}

onAuthStateChanged(auth, routeSignedInAdmin);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "Signing in...";
  try {
    const cred = await signInWithEmailAndPassword(
      auth,
      document.querySelector("#email").value.trim().toLowerCase(),
      document.querySelector("#password").value
    );
    const isAdmin = await checkAdmin(cred.user);
    if (!isAdmin) {
      await signOut(auth);
      msg.textContent = "This is a Customer Account. Please use the Customer Account login.";
      return;
    }
    window.location.replace("/admin/dashboard.html");
  } catch (err) {
    console.error(err);
    msg.textContent = "Login failed. Please check your email, password, and Admin access.";
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
    msg.textContent = "If an account exists for that email, password reset instructions have been sent.";
  } catch {
    msg.textContent = "If an account exists for that email, password reset instructions have been sent.";
  }
};
