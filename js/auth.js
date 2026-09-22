import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form = document.querySelector("#loginForm");
const msg = document.querySelector("#loginMessage");
let routing = false;

function show(text, type="") {
  msg.textContent = text;
  msg.className = `login-message ${type}`;
}

async function getRole(user){
  const snap = await getDoc(doc(db,"users",user.uid));
  return snap.exists() ? snap.data() : null;
}

async function routeExistingSession(user){
  if(!user || routing) return;
  try{
    const profile = await getRole(user);
    if(profile?.role === "admin" && profile?.active !== false){
      routing = true;
      window.location.replace("/admin/dashboard.html");
      return;
    }
    // Never move a customer session into the Customer portal from Admin login.
    // Clear it so the two portal entry points remain strictly separated.
    await signOut(auth);
  }catch(e){
    console.error("Admin session check failed",e);
    try{ await signOut(auth); }catch{}
  }
}

onAuthStateChanged(auth, routeExistingSession);

form.addEventListener("submit", async e => {
  e.preventDefault();
  if(routing) return;
  show("Signing in...");
  const email = document.querySelector("#email").value.trim().toLowerCase();
  const password = document.querySelector("#password").value;
  if(!email || !password){ show("Enter your email and password.","error"); return; }
  try{
    const cred = await signInWithEmailAndPassword(auth,email,password);
    const profile = await getRole(cred.user);
    if(!profile){
      await signOut(auth);
      show("This account is not registered for the Admin Portal.","error");
      return;
    }
    if(profile.role !== "admin"){
      await signOut(auth);
      show("This is a Customer Account. Customer accounts cannot access the Admin Portal.","error");
      return;
    }
    if(profile.active === false){
      await signOut(auth);
      show("This Admin account is inactive. Please contact the system owner.","error");
      return;
    }
    routing = true;
    show("Login successful. Opening Admin Dashboard...","success");
    window.location.replace("/admin/dashboard.html");
  }catch(err){
    console.error(err);
    show("Login failed. Please check your Admin email and password.","error");
  }
});

document.querySelector("#togglePassword").onclick = () => {
  const p = document.querySelector("#password");
  p.type = p.type === "password" ? "text" : "password";
  document.querySelector("#togglePassword").textContent = p.type === "password" ? "Show" : "Hide";
};

document.querySelector("#resetPassword").onclick = async () => {
  const email = document.querySelector("#email").value.trim();
  if(!email){ show("Enter your Admin email first.","error"); return; }
  try{
    await sendPasswordResetEmail(auth,email);
    show("If this Admin email exists, password reset instructions have been sent.","success");
  }catch{
    show("If this Admin email exists, password reset instructions have been sent.","success");
  }
};
