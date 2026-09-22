import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form=document.querySelector("#clientLoginForm");
const msg=document.querySelector("#clientLoginMessage");
const submit=document.querySelector("#clientLoginButton");
const UNIT_AUTH_DOMAIN="@client-login.pisowifi.local";
function message(text,type=""){ msg.textContent=text; msg.className=`client-login-message ${type}`; }
function normalizeUnitId(v){ return String(v||"").trim().toUpperCase(); }
function authEmailFromUnitId(unitId){ return `${unitId.toLowerCase().replace(/[^a-z0-9]+/g,"-")}${UNIT_AUTH_DOMAIN}`; }
async function roleOf(user){ const snap=await getDoc(doc(db,"users",user.uid)); return snap.exists()?snap.data():null; }
let routing=false;
async function handleExistingSession(user){
  if(!user||routing)return;
  try{
    const data=await roleOf(user);
    if(data?.role==="client" && data?.active!==false){ routing=true; location.replace("/client"); return; }
    await signOut(auth);
  }catch(e){ console.error("Customer authorization failed:",e); await signOut(auth).catch(()=>{}); }
}
onAuthStateChanged(auth,handleExistingSession);
form.addEventListener("submit",async e=>{
  e.preventDefault();
  const unitId=normalizeUnitId(document.querySelector("#clientEmail").value);
  const password=document.querySelector("#clientPassword").value;
  if(!unitId||!password){ message("Enter your Unit ID and password.","error"); return; }
  submit.disabled=true; submit.textContent="Signing in…"; message("Authenticating…");
  try{
    const cred=await signInWithEmailAndPassword(auth,authEmailFromUnitId(unitId),password);
    const data=await roleOf(cred.user);
    if(!data || data.role!=="client" || data.active===false){
      await signOut(auth); message("This account is not a Customer Account. Please use the correct login.","error");
      submit.disabled=false; submit.textContent="Login"; return;
    }
    routing=true; location.replace("/client");
  }catch(err){ console.error(err); message("Invalid Unit ID or password. If this is your first login, use the temporary password provided by Admin.","error"); submit.disabled=false; submit.textContent="Login"; }
});
document.querySelector("#clientTogglePassword").onclick=()=>{ const p=document.querySelector("#clientPassword"); p.type=p.type==="password"?"text":"password"; document.querySelector("#clientTogglePassword").textContent=p.type==="password"?"Show":"Hide"; };
document.querySelector("#clientForgotPassword").onclick=()=>{ message("For security, password recovery is handled by Admin. Please contact Admin to reset your access.","success"); };
