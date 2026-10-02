import { auth, db } from "./firebase.js";
import {
  signInWithCustomToken,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-functions.js";

const functions = getFunctions();
const clientLogin = httpsCallable(functions, "clientLogin");

const form = document.querySelector("#clientLoginForm");
const msg = document.querySelector("#clientLoginMessage");
const submit = document.querySelector("#clientLoginButton");
const remember = document.querySelector("#clientRememberMe");
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

  const email = normalizeUsername(document.querySelector("#clientEmail").value).toLowerCase();
  const password = document.querySelector("#clientPassword").value;

  if (!email || !password) {
    message("Enter your registered Gmail, Username, or Client ID and password.", "error");
    return;
  }

  submit.disabled = true;
  submit.textContent = "Signing in…";
  message("Authenticating…");

  try {
    await setPersistence(auth, browserSessionPersistence);

    // The Admin portal stores the customer's real registered Gmail in the
    // customer record, while the customer-facing login also accepts the
    // generated Username (e.g. CliffCID-023) or Client ID (e.g. CID-023).
    // The callable resolves that identifier privately on the server and
    // returns a Firebase custom token. No customer Gmail is exposed to the
    // browser just to perform a username/Client ID lookup.
    const result = await clientLogin({
      identifier: email,
      password
    });

    const customToken = String(result?.data?.customToken || "").trim();
    if (!customToken) {
      throw new Error("CLIENT LOGIN FAILED [custom_token_missing]");
    }

    const cred = await signInWithCustomToken(auth, customToken);

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
    const debugDetails = [
      `Registered Gmail entered: ${email}`,
      `Firebase project: piso-wifi-f2b5c`,
      `Operation: Firebase callable → clientLogin`,
      `Error code: ${err?.code || "(none)"}`,
      `Error message: ${err?.message || String(err)}`
    ].join("\n");
    console.error("[PISO WIFI CUSTOMER LOGIN]", err);
    if (window.pisoDebug?.capture) {
      window.pisoDebug.capture(err?.message || String(err), {
        type: "CUSTOMER LOGIN",
        operation: "signInWithEmailAndPassword",
        context: debugDetails,
        stack: err?.stack || ""
      });
    }
    message(
      "Login failed. Please check the temporary error popup for the exact Firebase error.",
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

const PASSWORD_RESET_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzcBLoOP6LoXwTE8rhUUxd1q68ykDgVj-f4o-TD7YGPYmtXrepvhJ8dbPWdeCqQt9fM/exec";

function openForgotPasswordModal(){
  const existing=document.querySelector("#forgotPasswordModal");
  if(existing){ existing.classList.remove("hidden"); existing.querySelector("input")?.focus(); return; }
  const wrap=document.createElement("div");
  wrap.id="forgotPasswordModal";
  wrap.className="client-reset-modal";
  wrap.innerHTML=`
    <div class="client-reset-backdrop" aria-hidden="true"></div>
    <section class="client-reset-card" role="dialog" aria-modal="true" aria-labelledby="forgotTitle" aria-describedby="forgotDescription">
      <button type="button" class="client-reset-close" data-close-reset aria-label="Close account recovery">×</button>
      <div class="client-reset-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M12 14v2"/></svg>
      </div>
      <span class="eyebrow">ACCOUNT RECOVERY</span>
      <h2 id="forgotTitle">Reset your password</h2>
      <p id="forgotDescription" class="reset-intro">Enter your Client ID and registered Gmail. A 6-digit verification code will be sent to your registered Gmail.</p>
      <form id="forgotPasswordForm">
        <label class="client-field"><span>Client ID</span><input id="resetClientId" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CID-0001" required></label>
        <label class="client-field"><span>Registered Gmail</span><input id="resetEmail" type="email" autocomplete="email" inputmode="email" placeholder="yourname@gmail.com" required></label>
        <div id="resetCodeRow" class="client-field" style="display:none"><span>6-Digit Verification Code</span><input id="resetCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000"></label></div>
        <div id="resetMessage" class="client-login-message" role="status" aria-live="polite"></div>
        <div class="client-reset-actions">
          <button class="client-secondary" id="resetCancel" type="button">Cancel</button>
          <button class="client-primary" id="resetSubmit" type="submit">Send Verification Code</button>
        </div>
        <div id="resetResendRow" class="client-reset-note" style="display:none">Didn't receive the code? <button type="button" id="resetResend" class="link-btn" style="padding:0">Send a new code</button></div>
        <div class="client-reset-note">The 6-digit code is one-time use and expires shortly. Admin will never see your private password.</div>
      </form>
    </section>`;
  document.body.appendChild(wrap);
  wrap.querySelectorAll("[data-close-reset]").forEach(el=>el.onclick=()=>wrap.remove());
  wrap.querySelector("#resetCancel").onclick=()=>wrap.remove();
  wrap.querySelector("#forgotPasswordForm").onsubmit=submitResetRequest;
  wrap.querySelector("#resetResend").onclick=()=>requestResetCode(false);
  wrap.addEventListener("keydown", e=>{ if(e.key==="Escape") wrap.remove(); });
  wrap.querySelector("#resetClientId").focus();
}

function resetRequestValues(){
  return {
    clientId:String(document.querySelector("#resetClientId")?.value||"").trim().toUpperCase(),
    email:String(document.querySelector("#resetEmail")?.value||"").trim().toLowerCase()
  };
}

async function callPasswordResetScript(payload){
  const response=await fetch(PASSWORD_RESET_APPS_SCRIPT_URL,{
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify(payload)
  });
  const text=await response.text();
  let data={};
  try{ data=JSON.parse(text); }catch{ throw new Error("Password recovery service returned an invalid response."); }
  if(!response.ok || data.ok!==true) throw new Error(data.error||"Unable to process password recovery.");
  return data;
}

async function requestResetCode(showResend=true){
  const {clientId,email}=resetRequestValues();
  const msgEl=document.querySelector("#resetMessage");
  const btn=document.querySelector("#resetSubmit");
  if(!/^CID-\d{3,}$/i.test(clientId)||!email){
    msgEl.textContent="Enter your Client ID and registered Gmail.";
    msgEl.className="client-login-message error";
    return;
  }
  btn.disabled=true; btn.textContent="Sending…";
  msgEl.textContent="Verifying your account details…"; msgEl.className="client-login-message";
  try{
    await callPasswordResetScript({action:"requestCode",clientId,email});
    document.querySelector("#resetCodeRow").style.display="block";
    document.querySelector("#resetResendRow").style.display="block";
    document.querySelector("#resetCode").required=true;
    btn.textContent="Verify Code";
    msgEl.textContent="A 6-digit verification code was sent to your registered Gmail.";
    msgEl.className="client-login-message success";
    document.querySelector("#resetCode").focus();
  }catch(err){
    console.error("[PISO WIFI PASSWORD RESET CODE]",err);
    msgEl.textContent=err.message||"Unable to send the verification code.";
    msgEl.className="client-login-message error";
    btn.textContent="Send Verification Code";
  }finally{ btn.disabled=false; }
}

async function submitResetRequest(e){
  e.preventDefault();
  const codeRow=document.querySelector("#resetCodeRow");
  if(codeRow?.style.display!=="none") return verifyResetCode();
  return requestResetCode(false);
}

async function verifyResetCode(){
  const {clientId,email}=resetRequestValues();
  const code=String(document.querySelector("#resetCode")?.value||"").trim();
  const msgEl=document.querySelector("#resetMessage");
  const btn=document.querySelector("#resetSubmit");
  if(!/^\d{6}$/.test(code)){
    msgEl.textContent="Enter the 6-digit verification code.";
    msgEl.className="client-login-message error";
    return;
  }
  btn.disabled=true; btn.textContent="Verifying…"; msgEl.textContent="Verifying your code…"; msgEl.className="client-login-message";
  try{
    const result=await callPasswordResetScript({action:"verifyCode",clientId,email,code});
    msgEl.textContent="Password reset successful. Your 6-digit code is now your temporary password. Use it to log in, then create your new private password.";
    msgEl.className="client-login-message success";
    const card=wrapCard();
    if(card){
      card.innerHTML=`<div class="client-reset-icon success" aria-hidden="true">✓</div>
        <span class="eyebrow">PASSWORD RESET COMPLETE</span>
        <h2>You're all set</h2>
        <p class="reset-intro">Your temporary password has been reset successfully.</p>
        <div class="client-reset-note success-note">Your <b>6-digit verification code</b> is now your temporary password. Use it to log in, then create your new private password.</div>
        <div class="client-reset-actions"><button class="client-primary" type="button" id="resetDone">Go Back to Login</button></div>`;
      card.querySelector("#resetDone").onclick=()=>wrapCard()?.closest("#forgotPasswordModal")?.remove();
    }
    return result;
  }catch(err){
    console.error("[PISO WIFI PASSWORD RESET VERIFY]",err);
    msgEl.textContent=err.message||"The code is invalid or expired.";
    msgEl.className="client-login-message error";
  }finally{ btn.disabled=false; if(btn.textContent==="Verifying…") btn.textContent="Verify Code"; }
}

function wrapCard(){ return document.querySelector("#forgotPasswordModal .client-reset-card"); }
