import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, setPersistence, inMemoryPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, orderBy, onSnapshot, serverTimestamp, arrayUnion } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";
console.info("[PISO WIFI CASHIER] BUILD 2026-10-13-COMBINED-FIXES-1");
const CASHIER_BUILD = "2026-10-13-COMBINED-FIXES-1";
const CASHIER_AUTH_TIMEOUT_MS = 12000;
function withCashierTimeout(promise, label){
  return Promise.race([
    promise,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error(`${label} is taking too long. Check your internet connection and Firestore access, then reload.`)),CASHIER_AUTH_TIMEOUT_MS))
  ]);
}
const app=initializeApp(firebaseConfig,"cashierPortal");const auth=getAuth(app);const db=getFirestore(app);const storage=getStorage(app);
const $=s=>document.querySelector(s);const money=n=>`₱${Number(n||0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}`;const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const CUSTOMER_CACHE_KEY="pisoWifi.cashier.registeredCustomers.v1";
function readCustomerCache(){try{const raw=localStorage.getItem(CUSTOMER_CACHE_KEY);const value=raw?JSON.parse(raw):[];return Array.isArray(value)?value:[]}catch{return []}}
function rememberCustomers(list){try{localStorage.setItem(CUSTOMER_CACHE_KEY,JSON.stringify(list.map(c=>({id:c.id,...c}))));}catch(error){console.warn("[Cashier] Customer cache not available",error)}}
let remittancesReady=false, remittancesLoadFailed=false;
const pendingRemittanceStatuses=new Set(["PENDING ADMIN AUTHORIZATION","PENDING","PENDING ADMIN APPROVAL"]);
function hasPendingRemittance(){return remittances.some(r=>pendingRemittanceStatuses.has(String(r.status||"").toUpperCase()));}
function saleEntryBlocked(){return !remittancesReady||remittancesLoadFailed||hasPendingRemittance();}
let user=null,profile=null,tab="sale",unsubs=[],customerUnsub=null,selectedReceiptTxnId="",receiptAmountsUnlocked=false,remitUnlocked=false,selectedSupportTicketId="",supportMobilePane="inbox",supportSearchTerm="";let supportTicketBuckets={unassigned:[],assigned:[]};let txns=[],chats=[],supportTickets=[],supportTicketFilter="Open",remittances=[],plans=[],customers=readCustomerCache(),customerLoadError="",customerLoadStatus=customers.length?"cached":"loading";
function msg(t,error=true){const el=$("#loginMsg");if(el){el.textContent=t;el.style.color=error?"#d9384a":"#168a52";}}
async function syncCashierRecord(action,transactionDocId){
  const response=await fetch("/api/cashier-sync",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":`Bearer ${await user.getIdToken()}`
    },
    body:JSON.stringify({action,transactionDocId})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result.ok!==true)throw new Error(result.error||"Dashboard sync failed.");
  return result;
}
async function audit(action,recordId,metadata={}){try{await addDoc(collection(db,"audit_logs"),{userId:user.uid,role:"cashier",action,recordId:String(recordId||""),metadata,createdAt:serverTimestamp()})}catch(e){console.warn("Audit log skipped",e)}}
function login(){
  const form=$("#loginForm"), emailField=$("#email"), passwordField=$("#password");
  const submitButton=form?.querySelector('button[type="submit"]');
  const rememberField=$("#cashierRememberMe");
  const CASHIER_REMEMBER_KEY="pisoWifi.cashier.rememberedEmail";
  try { const saved=localStorage.getItem(CASHIER_REMEMBER_KEY); if(saved && emailField){emailField.value=saved;if(rememberField)rememberField.checked=true;} } catch {}

  const originalButtonText=submitButton?.textContent||"Sign in to Cashier";
  const setPending=(pending)=>{
    if(submitButton){submitButton.disabled=!!pending;submitButton.textContent=pending?"Checking account…":originalButtonText;}
    if(emailField)emailField.disabled=!!pending;
    if(passwordField)passwordField.disabled=!!pending;
  };
  const clearAdminAutofill=()=>{
    if(["pisonet@admin.com","admin@pisonet.com"].includes(emailField.value.trim().toLowerCase())){
      emailField.value="";passwordField.value="";
      msg("Please sign in with your Cashier account. Admin accounts cannot sign in here.");
    }
  };
  emailField.setAttribute("autocomplete","username");
  passwordField.setAttribute("autocomplete","current-password");
  clearAdminAutofill();
  emailField.addEventListener("input",clearAdminAutofill);
  form.onsubmit=async e=>{
    e.preventDefault();
    if(submitButton?.disabled)return;
    const email=emailField.value.trim().toLowerCase();
    if(["pisonet@admin.com","admin@pisonet.com"].includes(email)){
      passwordField.value="";
      msg("Admin login is not available on the Cashier portal. Use your Cashier email and password.");
      return;
    }
    if(!email||!passwordField.value){msg("Enter your Cashier email and password.");return;}
    setPending(true);
    msg("Signing in…",false);
    try{
      await signInWithEmailAndPassword(auth,email,passwordField.value);
      try { if(rememberField?.checked)localStorage.setItem(CASHIER_REMEMBER_KEY,email);else localStorage.removeItem(CASHIER_REMEMBER_KEY); } catch {}
      msg("Login verified. Opening Cashier portal…",false);
      // The auth-state handler completes profile verification and renders the portal.
      setTimeout(()=>{
        if(document.body.classList.contains("cashier-login-page") && auth.currentUser){
          setPending(false);
          msg("Your password was accepted, but the Cashier portal did not finish opening. Check the account profile and connection, then try again.");
        }
      },CASHIER_AUTH_TIMEOUT_MS+1000);
    }catch(error){
      const code=String(error?.code||"");
      let message="Unable to sign in. Please try again.";
      if(["auth/invalid-credential","auth/wrong-password","auth/user-not-found","auth/invalid-email"].includes(code)){
        message="Incorrect email or password. Please check your Cashier email and password, then try again.";
      }else if(code==="auth/too-many-requests"){
        message="Too many unsuccessful attempts. Please wait a few minutes before trying again.";
      }else if(code==="auth/network-request-failed"){
        message="Connection problem. Check your internet connection and try again.";
      }else if(code==="auth/user-disabled"){
        message="This Cashier account has been disabled. Please contact the Admin.";
      }else if(code==="auth/operation-not-allowed"){
        message="Email/password sign-in is disabled in Firebase Authentication. Enable it in Firebase Console.";
      }else{
        message=error?.message||message;
      }
      msg(message);
      setPending(false);
    }
  };
  window.__pisoCashierSetLoginPending=setPending;
}
async function loadProfile(u){
  const snap=await withCashierTimeout(getDoc(doc(db,"users",u.uid)),"Cashier profile verification");
  if(!snap.exists())throw new Error("Your login is valid, but the Admin-created Cashier profile was not found. Ask Admin to check this account.");
  const account=snap.data()||{};
  if(String(account.role||"").toLowerCase()!=="cashier")throw new Error("This account is not registered with the Cashier role. Please use the correct Cashier account.");
  if(account.active===false)throw new Error("This Cashier account is inactive. Please contact the Admin.");
  user=u;profile={id:snap.id,...snap.data()};
  const passwordMarker=`pisoWifi.cashier.passwordChanged.${u.uid}`;
  let locallyChanged=false;try{locallyChanged=localStorage.getItem(passwordMarker)==="true";}catch{}
  if(profile.forcePasswordChange!==false && locallyChanged){
    try{await updateDoc(doc(db,"users",u.uid),{forcePasswordChange:false,passwordChangedAt:serverTimestamp()});profile.forcePasswordChange=false;}
    catch(error){console.warn("[Cashier] Password was changed previously; Firestore flag repair will retry later.",error);profile.forcePasswordChange=false;}
  }
  tab="sale";document.body.className="cashier-app";document.body.innerHTML=`<aside class="cashier-sidebar"><div class="cashier-mobile-brand-row"><div class="cashier-brand">PISO WIFI<small>Cashier Portal</small></div><button type="button" id="cashierMenuToggle" class="cashier-menu-toggle" aria-label="Open navigation menu" aria-expanded="false"><span></span><span></span><span></span></button></div><nav class="cashier-nav" id="cashierNav"><button data-tab="sale">Enter Sale</button><button data-tab="service">Customer Service</button><button data-tab="receipt">Receipt</button><button data-tab="remit">Remit</button></nav><button id="logout" class="secondary cashier-logout">Logout</button></aside><main class="cashier-main"><header class="cashier-top"><div><h1 id="title">Cashier Portal</h1><p>Cashier: <b>${esc(profile.name||profile.email||"Cashier")}</b></p><small id="cashierBuildStamp" style="display:block;color:#64748b;margin-top:4px">Build 2026-10-16-CHAT-MOBILE-ENHANCEMENT</small></div><span class="cashier-status">ACTIVE</span></header><section id="view"></section></main>`;$("#logout").onclick=()=>signOut(auth).then(()=>location.reload());$("#cashierMenuToggle").onclick=()=>{const open=document.body.classList.toggle("cashier-menu-open");$("#cashierMenuToggle").setAttribute("aria-expanded",String(open));$("#cashierMenuToggle").setAttribute("aria-label",open?"Close navigation menu":"Open navigation menu")};document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{if(tab==="remit"&&b.dataset.tab!=="remit")remitUnlocked=false;if(tab==="receipt"&&b.dataset.tab!=="receipt")receiptAmountsUnlocked=false;tab=b.dataset.tab;document.body.classList.remove("cashier-menu-open");$("#cashierMenuToggle")?.setAttribute("aria-expanded","false");if(tab!=="service"&&tab!=="support")supportMobilePane="inbox";render()}));if(profile.forcePasswordChange!==false){renderForcePasswordChange();return;}startRealtime();render();}
function renderForcePasswordChange(){
  const host=$("#view");
  if(!host)return;
  host.innerHTML=`<section class="panel" style="max-width:560px;margin:32px auto;padding:24px">
    <h2>Set a New Password</h2>
    <p>Your Admin-issued temporary password must be verified before you can use the Cashier Portal.</p>
    <form id="cashierPasswordChange">
      <label>Current temporary password<input id="currentCashierPassword" type="password" autocomplete="current-password" required></label>
      <label style="display:block;margin-top:12px">New password<input id="newCashierPassword" type="password" minlength="8" autocomplete="new-password" required></label>
      <label style="display:block;margin-top:12px">Confirm new password<input id="confirmCashierPassword" type="password" minlength="8" autocomplete="new-password" required></label>
      <p id="cashierPasswordMsg" class="message" role="status"></p>
      <button class="primary" type="submit">Save New Password</button>
    </form>
  </section>`;
  $("#cashierPasswordChange").onsubmit=async e=>{
    e.preventDefault();
    const current=$("#currentCashierPassword").value;
    const next=$("#newCashierPassword").value;
    const confirmPassword=$("#confirmCashierPassword").value;
    const msgEl=$("#cashierPasswordMsg");
    const button=$("#cashierPasswordChange button[type=submit]");
    if(next.length<8){msgEl.textContent="Use at least 8 characters for your new password.";return;}
    if(next!==confirmPassword){msgEl.textContent="The passwords do not match.";return;}
    if(!user?.email){msgEl.textContent="Your cashier session has expired. Please sign in again.";return;}
    try{
      button.disabled=true;
      msgEl.textContent="Verifying your current password…";
      const credential=EmailAuthProvider.credential(user.email,current);
      await reauthenticateWithCredential(user,credential);
      msgEl.textContent="Saving your new password…";
      await updatePassword(user,next);
      try{localStorage.setItem(`pisoWifi.cashier.passwordChanged.${user.uid}`,"true");}catch{}
      profile.forcePasswordChange=false;
      try{await updateDoc(doc(db,"users",user.uid),{forcePasswordChange:false,passwordChangedAt:serverTimestamp()});}
      catch(ruleError){console.error("[PISO WIFI CASHIER] Password changed but profile flag could not be saved; local one-time marker retained.",ruleError);}
      msgEl.textContent="Password updated. Opening Cashier Portal…";
      startRealtime();
      render();
    }catch(error){
      console.error("[PISO WIFI CASHIER] Password change failed",error);
      if(error?.code==="auth/wrong-password"||error?.code==="auth/invalid-credential"){
        msgEl.textContent="The current temporary password is incorrect. Please check it and try again.";
      }else if(error?.code==="auth/too-many-requests"){
        msgEl.textContent="Too many attempts. Wait a while before trying again.";
      }else if(error?.code==="auth/requires-recent-login"){
        msgEl.textContent="Firebase still requires a fresh sign-in. Log out, sign in again with your current password, then set your new password.";
      }else{
        msgEl.textContent=error?.message||"Could not update password. Please try again.";
      }
    }finally{
      if(button)button.disabled=false;
    }
  };
}
let supportAudioContext=null;
const supportListenerReady={unassigned:false,assigned:false};
const supportSoundKeys=new Map();
function playSupportNotificationSound(){
  try{
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextClass)return;
    supportAudioContext=supportAudioContext||new AudioContextClass();
    if(supportAudioContext.state==='suspended')supportAudioContext.resume().catch(()=>{});
    const ctx=supportAudioContext;
    const now=ctx.currentTime;
    const oscillator=ctx.createOscillator();
    const gain=ctx.createGain();
    oscillator.type='sine';
    oscillator.frequency.setValueAtTime(880,now);
    oscillator.frequency.setValueAtTime(1174.66,now+0.09);
    gain.gain.setValueAtTime(0.0001,now);
    gain.gain.exponentialRampToValueAtTime(0.12,now+0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001,now+0.24);
    oscillator.connect(gain);gain.connect(ctx.destination);
    oscillator.start(now);oscillator.stop(now+0.25);
  }catch(error){console.debug('[Cashier] Notification sound unavailable',error)}
}
function startRealtime(){remittancesReady=false;remittancesLoadFailed=false;unsubs.forEach(f=>f());unsubs=[];supportListenerReady.unassigned=false;supportListenerReady.assigned=false;supportTicketBuckets={unassigned:[],assigned:[]};const mergeSupportTickets=(snapshot,listenerKey)=>{const active=document.activeElement;const typingInComposer=active&&active.id==="cashierSupportInput";const draft=typingInComposer?active.value:"";const start=typingInComposer?active.selectionStart:null;const end=typingInComposer?active.selectionEnd:null;const oldMessages=document.querySelector(".admin-support-messages,.messages");const oldScroll=oldMessages?oldMessages.scrollTop:0;const oldHeight=oldMessages?oldMessages.scrollHeight:0;const oldClient=oldMessages?oldMessages.clientHeight:0;const wasAtBottom=oldMessages?(oldHeight-oldScroll-oldClient<48):true;const incoming=snapshot.docs.map(d=>({id:d.id,...d.data()}));
   if(supportListenerReady[listenerKey]){
     let shouldNotify=false;
     snapshot.docChanges().forEach(change=>{
       if(change.type==='removed')return;
       const ticket={id:change.doc.id,...change.doc.data()};
       if(ticket.lastMessageSender!=='customer')return;
       const messageKey=String(ticket.lastMessageAt||ticket.updatedAt||'')+'|'+String(ticket.lastMessage||'');
       const previous=supportSoundKeys.get(ticket.id);
       if(previous!==messageKey){supportSoundKeys.set(ticket.id,messageKey);shouldNotify=true;}
     });
     if(shouldNotify)playSupportNotificationSound();
   }else{
     incoming.forEach(ticket=>{if(ticket.lastMessageSender==='customer')supportSoundKeys.set(ticket.id,String(ticket.lastMessageAt||ticket.updatedAt||'')+'|'+String(ticket.lastMessage||''));});
     supportListenerReady[listenerKey]=true;
   }
   supportTicketBuckets[listenerKey]=incoming;const byId=new Map();[...supportTicketBuckets.unassigned,...supportTicketBuckets.assigned].forEach(c=>byId.set(c.id,c));supportTickets=[...byId.values()].filter(c=>String(c.assignedRole||"")==="cashier"&&(!c.assignedCashierId||String(c.assignedCashierId)===String(user.uid))).sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));const selectedStillExists=supportTickets.some(c=>c.id===selectedSupportTicketId&&String(c.status||"Open").toLowerCase()===supportTicketFilter.toLowerCase());if(!selectedStillExists){selectedSupportTicketId="";if(cashierSupportMessagesUnsub){cashierSupportMessagesUnsub();cashierSupportMessagesUnsub=null;}cashierSupportThreadMessages=[];supportMobilePane="inbox";}if(tab==="support"||tab==="service"){const thread=document.querySelector(".cashier-support-thread .messages");const shouldPin=!!thread&&selectedStillExists;render();if(shouldPin)requestAnimationFrame(()=>{const next=document.querySelector(".cashier-support-thread .messages");if(next)next.scrollTop=next.scrollHeight;});}else if(!selectedStillExists)render();if(typingInComposer){const next=$("#cashierSupportInput");if(next){next.value=draft;next.focus({preventScroll:true});try{next.setSelectionRange(start,end)}catch(e){}}}};unsubs.push(onSnapshot(query(collection(db,"supportChats"),where("assignedRole","==","cashier"),where("assignedCashierId","==","")),snapshot=>mergeSupportTickets(snapshot,"unassigned"),error=>console.error("Unassigned support inbox listener failed",error)));unsubs.push(onSnapshot(query(collection(db,"supportChats"),where("assignedRole","==","cashier"),where("assignedCashierId","==",user.uid)),snapshot=>mergeSupportTickets(snapshot,"assigned"),error=>console.error("Assigned support inbox listener failed",error)));unsubs.push(onSnapshot(query(collection(db,"cashierTransactions"),where("cashierId","==",user.uid)),s=>{txns=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));if(tab!=="support"&&tab!=="service")render()}));unsubs.push(onSnapshot(query(collection(db,"customerChats"),where("cashierId","==",user.uid)),s=>{chats=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));if(tab!=="support"&&tab!=="service")render()}));unsubs.push(onSnapshot(query(collection(db,"remittances"),where("cashierId","==",user.uid)),s=>{remittances=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));remittancesReady=true;remittancesLoadFailed=false;if(tab!=="support"&&tab!=="service")render()},error=>{console.error("Remittance approval status unavailable",error);remittancesReady=true;remittancesLoadFailed=true;if(tab==="sale")render()}));unsubs.push(onSnapshot(collection(db,"wifi_plans"),s=>{plans=s.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.status==="ACTIVE").sort((a,b)=>Number(a.sortOrder||0)-Number(b.sortOrder||0));if(tab!=="support"&&tab!=="service")render()}));loadRegisteredCustomers().catch(error=>{customerLoadStatus="error";customerLoadError=error?.message||"Could not start customer loading.";console.error("[Cashier] Could not start customer loader:",error);if(tab!=="support"&&tab!=="service")render()});}
async function loadRegisteredCustomers(){
  if(customerUnsub){customerUnsub();customerUnsub=null;}
  customerLoadStatus=customers.length?"cached":"loading";customerLoadError="";if(tab!=="support"&&tab!=="service")render();
  let firstResult=false;
  const timeout=setTimeout(()=>{
    if(!firstResult && customerLoadStatus==="loading"){
      customerLoadStatus="error";
      customerLoadError="Timed out waiting for Firestore. Verify the deployed cashier.js and Firestore access.";
      console.error("[Cashier] Customer loader timed out before first Firestore response.");
      render();
    }
  },10000);
  // Start realtime listener immediately so the customer dropdown is not blocked by a separate fetch.
  customerUnsub=onSnapshot(collection(db,"units"),snapshot=>{
    firstResult=true;clearTimeout(timeout);applyCustomerSnapshot(snapshot);
  },error=>{
    firstResult=true;clearTimeout(timeout);customerLoadStatus=customers.length?"cached":"error";
    customerLoadError=error?.code ? `${error.code}: ${error.message||"Could not read registered customers."}` : (error?.message||"Realtime customer connection failed.");
    console.error("[Cashier] Realtime units listener failed:",error);if(customers.length){customerLoadError="Using saved customer list; live refresh is unavailable.";}if(tab!=="support"&&tab!=="service")render();
  });
  // One-time fetch is supplemental. It has its own timeout and cannot leave the UI loading forever.
  try{
    const result=await Promise.race([
      getDocs(collection(db,"units")),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error("Timed out contacting Firestore while loading units.")),10000))
    ]);
    if(!firstResult){firstResult=true;clearTimeout(timeout);applyCustomerSnapshot(result);}
  }catch(error){
    console.error("[Cashier] Initial units fetch failed:",error);
    if(!firstResult){firstResult=true;clearTimeout(timeout);customerLoadStatus="error";customerLoadError=error?.code?`${error.code}: ${error.message||"Could not read units collection."}`:(error?.message||"Could not load registered customers.");if(tab!=="support"&&tab!=="service")render();}
  }
}
function customerDisplayName(c){
  const full=[c.firstName,c.lastName].filter(Boolean).join(" ").trim();
  return String(c.name||c.fullName||full||c.customerName||c.clientName||c.ownerName||c.unitName||c.accountName||c.displayName||c.clientCode||c.clientId||c.customerId||"Customer").trim();
}
function applyCustomerSnapshot(snapshot){
  customers=snapshot.docs.map(d=>({id:d.id,...d.data()}))
    .filter(c=>c.active!==false && c.type!=="password-reset")
    .sort((a,b)=>customerDisplayName(a).localeCompare(customerDisplayName(b)));
  rememberCustomers(customers);
  customerLoadStatus=customers.length?"loaded":"empty";
  customerLoadError="";
  console.info("[Cashier] Registered customers loaded from units:",customers.length);
  render();
}
function shell(title,sub,body){$("#title").textContent=title;return `<div class="panel"><h2>${title}</h2><p>${sub}</p>${body}</div>`}
function render(){document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));document.body.classList.toggle("cashier-support-active",tab==="service"||tab==="support");if(tab==="service"||tab==="support"){const title=$("#title");if(title)title.textContent="";}const v=$("#view");if(!v)return;const today=new Date().toISOString().slice(0,10);const todayTx=txns.filter(t=>String(t.createdAt?.toDate?t.createdAt.toDate().toISOString():t.createdAt||"").slice(0,10)===today);const pending=txns.filter(t=>t.status==="PENDING ADMIN REVIEW");if(tab==="sale"){const payable=txns.filter(t=>t.status!=="CUSTOMER EARNINGS PAID");v.innerHTML=`<div class="panel"><h2>Enter Sale</h2><p>Choose the registered customer, enter the matching Customer ID and gross sales, then save.</p>${saleEntryBlocked()?`<div class="notice" role="status" style="border:1px solid #f4c58c;background:#fff7ed;color:#92400e;margin:12px 0;padding:14px;border-radius:12px;font-weight:650">${remittancesLoadFailed?"Cannot verify remittance approval. Sales entry is temporarily disabled. Refresh or contact Admin.":!remittancesReady?"Checking your remittance approval status…":"Sales entry is locked: your previous remittance is awaiting Admin approval. Sales entry will reopen automatically after approval."}</div>`:""}<form id="saleForm" class="grid"><div class="field"><label>Customer Account *</label><select id="customerAccount" required><option value="">${customerLoadStatus==="error"?`Customer load failed — see message below`:(customerLoadStatus==="loading"&&!customers.length)?"Loading registered customers…":customers.length?"Select customer":"No active registered customers found in units"}</option>${customers.map(c=>`<option value="${esc(c.id)}">${esc(customerDisplayName(c))}</option>`).join("")}</select>${customerLoadStatus==="error"?`<small role="alert" style="display:block;color:#c62828;margin-top:6px">${esc(customerLoadError)} <button type="button" id="retryCustomers" class="secondary" style="margin-left:8px">Retry loading customers</button></small>`:(customerLoadStatus==="loading"&&!customers.length)?`<small style="display:block;color:#b45309;margin-top:6px">Connecting to registered customer accounts…</small>`:""}</div><div class="field"><label>Unit Code</label><input id="unitCode" readonly placeholder="Auto-filled from account"></div><div class="field"><label>Customer ID *</label><input id="customerVerify" required autocomplete="off" placeholder="Enter Customer ID"></div><div class="field"><label>Gross Sales (₱) *</label><input id="gross" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Date *</label><input id="saleDate" type="date" value="${new Date().toISOString().slice(0,10)}" required></div><div class="field full"><button class="primary" type="submit" ${saleEntryBlocked()?"disabled aria-disabled=\"true\" title=\"Awaiting Admin remittance approval\"":""}>SAVE SALE</button></div></form><div class="cards cashier-payment-summary"><div class="card"><small>Awaiting Customer Payment</small><strong>${money(payable.filter(t=>t.status!=="CUSTOMER EARNINGS PAID").reduce((sum,t)=>sum+Number(t.totalCustomerEarnings||0),0))}</strong></div></div>${shell("Sales History","Pending customer earnings only. Paid transactions move to Receipt History.",`<div class="table-wrap"><table><thead><tr><th>Date / Time</th><th>Customer</th><th>Customer ID</th><th>Gross Sales</th><th>Customer Earnings</th><th>Status</th><th>Action</th></tr></thead><tbody>${txns.filter(t=>t.status!=="CUSTOMER EARNINGS PAID").map(t=>`<tr><td>${esc(t.saleDate||dateTime(t.createdAt))}<br>${esc(dateTime(t.createdAt))}</td><td>${esc(t.customerName||"Customer")}</td><td>${esc(t.customerId||"—")}</td><td><span class="cashier-history-amount" title="Amount hidden in history">${money(t.grossSales)}</span></td><td><span class="cashier-history-amount" title="Amount hidden in history">${money(t.totalCustomerEarnings)}</span></td><td>${esc(t.status||"SAVED")}</td><td><button class="primary" data-pay-earning="${esc(t.id)}">Send Payment</button></td></tr>`).join("")||`<tr><td colspan="7">No pending customer earnings payments.</td></tr>`}</tbody></table></div>`)}</div>`;const csel=$("#customerAccount");csel.onchange=()=>{const c=customers.find(x=>x.id===csel.value);$("#unitCode").value=c?.unitCode||c?.unit_code||c?.code||c?.clientCode||c?.clientId||"";$("#customerVerify").value=""};$("#retryCustomers")?.addEventListener("click",()=>loadRegisteredCustomers());$("#saleForm").onsubmit=saveSale;document.querySelectorAll("[data-pay-earning]").forEach(b=>b.onclick=()=>payCustomerEarnings(b.dataset.payEarning));document.querySelectorAll("[data-send-receipt]").forEach(b=>b.onclick=()=>openReceiptTab(b.dataset.sendReceipt));return;}
if(tab==="collection"){v.innerHTML=`<div class="panel"><h2>Collection</h2><p>This section has been removed. Use Remit to reconcile collected sales.</p></div>`;return;}
if(tab==="receipt"){
  const paid=txns.filter(t=>t.status==="CUSTOMER EARNINGS PAID"&&t.receiptSummary);
  v.innerHTML=shell("Receipt History","Paid receipts. Use Resend Email to send the receipt to the customer's registered email.",`${paid.length?`<div style="display:flex;justify-content:flex-end;margin-bottom:12px"><button type="button" class="secondary" id="receiptAmountsToggle">${receiptAmountsUnlocked?"Hide Amounts":"View Amounts"}</button></div><div class="receipt-list">${paid.map(t=>`<article class="receipt-row"><div class="receipt-meta"><strong class="receipt-customer-name">${esc(t.customerName||"Customer")}</strong><small>${esc(t.receiptSummary.receiptId||t.receiptId||t.transactionId||"")} · ${esc(dateTime(t.receiptSummary.paidAt||t.customerEarningsPaidAt))}</small><small>${esc(t.customerEmail||"No registered customer email saved on this sale")}</small><small class="receipt-email-state ${String(t.receiptEmailStatus||"").toLowerCase()==="sent"?"sent":String(t.receiptEmailStatus||"").toLowerCase()==="failed"?"failed":"pending"}">${String(t.receiptEmailStatus||"").toLowerCase()==="sent"?"Email sent":String(t.receiptEmailStatus||"").toLowerCase()==="failed"?"Email failed — resend available":"Receipt email status not confirmed"}</small></div><div class="receipt-amount"><strong class="blurred-amount ${receiptAmountsUnlocked?"revealed":""}" id="receipt-amount-${esc(t.id)}">${money(t.receiptSummary.amount)}</strong></div><div class="receipt-actions"><button class="primary" data-send-receipt="${esc(t.id)}">Resend Email</button></div></article>`).join("")}</div>`:`<div class="empty">No paid receipts yet. Receipts appear here after a customer earnings payment is recorded.</div>`}`);
  document.querySelectorAll("[data-send-receipt]").forEach(b=>b.onclick=()=>sendReceipt(b.dataset.sendReceipt));
  const amountToggle=$("#receiptAmountsToggle");
  if(amountToggle)amountToggle.onclick=async()=>{
    if(receiptAmountsUnlocked){receiptAmountsUnlocked=false;render();return;}
    const overlay=document.createElement("div");
    overlay.id="receiptAdminVerifyOverlay";
    overlay.style.cssText="position:fixed;inset:0;z-index:99999;background:rgba(5,19,31,.70);backdrop-filter:blur(7px);display:flex;align-items:center;justify-content:center;padding:18px";
    overlay.innerHTML=`<form id="receiptAdminVerifyForm" style="width:min(100%,410px);background:#fff;border-radius:22px;padding:30px;box-shadow:0 26px 90px #0005;border:1px solid #dbeafe;color:#142b43;font-family:inherit">
      <div style="width:48px;height:48px;border-radius:15px;background:#e8f2ff;color:#1565c0;display:grid;place-items:center;font-size:23px;margin-bottom:15px">🔒</div>
      <h2 style="margin:0 0 7px;font-size:22px">Verify Admin Access</h2>
      <p style="margin:0 0 19px;color:#64748b;line-height:1.5;font-size:13px">Enter the administrator password to view all receipt amounts. Your cashier session stays signed in.</p>
      <label for="receiptAdminPassword" style="display:block;font-weight:700;font-size:13px;margin-bottom:7px">Admin password</label>
      <div style="display:flex;gap:7px"><input id="receiptAdminPassword" type="password" autocomplete="off" required placeholder="Enter admin password" style="flex:1;min-width:0;border:1px solid #cbd5e1;border-radius:10px;padding:12px;font-size:15px;color:#142b43;background:white"/><button id="receiptAdminShowPassword" type="button" style="border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;padding:0 12px;color:#334155">Show</button></div>
      <p id="receiptAdminVerifyError" role="alert" style="color:#b91c1c;min-height:18px;font-size:12px;margin:9px 0"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end"><button id="receiptAdminCancel" type="button" style="border:1px solid #cbd5e1;border-radius:10px;background:white;color:#334155;padding:11px 17px">Cancel</button><button id="receiptAdminSubmit" type="submit" style="border:0;border-radius:10px;background:#1675ed;color:white;font-weight:700;padding:11px 17px">Verify & View</button></div>
    </form>`;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove();
    overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
    overlay.querySelector("#receiptAdminCancel").onclick=close;
    overlay.querySelector("#receiptAdminShowPassword").onclick=()=>{const field=overlay.querySelector("#receiptAdminPassword");field.type=field.type==="password"?"text":"password";overlay.querySelector("#receiptAdminShowPassword").textContent=field.type==="password"?"Show":"Hide"};
    overlay.querySelector("#receiptAdminVerifyForm").onsubmit=async e=>{
      e.preventDefault();
      const password=overlay.querySelector("#receiptAdminPassword").value;
      const submit=overlay.querySelector("#receiptAdminSubmit");
      const errorBox=overlay.querySelector("#receiptAdminVerifyError");
      submit.disabled=true;submit.textContent="Verifying…";errorBox.textContent="";
      let verifierApp;
      try{
        verifierApp=initializeApp(firebaseConfig,`receiptAdminVerifier-${Date.now()}`);
        const verifierAuth=getAuth(verifierApp);
        await setPersistence(verifierAuth,inMemoryPersistence);
        const credential=await signInWithEmailAndPassword(verifierAuth,"admin@pisonet.com",password);
        const adminProfile=await getDoc(doc(getFirestore(verifierApp),"users",credential.user.uid));
        if(!adminProfile.exists()||String(adminProfile.data().role||"").toLowerCase()!=="admin")throw new Error("This account is not authorized as an administrator.");
        receiptAmountsUnlocked=true;
        close();
        if(tab==="receipt")render();
      }catch(error){
        console.warn("Receipt admin verification failed:",error?.code||error?.message);
        errorBox.textContent="Verification failed. Check the admin password and account permissions.";
      }finally{
        if(verifierApp)await deleteApp(verifierApp).catch(()=>{});
        if(overlay.isConnected){submit.disabled=false;submit.textContent="Verify & View";overlay.querySelector("#receiptAdminPassword").value="";}
      }
    };
    overlay.querySelector("#receiptAdminPassword").focus();
  };
  
  
  return;
}
 if(tab==="service"||tab==="support"){
   const normalizedSearch=supportSearchTerm.trim().toLowerCase();
   const filteredTickets=supportTickets.filter(c=>{const status=String(c.status||"Open").toLowerCase();const statusMatch=supportTicketFilter==="All"||status===supportTicketFilter.toLowerCase()||(supportTicketFilter==="Closed"&&status==="solved");const haystack=[c.customerName,c.customerEmail,c.clientCode,c.customerId,c.unitCode,c.lastMessage,...(Array.isArray(c.messages)?c.messages.map(m=>m.text):[])].filter(Boolean).join(" ").toLowerCase();return statusMatch&&(!normalizedSearch||haystack.includes(normalizedSearch));});
   const selected=filteredTickets.find(c=>c.id===selectedSupportTicketId)||null;
   const unreadCount=supportTickets.filter(c=>c.unreadForCashier===true).length;
   v.innerHTML=`<section class="panel cashier-service-panel"><header class="cashier-service-heading"><div><span class="cashier-service-eyebrow">SUPPORT CENTER</span><h2>Customer Service</h2></div><div class="cashier-service-live"><span></span> Live inbox <b class="cashier-live-unread">${unreadCount} unread</b></div></header><div class="chat cashier-service-layout ${supportMobilePane==="thread"&&selected?"mobile-thread-active":"mobile-inbox-active"}"><aside class="panel chat-list cashier-support-inbox"><div class="cashier-inbox-heading"><div><h3>Support Inbox</h3><p>${supportTickets.length} total conversation${supportTickets.length===1?"":"s"}</p></div><span class="cashier-inbox-unread">${unreadCount} unread</span></div><label class="cashier-support-search"><span aria-hidden="true">⌕</span><input id="cashierSupportSearch" type="search" value="${esc(supportSearchTerm)}" placeholder="Search customer or Unit ID" autocomplete="off" aria-label="Search customer or Unit ID"><button type="button" id="cashierSupportSearchClear" aria-label="Clear search" ${supportSearchTerm?"":"hidden"}>×</button></label><div class="support-filter-tabs" role="tablist" aria-label="Filter support tickets">${["Open","Solved","Closed","All"].map(f=>{const count=f==="All"?supportTickets.length:supportTickets.filter(c=>String(c.status||"Open").toLowerCase()===f.toLowerCase()).length;return `<button type="button" class="support-filter-tab ${supportTicketFilter===f?"active":""}" data-support-filter="${f}" role="tab" aria-selected="${supportTicketFilter===f}"><span class="support-filter-label">${f}</span><span class="support-filter-count">${count}</span></button>`}).join("")}</div>${filteredTickets.length?filteredTickets.map(c=>`<button type="button" class="chat-item ${c.id===selected?.id?"active":""} ${c.unreadForCashier===true?"has-unread":""}" data-support-ticket="${esc(c.id)}" style="width:100%;text-align:left"><span class="cashier-chat-item-top"><b>${esc(c.customerName||"Customer")}</b>${c.unreadForCashier===true?`<i class="cashier-unread-dot" aria-label="Unread message"></i>`:""}</span><small>${esc(c.assignedCashierName||"Waiting for cashier")} · ${esc(c.status||"Open")}</small><div>${esc(c.lastMessage||c.messages?.at(-1)?.text||"")}</div></button>`).join(""):`<div class="empty">${normalizedSearch?"No matching conversations found.":`No ${supportTicketFilter.toLowerCase()} support conversations.`}</div>`}</aside><section class="panel cashier-support-thread">${selected?`<button type="button" class="cashier-mobile-back" id="cashierSupportBack">← <span>Inbox</span></button>${renderCashierSupportTicket(selected)}`:`<div class="cashier-support-empty"><div class="cashier-support-empty-icon">✦</div><h3>Select a conversation</h3><p>Choose a customer ticket from the inbox to view messages and reply.</p></div>`}</section></div></section>`;
   document.querySelectorAll("[data-support-filter]").forEach(b=>b.onclick=()=>{supportTicketFilter=b.dataset.supportFilter;supportMobilePane="inbox";render()});
   const searchInput=$("#cashierSupportSearch");if(searchInput){searchInput.oninput=()=>{const pos=searchInput.selectionStart;supportSearchTerm=searchInput.value;const before=selectedSupportTicketId;render();const next=$("#cashierSupportSearch");if(next){next.focus({preventScroll:true});try{next.setSelectionRange(pos,pos)}catch(e){}}if(!filteredTickets.some(c=>c.id===before)&&supportMobilePane==="thread")supportMobilePane="inbox";};}
   $("#cashierSupportSearchClear")?.addEventListener("click",()=>{supportSearchTerm="";render();$("#cashierSupportSearch")?.focus()});
   document.querySelectorAll("[data-support-ticket]").forEach(b=>b.onclick=async()=>{selectedSupportTicketId=b.dataset.supportTicket;if(!selectedSupportTicketId)return;supportMobilePane="thread";if(cashierSupportMessagesUnsub){cashierSupportMessagesUnsub();cashierSupportMessagesUnsub=null;}cashierSupportThreadMessages=[];const messageTicketId=selectedSupportTicketId;cashierSupportMessagesUnsub=onSnapshot(query(collection(db,"supportChats",messageTicketId,"messages"),orderBy("createdAt","asc")),snap=>{if(selectedSupportTicketId!==messageTicketId)return;cashierSupportThreadMessages=snap.docs.map(d=>({id:d.id,...d.data()}));const current=supportTickets.find(x=>x.id===messageTicketId);if(current){const box=document.querySelector(".cashier-support-thread .messages");if(box){const oldTop=box.scrollTop,oldHeight=box.scrollHeight,clientHeight=box.clientHeight;const atBottom=true;const temp=document.createElement("div");temp.innerHTML=renderCashierSupportTicket(current);const nextBox=temp.querySelector(".messages");if(nextBox){const wanted=new Set([...nextBox.querySelectorAll("[data-support-message-id]")].map(el=>el.dataset.supportMessageId));if(wanted.size)box.querySelector(".empty")?.remove();box.querySelectorAll("[data-support-message-id]").forEach(el=>{if(!wanted.has(el.dataset.supportMessageId))el.remove();});const have=new Set([...box.querySelectorAll("[data-support-message-id]")].map(el=>el.dataset.supportMessageId));nextBox.querySelectorAll("[data-support-message-id]").forEach(el=>{if(!have.has(el.dataset.supportMessageId))box.appendChild(el.cloneNode(true));});}requestAnimationFrame(()=>{box.scrollTop=atBottom?box.scrollHeight:oldTop;});}}},err=>console.error("Cashier message stream failed",err));const c=supportTickets.find(x=>x.id===selectedSupportTicketId);try{if(c&&!c.assignedCashierId)await updateDoc(doc(db,"supportChats",c.id),{assignedCashierId:user.uid,assignedCashierName:profile.name||profile.displayName||profile.email||"Cashier",assignedRole:"cashier",updatedAt:new Date().toISOString()});await updateDoc(doc(db,"supportChats",selectedSupportTicketId),{unreadForCashier:false,updatedAt:new Date().toISOString()});}catch(e){console.warn("Unable to claim/read support ticket",e)}render()});
   $("#cashierSupportBack")?.addEventListener("click",()=>{supportMobilePane="inbox";render()});
   const input=$("#cashierSupportInput"),send=$("#cashierSupportSend");if(send&&selected)send.onclick=()=>sendCashierSupportMessage(selected.id);if(input&&selected){const pinLatest=()=>{const box=document.querySelector(".cashier-support-thread .messages");if(box)requestAnimationFrame(()=>{box.scrollTop=box.scrollHeight;});};input.addEventListener("focus",pinLatest);input.addEventListener("click",pinLatest);let typingSent=false;input.oninput=()=>{clearTimeout(cashierSupportTypingTimer);if(!typingSent){typingSent=true;setCashierSupportTyping(selected.id,true);}cashierSupportTypingTimer=setTimeout(()=>{typingSent=false;setCashierSupportTyping(selected.id,false);},3000);};input.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendCashierSupportMessage(selected.id)}};}$("#cashierSupportTransfer")?.addEventListener("click",()=>transferSupportTicket(selected?.id));$("#cashierSupportSolve")?.addEventListener("click",()=>setSupportTicketStatus(selected?.id,"Solved"));$("#cashierSupportClose")?.addEventListener("click",()=>setSupportTicketStatus(selected?.id,"Closed"));$("#cashierSupportClaim")?.addEventListener("click",async()=>{if(!selected)return;try{await updateDoc(doc(db,"supportChats",selected.id),{assignedCashierId:user.uid,assignedCashierName:profile.name||profile.displayName||profile.email||"Cashier",assignedRole:"cashier",unreadForCashier:false,updatedAt:new Date().toISOString()});selectedSupportTicketId=selected.id;supportMobilePane="thread";}catch(e){alert(e?.message||"Unable to claim this conversation.")}render()});
   return;
 }
if(tab==="remit"){const pendingRemit=remittances.find(r=>String(r.cashierId||"")===String(user.uid)&&["PENDING ADMIN AUTHORIZATION","PENDING"].includes(String(r.status||"").toUpperCase()));const eligible=pendingRemit?[]:txns.filter(t=>!t.remittanceId&&!t.remittanceApproved&&!t.remittanceFinalized&&!remittances.some(r=>(r.transactionIds||[]).includes(t.id)&&["PENDING ADMIN AUTHORIZATION","PENDING","APPROVED","REMITTED"].includes(String(r.status||"").toUpperCase())));const remitCustomers=new Set(eligible.map(t=>String(t.unitId||t.customerId||t.id)));const totalCustomer=remitCustomers.size;const grossCollected=eligible.reduce((sum,t)=>sum+Number(t.grossSales||0),0);const internetShare=totalCustomer*1000;const ownerElectricityShare=totalCustomer*100;const customerEarnings=(grossCollected*.30)+ownerElectricityShare;const expected=Math.max(0,grossCollected-customerEarnings);v.innerHTML=shell("Remit","Internet and electricity shares are charged once per customer per remittance batch. A batch closes only after Admin approval. Enter the Remit password to unlock this page.",`${remitUnlocked?`${pendingRemit?`<div class="notice">A remittance is awaiting Admin approval. This batch remains open and cannot be submitted again until Admin approves or rejects it.</div>`:""}<div class="remit-sensitive"><div class="cards"><div class="card"><small>Total Customer</small><strong>${totalCustomer}</strong></div><div class="card"><small>Total Gross</small><strong>${money(grossCollected)}</strong></div><div class="card"><small>Total Internet Share (₱1,000/customer)</small><strong>${money(internetShare)}</strong></div><div class="card"><small>Owner Electricity Share (₱100/customer)</small><strong>${money(ownerElectricityShare)}</strong></div><div class="card"><small>Accumulated Customer Earnings (30% + electricity share)</small><strong>${money(customerEarnings)}</strong></div><div class="card"><small>Total Cash on Hand (Expected: Gross − Customer Earnings)</small><strong>${money(expected)}</strong></div></div><form id="remitForm" class="grid"><div class="field"><label>Exact Cash Amount in Hand (₱) *</label><input id="actualRemit" type="number" min="0" step="0.01" required placeholder="Enter exact amount"></div><div class="field"><label>Remitted To / Recipient Name *</label><input id="remittedTo" required placeholder="Name of person receiving cash"></div><div class="field full"><p id="remitVariance" class="notice">Enter the cash amount to calculate Short / Over.</p></div><div class="actions full"><button class="primary" type="submit" ${pendingRemit?"disabled":""}>REMIT NOW</button></div></form>`:`<div class="remit-locked"><div class="remit-blur"><div class="cards"><div class="card"><small>Remittance totals</small><strong>₱••••••</strong></div></div><button class="primary">REMIT NOW</button><h3>Remittance History</h3></div><div class="remit-unlock"><h3>🔒 Unlock Remittance</h3><p>Enter the Remit password to view totals and submit a remittance.</p><form id="remitUnlockForm"><label>Remit Password<input id="remitPassword" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Unlock</button><p id="remitUnlockMsg" class="message"></p></form></div></div>`}<h3>Cashier Remittance History</h3><p class="muted">This history shows only Date & Time Remitted, Remitted To, and Short / Over.</p>${remittances.length?`<div class="table-wrap"><table><thead><tr><th>Date & Time Remitted</th><th>Remitted To</th><th>Short / Over</th></tr></thead><tbody>${remittances.map(r=>{const expected=Number(r.expectedCollection||0);const actual=Number(r.actualRemittance||0);const variance=Number(r.variance??(actual-expected));const varianceLabel=variance<0?`Short ${money(Math.abs(variance))}`:variance>0?`Over ${money(variance)}`:"Balanced";const tone=variance<0?"#dc2626":variance>0?"#2563eb":"#64748b";const approval=String(r.status||"PENDING ADMIN AUTHORIZATION").toUpperCase();const approvalLabel=approval==="APPROVED"?"APPROVED":approval==="REJECTED"?"REJECTED":"PENDING ADMIN APPROVAL";const approvalTone=approval==="APPROVED"?"#15803d":approval==="REJECTED"?"#dc2626":"#b45309";return `<tr><td>${esc(dateTime(r.createdAt))}</td><td>${esc(r.remittedTo||r.recipientName||"—")}</td><td><strong style="color:${tone}">${varianceLabel}</strong></td></tr>`}).join("")}</tbody></table></div>`:`<div class="empty">No remittance history yet. After you submit a remittance, Date & Time Remitted, Remitted To, and Short / Over will appear here.</div>`}`);if(!remitUnlocked){$("#remitUnlockForm").onsubmit=async e=>{e.preventDefault();const msgEl=$("#remitUnlockMsg"),password=$("#remitPassword").value;if(password!=="Admin@owner123"){msgEl.textContent="Incorrect Remit password.";return;}remitUnlocked=true;render()};return;}const amountInput=$("#actualRemit");amountInput.oninput=()=>{const diff=Number(amountInput.value||0)-expected;$("#remitVariance").textContent=amountInput.value===""?"Enter the cash amount to calculate Short / Over.":diff<0?`Short: ${money(Math.abs(diff))}`:diff>0?`Over: ${money(diff)}`:"Balanced: exact amount."};$("#remitForm").onsubmit=async e=>{e.preventDefault();if(pendingRemit){alert("This remittance batch is already awaiting Admin approval. Do not submit it again.");return;}if(!eligible.length){alert("There are no unremitted sales in this batch.");return;}const actual=Number(amountInput.value),recipient=$("#remittedTo").value.trim(),variance=actual-expected;if(!recipient||!Number.isFinite(actual)||actual<0)return;if(!await window.pisoConfirm(`Are you sure you want to submit this remittance?\n\nExpected: ${money(expected)}\nActual cash: ${money(actual)}\nShort / Over: ${variance<0?"Short ":variance>0?"Over ":""}${money(Math.abs(variance))}\nRemitted to: ${recipient}`))return;const id=`REM-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;const ref=await addDoc(collection(db,"remittances"),{remittanceId:id,cashierId:user.uid,cashierName:profile.name||profile.email,transactionIds:eligible.map(t=>t.id),expectedCollection:expected,customerEarningsTotal:customerEarnings,grossCollected,actualRemittance:actual,variance,remittedTo:recipient,recipientName:recipient,status:"PENDING ADMIN AUTHORIZATION",createdAt:serverTimestamp()});await audit("REMIT_REQUESTED",ref.id,{expectedCollection:expected,actualRemittance:actual,variance,remittedTo:recipient});remitUnlocked=false;alert("Remittance request sent to Admin for authorization. Sales will be marked remitted only after Admin approval.");render();};return;}
}
function todayTxGross(){return txns.filter(t=>String(t.createdAt?.toDate?t.createdAt.toDate().toISOString():t.createdAt||"").slice(0,10)===new Date().toISOString().slice(0,10)).reduce((s,t)=>s+Number(t.grossSales||0),0)}
function table(rows,cols){if(!rows.length)return `<div class="empty">No records.</div>`;return `<div class="table-wrap"><table><thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.transactionId||r.remittanceId||r.receiptNumber||r.id)}</td><td>${esc(r.customerName||r.cashierName||"—")}</td><td>${money(r.grossSales??r.expectedCollection??r.amount)}</td><td>${money(r.amountReceived??r.actualRemittance??r.paid??0)}</td><td>${esc(r.paymentMethod||r.variance||r.status||"—")}</td><td>${esc(r.status||"")}</td></tr>`).join("")}</tbody></table></div>`}
function bindTabs(){document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{if(tab==="remit"&&b.dataset.tab!=="remit")remitUnlocked=false;if(tab==="receipt"&&b.dataset.tab!=="receipt")receiptAmountsUnlocked=false;tab=b.dataset.tab;render()}))}
function dateTime(value){try{const d=value?.toDate?value.toDate():value instanceof Date?value:new Date(value);return Number.isNaN(d.getTime())?"—":d.toLocaleString("en-PH")}catch{return "—"}}
function showSaleConfirmation({customerName,customerId,gross,onConfirm,onCancel}){return new Promise(resolve=>{const prior=document.getElementById("saleConfirmOverlay");prior?.remove();const overlay=document.createElement("div");overlay.id="saleConfirmOverlay";overlay.innerHTML=`<style>#saleConfirmOverlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(15,23,42,.48);backdrop-filter:blur(5px);animation:scFade .18s ease-out}#saleConfirmOverlay .sc-card{width:min(100%,460px);background:#fff;border-radius:20px;padding:25px;box-shadow:0 24px 70px rgba(15,23,42,.28);animation:scPop .22s cubic-bezier(.2,.8,.2,1)}#saleConfirmOverlay .sc-head{display:flex;align-items:center;gap:12px;margin-bottom:8px}#saleConfirmOverlay .sc-icon{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:#e8f1ff;color:#185abd;font-size:23px}#saleConfirmOverlay h2{margin:0;font-size:21px;color:#132238}#saleConfirmOverlay .sc-sub{margin:6px 0 18px;color:#64748b;line-height:1.5}#saleConfirmOverlay .sc-row{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid #e8edf4;color:#64748b}#saleConfirmOverlay .sc-row strong{color:#17243a;text-align:right;overflow-wrap:anywhere}#saleConfirmOverlay .sc-total{font-size:20px;color:#167447!important}#saleConfirmOverlay .sc-question{margin:18px 0;color:#334155;line-height:1.5}#saleConfirmOverlay .sc-actions{display:flex;gap:10px;margin-top:22px}#saleConfirmOverlay button{flex:1;border:0;border-radius:11px;padding:12px 14px;font-weight:700;cursor:pointer}#saleConfirmOverlay .sc-cancel{background:#eef2f7;color:#334155}#saleConfirmOverlay .sc-confirm{background:#175cd3;color:white}#saleConfirmOverlay button:disabled{opacity:.6;cursor:wait}@keyframes scFade{from{opacity:0}to{opacity:1}}@keyframes scPop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}@media(prefers-reduced-motion:reduce){#saleConfirmOverlay,#saleConfirmOverlay .sc-card{animation:none}}</style><div class="sc-card" role="dialog" aria-modal="true" aria-labelledby="scTitle"><div class="sc-head"><div class="sc-icon">✓</div><div><h2 id="scTitle">Are you sure?</h2><div style="color:#64748b;font-size:13px;margin-top:3px">Review the sale before saving</div></div></div><p class="sc-sub">Please verify the registered customer and the gross sales amount.</p><div class="sc-row"><span>Customer Name</span><strong>${esc(customerName)}</strong></div><div class="sc-row"><span>Customer ID</span><strong>${esc(customerId)}</strong></div><div class="sc-row"><span>Total Gross Sales</span><strong class="sc-total">${money(gross)}</strong></div><p class="sc-question">Save this sale with the details shown above?</p><div class="sc-actions"><button type="button" class="sc-cancel">Cancel</button><button type="button" class="sc-confirm">Confirm Sale</button></div><p class="sc-error" role="alert" style="display:none;color:#b42318;margin:12px 0 0"></p></div>`;document.body.appendChild(overlay);const cancel=()=>{overlay.remove();resolve(false)};overlay.querySelector('.sc-cancel').onclick=cancel;overlay.addEventListener('click',e=>{if(e.target===overlay)cancel()});overlay.querySelector('.sc-confirm').onclick=async()=>{const btn=overlay.querySelector('.sc-confirm'),err=overlay.querySelector('.sc-error');btn.disabled=true;btn.textContent='Saving…';overlay.querySelector('.sc-cancel').disabled=true;try{await onConfirm();overlay.remove();resolve(true)}catch(e){err.style.display='block';err.textContent=e?.message||'Could not save this sale. Please try again.';btn.disabled=false;btn.textContent='Try Again';overlay.querySelector('.sc-cancel').disabled=false}};overlay.querySelector('.sc-cancel').focus()})}
async function saveSale(e){
  e.preventDefault();
  if(saleEntryBlocked()){alert("Sales entry is locked until Admin approves your previous remittance (or the approval status can be verified).");return;}
  const customer=customers.find(c=>c.id===$("#customerAccount").value);
  if(!customer){alert("Select a customer account created by Admin.");return;}
  const customerName=customerDisplayName(customer);
  const expectedId=String(customer.clientCode||customer.clientId||customer.customerId||customer.customerCode||customer.clientID||customer.customerID||"").trim();
  if(!expectedId){alert("This customer record has no registered Customer ID. Ask Admin to correct the customer profile before recording a sale.");return;}
  const enteredRaw=$("#customerVerify").value.trim();
  if(!enteredRaw||enteredRaw.toLowerCase()!==expectedId.toLowerCase()){
    alert("Customer ID does not match the selected customer. Please verify the ID before continuing.");
    $("#customerVerify").focus();return;
  }
  const gross=Number($("#gross").value);
  if(!(gross>0)){alert("Gross sales must be greater than zero.");return;}
  const saleDate=$("#saleDate").value;
  if(!saleDate){alert("Please select the sale date.");return;}
  await showSaleConfirmation({customerName,customerId:expectedId,gross,onConfirm:async()=>{
    if(saleEntryBlocked())throw new Error("Sales entry is locked until Admin approves your previous remittance.");
    const id=`TXN-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
    const clientShare=gross*.30;
    const openBatchTxns=txns.filter(t=>!t.remittanceApproved&&!t.remittanceFinalized&&!t.remittanceId&&!remittances.some(r=>(r.transactionIds||[]).includes(t.id)&&["APPROVED","REMITTED"].includes(String(r.status||"").toUpperCase())));
    // A customer is charged the fixed Internet fee and receives the owner electricity
    // share once per unapproved remittance batch, not once per sales entry.
    const customerHasOpenSale=openBatchTxns.some(t=>String(t.unitId||t.customerId)===String(customer.id)||String(t.customerId||"")===String(expectedId));
    const internetFee=customerHasOpenSale?0:1000;
    const electricity=customerHasOpenSale?0:100;
    const customerTotal=clientShare+electricity;
    const now=new Date();
    // Persist the sale first, but never label dashboard sync as complete before the API confirms it.
    const saleRef=await addDoc(collection(db,"cashierTransactions"),{
      transactionId:id,cashierId:user.uid,cashierName:profile.name||profile.email,
      customerId:expectedId,unitId:customer.id,unitCode:customer.unitCode||"",customerName,
      customerEmail:customer.email||customer.emailAddress||customer.contactEmail||customer.gmail||"",
      grossSales:gross,internetFee,ownerPercent:70,clientPercent:30,
      ownerShare:gross*.70,clientShare,electricityShare:electricity,totalCustomerEarnings:customerTotal,
      saleDate,recordedAt:now.toISOString(),status:"AWAITING CUSTOMER EARNINGS PAYMENT",
      cashierLocked:true,dashboardSalesSyncStatus:"PENDING",createdAt:serverTimestamp()
    });
    await audit("SALE_CREATED",id,{grossSales:gross,customerId:expectedId,totalCustomerEarnings:customerTotal,saleDate});
    try{
      await syncCashierRecord("sale",saleRef.id);
      alert("Sale saved and dashboard synchronization confirmed. Customer and Admin totals should update automatically.");
    }catch(syncError){
      console.error("[PISO WIFI CASHIER] Sale saved but dashboard sync was not confirmed",syncError);
      try{await updateDoc(doc(db,"cashierTransactions",saleRef.id),{dashboardSalesSyncStatus:"FAILED"});}catch(statusError){console.warn("Could not mark sale sync as failed",statusError);}
      alert("Sale was saved, but the Admin/Customer dashboard sync was NOT confirmed. Do not enter this sale again. Check the Cloudflare /api/cashier-sync configuration and retry after the sync issue is fixed. Details: "+(syncError?.message||syncError));
    }
    render();
  }});
}
function confirmEarningsPayment(t){return new Promise(resolve=>{document.getElementById("earningsPaymentOverlay")?.remove();const overlay=document.createElement("div");overlay.id="earningsPaymentOverlay";overlay.style.cssText="position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.58)";overlay.innerHTML=`<div role="dialog" aria-modal="true" style="width:min(100%,480px);background:#fff;border-radius:18px;padding:24px;box-shadow:0 24px 70px #0003;color:#132238"><h2 style="margin:0 0 8px">Confirm Customer Earnings Payment</h2><p style="color:#64748b;margin:0 0 18px">Review the amount and enter the customer's full registered name as acknowledgment.</p><div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e5e7eb"><span>Customer</span><strong id="epExpected">${esc(t.customerName||"")}</strong></div><div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e5e7eb"><span>Customer Earnings</span><strong style="color:#16834a;font-size:20px">${money(t.totalCustomerEarnings)}</strong></div><label style="display:block;margin-top:18px;font-weight:700">Customer full name signature<input id="epSignature" autocomplete="off" style="display:block;width:100%;box-sizing:border-box;margin-top:7px;padding:12px;border:1px solid #cbd5e1;border-radius:10px" placeholder="Type registered full name" required></label><p id="epError" style="display:none;color:#b42318;margin:8px 0 0" role="alert"></p><div style="display:flex;gap:10px;margin-top:20px"><button id="epCancel" type="button" style="flex:1;padding:12px;border:0;border-radius:10px;background:#eef2f7;font-weight:700">Cancel</button><button id="epConfirm" type="button" style="flex:1;padding:12px;border:0;border-radius:10px;background:#175cd3;color:#fff;font-weight:700">Confirm Payment</button></div><small style="display:block;color:#64748b;margin-top:12px">Typed name is an acknowledgment and is not identity-verified.</small></div>`;document.body.appendChild(overlay);const finish=v=>{overlay.remove();resolve(v)};overlay.querySelector("#epCancel").onclick=()=>finish(null);overlay.addEventListener("click",e=>{if(e.target===overlay)finish(null)});overlay.querySelector("#epConfirm").onclick=()=>{const value=overlay.querySelector("#epSignature").value.trim(),expected=String(t.customerName||"").trim(),err=overlay.querySelector("#epError");if(!value||value.localeCompare(expected,undefined,{sensitivity:"accent"})!==0){err.textContent="Please enter the customer's registered full name exactly as shown.";err.style.display="block";return;}finish(value)};overlay.querySelector("#epSignature").focus()})}
async function payCustomerEarnings(id){
  const t=txns.find(x=>x.id===id);
  if(!t||t.status==="CUSTOMER EARNINGS PAID")return;
  const signatureName=await confirmEarningsPayment(t);if(!signatureName)return;
  const button=document.querySelector(`[data-pay-earning="${CSS.escape(id)}"]`);
  if(button){button.disabled=true;button.textContent="Saving payment…";}
  const receiptId=`REC-${Date.now()}`;
  const receipt={receiptId,transactionId:t.transactionId,customerName:t.customerName,customerId:t.customerId||"",unitCode:t.unitCode,amount:Number(t.totalCustomerEarnings||0),grossSales:Number(t.grossSales||0),status:"PAID",paidAt:new Date().toISOString(),cashierId:user.uid,cashierName:profile.name||profile.email};
  try{
    // Persist the transaction first. If Firestore rejects it, do not show a success message.
    await updateDoc(doc(db,"cashierTransactions",id),{
      status:"CUSTOMER EARNINGS PAID",
      customerEarningsPaid:true,
      customerEarningsPaidAt:serverTimestamp(),
      customerEarningsPaidBy:user.uid,
      customerEarningsAcknowledgedBy:signatureName,
      customerEarningsAcknowledgedAt:serverTimestamp(),
      dashboardPaymentSyncStatus:"PENDING",
      receiptId,
      receiptSummary:receipt
    });
    try{
      await addDoc(collection(db,"receipts"),{...receipt,createdAt:serverTimestamp(),receiptType:"CUSTOMER_EARNINGS",visibility:"SUMMARY_ONLY"});
    }catch(receiptError){
      console.error("[PISO WIFI CASHIER] Payment saved but receipt document creation failed",receiptError);
      alert("Payment status was saved, but the receipt record could not be created: "+(receiptError?.message||receiptError));
    }
    let dashboardPaymentSyncError=null;
    try{
      await syncCashierRecord("payment",id);
    }catch(syncError){
      dashboardPaymentSyncError=syncError;
      console.error("[PISO WIFI CASHIER] Payment saved but dashboard payment sync was not confirmed",syncError);
      try{await updateDoc(doc(db,"cashierTransactions",id),{dashboardPaymentSyncStatus:"FAILED"});}catch(statusError){console.warn("Could not mark payment sync as failed",statusError);}
    }
    await audit("CUSTOMER_EARNINGS_PAID",id,{amount:receipt.amount,receiptId});
    const receiptTxn={...t,id,receiptId,receiptSummary:receipt,status:"CUSTOMER EARNINGS PAID"};
    let emailError=null;
    try{await sendReceiptEmailForTransaction(receiptTxn);try{await updateDoc(doc(db,"cashierTransactions",id),{receiptEmailStatus:"SENT",receiptEmailSentAt:serverTimestamp(),receiptEmailError:""});}catch(statusError){console.warn("[PISO WIFI CASHIER] Could not update receipt email status",statusError);}}
    catch(error){emailError=error;console.error("[PISO WIFI CASHIER] Receipt email failed",error);try{await updateDoc(doc(db,"cashierTransactions",id),{receiptEmailStatus:"FAILED",receiptEmailError:String(error?.message||error),receiptEmailAttemptedAt:serverTimestamp()});}catch(statusError){console.warn("[PISO WIFI CASHIER] Could not save receipt email failure status",statusError);}}
    let message=`Payment status saved for ${t.customerName}. Receipt: ${receiptId}.`;
    if(!emailError)message+=` Receipt email sent to ${receiptTxn.customerEmail}.`;
    else message+=` Receipt email was NOT sent. Open the Receipt category and select Resend Email. Reason: ${emailError.message}`;
    if(dashboardPaymentSyncError) message+=" Dashboard payment sync was NOT confirmed. Do not record this payment again. Check /api/cashier-sync and retry synchronization after the endpoint is fixed. Reason: "+(dashboardPaymentSyncError?.message||dashboardPaymentSyncError);
    else message+=" Admin and Customer dashboard payment synchronization confirmed.";
    alert(message);
    render();
  }catch(error){
    console.error("[PISO WIFI CASHIER] Could not save customer earnings payment",error);
    const code=String(error?.code||"");
    let detail=error?.message||String(error);
    if(code==="permission-denied")detail="Firebase rejected the payment update (permission-denied). Confirm that the updated firestore.rules is published to the same Firebase project and that this Cashier account is active and owns this sale.";
    alert("PAYMENT WAS NOT CONFIRMED. "+detail);
  }finally{
    if(button){button.disabled=false;button.textContent="Send Payment";}
  }
}
function openReceiptTab(id){selectedReceiptTxnId=id;tab="receipt";render();}
function receiptHtml(t){const r=t.receiptSummary||{};return `<!doctype html><html><body style="margin:0;background:#f2f5fa;font-family:Arial,sans-serif;color:#18243a;padding:24px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #dce4ef"><div style="background:#0b2345;color:#fff;padding:24px"><h1 style="margin:0;font-size:22px">PISO WIFI</h1><p style="margin:6px 0 0;color:#c8dcfa">Payment Receipt</p></div><div style="padding:24px"><p>Hello ${esc(t.customerName||"Customer")},</p><p>Your customer earnings payment has been recorded. Please keep this receipt for your records.</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:10px;border-bottom:1px solid #eee">Receipt No.</td><td style="padding:10px;border-bottom:1px solid #eee;text-align:right"><b>${esc(r.receiptId||t.receiptId||"")}</b></td></tr><tr><td style="padding:10px;border-bottom:1px solid #eee">Customer</td><td style="padding:10px;border-bottom:1px solid #eee;text-align:right">${esc(t.customerName||"")}</td></tr><tr><td style="padding:10px;border-bottom:1px solid #eee">Customer ID</td><td style="padding:10px;border-bottom:1px solid #eee;text-align:right">${esc(t.customerId||"")}</td></tr><tr><td style="padding:10px;border-bottom:1px solid #eee">Amount Paid</td><td style="padding:10px;border-bottom:1px solid #eee;text-align:right"><b>${money(r.amount)}</b></td></tr><tr><td style="padding:10px;border-bottom:1px solid #eee">Payment Date</td><td style="padding:10px;border-bottom:1px solid #eee;text-align:right">${esc(dateTime(r.paidAt||t.customerEarningsPaidAt))}</td></tr><tr><td style="padding:10px">Status</td><td style="padding:10px;text-align:right;color:#168a52"><b>PAID</b></td></tr></table><p style="margin-top:24px">Thank you,<br><b>PISO WIFI Team</b></p></div></div></body></html>`}
function viewReceipt(id){const t=txns.find(x=>x.id===id);if(!t||!t.receiptSummary)return alert("Receipt is not available.");const w=window.open("","_blank","noopener,noreferrer,width=700,height=800");if(!w)return alert("Please allow pop-ups to view the receipt.");w.document.write(receiptHtml(t));w.document.close()}
async function sendReceiptEmailForTransaction(t){
  if(!t||!t.receiptSummary)throw new Error("Receipt is not available.");
  if(!t.customerEmail||!String(t.customerEmail).includes("@"))throw new Error("No valid registered customer email is saved on this sale. Admin must correct the customer email before sending.");
  const response=await fetch("/api/send-receipt",{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${await user.getIdToken()}`},
    body:JSON.stringify({
      to:t.customerEmail,
      subject:`PISO WIFI Payment Receipt ${t.receiptSummary.receiptId||t.receiptId||""}`,
      html:receiptHtml(t),
      receiptId:t.receiptSummary.receiptId||t.receiptId||"",
      transactionId:t.transactionId||""
    })
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result.ok!==true)throw new Error(result.error||"Receipt email service is not configured.");
  await audit("RECEIPT_EMAIL_SENT",t.id||t.transactionId,{to:t.customerEmail,receiptId:t.receiptSummary.receiptId||t.receiptId||""});
  return true;
}
async function sendReceipt(id){
  const t=txns.find(x=>x.id===id);
  if(!t||!t.receiptSummary)return alert("Receipt is not available.");
  const button=document.querySelector(`[data-send-receipt="${CSS.escape(id)}"]`);
  if(button){button.disabled=true;button.textContent="Sending…";}
  try{
    await sendReceiptEmailForTransaction(t);
    alert(`Receipt sent to ${t.customerEmail}.`);
  }catch(e){
    alert(`Receipt email was not sent. ${e.message}`);
  }finally{
    if(button){button.disabled=false;button.textContent="Resend Email";}
  }
}
async function saveReceipt(e){e.preventDefault();const file=$("#rFile").files[0];if(!file)throw new Error("Receipt file is required.");const id=`REC-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;const path=`receipts/${user.uid}/${id}/${file.name}`;const snap=await uploadBytes(ref(storage,path),file);const url=await getDownloadURL(snap.ref);await addDoc(collection(db,"receipts"),{receiptId:id,receiptNumber:$("#rNumber").value.trim(),transactionId:$("#rTxn").value.trim(),customerName:$("#rCustomer").value.trim(),amount:Number($("#rAmount").value),paymentMethod:$("#rMethod").value,referenceNumber:$("#rRef").value.trim(),storagePath:path,receiptUrl:url,cashierId:user.uid,cashierName:profile.name||profile.email,notes:$("#rNotes").value.trim(),createdAt:serverTimestamp()});await audit("RECEIPT_UPLOADED",id,{amount:Number($("#rAmount").value)});alert("Receipt registered.");tab="receipt";render()}
function renderCashierSupportTicket(c){const legacy=Array.isArray(c.messages)?c.messages:[];const merged=new Map();[...legacy,...cashierSupportThreadMessages].forEach((m,i)=>merged.set(String(m.id||`${m.senderType||"system"}|${m.createdAt||""}|${m.text||""}|${i}`),m));const messages=[...merged.values()].sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||"")));const claimed=String(c.assignedCashierId||"")===String(user.uid);return `<div class="admin-chat-head piso-support-chat-head"><div class="piso-support-customer-title"><h3>${esc(c.customerName||"Customer")}</h3><small class="piso-support-assignee">Assignee: <b>${esc(c.assignedCashierName||(claimed?(profile.name||profile.email):"Not assigned"))}</b></small></div><div class="piso-support-head-actions"><span class="piso-ticket-status status-${esc(String(c.status||"Open").toLowerCase())}">${esc(c.status||"Open")}</span>${claimed&&!["solved","closed"].includes(String(c.status||"").toLowerCase())?`<button type="button" class="piso-ticket-action solved" id="cashierSupportSolve" title="Mark ticket as solved"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span>Solved</span></button><button type="button" class="piso-ticket-action closed" id="cashierSupportClose" title="Close ticket"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg><span>Closed</span></button><button type="button" class="piso-transfer-premium" id="cashierSupportTransfer" title="Transfer ticket to Admin" aria-label="Transfer ticket to Admin"><span class="piso-transfer-logo" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h14l-3-3M20 17H6l3 3"/><path d="m15 4 3 3-3 3M9 14l-3 3 3 3"/></svg></span><span class="piso-transfer-label">Transfer</span></button>`:""}</div></div><div class="messages" style="min-height:240px;max-height:48vh;overflow:auto">${messages.map(m=>{const who=m.senderType==="customer"?(c.customerName||"Customer"):m.senderType==="cashier"?(m.senderName||c.assignedCashierName||"Cashier"):m.senderType==="admin"?"Piso Net Admin":"Customer Service";const stableId=String(m.id||`${m.senderType||"system"}|${m.createdAt||""}|${m.text||""}`);return `<div class="bubble ${m.senderType==="cashier"&&m.senderId===user.uid?"me":""}" data-support-message-id="${esc(stableId)}"><div>${esc(m.text||"")}</div><small>${esc(who)} · ${esc(dateTime(m.createdAt))}</small></div>`}).join("")||`<div class="empty">No messages yet.</div>`}${c.typingBy?.customer?`<div class="typing-indicator cashier-customer-typing"><span></span><span></span><span></span> Customer is typing…</div>`:""}</div>${["solved","closed"].includes(String(c.status||"").toLowerCase())?`<div class="support-closed-ticket-notice">${esc(String(c.status||"Closed"))} Ticket · Conversation is read-only.</div>`:claimed?`<div class="chat-compose"><textarea id="cashierSupportInput" placeholder="Reply as ${esc(profile.name||"Cashier")}…"></textarea><button class="primary" id="cashierSupportSend">Send</button></div>`:`<div class="notice">Claim this conversation to handle it as ${esc(profile.name||profile.email||"Cashier")}.</div><button class="primary" id="cashierSupportClaim">Handle this conversation</button>`}`}
let cashierSupportTypingTimer=null;
let cashierSupportMessagesUnsub=null;
let cashierSupportThreadMessages=[];
async function setCashierSupportTyping(id,on){if(!id)return;try{await updateDoc(doc(db,"supportChats",id),{"typingBy.cashier":!!on});}catch(e){}}
async function sendCashierSupportMessage(id){const input=$("#cashierSupportInput"),text=String(input?.value||"").trim();if(!id||!text)return;const current=supportTickets.find(c=>c.id===id);if(["solved","closed"].includes(String(current?.status||"").toLowerCase())){alert("This ticket is "+String(current.status).toLowerCase()+". Reopen it or start a new conversation before replying.");return;}try{clearTimeout(cashierSupportTypingTimer);const now=new Date().toISOString();await addDoc(collection(db,"supportChats",id,"messages"),{senderType:"cashier",senderId:user.uid,senderName:profile.name||profile.displayName||profile.email||"Cashier",text,createdAt:now});await updateDoc(doc(db,"supportChats",id),{lastMessage:text,lastMessageSender:"cashier",lastMessageAt:now,updatedAt:now,unreadForCustomer:true,unreadForCashier:false,"typingBy.cashier":false,assignedRole:"cashier",assignedCashierId:user.uid,assignedCashierName:profile.name||profile.displayName||profile.email||"Cashier"});input.value="";requestAnimationFrame(()=>{const box=document.querySelector(".cashier-support-thread .messages");if(box)box.scrollTop=box.scrollHeight;input.focus({preventScroll:true});});}catch(e){alert(e?.message||"Unable to send support reply.")}}
async function setSupportTicketStatus(id,status){
  if(!id)return;
  const prompt=String(status).toLowerCase()==="closed"?"Close this ticket? The customer will no longer be able to reply in this conversation.":"Mark this ticket as solved? The customer will no longer be able to reply in this conversation.";
  if(!await window.pisoConfirm(prompt))return;
  try{
    const now=new Date().toISOString();
    const farewell="Thank you for contacting us. You are welcome to contact us again if you have any concerns.";
    // Keep the final notice in the ticket itself so the customer sees it even
    // after the ticket becomes read-only; do not write a message after closure.
    await updateDoc(doc(db,"supportChats",id),{status,updatedAt:now,lastMessage:farewell,lastMessageAt:now,unreadForCashier:false,unreadForCustomer:true,"typingBy.cashier":false,"typingBy.customer":false,messages:arrayUnion({senderType:"system",text:farewell,createdAt:now,kind:"ticket-closed"})});
    selectedSupportTicketId="";supportMobilePane="inbox";render();
  }catch(e){alert(e?.message||"Unable to update ticket status. Check Firestore permissions.");}
}

async function transferSupportTicket(id){if(!id||!await window.pisoConfirm("Are you sure you want to transfer this ticket to the Admin? It will immediately disappear from your Cashier inbox."))return;try{const now=new Date().toISOString();/* Write the handoff message while cashier still has message-create permission. */await addDoc(collection(db,"supportChats",id,"messages"),{senderType:"system",text:`Conversation transferred to Piso Net Admin by ${profile.name||profile.displayName||profile.email||"Cashier"}.`,createdAt:now});await updateDoc(doc(db,"supportChats",id),{assignedRole:"admin",assignedCashierId:"",assignedCashierName:"",transferredToAdmin:true,transferredAt:now,transferredBy:user.uid,transferredByName:profile.name||profile.displayName||profile.email||"Cashier",updatedAt:now,unreadForAdmin:true,unreadForCashier:false,"typingBy.cashier":false});/* Activity collection is admin-only; do not let an optional audit write fail an already completed transfer. */supportTickets=supportTickets.filter(c=>c.id!==id);if(selectedSupportTicketId===id)selectedSupportTicketId="";supportMobilePane="inbox";render();}catch(e){alert(e?.message||"Unable to transfer conversation to Admin. Please check Firestore permissions.")}}

function renderChat(){const c=chats.find(x=>x.id===window.selectedChat)||chats[0];if(!c)return `<div class="empty">Start a customer service conversation by selecting a customer.</div>`;return `<h3>${esc(c.customerName||"Customer")}</h3><div class="messages">${(c.messages||[]).map(m=>`<div class="bubble ${m.senderId===user.uid?"me":""}">${esc(m.text)}<small>${esc(m.senderRole||"")}</small></div>`).join("")}</div><div class="chat-compose"><textarea id="chatInput" placeholder="Reply…"></textarea><button class="primary" id="chatSend">Send</button><button class="danger" id="transferChat">Transfer to Admin</button></div>`}
async function sendChat(){const c=chats.find(x=>x.id===window.selectedChat);const text=$("#chatInput").value.trim();if(!c||!text)return;await updateDoc(doc(db,"customerChats",c.id),{messages:arrayUnion({senderId:user.uid,senderRole:"cashier",text,createdAt:new Date().toISOString()}),lastMessage:text,lastMessageSender:"cashier",updatedAt:serverTimestamp(),status:"IN PROGRESS"});await audit("CHAT_MESSAGE",c.id);$("#chatInput").value=""}
async function transferChat(){const c=chats.find(x=>x.id===window.selectedChat);if(!c)return;if(!await window.pisoConfirm("Transfer this concern to Admin?"))return;await updateDoc(doc(db,"customerChats",c.id),{status:"TRANSFERRED TO ADMIN",transferredAt:serverTimestamp(),transferredBy:user.uid,updatedAt:serverTimestamp()});await audit("CHAT_TRANSFERRED",c.id);alert("Conversation transferred to Admin.")}
async function requestRemit(eligible,total){if(!await window.pisoConfirm(`Request Admin authorization for ${money(total)}?`))return;const id=`REM-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;const ref=await addDoc(collection(db,"remittances"),{remittanceId:id,cashierId:user.uid,cashierName:profile.name||profile.email,transactionIds:eligible.map(t=>t.id),expectedCollection:total,actualRemittance:0,variance:0,status:"PENDING ADMIN AUTHORIZATION",createdAt:serverTimestamp()});await Promise.all(eligible.map(t=>updateDoc(doc(db,"cashierTransactions",t.id),{remittanceId:ref.id})));await audit("REMIT_STARTED",ref.id,{expectedCollection:total});alert("Remittance sent to Admin for authorization. It cannot be finalized by the cashier.");render()}
document.addEventListener("visibilitychange",()=>{if(document.hidden){receiptAmountsUnlocked=false;if(tab==="remit"&&remitUnlocked)remitUnlocked=false;}});
login();
let cashierAuthHandling=false;
const cashierAuthTimer=setTimeout(()=>{
  if(!cashierAuthHandling && !auth.currentUser){
    msg("Authentication is taking too long. Check your connection and reload the Cashier portal.");
  }
},CASHIER_AUTH_TIMEOUT_MS);
onAuthStateChanged(auth,async u=>{
  if(!u){clearTimeout(cashierAuthTimer);window.__pisoCashierSetLoginPending?.(false);return;}
  if(cashierAuthHandling)return;
  cashierAuthHandling=true;
  clearTimeout(cashierAuthTimer);
  try{
    await loadProfile(u);
  }catch(e){
    console.error("[PISO WIFI CASHIER] Portal initialization failed",e);
    try{await signOut(auth)}catch{}
    const el=$("#loginMsg");
    if(el)msg(e?.message||"Could not open Cashier portal. Please reload and try again.");
    window.__pisoCashierSetLoginPending?.(false);
    cashierAuthHandling=false;
  }
});
// Syntax fix: close render() before todayTxGross(). Build 2026-10-12-2
// Customer name mapping, automatic receipt email, and Admin-authorized remittance fixes.
// Password-change fix: reauthenticate with current temporary password before updatePassword.
// Integrated sync: cashier sales/payments -> shared monthlyRecords/payments for Admin and Customer.
