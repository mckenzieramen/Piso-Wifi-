import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form=document.querySelector("#clientLoginForm");
const msg=document.querySelector("#clientLoginMessage");
const submit=document.querySelector("#clientLoginButton");

function message(text,type=""){
  msg.textContent=text;msg.className=`client-login-message ${type}`;
}
async function routeUser(user){
  if(!user)return;
  try{
    const snap=await getDoc(doc(db,"users",user.uid));
    if(snap.exists() && snap.data().role==="admin"){location.replace("dashboard.html");return;}
    location.replace("client.html");
  }catch(e){
    location.replace("client.html");
  }
}
onAuthStateChanged(auth,user=>{if(user)routeUser(user);});
form.addEventListener("submit",async e=>{
  e.preventDefault();
  const email=document.querySelector("#clientEmail").value.trim().toLowerCase();
  const password=document.querySelector("#clientPassword").value;
  if(!email||!password){message("Enter your email and password.","error");return;}
  submit.disabled=true;submit.textContent="Signing in…";message("Authenticating…");
  try{
    const cred=await signInWithEmailAndPassword(auth,email,password);
    const userSnap=await getDoc(doc(db,"users",cred.user.uid));
    if(userSnap.exists() && userSnap.data().role==="admin"){
      await signOut(auth);
      message("This is an Admin account. Please use the Admin Portal login.","error");
      submit.disabled=false;submit.textContent="Login";return;
    }
    location.replace("client.html");
  }catch(err){
    console.error(err);
    message("Invalid email or password, or your client account is not linked yet.","error");
    submit.disabled=false;submit.textContent="Login";
  }
});
document.querySelector("#clientTogglePassword").onclick=()=>{
  const p=document.querySelector("#clientPassword");p.type=p.type==="password"?"text":"password";
  document.querySelector("#clientTogglePassword").textContent=p.type==="password"?"Show":"Hide";
};
document.querySelector("#clientForgotPassword").onclick=async()=>{
  const email=document.querySelector("#clientEmail").value.trim().toLowerCase();
  if(!email){message("Enter your email first.","error");return;}
  try{
    await sendPasswordResetEmail(auth,email);
    message("If an account exists for that email, password reset instructions have been sent.","success");
  }catch(e){
    message("If an account exists for that email, password reset instructions have been sent.","success");
  }
};
