import { auth, db } from "./firebase.js";
import {
  signInWithCustomToken,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-functions.js";

const functions = getFunctions(undefined, "us-central1");
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

const passwordResetApi = "/api/password-reset-code";

function openForgotPasswordModal(){
  const existing=document.querySelector("#forgotPasswordModal");
  if(existing){ existing.classList.remove("hidden"); existing.querySelector("input")?.focus(); return; }

  const wrap=document.createElement("div");
  wrap.id="forgotPasswordModal";
  wrap.className="client-reset-modal";
  wrap.innerHTML=`
    <div class="client-reset-backdrop" aria-hidden="true"></div>
    <section class="client-reset-card" role="dialog" aria-modal="true" aria-labelledby="forgotTitle">
      <button type="button" class="client-reset-close" data-close-reset aria-label="Close account recovery">×</button>
      <div class="client-reset-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M12 14v2"/></svg>
      </div>
      <span class="eyebrow">ACCOUNT RECOVERY</span>
      <h2 id="forgotTitle">Recover your account</h2>
      <p id="forgotDescription" class="reset-intro">Enter your Client ID and registered Gmail. We’ll email you a 6-digit verification code.</p>
      <div id="resetStepAccount">
        <form id="forgotPasswordForm">
          <label class="client-field"><span>Client ID</span><input id="resetClientId" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CID-0001" required></label>
          <label class="client-field"><span>Registered Gmail</span><input id="resetEmail" type="email" autocomplete="email" inputmode="email" placeholder="yourname@gmail.com" required></label>
          <div id="resetMessage" class="client-login-message" role="status" aria-live="polite"></div>
          <div class="client-reset-actions">
            <button class="client-secondary" id="resetCancel" type="button">Cancel</button>
            <button class="client-primary" id="resetSubmit" type="submit">Send 6-Digit Code</button>
          </div>
          <div class="client-reset-note">The code is sent only to the registered Gmail. Admin cannot see your private password.</div>
        </form>
      </div>
      <div id="resetStepCode" class="hidden">
        <form id="verifyResetForm">
          <label class="client-field"><span>6-Digit Verification Code</span><input id="resetCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" placeholder="123456" required></label>
          <div id="verifyMessage" class="client-login-message" role="status" aria-live="polite"></div>
          <div class="client-reset-actions">
            <button class="client-secondary" id="backReset" type="button">Back</button>
            <button class="client-primary" id="verifySubmit" type="submit">Verify Code</button>
          </div>
          <div class="client-reset-note">The code expires in 10 minutes and can only be used once.</div>
        </form>
        <button type="button" id="resendResetCode" class="text-link" style="margin-top:14px">Send a new code</button>
      </div>
    </section>`;
  document.body.appendChild(wrap);

  wrap.querySelectorAll("[data-close-reset]").forEach(el=>el.onclick=()=>wrap.remove());
  wrap.querySelector("#resetCancel").onclick=()=>wrap.remove();
  wrap.querySelector("#backReset").onclick=()=>showRecoveryAccountStep();
  wrap.querySelector("#forgotPasswordForm").onsubmit=submitResetRequest;
  wrap.querySelector("#verifyResetForm").onsubmit=verifyResetCode;
  wrap.querySelector("#resendResetCode").onclick=()=>submitResetRequest({preventDefault(){}});
  wrap.querySelector("#resetClientId").focus();

  function showRecoveryAccountStep(){
    wrap.querySelector("#resetStepAccount").classList.remove("hidden");
    wrap.querySelector("#resetStepCode").classList.add("hidden");
    wrap.querySelector("#forgotDescription").textContent="Enter your Client ID and registered Gmail. We’ll email you a 6-digit verification code.";
    wrap.querySelector("#resetClientId").focus();
  }
}

async function passwordResetRequest(payload){
  const response=await fetch(passwordResetApi,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  const data=await response.json().catch(()=>({ok:false,error:"Password recovery server returned an invalid response."}));
  if(!response.ok || data.ok!==true) throw new Error(data.error||"Unable to process the password recovery request.");
  return data;
}

async function submitResetRequest(e){
  e.preventDefault();
  const clientId=document.querySelector("#resetClientId")?.value.trim().toUpperCase();
  const email=document.querySelector("#resetEmail")?.value.trim().toLowerCase();
  const msgEl=document.querySelector("#resetMessage");
  const btn=document.querySelector("#resetSubmit");
  if(!clientId||!email){msgEl.textContent="Enter your Client ID and registered Gmail.";msgEl.className="client-login-message error";return;}
  btn.disabled=true; btn.textContent="Sending…"; msgEl.textContent="Checking your account and sending the code…"; msgEl.className="client-login-message";
  try{
    await passwordResetRequest({action:"requestCode",clientId,email});
    document.querySelector("#resetStepAccount").classList.add("hidden");
    document.querySelector("#resetStepCode").classList.remove("hidden");
    document.querySelector("#forgotDescription").textContent=`We sent a 6-digit code to ${email}. Enter it below to continue.`;
    document.querySelector("#resetCode").focus();
  }catch(err){
    console.error("[PISO WIFI PASSWORD RESET REQUEST]",err);
    msgEl.textContent=err?.message||"We could not send the verification code. Please check your details and try again.";
    msgEl.className="client-login-message error";
    btn.disabled=false; btn.textContent="Send 6-Digit Code";
  }
}

async function verifyResetCode(e){
  e.preventDefault();
  const clientId=document.querySelector("#resetClientId")?.value.trim().toUpperCase();
  const email=document.querySelector("#resetEmail")?.value.trim().toLowerCase();
  const code=document.querySelector("#resetCode")?.value.trim();
  const msgEl=document.querySelector("#verifyMessage");
  const btn=document.querySelector("#verifySubmit");
  if(!/^\d{6}$/.test(code||"")){msgEl.textContent="Enter the 6-digit code from your email.";msgEl.className="client-login-message error";return;}
  btn.disabled=true; btn.textContent="Verifying…"; msgEl.textContent="Verifying your code…"; msgEl.className="client-login-message";
  try{
    await passwordResetRequest({action:"verifyCode",clientId,email,code});
    const wrap=document.querySelector("#forgotPasswordModal");
    const card=wrap?.querySelector(".client-reset-card");
    if(card){
      card.innerHTML=`<button type="button" class="client-reset-close" data-close-reset aria-label="Close confirmation">×</button>
        <div class="client-reset-icon success" aria-hidden="true">✓</div>
        <span class="eyebrow">PASSWORD RESET COMPLETE</span>
        <h2>Your 6-digit code is ready to use</h2>
        <p class="reset-intro">Your password has been reset securely. Use your <b>Client ID</b> and the same <b>6-digit code</b> as your temporary password to sign in.</p>
        <div class="client-reset-note success-note"><b>Next:</b> After you sign in, PISO WIFI will ask you to create your own private password. The 6-digit code is temporary.</div>
        <div class="client-reset-actions"><button class="client-primary" type="button" id="returnToCustomerLogin">Return to Login</button></div>`;
      card.querySelector("[data-close-reset]").onclick=()=>wrap.remove();
      card.querySelector("#returnToCustomerLogin").onclick=()=>{
        wrap.remove();
        const loginId=document.querySelector("#clientEmail");
        const loginPassword=document.querySelector("#clientPassword");
        if(loginId) loginId.value=clientId;
        if(loginPassword){loginPassword.value=code;loginPassword.focus();}
        message("Your reset is complete. Use the 6-digit code as your temporary password, then create your private password.","success");
      };
    }
  }catch(err){
    console.error("[PISO WIFI PASSWORD RESET VERIFY]",err);
    msgEl.textContent=err?.message||"The code could not be verified. Request a new code if it has expired.";
    msgEl.className="client-login-message error";
    btn.disabled=false; btn.textContent="Verify Code";
  }
}

