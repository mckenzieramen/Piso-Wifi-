import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form=document.querySelector("#loginForm"), msg=document.querySelector("#loginMessage");
const emailInput=document.querySelector("#email"), passwordInput=document.querySelector("#password");
const submitButton=form?.querySelector('button[type="submit"]');
const togglePassword=document.querySelector("#togglePassword"), resetPassword=document.querySelector("#resetPassword");
const rememberAdmin=document.querySelector("#rememberAdmin"), KEY="pisoWifi.rememberedAdminEmail";
let redirecting=false, signingIn=false;

function showMessage(t,type=""){if(msg){msg.textContent=t;msg.className=`login-message ${type}`.trim();}}
function setBusy(b){signingIn=b;if(submitButton){submitButton.disabled=false;submitButton.style.pointerEvents="auto";submitButton.textContent=b?"Signing in…":"Sign in to Admin";}}
function timeout(p,ms,label){return Promise.race([p,new Promise((_,rej)=>setTimeout(()=>{const e=new Error(label+" timed out after "+Math.round(ms/1000)+" seconds.");e.code="piso/timeout";rej(e)},ms))]);}
async function getRole(user){const s=await timeout(getDoc(doc(db,"users",user.uid)),10000,"Admin profile lookup");return s.exists()?s.data():null;}

try{const saved=localStorage.getItem(KEY);if(saved&&emailInput){emailInput.value=saved;if(rememberAdmin)rememberAdmin.checked=true;}}catch(_){}

onAuthStateChanged(auth,user=>{if(user&&!signingIn&&!redirecting)route(user);});

async function route(user){
 redirecting=true;
 try{
  const p=await getRole(user);
  if(p?.role==="admin"&&p?.active!==false){window.location.replace("/admin/dashboard.html");return;}
  await signOut(auth).catch(()=>{}); redirecting=false;
  showMessage("This account is not authorized for the Admin Portal.","error");
 }catch(e){
  await signOut(auth).catch(()=>{}); redirecting=false;
  showMessage(e.code==="piso/timeout"?e.message:"Unable to verify Admin access. Please try again.","error");
 }
}

form?.addEventListener("submit",async e=>{
 e.preventDefault();e.stopPropagation();if(signingIn||redirecting)return;
 const email=String(emailInput?.value||"").trim().toLowerCase(), password=String(passwordInput?.value||"");
 if(!email||!password){showMessage("Enter your email and password.","error");return;}
 setBusy(true);showMessage("Signing in…");
 try{
  const cred=await timeout(signInWithEmailAndPassword(auth,email,password),15000,"Firebase Admin sign-in");
  const profile=await getRole(cred.user);
  if(!profile||profile.role!=="admin"||profile.active===false){
   await signOut(auth).catch(()=>{});setBusy(false);
   showMessage("Access denied. This account is not an active Admin account.","error");return;
  }
  try{if(rememberAdmin?.checked)localStorage.setItem(KEY,email);else localStorage.removeItem(KEY);}catch(_){}
  redirecting=true;showMessage("Admin verified. Opening dashboard…","success");
  window.location.replace("/admin/dashboard.html");
 }catch(err){
  console.error("[PISO WIFI ADMIN LOGIN]",err);setBusy(false);
  const c=String(err?.code||"");let t="Login failed. Please check your Admin email and password.";
  if(c==="piso/timeout")t=err.message;
  else if(["auth/invalid-credential","auth/wrong-password","auth/user-not-found"].includes(c))t="Incorrect Admin email or password.";
  else if(c==="auth/too-many-requests")t="Too many attempts. Please wait a moment and try again.";
  else if(c==="auth/network-request-failed")t="Firebase network connection failed. Please check the connection and try again.";
  else if(c==="auth/operation-not-allowed")t="Firebase Email/Password sign-in is not enabled for this project.";
  else if(c==="auth/invalid-api-key")t="Firebase configuration error: invalid API key.";
  showMessage(t,"error");
 }
});

togglePassword?.addEventListener("click",e=>{e.preventDefault();const p=passwordInput;if(!p)return;p.type=p.type==="password"?"text":"password";togglePassword.textContent=p.type==="password"?"Show":"Hide";});
resetPassword?.addEventListener("click",async e=>{e.preventDefault();const email=String(emailInput?.value||"").trim();if(!email){showMessage("Enter your Admin email first.","error");return;}try{await timeout(sendPasswordResetEmail(auth,email),10000,"Password reset request");}catch(_){}showMessage("If an Admin account exists for that email, password reset instructions have been sent.","success");});
