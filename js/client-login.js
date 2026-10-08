console.info("[PISO WIFI] BUILD v79 — customer login, logout, and OTP recovery workflow");
import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc, getDocs, setDoc, addDoc, collection, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

console.info("[PISO WIFI] BUILD v61 — navigation/auth syntax fixed");

const form = document.querySelector("#clientLoginForm");
const msg = document.querySelector("#clientLoginMessage");
const submit = document.querySelector("#clientLoginButton");
const remember = document.querySelector("#clientRememberMe");
const CLIENT_REMEMBER_KEY = "pisoWifi.rememberedUsername";
const CLIENT_LAST_EMAIL_KEY = "pisoWifi.lastCustomerEmail";

function message(text, type = "") {
  msg.textContent = text;
  msg.className = `client-login-message ${type}`.trim();
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

try {
  const justLoggedOut = new URLSearchParams(window.location.search).get("loggedOut") === "1";
  const emailInput = document.querySelector("#clientEmail");
  const passwordInput = document.querySelector("#clientPassword");
  if (justLoggedOut) {
    // Never carry the previous customer session/password into a fresh login.
    if (passwordInput) passwordInput.value = "";
  }
  const savedEmail = localStorage.getItem(CLIENT_LAST_EMAIL_KEY);
  if (savedEmail && emailInput) {
    emailInput.value = savedEmail;
  }
  const savedUnit = localStorage.getItem(CLIENT_REMEMBER_KEY);
  if (remember && savedUnit) remember.checked = true;
} catch {}


async function getRole(user) {
  // Primary source: users/{uid}. If that profile is missing or temporarily
  // unavailable, resolve the customer from the unit explicitly linked to the
  // authenticated Firebase UID. This keeps a valid Auth login from being
  // incorrectly reported as a failed login.
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) return snap.data();
  } catch (e) {
    console.warn("[PISO WIFI CUSTOMER AUTH] users profile lookup failed; using unit fallback.", e);
  }

  try {
    const byUid = await getDocs(query(
      collection(db, "units"),
      where("authUserId", "==", user.uid)
    ));
    const unit = byUid.docs.find(d => d.data()?.active !== false);
    if (unit) {
      const data = unit.data();
      return {
        role: "client",
        active: data?.active !== false,
        clientUnitId: unit.id,
        unitId: unit.id,
        clientCode: data?.clientCode || "",
        username: data?.username || "",
        email: data?.email || user.email || "",
        authEmail: data?.authEmail || user.email || ""
      };
    }
  } catch (e) {
    console.warn("[PISO WIFI CUSTOMER AUTH] authUserId unit lookup failed.", e);
  }

  try {
    const byEmail = await getDocs(query(
      collection(db, "units"),
      where("email", "==", String(user.email || "").trim().toLowerCase())
    ));
    const unit = byEmail.docs.find(d => d.data()?.active !== false);
    if (unit) {
      const data = unit.data();
      return {
        role: "client",
        active: data?.active !== false,
        clientUnitId: unit.id,
        unitId: unit.id,
        clientCode: data?.clientCode || "",
        username: data?.username || "",
        email: data?.email || user.email || "",
        authEmail: data?.authEmail || user.email || ""
      };
    }
  } catch (e) {
    console.warn("[PISO WIFI CUSTOMER AUTH] email unit lookup failed.", e);
  }

  return null;
}

async function routeUser(user) {
  if (!user) return;

  try {
    const profile = await getRole(user);

    if (profile?.role === "client" && profile?.active !== false) {
      try {
        const customerEmail = String(user?.email || profile?.authEmail || profile?.email || "").trim().toLowerCase();
        if (customerEmail) localStorage.setItem(CLIENT_LAST_EMAIL_KEY, customerEmail);
        const rememberedUsername = String(profile?.username || "").trim();
        if (remember?.checked && rememberedUsername) localStorage.setItem(CLIENT_REMEMBER_KEY, rememberedUsername);
        else if (!remember?.checked) localStorage.removeItem(CLIENT_REMEMBER_KEY);
      } catch {}

      window.location.replace("/client/index.html");
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

let logoutGateActive = false;
const logoutUrl = new URLSearchParams(window.location.search).get("loggedOut")==="1";

// After logout, never route a stale Firebase auth callback back into the
// customer dashboard. Keep the gate until Firebase confirms signed-out state.
onAuthStateChanged(auth, async user => {
  const justLoggedOut=sessionStorage.getItem("pisoWifi.justLoggedOut")==="1";
  if(justLoggedOut || logoutUrl || logoutGateActive){
    logoutGateActive = true;
    if(user){
      try{ await signOut(auth); }
      catch(e){ console.warn("[PISO WIFI CUSTOMER LOGOUT] cleanup failed",e); }
      return;
    }
    sessionStorage.removeItem("pisoWifi.justLoggedOut");
    logoutGateActive = false;
    if(logoutUrl){
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
    return;
  }
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
    try {
      // Current accounts use the customer's real registered Gmail.
      cred = await signInWithEmailAndPassword(auth, email, password);
    } catch (primaryErr) {
      // Backward compatibility: older client accounts were provisioned with
      // the synthetic @client-login.pisowifi.local email. If that legacy
      // account still uses the temporary CID password, sign in with it and
      // migrate the Firebase Auth email to the customer's real Gmail.
      const legacyEmail = `${email.split("@")[0].replace(/[^a-z0-9]+/gi, "-").toLowerCase()}@client-login.pisowifi.local`;
      try {
        cred = await signInWithEmailAndPassword(auth, legacyEmail, password);
        const profile = await getRole(cred.user);
        if (profile?.role !== "client" || profile?.active === false) {
          await signOut(auth);
          throw primaryErr;
        }
        try {
          const { updateEmail } = await import("https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js");
          await updateEmail(cred.user, email);
          await setDoc(doc(db, "users", cred.user.uid), { email, authEmail: email, updatedAt: serverTimestamp() }, { merge: true });
          if (profile?.clientUnitId) {
            await setDoc(doc(db, "units", profile.clientUnitId), { authEmail: email, authUserId: cred.user.uid, updatedAt: serverTimestamp() }, { merge: true });
          }
        } catch (migrationErr) {
          console.warn("[PISO WIFI] Legacy login succeeded but email migration was skipped:", migrationErr);
        }
      } catch (legacyErr) {
        throw primaryErr;
      }
    }

    const profile = await getRole(cred.user);

    // Keep the just-used temporary credential for the Customer portal's
    // first-login password setup. The password-change flag lives on the
    // unit record in some account versions, so relying on users/{uid}
    // forcePasswordChange here can leave the dashboard without the
    // temporary credential it needs. Store it for every successful client
    // login, then remove it immediately after the password is changed or
    // when the customer completes a normal login.
    try {
      if (profile?.role === "client" && profile?.active !== false) {
        sessionStorage.setItem("pisoWifi.pendingCurrentPassword", password);
      } else {
        sessionStorage.removeItem("pisoWifi.pendingCurrentPassword");
      }
    } catch {}

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

    window.location.replace("/client/index.html");
  } catch (err) {
    const debugDetails = [
      `Registered Gmail entered: ${email}`,
      `Firebase project: piso-wifi-f2b5c`,
      `Operation: signInWithEmailAndPassword → ${email}`,
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
    const code = err?.code || "";
    const firebaseMessage = String(err?.message || "").replace(/^Firebase:\s*/i, "");
    const detail = code
      ? `Login failed (${code}). ${firebaseMessage || "Please try again."}`
      : `Login failed. ${firebaseMessage || "Please try again."}`;
    message(detail, "error");
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

const APPS_SCRIPT_OTP_URL = "https://script.google.com/macros/s/AKfycbzJcIf9rpdunJ8-1kDvgePWTT1L-cQOFzZLQHFQMaqBYTlviovyxjz4JOX-FpvUrjFu/exec";
let recoveryToken = "";
let recoveryEmail = "";
let recoveryClientId = "";

function esc(v){return String(v??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[c]));}
function recoveryCard(){return document.querySelector("#forgotPasswordModal .client-reset-card");}
function closeRecovery(){document.querySelector("#forgotPasswordModal")?.remove();}

function openForgotPasswordModal(){
  const existing=document.querySelector("#forgotPasswordModal");
  if(existing){existing.remove();}
  const wrap=document.createElement("div");
  wrap.id="forgotPasswordModal";
  wrap.className="client-reset-modal";
  wrap.innerHTML=`
    <div class="client-reset-backdrop" aria-hidden="true"></div>
    <section class="client-reset-card" role="dialog" aria-modal="true" aria-labelledby="forgotTitle" aria-describedby="forgotDescription">
      <button type="button" class="client-reset-close" data-close-reset aria-label="Close account recovery">×</button>
      <div class="client-reset-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M12 14v2"/></svg></div>
      <span class="eyebrow">ACCOUNT RECOVERY</span>
      <h2 id="forgotTitle">Recover your account</h2>
      <p id="forgotDescription" class="reset-intro">Enter your Client ID and registered Gmail. We’ll send a 6-digit verification code to your Gmail.</p>
      <form id="forgotPasswordForm">
        <label class="client-field"><span>Client ID</span><input id="resetClientId" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CID-0014" required></label>
        <label class="client-field"><span>Registered Gmail</span><input id="resetEmail" type="email" autocomplete="email" inputmode="email" placeholder="yourname@gmail.com" required></label>
        <div id="resetMessage" class="client-login-message" role="status" aria-live="polite"></div>
        <div class="client-reset-actions">
          <button class="client-secondary" id="resetCancel" type="button">Cancel</button>
          <button class="client-primary" id="resetSubmit" type="submit">Get OTP</button>
        </div>
        <div class="client-reset-note">The 6-digit code expires in 10 minutes. PISO WIFI will never ask you to share this code.</div>
      </form>
    </section>`;
  document.body.appendChild(wrap);
  wrap.querySelectorAll("[data-close-reset]").forEach(el=>el.onclick=closeRecovery);
  wrap.querySelector("#resetCancel").onclick=closeRecovery;
  wrap.querySelector("#forgotPasswordForm").onsubmit=submitResetRequest;
  wrap.addEventListener("keydown",e=>{if(e.key==="Escape")closeRecovery();});
  wrap.querySelector("#resetClientId").focus();
}

async function callRecovery(payload){
  const res=await fetch("/api/password-recovery",{method:"POST",headers:{"Content-Type":"application/json;charset=utf-8"},body:JSON.stringify(payload),cache:"no-store"});
  const text=await res.text();
  let data={}; try{data=JSON.parse(text);}catch{throw new Error("Invalid recovery response from server.");}
  if(!data.ok) throw new Error(data.error||"Unable to complete account recovery.");
  return data;
}

async function submitResetRequest(e){
  e.preventDefault();
  const clientId=document.querySelector("#resetClientId").value.trim().toUpperCase();
  const email=document.querySelector("#resetEmail").value.trim().toLowerCase();
  const msgEl=document.querySelector("#resetMessage");
  const btn=document.querySelector("#resetSubmit");
  if(!/^CID-\d{3,}$/.test(clientId)||!email){msgEl.textContent="Enter a valid Client ID and registered Gmail.";msgEl.className="client-login-message error";return;}
  btn.disabled=true;btn.textContent="Sending OTP…";msgEl.textContent="Checking your account…";msgEl.className="client-login-message";
  try{
    const result=await callRecovery({action:"requestCode",clientId,email});
    recoveryToken=result.resetToken||result.verificationToken||"";
    recoveryEmail=result.email||email;
    recoveryClientId=clientId;
    closeRecovery();
    openOtpModal(result);
  }catch(err){
    console.error("[PISO WIFI OTP REQUEST]",err);
    msgEl.textContent=err.message||"Unable to send OTP.";
    msgEl.className="client-login-message error";
    btn.disabled=false;btn.textContent="Get OTP";
  }
}

function openOtpModal(result){
  const wrap=document.createElement("div");
  wrap.id="otpModal";wrap.className="client-reset-modal";
  wrap.innerHTML=`
    <div class="client-reset-backdrop" aria-hidden="true"></div>
    <section class="client-reset-card" role="dialog" aria-modal="true" aria-labelledby="otpTitle">
      <button type="button" class="client-reset-close" id="otpClose" aria-label="Close">×</button>
      <div class="client-reset-icon" aria-hidden="true"><span style="font-size:25px;font-weight:900;">#</span></div>
      <span class="eyebrow">EMAIL VERIFICATION</span>
      <h2 id="otpTitle">Enter your 6-digit code</h2>
      <p class="reset-intro">We sent a verification code to <b>${esc(result.email||recoveryEmail)}</b>. The code expires in 10 minutes.</p>
      <form id="otpForm">
        <label class="client-field"><span>6-Digit OTP</span><input id="otpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" placeholder="000000" required></label>
        <div id="otpMessage" class="client-login-message" role="status" aria-live="polite"></div>
        <div class="client-reset-actions"><button class="client-secondary" id="otpCancel" type="button">Cancel</button><button class="client-primary" id="otpVerify" type="submit">Verify OTP</button></div>
        <div class="client-reset-note">Never share your OTP with anyone. We will not ask for it by phone, email, or chat.</div>
      </form>
    </section>`;
  document.body.appendChild(wrap);
  const input=wrap.querySelector("#otpCode");
  input.addEventListener("input",()=>{input.value=input.value.replace(/\\D/g,"").slice(0,6);});
  wrap.querySelector("#otpClose").onclick=()=>wrap.remove();
  wrap.querySelector("#otpCancel").onclick=()=>wrap.remove();
  wrap.querySelector("#otpForm").onsubmit=verifyOtp;
  input.focus();
}

async function verifyOtp(e){
  e.preventDefault();
  const code=document.querySelector("#otpCode").value.replace(/\\D/g,"");
  const msgEl=document.querySelector("#otpMessage");const btn=document.querySelector("#otpVerify");
  if(!/^\\d{6}$/.test(code)){msgEl.textContent="Enter the 6-digit OTP.";msgEl.className="client-login-message error";return;}
  btn.disabled=true;btn.textContent="Verifying…";msgEl.textContent="Verifying your code…";msgEl.className="client-login-message";
  try{
    await callRecovery({action:"verifyCode",clientId:recoveryClientId,email:recoveryEmail,code});
    document.querySelector("#otpModal")?.remove();
    openNewPasswordModal();
  }catch(err){
    msgEl.textContent=err.message||"Invalid or expired OTP.";msgEl.className="client-login-message error";
    btn.disabled=false;btn.textContent="Verify OTP";
  }
}

function openNewPasswordModal(){
  const wrap=document.createElement("div");wrap.id="newPasswordModal";wrap.className="client-reset-modal";
  wrap.innerHTML=`
    <div class="client-reset-backdrop" aria-hidden="true"></div>
    <section class="client-reset-card" role="dialog" aria-modal="true" aria-labelledby="newPasswordTitle">
      <button type="button" class="client-reset-close" id="newPasswordClose" aria-label="Close">×</button>
      <div class="client-reset-icon success" aria-hidden="true">✓</div>
      <span class="eyebrow">VERIFIED</span>
      <h2 id="newPasswordTitle">Create New Password</h2>
      <p class="reset-intro">Your email has been verified. Create a new private password for your PISO WIFI Customer Account.</p>
      <form id="newPasswordForm">
        <label class="client-field"><span>New Password</span><input id="newPasswordValue" type="password" autocomplete="new-password" minlength="8" required></label>
        <label class="client-field"><span>Confirm New Password</span><input id="newPasswordConfirm" type="password" autocomplete="new-password" minlength="8" required></label>
        <div id="newPasswordMessage" class="client-login-message" role="status" aria-live="polite"></div>
        <div class="client-reset-actions"><button class="client-secondary" id="newPasswordCancel" type="button">Cancel</button><button class="client-primary" id="newPasswordSave" type="submit">Save New Password</button></div>
        <div class="client-reset-note">Use at least 8 characters. Do not reuse your temporary password.</div>
      </form>
    </section>`;
  document.body.appendChild(wrap);
  wrap.querySelector("#newPasswordClose").onclick=()=>wrap.remove();
  wrap.querySelector("#newPasswordCancel").onclick=()=>wrap.remove();
  wrap.querySelector("#newPasswordForm").onsubmit=saveNewPassword;
  wrap.querySelector("#newPasswordValue").focus();
}

async function saveNewPassword(e){
  e.preventDefault();
  const password=document.querySelector("#newPasswordValue").value;
  const confirm=document.querySelector("#newPasswordConfirm").value;
  const msgEl=document.querySelector("#newPasswordMessage");const btn=document.querySelector("#newPasswordSave");
  if(password.length<8){msgEl.textContent="Your password must be at least 8 characters.";msgEl.className="client-login-message error";return;}
  if(password!==confirm){msgEl.textContent="The passwords do not match.";msgEl.className="client-login-message error";return;}
  btn.disabled=true;btn.textContent="Updating…";msgEl.textContent="Updating your password…";msgEl.className="client-login-message";
  try{
    await callRecovery({action:"resetPassword",clientId:recoveryClientId,email:recoveryEmail,resetToken:recoveryToken,newPassword:password});
    recoveryToken="";
    wrapSuccessAndReturn();
  }catch(err){
    msgEl.textContent=err.message||"Unable to update your password.";msgEl.className="client-login-message error";
    btn.disabled=false;btn.textContent="Save New Password";
  }
}

function wrapSuccessAndReturn(){
  const wrap=document.querySelector("#newPasswordModal");const card=wrap?.querySelector(".client-reset-card");if(!card)return;
  card.innerHTML=`<div class="client-reset-icon success" aria-hidden="true">✓</div><span class="eyebrow">PASSWORD UPDATED</span><h2>Password updated successfully</h2><p class="reset-intro">Your new password is now active. You can return to the Customer Account login.</p><div class="client-reset-actions" style="grid-template-columns:1fr"><button class="client-primary" type="button" id="recoveryDone">Return to Login</button></div>`;
  card.querySelector("#recoveryDone").onclick=()=>wrap.remove();
  setTimeout(()=>{if(document.querySelector("#newPasswordModal"))wrap.remove();},3500);
}

