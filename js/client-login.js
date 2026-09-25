import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserSessionPersistence,
  signInWithCustomToken
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

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
    message("Enter your registered Gmail and password.", "error");
    return;
  }

  submit.disabled = true;
  submit.textContent = "Signing in…";
  message("Authenticating…");

  try {
    await setPersistence(auth, browserSessionPersistence);

    let cred;

    // Normal path: registered Gmail.
    if (email.includes("@")) {
      cred = await signInWithEmailAndPassword(auth, email, password);
    } else {
      // Compatibility path: also allow the Admin-generated Username / Client ID
      // (for example SandyCID-021 or CID-021) without exposing the customer
      // directory to unauthenticated Firestore reads. The server resolves the
      // identifier and returns a short-lived Firebase custom token only after
      // the password is verified.
      const response = await fetch("/api/client-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: email, password })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.customToken) {
        const code = String(result.error || "INVALID_LOGIN_CREDENTIALS");
        const e = new Error(code);
        e.code = code;
        throw e;
      }
      const userCredential = await signInWithCustomToken(auth, result.customToken);
      cred = userCredential;
    }

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
      `Operation: customer login → ${email}`,
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
    const code = String(err?.code || "");
    let loginMessage = "Invalid login credentials. Use your Registered Gmail, Username, or Client ID with the temporary password provided by Admin.";
    if (code === "CLIENT_ACCOUNT_NOT_FOUND") {
      loginMessage = "Customer account not found. Check your Registered Gmail, Username, or Client ID.";
    } else if (code === "CLIENT_ACCOUNT_NOT_AVAILABLE" || code === "CLIENT_ACCOUNT_MISMATCH") {
      loginMessage = "This Customer Account is inactive or not fully linked. Please contact Admin.";
    }
    message(loginMessage, "error");
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
  if(!clientId||!email){msgEl.textContent="Please enter your Client ID and registered Gmail.";msgEl.className="client-login-message error";return;}
  btn.disabled=true;
  btn.textContent="Sending…";
  msgEl.textContent="Verifying your Client ID and registered Gmail…";
  msgEl.className="client-login-message";

  try{
    // Validation and recovery-request creation are handled server-side.
    // This prevents Firestore Security Rules from returning the generic
    // "Missing or insufficient permissions" error when the credentials do not match.
    const response=await fetch("https://us-central1-piso-wifi-f2b5c.cloudfunctions.net/sendCustomPasswordReset",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({clientCode:clientId,email})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||result.ok!==true){
      throw new Error(result.error||`Password reset request failed (HTTP ${response.status}).`);
    }

    const safeEmail=email.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[c]));
    const card=wrapCard();
    if(card){
      card.innerHTML=`<button type="button" class="client-reset-close" data-close-reset aria-label="Close confirmation">×</button>
        <div class="client-reset-icon success" aria-hidden="true">✓</div>
        <span class="eyebrow">EMAIL SENT</span>
        <h2>Check your email</h2>
        <p class="reset-intro">We sent a secure password-reset link to <b>${safeEmail}</b>.</p>
        <div class="client-reset-note success-note">Open the email and click <b>Reset My Password</b> to create your new private password. If you don't see it shortly, check your Spam or Promotions folder.</div>
        <div class="client-reset-actions"><button class="client-primary" type="button" data-close-reset>Close &amp; Return to Login</button></div>`;
      card.querySelectorAll("[data-close-reset]").forEach(el=>el.onclick=()=>document.querySelector("#forgotPasswordModal")?.remove());
    }
    btn.disabled=true;
    btn.textContent="Reset Email Sent";
  }catch(err){
    const detail=String(err?.message||"Unable to send the password-reset email.").trim();
    const debugDetails=[
      `Client ID entered: ${clientId}`,
      `Registered Gmail entered: ${email}`,
      `Operation: sendCustomPasswordReset`,
      `HTTP status: ${err?.status || "(unknown)"}`,
      `Error code: ${err?.code || "(none)"}`,
      `Error message: ${detail}`
    ].join("\n");
    console.error("[PISO WIFI PASSWORD RESET]",err);
    window.pisoDebug?.capture(detail,{
      type:"PASSWORD RESET ERROR",
      source:"client-login.js → sendCustomPasswordReset",
      operation:"POST /sendCustomPasswordReset",
      context:debugDetails,
      stack:err?.stack||""
    });
    msgEl.textContent=detail;
    msgEl.className="client-login-message error";
    btn.disabled=false;
    btn.textContent="Send Reset Link";
  }
}
