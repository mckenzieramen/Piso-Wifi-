import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form = document.querySelector("#clientLoginForm");
const msg = document.querySelector("#clientLoginMessage");
const submit = document.querySelector("#clientLoginButton");
const remember = document.querySelector("#clientRememberMe");
const UNIT_AUTH_DOMAIN = "@client-login.pisowifi.local";
const CLIENT_REMEMBER_KEY = "pisoWifi.rememberedUsername";

function message(text, type = "") {
  msg.textContent = text;
  msg.className = `client-login-message ${type}`.trim();
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

try {
  const savedUnit = localStorage.getItem(CLIENT_REMEMBER_KEY);
  if (savedUnit && document.querySelector("#clientEmail")) {
    document.querySelector("#clientEmail").value = savedUnit;
    if (remember) remember.checked = true;
  }
} catch {}

function authEmailFromUsername(username) {
  return `${username.toLowerCase().replace(/[^a-z0-9]+/g, "-")}${UNIT_AUTH_DOMAIN}`;
}

async function getRole(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() ? snap.data() : null;
}

async function routeUser(user) {
  if (!user) return;

  try {
    const profile = await getRole(user);

    if (profile?.role === "client" && profile?.active !== false) {
      try {
      const rememberedUsername = String(profile?.username || "").trim();
      if (remember?.checked && rememberedUsername) localStorage.setItem(CLIENT_REMEMBER_KEY, rememberedUsername);
      else if (!remember?.checked) localStorage.removeItem(CLIENT_REMEMBER_KEY);
    } catch {}

    window.location.replace("/client/");
      return;
    }

    // Admin accounts must never be routed into the Customer portal.
    await signOut(auth);
    message(
      "This is an Admin Account. Please use the Admin Portal.",
      "error"
    );
  } catch (e) {
    console.error("[PISO WIFI CUSTOMER AUTH]", e);
    try { await signOut(auth); } catch {}
    message(
      "This account is not authorized for the Customer Account.",
      "error"
    );
  }
}

onAuthStateChanged(auth, user => {
  if (user) routeUser(user);
});

form.addEventListener("submit", async e => {
  e.preventDefault();

  const username = normalizeUsername(document.querySelector("#clientEmail").value);
  const password = document.querySelector("#clientPassword").value;

  if (!username || !password) {
    message("Enter your username and password.", "error");
    return;
  }

  submit.disabled = true;
  submit.textContent = "Signing in…";
  message("Authenticating…");

  try {
    await setPersistence(auth, browserSessionPersistence);

    const cred = await signInWithEmailAndPassword(
      auth,
      authEmailFromUsername(username),
      password
    );

    const profile = await getRole(cred.user);

    if (profile?.role !== "client" || profile?.active === false) {
      await signOut(auth);
      message(
        "Access denied. This account is not a Customer Account.",
        "error"
      );
      submit.disabled = false;
      submit.textContent = "Login";
      return;
    }

    window.location.replace("/client/");
  } catch (err) {
    console.error("[PISO WIFI CUSTOMER LOGIN]", err);
    message(
      "Invalid username or password. If this is your first login, use the temporary password provided by Admin.",
      "error"
    );
    submit.disabled = false;
    submit.textContent = "Login";
  }
});

document.querySelector("#clientTogglePassword").onclick = () => {
  const p = document.querySelector("#clientPassword");
  p.type = p.type === "password" ? "text" : "password";
  document.querySelector("#clientTogglePassword").textContent =
    p.type === "password" ? "Show" : "Hide";
};

document.querySelector("#clientForgotPassword").onclick = () => {
  openForgotPasswordModal();
};

const PASSWORD_RECOVERY_API = "/api/password-reset-code";
let passwordRecoveryState = {
  clientId: "",
  email: "",
  resetToken: ""
};

async function passwordRecoveryApi(payload){
  const response = await fetch(PASSWORD_RECOVERY_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok || data.ok !== true) {
    throw new Error(data?.error || "Unable to process password recovery.");
  }
  return data;
}

function closeRecoveryModal(id){
  document.querySelector(`#${id}`)?.remove();
}

function openForgotPasswordModal(){
  closeRecoveryModal("passwordOtpModal");
  closeRecoveryModal("createPasswordModal");

  const existing=document.querySelector("#forgotPasswordModal");
  if(existing){ existing.classList.remove("hidden"); existing.querySelector("input")?.focus(); return; }

  const wrap=document.createElement("div");
  wrap.id="forgotPasswordModal";
  wrap.className="client-reset-modal";
  wrap.innerHTML=`
    <div class="client-reset-backdrop" aria-hidden="true"></div>
    <section class="client-reset-card" role="dialog" aria-modal="true" aria-labelledby="forgotTitle">
      <button type="button" class="client-reset-close" data-close-reset aria-label="Close">×</button>
      <div class="client-reset-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M12 14v2"/></svg>
      </div>
      <span class="eyebrow">ACCOUNT RECOVERY</span>
      <h2 id="forgotTitle">Forgot your password?</h2>
      <p class="reset-intro">Enter your Client ID and registered Gmail. We’ll send a 6-digit verification code to your email.</p>
      <form id="forgotPasswordForm">
        <label class="client-field"><span>Client ID</span><input id="resetClientId" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CID-0001" required></label>
        <label class="client-field"><span>Registered Gmail</span><input id="resetEmail" type="email" autocomplete="email" inputmode="email" placeholder="yourname@gmail.com" required></label>
        <div id="resetMessage" class="client-login-message" role="status" aria-live="polite"></div>
        <div class="client-reset-actions">
          <button class="client-secondary" id="resetCancel" type="button">Cancel</button>
          <button class="client-primary" id="resetSubmit" type="submit">Get OTP</button>
        </div>
        <div class="client-reset-note">The verification code expires in 10 minutes and can only be used once.</div>
      </form>
    </section>`;
  document.body.appendChild(wrap);
  wrap.querySelectorAll("[data-close-reset]").forEach(el=>el.onclick=()=>closeRecoveryModal("forgotPasswordModal"));
  wrap.querySelector("#resetCancel").onclick=()=>closeRecoveryModal("forgotPasswordModal");
  wrap.querySelector("#forgotPasswordForm").onsubmit=submitResetRequest;
  wrap.addEventListener("keydown", e=>{ if(e.key==="Escape") closeRecoveryModal("forgotPasswordModal"); });
  wrap.querySelector("#resetClientId").focus();
}

async function submitResetRequest(e){
  e.preventDefault();
  const clientId=document.querySelector("#resetClientId").value.trim().toUpperCase();
  const email=document.querySelector("#resetEmail").value.trim().toLowerCase();
  const msgEl=document.querySelector("#resetMessage");
  const btn=document.querySelector("#resetSubmit");
  if(!/^CID-\d{3,}$/.test(clientId)||!/^\S+@\S+\.\S+$/.test(email)){
    msgEl.textContent="Enter a valid Client ID and registered Gmail.";
    msgEl.className="client-login-message error";
    return;
  }
  btn.disabled=true;
  btn.textContent="Sending…";
  msgEl.textContent="Verifying your account and sending the OTP…";
  msgEl.className="client-login-message";
  try{
    await passwordRecoveryApi({action:"requestCode",clientId,email});
    passwordRecoveryState.clientId=clientId;
    passwordRecoveryState.email=email;
    passwordRecoveryState.resetToken="";
    closeRecoveryModal("forgotPasswordModal");
    openPasswordOtpModal();
  }catch(err){
    console.error("[PISO WIFI PASSWORD OTP REQUEST]",err);
    msgEl.textContent=err?.message||"Unable to send OTP. Please try again.";
    msgEl.className="client-login-message error";
    btn.disabled=false;
    btn.textContent="Get OTP";
  }
}

function openPasswordOtpModal(){
  closeRecoveryModal("createPasswordModal");
  closeRecoveryModal("passwordOtpModal");
  const wrap=document.createElement("div");
  wrap.id="passwordOtpModal";
  wrap.className="client-reset-modal";
  wrap.innerHTML=`
    <div class="client-reset-backdrop" aria-hidden="true"></div>
    <section class="client-reset-card" role="dialog" aria-modal="true" aria-labelledby="otpTitle">
      <button type="button" class="client-reset-close" id="otpClose" aria-label="Close">×</button>
      <div class="client-reset-icon" aria-hidden="true">✓</div>
      <span class="eyebrow">VERIFY OTP</span>
      <h2 id="otpTitle">Enter your 6-digit code</h2>
      <p class="reset-intro">We sent a verification code to your registered Gmail. Enter it below to continue.</p>
      <form id="passwordOtpForm">
        <label class="client-field"><span>6-Digit OTP</span><input id="passwordOtpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required></label>
        <div id="passwordOtpMessage" class="client-login-message" role="status" aria-live="polite"></div>
        <div class="client-reset-actions">
          <button class="client-secondary" id="otpCancel" type="button">Cancel</button>
          <button class="client-primary" id="otpVerify" type="submit">Verify OTP</button>
        </div>
        <div class="client-reset-note">The OTP expires in 10 minutes. You have up to 5 attempts.</div>
      </form>
    </section>`;
  document.body.appendChild(wrap);
  wrap.querySelector("#otpClose").onclick=()=>closeRecoveryModal("passwordOtpModal");
  wrap.querySelector("#otpCancel").onclick=()=>closeRecoveryModal("passwordOtpModal");
  wrap.querySelector("#passwordOtpForm").onsubmit=verifyPasswordOtp;
  wrap.querySelector("#passwordOtpCode").addEventListener("input",e=>{e.target.value=e.target.value.replace(/\D/g,"").slice(0,6);});
  wrap.querySelector("#passwordOtpCode").focus();
}

async function verifyPasswordOtp(e){
  e.preventDefault();
  const code=document.querySelector("#passwordOtpCode").value.replace(/\D/g,"");
  const msgEl=document.querySelector("#passwordOtpMessage");
  const btn=document.querySelector("#otpVerify");
  if(!/^\d{6}$/.test(code)){
    msgEl.textContent="Enter the 6-digit OTP.";
    msgEl.className="client-login-message error";
    return;
  }
  btn.disabled=true;
  btn.textContent="Verifying…";
  msgEl.textContent="Checking your verification code…";
  msgEl.className="client-login-message";
  try{
    const result=await passwordRecoveryApi({action:"verifyCode",clientId:passwordRecoveryState.clientId,email:passwordRecoveryState.email,code});
    passwordRecoveryState.resetToken=result.resetToken||"";
    if(!passwordRecoveryState.resetToken) throw new Error("The verification session could not be created. Please request a new OTP.");
    closeRecoveryModal("passwordOtpModal");
    openCreatePasswordModal();
  }catch(err){
    console.error("[PISO WIFI PASSWORD OTP VERIFY]",err);
    msgEl.textContent=err?.message||"Incorrect or expired OTP.";
    msgEl.className="client-login-message error";
    btn.disabled=false;
    btn.textContent="Verify OTP";
  }
}

function openCreatePasswordModal(){
  closeRecoveryModal("createPasswordModal");
  const wrap=document.createElement("div");
  wrap.id="createPasswordModal";
  wrap.className="client-reset-modal";
  wrap.innerHTML=`
    <div class="client-reset-backdrop" aria-hidden="true"></div>
    <section class="client-reset-card" role="dialog" aria-modal="true" aria-labelledby="createPasswordTitle">
      <button type="button" class="client-reset-close" id="createPasswordClose" aria-label="Close">×</button>
      <div class="client-reset-icon" aria-hidden="true">🔐</div>
      <span class="eyebrow">NEW PASSWORD</span>
      <h2 id="createPasswordTitle">Create a new password</h2>
      <p class="reset-intro">Your OTP has been verified. Create your new private password below.</p>
      <form id="createPasswordForm">
        <label class="client-field"><span>New Password</span><input id="newRecoveryPassword" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required></label>
        <label class="client-field"><span>Confirm New Password</span><input id="confirmRecoveryPassword" type="password" autocomplete="new-password" minlength="8" placeholder="Re-enter your password" required></label>
        <div id="createPasswordMessage" class="client-login-message" role="status" aria-live="polite"></div>
        <div class="client-reset-actions">
          <button class="client-secondary" id="createPasswordCancel" type="button">Cancel</button>
          <button class="client-primary" id="createPasswordSubmit" type="submit">Create Password</button>
        </div>
        <div class="client-reset-note">Choose a password you do not share with anyone. Your OTP is not your password.</div>
      </form>
    </section>`;
  document.body.appendChild(wrap);
  wrap.querySelector("#createPasswordClose").onclick=()=>closeRecoveryModal("createPasswordModal");
  wrap.querySelector("#createPasswordCancel").onclick=()=>closeRecoveryModal("createPasswordModal");
  wrap.querySelector("#createPasswordForm").onsubmit=createPasswordAfterOtp;
  wrap.querySelector("#newRecoveryPassword").focus();
}

async function createPasswordAfterOtp(e){
  e.preventDefault();
  const password=document.querySelector("#newRecoveryPassword").value;
  const confirm=document.querySelector("#confirmRecoveryPassword").value;
  const msgEl=document.querySelector("#createPasswordMessage");
  const btn=document.querySelector("#createPasswordSubmit");
  if(password.length<8){msgEl.textContent="Password must be at least 8 characters.";msgEl.className="client-login-message error";return;}
  if(password!==confirm){msgEl.textContent="Passwords do not match.";msgEl.className="client-login-message error";return;}
  if(!passwordRecoveryState.resetToken){msgEl.textContent="Your verification session has expired. Please request a new OTP.";msgEl.className="client-login-message error";return;}
  btn.disabled=true;
  btn.textContent="Saving…";
  msgEl.textContent="Updating your password securely…";
  msgEl.className="client-login-message";
  try{
    await passwordRecoveryApi({action:"resetPassword",resetToken:passwordRecoveryState.resetToken,newPassword:password});
    closeRecoveryModal("createPasswordModal");
    passwordRecoveryState={clientId:"",email:"",resetToken:""};
    msg.textContent="Password created successfully. You can now log in with your new password.";
    msg.className="client-login-message success";
    document.querySelector("#clientPassword").value="";
    document.querySelector("#clientPassword").focus();
  }catch(err){
    console.error("[PISO WIFI PASSWORD CREATE]",err);
    msgEl.textContent=err?.message||"Unable to update your password. Please try again.";
    msgEl.className="client-login-message error";
    btn.disabled=false;
    btn.textContent="Create Password";
  }
}

