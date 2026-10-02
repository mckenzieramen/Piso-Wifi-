import { auth, db } from "./firebase.js";
import {
  signInWithCustomToken,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
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
    <div class="client-reset-backdrop"></div>
    <section class="client-reset-card" role="dialog" aria-modal="true" aria-labelledby="forgotTitle">
      <button type="button" class="client-reset-close" id="resetClose" aria-label="Close">×</button>
      <div class="client-reset-icon" aria-hidden="true">🔐</div>
      <span class="eyebrow">ACCOUNT RECOVERY</span>
      <h2 id="forgotTitle">Reset your password</h2>
      <p id="resetIntro" class="reset-intro">Enter your Client ID and registered Gmail. We'll send a 6-digit verification code to your email.</p>

      <form id="forgotPasswordForm">
        <div id="resetStepRequest">
          <label class="client-field"><span>Client ID</span><input id="resetClientId" autocomplete="off" placeholder="CID-001" required></label>
          <label class="client-field"><span>Registered Gmail</span><input id="resetEmail" type="email" autocomplete="email" placeholder="yourname@gmail.com" required></label>
          <div id="resetMessage" class="client-login-message" role="status" aria-live="polite"></div>
          <div class="client-reset-actions"><button type="button" class="client-secondary" id="resetCancel">Cancel</button><button class="client-primary login-submit" id="resetSubmit" type="submit">Send Verification Code</button></div>
        </div>

        <div id="resetStepCode" hidden>
          <label class="client-field"><span>6-Digit Verification Code</span><input id="resetCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" required></label>
          <div id="resetCodeMessage" class="client-login-message" role="status" aria-live="polite"></div>
          <div class="client-reset-actions"><button type="button" class="client-secondary" id="resetResend">Resend Code</button><button class="client-primary login-submit" id="verifyResetCode" type="button">Verify Code</button></div>
          <p class="client-reset-note">The code expires in 10 minutes and can only be used once.</p>
        </div>

        <div id="resetStepPassword" hidden>
          <label class="client-field"><span>New Password</span><input id="resetNewPassword" type="password" minlength="8" autocomplete="new-password" placeholder="At least 8 characters" required></label>
          <label class="client-field"><span>Confirm New Password</span><input id="resetConfirmPassword" type="password" minlength="8" autocomplete="new-password" placeholder="Re-enter your password" required></label>
          <div id="resetPasswordMessage" class="client-login-message" role="status" aria-live="polite"></div>
          <div class="client-reset-actions"><button type="button" class="client-secondary" id="resetBackCode">Back</button><button class="client-primary login-submit" id="saveResetPassword" type="button">Save New Password</button></div>
        </div>

        <div id="resetStepSuccess" hidden>
          <div style="text-align:center;padding:8px 0 12px">
            <div style="font-size:42px;line-height:1;margin-bottom:12px">✓</div>
            <h3 style="margin:0 0 8px;color:#102a4c;font-size:24px">Congratulations!</h3>
            <p style="margin:0;color:#667990;line-height:1.6">Your password was changed successfully.</p>
          </div>
          <button class="client-primary login-submit" id="resetGoLogin" type="button">Go Back to Login</button>
        </div>
      </form>
    </section>`;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.querySelector("#resetClose").onclick = close;
  wrap.querySelector("#resetCancel").onclick = close;
  wrap.querySelector("#forgotPasswordForm").onsubmit = submitResetCodeRequest;
  wrap.querySelector("#verifyResetCode").onclick = verifyResetCode;
  wrap.querySelector("#resetResend").onclick = resendResetCode;
  wrap.querySelector("#resetBackCode").onclick = () => showResetStep("code");
  wrap.querySelector("#saveResetPassword").onclick = completePasswordReset;
  wrap.querySelector("#resetGoLogin").onclick = close;
  wrap.querySelector("#resetClientId").focus();
}

function showResetStep(step){
  const root=document.querySelector("#forgotPasswordModal");
  if(!root) return;
  const steps={request:"#resetStepRequest",code:"#resetStepCode",password:"#resetStepPassword",success:"#resetStepSuccess"};
  Object.entries(steps).forEach(([name,selector])=>{
    root.querySelector(selector).hidden = name !== step;
  });
  const title=root.querySelector("#forgotTitle");
  const intro=root.querySelector("#resetIntro");
  if(step === "request"){
    title.textContent="Reset your password";
    intro.textContent="Enter your Client ID and registered Gmail. We'll send a 6-digit verification code to your email.";
  }else if(step === "code"){
    title.textContent="Verify your email";
    intro.textContent="Enter the 6-digit code we sent to your registered Gmail.";
    root.querySelector("#resetCode")?.focus();
  }else if(step === "password"){
    title.textContent="Create a new password";
    intro.textContent="Your code has been verified. Create a new private password.";
    root.querySelector("#resetNewPassword")?.focus();
  }else{
    title.textContent="Password updated";
    intro.textContent="Your account is ready. Your new password is now active.";
  }
}

async function callPasswordResetApi(payload){
  const response = await fetch(PASSWORD_RESET_APPS_SCRIPT_URL, {
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify(payload)
  });
  const raw = await response.text();
  let data={};
  try{ data=JSON.parse(raw); }catch(_){ throw new Error("The password recovery service returned an invalid response."); }
  if(!data.ok) throw new Error(data.error || "Password recovery request failed.");
  return data;
}

async function submitResetCodeRequest(e){
  e.preventDefault();
  const root=document.querySelector("#forgotPasswordModal");
  const clientId=root.querySelector("#resetClientId").value.trim().toUpperCase();
  const email=root.querySelector("#resetEmail").value.trim().toLowerCase();
  const msgEl=root.querySelector("#resetMessage");
  const btn=root.querySelector("#resetSubmit");
  if(!/^CID-\d{3,}$/.test(clientId) || !email.includes("@")){
    msgEl.textContent="Enter a valid Client ID and registered Gmail.";
    msgEl.className="client-login-message error";
    return;
  }
  btn.disabled=true; btn.textContent="Sending…";
  msgEl.textContent="Verifying your account and sending the code…"; msgEl.className="client-login-message";
  try{
    await callPasswordResetApi({action:"requestCode",clientId,email});
    msgEl.textContent="Verification code sent. Check your Gmail.";
    msgEl.className="client-login-message success";
    showResetStep("code");
  }catch(err){
    console.error("[PISO WIFI PASSWORD RESET]",err);
    msgEl.textContent=err.message || "We could not send the verification code.";
    msgEl.className="client-login-message error";
    btn.disabled=false; btn.textContent="Send Verification Code";
  }
}

async function resendResetCode(){
  const root=document.querySelector("#forgotPasswordModal");
  const clientId=root.querySelector("#resetClientId").value.trim().toUpperCase();
  const email=root.querySelector("#resetEmail").value.trim().toLowerCase();
  const btn=root.querySelector("#resetResend");
  const msgEl=root.querySelector("#resetCodeMessage");
  btn.disabled=true; btn.textContent="Sending…";
  try{
    await callPasswordResetApi({action:"requestCode",clientId,email});
    msgEl.textContent="A new verification code was sent to your Gmail.";
    msgEl.className="client-login-message success";
  }catch(err){
    msgEl.textContent=err.message || "Unable to resend the code.";
    msgEl.className="client-login-message error";
  }finally{
    btn.disabled=false; btn.textContent="Resend Code";
  }
}

async function verifyResetCode(){
  const root=document.querySelector("#forgotPasswordModal");
  const clientId=root.querySelector("#resetClientId").value.trim().toUpperCase();
  const email=root.querySelector("#resetEmail").value.trim().toLowerCase();
  const code=root.querySelector("#resetCode").value.trim();
  const btn=root.querySelector("#verifyResetCode");
  const msgEl=root.querySelector("#resetCodeMessage");
  if(!/^\d{6}$/.test(code)){
    msgEl.textContent="Enter the 6-digit verification code.";
    msgEl.className="client-login-message error";
    return;
  }
  btn.disabled=true; btn.textContent="Verifying…";
  try{
    const result=await callPasswordResetApi({action:"verifyCode",clientId,email,code});
    root.dataset.resetToken=result.resetToken;
    msgEl.textContent="Code verified successfully.";
    msgEl.className="client-login-message success";
    showResetStep("password");
  }catch(err){
    msgEl.textContent=err.message || "Invalid or expired code.";
    msgEl.className="client-login-message error";
    btn.disabled=false; btn.textContent="Verify Code";
  }
}

async function completePasswordReset(){
  const root=document.querySelector("#forgotPasswordModal");
  const clientId=root.querySelector("#resetClientId").value.trim().toUpperCase();
  const email=root.querySelector("#resetEmail").value.trim().toLowerCase();
  const newPassword=root.querySelector("#resetNewPassword").value;
  const confirmPassword=root.querySelector("#resetConfirmPassword").value;
  const resetToken=root.dataset.resetToken || "";
  const btn=root.querySelector("#saveResetPassword");
  const msgEl=root.querySelector("#resetPasswordMessage");
  if(newPassword.length<8){
    msgEl.textContent="Your new password must be at least 8 characters.";
    msgEl.className="client-login-message error"; return;
  }
  if(newPassword!==confirmPassword){
    msgEl.textContent="Passwords do not match.";
    msgEl.className="client-login-message error"; return;
  }
  if(!resetToken){
    msgEl.textContent="Your verification session has expired. Request a new code.";
    msgEl.className="client-login-message error"; return;
  }
  btn.disabled=true; btn.textContent="Saving…";
  try{
    await callPasswordResetApi({action:"resetPassword",clientId,email,resetToken,newPassword});
    showResetStep("success");
  }catch(err){
    msgEl.textContent=err.message || "We could not change your password.";
    msgEl.className="client-login-message error";
    btn.disabled=false; btn.textContent="Save New Password";
  }
}

