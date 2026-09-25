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

function openForgotPasswordModal(){
  const existing=document.querySelector("#forgotPasswordModal");
  if(existing){ existing.classList.remove("hidden"); existing.querySelector("input")?.focus(); return; }
  const wrap=document.createElement("div");
  wrap.id="forgotPasswordModal";
  wrap.className="client-reset-modal";
  wrap.innerHTML=`
    <div class="client-reset-backdrop" data-close-reset></div>
    <section class="client-reset-card" role="dialog" aria-modal="true" aria-labelledby="forgotTitle">
      <button type="button" class="client-reset-close" data-close-reset aria-label="Close">×</button>
      <span class="eyebrow">ACCOUNT RECOVERY</span>
      <h2 id="forgotTitle">Forgot your password?</h2>
      <p>Enter your Client ID and registered Gmail. We’ll send a secure password-reset link to your registered Gmail.</p>
      <form id="forgotPasswordForm">
        <label class="client-field"><span>Client ID</span><input id="resetClientId" autocomplete="off" placeholder="CID-001" required></label>
        <label class="client-field"><span>Registered Gmail</span><input id="resetEmail" type="email" autocomplete="email" placeholder="yourname@gmail.com" required></label>
        <div id="resetMessage" class="client-login-message" role="status" aria-live="polite"></div>
        <button class="client-primary login-submit" id="resetSubmit" type="submit">Send Reset Link</button>
      </form>
    </section>`;
  document.body.appendChild(wrap);
  // Do not close the recovery form when the backdrop is clicked; use the explicit X button.
  wrap.querySelectorAll("[data-close-reset]").forEach(el=>{
    if(!el.classList.contains("client-reset-backdrop")) el.onclick=()=>wrap.remove();
  });
  wrap.querySelector("#forgotPasswordForm").onsubmit=submitResetRequest;
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
    const response=await fetch("/api/sendCustomPasswordReset",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({clientCode:clientId,email})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||result.ok!==true){
      const error=new Error(result.error||`Password reset request failed (HTTP ${response.status}).`);
      error.status=response.status;
      error.code=result.errorCode||result.code||"(none)";
      throw error;
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
    console.error("[PISO WIFI PASSWORD RESET]",err);
    const detail=String(err?.message||"Unable to send the password-reset email.").trim();
    msgEl.textContent=detail;
    msgEl.className="client-login-message error";
    btn.disabled=false;
    btn.textContent="Send Reset Link";
  }
}
