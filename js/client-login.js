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


const PASSWORD_RECOVERY_ENDPOINT = "/api/password-reset-code";

document.querySelector("#clientForgotPassword").onclick = () => {
  openForgotPasswordModal();
};

function openForgotPasswordModal(){
  const existing=document.querySelector("#forgotPasswordModal");
  if(existing) existing.remove();

  const wrap=document.createElement("div");
  wrap.id="forgotPasswordModal";
  wrap.className="client-reset-modal";
  wrap.innerHTML=`
    <div class="client-reset-backdrop" data-close-reset></div>
    <section class="client-reset-card" role="dialog" aria-modal="true" aria-labelledby="forgotTitle">
      <button type="button" class="client-reset-close" data-close-reset aria-label="Close account recovery">×</button>
      <div class="client-reset-icon" aria-hidden="true">🔐</div>
      <h2 id="forgotTitle">Forgot your password?</h2>
      <p id="resetIntro" class="reset-intro">Enter your Client ID and registered Gmail. We’ll send a 6-digit verification code to your email.</p>

      <form id="forgotPasswordForm">
        <label class="client-field"><span>Client ID</span><input id="resetClientId" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CID-0001" required></label>
        <label class="client-field"><span>Registered Gmail</span><input id="resetEmail" type="email" autocomplete="email" inputmode="email" placeholder="yourname@gmail.com" required></label>

        <div id="resetCodeGroup" hidden>
          <label class="client-field">
            <span>6-Digit Verification Code</span>
            <input id="resetCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000">
          </label>
          <p class="client-reset-note">The code expires in 10 minutes and can only be used once.</p>
        </div>

        <div id="resetPasswordGroup" hidden>
          <label class="client-field"><span>New Password</span><input id="resetNewPassword" type="password" minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label>
          <label class="client-field"><span>Confirm New Password</span><input id="resetConfirmPassword" type="password" minlength="8" autocomplete="new-password" placeholder="Re-enter your new password"></label>
        </div>

        <div id="resetMessage" class="client-login-message" role="status" aria-live="polite"></div>
        <div class="client-reset-actions">
          <button class="client-secondary" id="resetCancel" type="button">Cancel</button>
          <button class="client-primary" id="resetSubmit" type="submit">Send 6-Digit Code</button>
        </div>
      </form>

      <div class="client-reset-note">Your personal password is never shown to Admin. The 6-digit code is only for account recovery.</div>
    </section>`;
  document.body.appendChild(wrap);

  let stage="request";
  let resetToken="";

  const form=wrap.querySelector("#forgotPasswordForm");
  const msgEl=wrap.querySelector("#resetMessage");
  const btn=wrap.querySelector("#resetSubmit");
  const codeGroup=wrap.querySelector("#resetCodeGroup");
  const passwordGroup=wrap.querySelector("#resetPasswordGroup");
  const codeInput=wrap.querySelector("#resetCode");
  const intro=wrap.querySelector("#resetIntro");

  wrap.querySelectorAll("[data-close-reset]").forEach(el=>{
    el.onclick=()=>wrap.remove();
  });
  wrap.querySelector("#resetCancel").onclick=()=>wrap.remove();
  wrap.querySelector("#resetClientId").focus();

  async function postRecovery(payload){
    const response=await fetch(PASSWORD_RECOVERY_ENDPOINT,{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify(payload)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || !data.ok) throw new Error(data.error || "Password recovery request failed.");
    return data;
  }

  form.onsubmit=async e=>{
    e.preventDefault();
    const clientId=wrap.querySelector("#resetClientId").value.trim().toUpperCase();
    const email=wrap.querySelector("#resetEmail").value.trim().toLowerCase();

    try{
      btn.disabled=true;

      if(stage==="request"){
        btn.textContent="Sending code…";
        msgEl.textContent="";
        await postRecovery({action:"requestCode",clientId,email});
        stage="verify";
        codeGroup.hidden=false;
        wrap.querySelector("#resetClientId").disabled=true;
        wrap.querySelector("#resetEmail").disabled=true;
        intro.textContent=`We sent a 6-digit verification code to ${email}.`;
        btn.textContent="Verify Code";
        msgEl.textContent="Check your Gmail inbox, Spam, or Promotions.";
        msgEl.className="client-login-message success";
        codeInput.focus();
        return;
      }

      if(stage==="verify"){
        const code=codeInput.value.trim();
        if(!/^\d{6}$/.test(code)){
          throw new Error("Enter the 6-digit verification code.");
        }
        btn.textContent="Verifying…";
        const result=await postRecovery({action:"verifyCode",clientId,email,code});
        resetToken=result.resetToken;
        stage="reset";
        codeGroup.hidden=true;
        passwordGroup.hidden=false;
        intro.textContent="Verification successful. Create your new private password.";
        btn.textContent="Save New Password";
        msgEl.textContent="";
        wrap.querySelector("#resetNewPassword").focus();
        return;
      }

      const newPassword=wrap.querySelector("#resetNewPassword").value;
      const confirmPassword=wrap.querySelector("#resetConfirmPassword").value;
      if(newPassword.length<8) throw new Error("Your new password must be at least 8 characters.");
      if(newPassword!==confirmPassword) throw new Error("The new passwords do not match.");

      btn.textContent="Saving password…";
      await postRecovery({action:"resetPassword",clientId,email,resetToken,newPassword});
      msgEl.textContent="Password changed successfully. You can now sign in with your new password.";
      msgEl.className="client-login-message success";
      btn.textContent="Return to Login";
      stage="done";
      btn.disabled=false;
      btn.onclick=()=>wrap.remove();
    }catch(err){
      console.error("[PISO WIFI PASSWORD RECOVERY]",err);
      msgEl.textContent=String(err?.message || "Password recovery failed. Please try again.");
      msgEl.className="client-login-message error";
      btn.disabled=false;
      if(stage==="request") btn.textContent="Send 6-Digit Code";
      else if(stage==="verify") btn.textContent="Verify Code";
      else if(stage==="reset") btn.textContent="Save New Password";
    }
  };
}

