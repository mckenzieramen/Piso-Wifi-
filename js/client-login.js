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
      <h2 id="forgotTitle">Recover your account</h2>
      <p id="forgotDescription" class="reset-intro">Enter your Client ID and registered Gmail. We’ll send a secure password-reset link to your registered Gmail.</p>
      <form id="forgotPasswordForm">
        <label class="client-field"><span>Client ID</span><input id="resetClientId" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CID-0001" required></label>
        <label class="client-field"><span>Registered Gmail</span><input id="resetEmail" type="email" autocomplete="email" inputmode="email" placeholder="yourname@gmail.com" required></label>
        <div id="resetMessage" class="client-login-message" role="status" aria-live="polite"></div>
        <div class="client-reset-actions">
          <button class="client-secondary" id="resetCancel" type="button">Cancel</button>
          <button class="client-primary" id="resetSubmit" type="submit">Send Reset Link</button>
        </div>
        <div class="client-reset-note">For your security, your password is never displayed to Admin. The reset link is sent only to the registered Gmail for this Customer Account.</div>
      </form>
    </section>`;
  document.body.appendChild(wrap);
  // Do not close the recovery form when the backdrop is clicked; use the explicit X button.
  wrap.querySelectorAll("[data-close-reset]").forEach(el=>{
    el.onclick=()=>wrap.remove();
  });
  wrap.querySelector("#resetCancel").onclick=()=>wrap.remove();
  wrap.querySelector("#forgotPasswordForm").onsubmit=submitResetRequest;
  wrap.addEventListener("keydown", e=>{ if(e.key==="Escape") wrap.remove(); });
  wrap.querySelector("#resetClientId").focus();
}

async function submitResetRequest(e){
  e.preventDefault();
  const clientId=document.querySelector("#resetClientId").value.trim().toUpperCase();
  const email=document.querySelector("#resetEmail").value.trim().toLowerCase();
  const msgEl=document.querySelector("#resetMessage");
  const btn=document.querySelector("#resetSubmit");
  if(!clientId||!email){msgEl.textContent="Complete all fields.";msgEl.className="client-login-message error";return;}
  btn.disabled=true; btn.textContent="Sending…"; msgEl.textContent="Checking your account…"; msgEl.className="client-login-message";
  try{
    // Send the secure Firebase Auth reset email first. The Firestore request is an audit/notification record;
    // a stale Firestore rule must never prevent the actual password-reset email from being sent.
    const actionCodeSettings={
      url:`${window.location.origin}/reset-password.html`,
      handleCodeInApp:true
    };
    await sendPasswordResetEmail(auth,email,actionCodeSettings);

    // Best-effort recovery notification record for Admin. The email has already been sent if this write fails.
    try{
      await addDoc(collection(db,"passwordResetRequests"),{
        clientCode:clientId,
        email,
        status:"email_sent",
        adminRead:false,
        createdAt:serverTimestamp()
      });
    }catch(recordErr){
      console.warn("[PISO WIFI PASSWORD RESET] Email sent, but recovery notification record could not be saved.",recordErr);
    }

    const safeEmail=email.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[c]));
    const card=wrapCard();
    if(card){
      card.innerHTML=`<button type="button" class="client-reset-close" data-close-reset aria-label="Close confirmation" title="Close">×</button>
        <div class="client-reset-icon success" aria-hidden="true">✓</div>
        <span class="eyebrow">EMAIL SENT</span>
        <h2>Check your email</h2>
        <p class="reset-intro">We sent a secure password-reset link to <b>${safeEmail}</b>.</p>
        <div class="client-reset-note success-note">Open the email and click <b>Reset My Password</b> to create your new private password. If you don't see it shortly, check your Spam or Promotions folder.</div>
        <div class="client-reset-actions"><button class="client-primary" type="button" data-close-reset>Close &amp; Return to Login</button></div>`;
      const closeAndReturnToLogin=()=>{
        wrap.remove();
        // Always return to the official Customer Login route.
        window.location.replace("/");
      };
      // Use delegated click handling so dynamically-created controls always respond.
      wrap.addEventListener("click",(event)=>{
        const closeButton=event.target.closest("[data-close-reset]");
        if(closeButton){
          event.preventDefault();
          event.stopPropagation();
          closeAndReturnToLogin();
        }
      });
      // No automatic close: the customer controls when the confirmation closes.

    }
    function wrapCard(){ return document.querySelector("#forgotPasswordModal .client-reset-card"); }
  }catch(err){
    console.error("[PISO WIFI PASSWORD RESET]",err);
    const code=String(err?.code||"");
    let text="We could not send the reset email. Please verify your Client ID and registered Gmail and try again.";
    if(code.includes("permission-denied")){
      text="The Client ID and registered Gmail do not match our records. Please check both and try again.";
    }else if(code.includes("user-not-found")){
      text="We could not send the reset email. Please verify your registered Gmail and try again.";
    }else if(code.includes("unauthorized-continue-uri")||code.includes("invalid-continue-uri")){
      text="Password reset is not fully configured for this website yet. Please contact Admin.";
    }
    msgEl.textContent=text;
    msgEl.className="client-login-message error";
    btn.disabled=false; btn.textContent="Send Reset Link";
  }
}
