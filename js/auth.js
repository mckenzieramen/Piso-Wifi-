import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form = document.querySelector("#loginForm");
const msg = document.querySelector("#loginMessage");

async function routeSignedInUser(user){
  if(!user)return;
  try{
    const roleSnap=await getDoc(doc(db,"users",user.uid));
    if(roleSnap.exists() && roleSnap.data().role==="client"){
      window.location.href="/client"; return;
    }
    if(roleSnap.exists() && roleSnap.data().role==="admin"){
      window.location.href="/admin/dashboard.html"; return;
    }
    const linked=await getDocs(query(collection(db,"units"),where("email","==",(user.email||"").toLowerCase())));
    if(!linked.empty){window.location.href="/client";return;}
    window.location.href="/admin/dashboard.html";
  }catch(e){
    window.location.href="/admin/dashboard.html";
  }
}
onAuthStateChanged(auth, routeSignedInUser);

form.addEventListener("submit", async e => {
  e.preventDefault();
  msg.textContent = "Signing in...";
  try {
    const cred=await signInWithEmailAndPassword(
      auth,
      document.querySelector("#email").value.trim().toLowerCase(),
      document.querySelector("#password").value
    );
    await routeSignedInUser(cred.user);
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
    msg.textContent = "If an account exists for that email, password reset instructions have been sent.";
  } catch {
    msg.textContent = "If an account exists for that email, password reset instructions have been sent.";
  }
};
