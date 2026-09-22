import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form=document.querySelector("#clientLoginForm");
const msg=document.querySelector("#clientLoginMessage");
const submit=document.querySelector("#clientLoginButton");

function message(text,type=""){ msg.textContent=text; msg.className=`client-login-message ${type}`; }
function normalizeUnitId(v){ return String(v||"").trim().toUpperCase(); }
function authEmailFromUnitId(unitId){ return `${unitId.toLowerCase().replace(/[^a-z0-9]+/g,"-")}@client-login.pisowifi.local`; }

async function checkClient(user){
  if(!user) return false;
  const snap=await getDoc(doc(db,"users",user.uid));
  return snap.exists() && snap.data().role === "client" && snap.data().active !== false;
}

async function routeSignedInClient(user){
  if(!user) return;
  try{
    const isClient=await checkClient(user);
    if(isClient){ location.replace("/client"); return; }
    await signOut(auth);
    message("This account is not authorized for the Customer Account.","error");
  }catch(e){
    console.error(e);
    try{ await signOut(auth); }catch{}
    message("Unable to verify Customer Account access. Please try again.","error");
  }
}

onAuthStateChanged(auth,user=>{ if(user) routeSignedInClient(user); });

form.addEventListener("submit",async e=>{
  e.preventDefault();
  const unitId=normalizeUnitId(document.querySelector("#clientEmail").value);
  const password=document.querySelector("#clientPassword").value;
  if(!unitId||!password){ message("Enter your Unit ID and password.","error"); return; }
  submit.disabled=true; submit.textContent="Signing in…"; message("Authenticating…");
  try{
    const cred=await signInWithEmailAndPassword(auth,authEmailFromUnitId(unitId),password);
    const isClient=await checkClient(cred.user);
    if(!isClient){
      await signOut(auth);
      message("This is an Admin account. Please use the Admin Portal login.","error");
      submit.disabled=false; submit.textContent="Login"; return;
    }
    location.replace("/client");
  }catch(err){
    console.error(err);
    message("Invalid Unit ID or password. If this is your first login, use the temporary password provided by Admin.","error");
    submit.disabled=false; submit.textContent="Login";
  }
});

document.querySelector("#clientTogglePassword").onclick=()=>{
  const p=document.querySelector("#clientPassword"); p.type=p.type==="password"?"text":"password";
  document.querySelector("#clientTogglePassword").textContent=p.type==="password"?"Show":"Hide";
};

document.querySelector("#clientForgotPassword").onclick=()=>{
  message("For security, password recovery is handled by Admin. Please contact Admin to reset your access.","success");
};
