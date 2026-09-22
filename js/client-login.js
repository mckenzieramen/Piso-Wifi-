import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form=document.querySelector("#clientLoginForm");
const msg=document.querySelector("#clientLoginMessage");
const submit=document.querySelector("#clientLoginButton");

function message(text,type=""){ msg.textContent=text; msg.className=`client-login-message ${type}`; }
function normalizeUnitId(v){ return String(v||"").trim().toUpperCase(); }
function authEmailFromUnitId(unitId){ return `${unitId.toLowerCase().replace(/[^a-z0-9]+/g,"-")}@client-login.pisowifi.local`; }

async function isClientUser(user){
  const snap=await getDoc(doc(db,"users",user.uid));
  return snap.exists() && snap.data().role === "client" && snap.data().active !== false;
}

async function routeExistingSession(user){
  if(!user) return;
  try{
    if(await isClientUser(user)) location.replace("/client");
    else await signOut(auth);
  }catch(e){ console.error(e); try{await signOut(auth);}catch{} }
}
onAuthStateChanged(auth,routeExistingSession);

form.addEventListener("submit",async e=>{
  e.preventDefault();
  const unitId=normalizeUnitId(document.querySelector("#clientEmail").value);
  const password=document.querySelector("#clientPassword").value;
  if(!unitId||!password){ message("Enter your Unit ID and password.","error"); return; }
  submit.disabled=true; submit.textContent="Signing in…"; message("Authenticating…");
  try{
    const cred=await signInWithEmailAndPassword(auth,authEmailFromUnitId(unitId),password);
    const profileSnap=await getDoc(doc(db,"users",cred.user.uid));
    const profile=profileSnap.exists()?profileSnap.data():null;
    if(!profile || profile.role !== "client" || profile.active === false){
      await signOut(auth);
      message("This account is not a Customer Account. Please use the correct portal.","error");
      submit.disabled=false; submit.textContent="Login"; return;
    }
    message("Login successful. Opening your Customer Account…","success");
    location.replace("/client");
  }catch(err){
    console.error(err);
    message("Invalid Unit ID or password. Use the temporary password provided by Admin on your first login.","error");
    submit.disabled=false; submit.textContent="Login";
  }
});

document.querySelector("#clientTogglePassword").onclick=()=>{
  const p=document.querySelector("#clientPassword"); p.type=p.type==="password"?"text":"password";
  document.querySelector("#clientTogglePassword").textContent=p.type==="password"?"Show":"Hide";
};
document.querySelector("#clientForgotPassword").onclick=()=>{
  message("For security, contact Admin for a password reset.","success");
};
