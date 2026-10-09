import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, query, orderBy, onSnapshot, serverTimestamp, arrayUnion } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { auth, db } from "./firebase.js";
import { firebaseConfig } from "./firebase-config.js";
const provisioner=initializeApp(firebaseConfig,"cashierAdminProvisioner");
const provisionAuth=getAuth(provisioner);
const $=s=>document.querySelector(s);
function setLoading(message){const el=$("#authLoading");if(el){el.innerHTML=`<div style="text-align:center;padding:30px"><div class="loader" style="margin:0 auto 14px"></div><strong>${esc(message)}</strong></div>`;el.classList.remove("hidden");}}
function showApp(){const el=$("#authLoading");if(el)el.classList.add("hidden");const app=$("#app");if(app)app.classList.remove("hidden");}const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));const money=n=>`₱${Number(n||0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
let tab="cashiers",cashiers=[],transactions=[],receipts=[],remittances=[],chats=[],wifiPlans=[];
async function audit(action,recordId,metadata={}){try{await addDoc(collection(db,"audit_logs"),{userId:auth.currentUser.uid,role:"admin",action,recordId:String(recordId||""),metadata,createdAt:serverTimestamp()})}catch(e){}}
function deny(){location.replace("/admin/index.html");}
function render(){setTimeout(bind,0);document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));const v=$("#view");if(tab==="cashiers")return v.innerHTML=`<div class="admin-card"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><div><h2>Cashier Accounts</h2><p>Create, activate/deactivate and reset cashier accounts.</p></div><button class="primary-btn" id="addCashier">+ Add Cashier</button></div></div>${cashiers.length?`<div class="admin-card"><table><thead><tr><th>Cashier ID</th><th>Name</th><th>Email</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>${cashiers.map(c=>`<tr><td>${esc(c.cashierId||"—")}</td><td>${esc(c.name||"—")}</td><td>${esc(c.email||"—")}</td><td><span class="status-pill ${c.active===false?"rejected":""}">${c.active===false?"INACTIVE":"ACTIVE"}</span></td><td>${esc(String(c.createdAt?.toDate?c.createdAt.toDate().toLocaleDateString():c.createdAt||"—"))}</td><td><button class="secondary-btn" data-toggle="${c.id}" data-active="${c.active!==false}">${c.active===false?"Activate":"Deactivate"}</button> <button class="secondary-btn" data-reset="${c.email}">Reset Password</button></td></tr>`).join("")}</tbody></table></div>`:`<div class="admin-card">No cashier accounts yet.</div>`;
if(tab==="transactions")return v.innerHTML=`<div class="admin-card"><h2>Cashier Transactions</h2><p>Approve, reject or request correction. Final invoices are generated only after approval.</p>${table(transactions,["Transaction","Cashier","Customer","Gross","Paid","Status"],true)}</div>`;
if(tab==="receipts")return v.innerHTML=`<div class="admin-card"><h2>Uploaded Receipts</h2>${table(receipts,["Receipt","Cashier","Customer","Amount","Method","Status"],false)}</div>`;
if(tab==="remittances")return v.innerHTML=`<div class="admin-card"><h2>Remittance</h2><p>Admin is the only role that can finalize a remittance.</p>${remittances.length?`<div style="overflow:auto"><table><thead><tr><th>Remittance</th><th>Cashier</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Status</th><th>Action</th></tr></thead><tbody>${remittances.map(r=>`<tr><td>${esc(r.remittanceId)}</td><td>${esc(r.cashierName)}</td><td>${money(r.expectedCollection)}</td><td>${money(r.actualRemittance)}</td><td>${money(r.variance)}</td><td>${esc(r.status)}</td><td>${r.status==="PENDING ADMIN AUTHORIZATION"?`<button class="primary-btn" data-remit-approve="${r.id}">Authorize & Finalize</button>`:"—"}</td></tr>`).join("")}</tbody></table></div>`:"No remittances."}</div>`;
if(tab==="escalations")return v.innerHTML=`<div class="admin-card"><h2>Customer Service Escalations</h2>${chats.filter(c=>c.status==="TRANSFERRED TO ADMIN").map(c=>`<div class="admin-card"><b>${esc(c.customerName||"Customer")}</b><p>${esc(c.lastMessage||"")}</p><button class="secondary-btn" data-resolve="${c.id}">Resolve</button></div>`).join("")||"<div>No escalations.</div>"}`;bind();}
function table(rows,cols,actions){if(!rows.length)return `<div style="padding:25px;color:#64748b">No records.</div>`;return `<div style="overflow:auto"><table><thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}${actions?"<th>Action</th>":""}</tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.transactionId||r.receiptId||r.remittanceId||r.id)}</td><td>${esc(r.cashierName||r.cashierId||"—")}</td><td>${esc(r.customerName||"—")}</td><td>${money(r.grossSales??r.expectedCollection??r.amount)}</td><td>${money(r.amountReceived??r.actualRemittance??0)}</td><td>${esc(r.status||"—")}</td>${actions?`<td>${r.status==="PENDING ADMIN REVIEW"?`<button class="primary-btn" data-approve="${r.id}">Approve</button> <button class="danger-btn" data-reject="${r.id}">Reject</button>`:""}</td>`:""}</tr>`).join("")}</tbody></table></div>`}
function bind(){document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=async()=>{tab=b.dataset.tab;render(); if(tab!=="cashiers") { try { await loadTabData(tab); } catch(e) { console.warn(e); } }});$("#addCashier")?.addEventListener("click",openCashier);document.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=async()=>{await updateDoc(doc(db,"users",b.dataset.toggle),{active:b.dataset.active!=="true",updatedAt:serverTimestamp()});load();});document.querySelectorAll("[data-reset]").forEach(b=>b.onclick=async()=>{try{await sendPasswordResetEmail(auth,b.dataset.reset);alert("Password reset email sent to "+b.dataset.reset)}catch(e){alert(e.message)}});document.querySelectorAll("[data-approve]").forEach(b=>b.onclick=()=>approve(b.dataset.approve));document.querySelectorAll("[data-reject]").forEach(b=>b.onclick=()=>updateDoc(doc(db,"cashierTransactions",b.dataset.reject),{status:"REJECTED",rejectedAt:serverTimestamp(),rejectedBy:auth.currentUser.uid}).then(load));document.querySelectorAll("[data-resolve]").forEach(b=>b.onclick=()=>updateDoc(doc(db,"customerChats",b.dataset.resolve),{status:"RESOLVED",updatedAt:serverTimestamp()}).then(load));document.querySelectorAll("[data-plan-toggle]").forEach(b=>b.onclick=()=>updateDoc(doc(db,"wifi_plans",b.dataset.planToggle),{status:b.dataset.planStatus==="ACTIVE"?"INACTIVE":"ACTIVE",updatedAt:serverTimestamp()}).then(load));$("#addPlan")?.addEventListener("click",openPlan);document.querySelectorAll("[data-remit-approve]").forEach(b=>b.onclick=()=>finalizeRemittance(b.dataset.remitApprove));}
function openCashier(){ $("#modalRoot").innerHTML=`<div class="admin-modal-backdrop"><div class="admin-modal"><h2>Add Cashier</h2><div class="admin-grid"><div class="admin-field"><label>Cashier ID *</label><input id="cId" placeholder="CASH-001"></div><div class="admin-field"><label>Cashier Name *</label><input id="cName"></div><div class="admin-field full"><label>Email *</label><input id="cEmail" type="email"></div><div class="admin-field"><label>Temporary Password *</label><input id="cPassword" type="password" minlength="6"></div><div class="admin-field"><label>Status</label><select id="cActive"><option value="true">Active</option><option value="false">Inactive</option></select></div></div><div class="admin-actions"><button class="secondary-btn" id="cancelCashier">Cancel</button><button class="primary-btn" id="saveCashier">Create Cashier</button></div></div></div>`;$("#cancelCashier").onclick=()=>$("#modalRoot").innerHTML="";$("#saveCashier").onclick=async()=>{try{const email=$("#cEmail").value.trim().toLowerCase(),password=$("#cPassword").value;if(!email||password.length<6)throw new Error("Valid email and a password of at least 6 characters are required.");const cred=await createUserWithEmailAndPassword(provisionAuth,email,password);await setDoc(doc(db,"users",cred.user.uid),{role:"cashier",cashierId:$("#cId").value.trim().toUpperCase(),name:$("#cName").value.trim(),email,active:$("#cActive").value==="true",createdAt:serverTimestamp(),createdBy:auth.currentUser.uid});await provisionAuth.signOut();$("#modalRoot").innerHTML="";alert("Cashier created successfully.");load()}catch(e){alert(e.message)}}}
async function approve(id){const t=transactions.find(x=>x.id===id);if(!t)return;const invoice=`<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(t.transactionId)}</title></head><body><h1>PISO WIFI</h1><h2>INVOICE</h2><p>Invoice #: INV-${esc(t.transactionId)}</p><p>Transaction #: ${esc(t.transactionId)}</p><p>Customer: ${esc(t.customerName)}</p><p>Service: ${esc(t.productName)}</p><p>Gross Sales: ${money(t.grossSales)}</p><p>Amount Paid: ${money(t.amountReceived)}</p><p>Balance: ${money(t.balance)}</p><p>Payment Method: ${esc(t.paymentMethod)}</p><p>Reference: ${esc(t.referenceNumber)}</p><p>Status: PAID / APPROVED</p><p>Cashier: ${esc(t.cashierName)}</p><p>Approved By: ADMIN</p></body></html>`;await updateDoc(doc(db,"cashierTransactions",id),{status:"APPROVED",approvedAt:serverTimestamp(),approvedBy:auth.currentUser.uid,invoiceHtml:invoice,invoiceReady:true});await audit("SALE_APPROVED",id);await addDoc(collection(db,"notifications"),{type:"cashier","title":"Cashier transaction approved",message:`${t.transactionId} was approved and invoice generated.`,relatedId:id,read:false,createdAt:serverTimestamp()});load()}
function openPlan(){ $("#modalRoot").innerHTML=`<div class="admin-modal-backdrop"><div class="admin-modal"><h2>Add WiFi Plan</h2><div class="admin-grid"><div class="admin-field"><label>Plan Name *</label><input id="pName"></div><div class="admin-field"><label>Price *</label><input id="pPrice" type="number" min="0" step="0.01"></div><div class="admin-field"><label>Duration *</label><input id="pDuration" placeholder="24 Hours"></div><div class="admin-field"><label>Status</label><select id="pStatus"><option>ACTIVE</option><option>INACTIVE</option></select></div><div class="admin-field full"><label>Description</label><textarea id="pDescription"></textarea></div></div><div class="admin-actions"><button class="secondary-btn" id="cancelPlan">Cancel</button><button class="primary-btn" id="savePlan">Save Plan</button></div></div></div>`;$("#cancelPlan").onclick=()=>$("#modalRoot").innerHTML="";$("#savePlan").onclick=async()=>{const name=$("#pName").value.trim(),price=Number($("#pPrice").value),duration=$("#pDuration").value.trim();if(!name||price<0||!duration) return alert("Plan name, price and duration are required.");await addDoc(collection(db,"wifi_plans"),{name,price,duration,description:$("#pDescription").value.trim(),status:$("#pStatus").value,sortOrder:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});$("#modalRoot").innerHTML="";load()}}
async function finalizeRemittance(id){const r=remittances.find(x=>x.id===id);if(!r)return;const actual=Number(prompt(`Expected collection: ${money(r.expectedCollection)}\nEnter actual remittance amount:`));if(!Number.isFinite(actual)||actual<0)return;const variance=actual-Number(r.expectedCollection||0);if(!confirm(`Finalize ${r.remittanceId} for ${money(actual)}? Variance: ${money(variance)}`))return;await updateDoc(doc(db,"remittances",id),{actualRemittance:actual,variance,status:"REMITTED",authorizedBy:auth.currentUser.uid,authorizedAt:serverTimestamp()});await audit("ADMIN_REMIT_AUTHORIZED",id,{actualRemittance:actual,variance});for(const tid of (r.transactionIds||[])){await updateDoc(doc(db,"cashierTransactions",tid),{remittanceFinalized:true,remittanceAuthorizedAt:serverTimestamp()})}await addDoc(collection(db,"notifications"),{type:"cashier-remittance",title:"Cashier remittance finalized",message:`${r.cashierName} remitted ${money(actual)}. Variance ${money(variance)}.`,relatedId:id,read:false,createdAt:serverTimestamp()});load()}
function withTimeout(promise, ms=5000, label="Firebase request"){
  return Promise.race([
    promise,
    new Promise((_, reject)=>setTimeout(()=>reject(new Error(`${label} timed out. The page is still available; check Firebase Rules or your connection.`)),ms))
  ]);
}
async function safeDocs(path, sortField=""){
  try{
    const ref=collection(db,path);
    try{
      return await withTimeout(sortField ? getDocs(query(ref,orderBy(sortField,"desc"))) : getDocs(query(ref)),5000,`Loading ${path}`);
    }catch(primaryError){
      console.warn(`[CASHIER ADMIN] ${path} ordered query failed; retrying without orderBy.`,primaryError);
      return await withTimeout(getDocs(query(ref)),5000,`Loading ${path}`);
    }
  }catch(error){
    console.warn(`[CASHIER ADMIN] ${path} is unavailable.`,error);
    return {docs:[]};
  }
}
function applyDocs(path,snap){
  const rows=snap.docs.map(d=>({id:d.id,...d.data()}));
  if(path==="users") cashiers=rows.filter(x=>x.role==="cashier");
  if(path==="cashierTransactions") transactions=rows;
  if(path==="receipts") receipts=rows;
  if(path==="remittances") remittances=rows;
  if(path==="customerChats") chats=rows;
  if(path==="wifi_plans") wifiPlans=rows;
}
async function loadTabData(target){
  const map={transactions:["cashierTransactions","createdAt"],receipts:["receipts","createdAt"],remittances:["remittances","createdAt"],wifi:["wifi_plans",""] ,escalations:["customerChats","updatedAt"]};
  const spec=map[target];
  if(!spec)return;
  const snap=await safeDocs(spec[0],spec[1]);
  applyDocs(spec[0],snap);
  render();
}
async function load(){
  // Open the page as soon as the Admin session is verified. Do not block the
  // entire Cashier Management UI on unrelated collections or indexes.
  // Once the authenticated Admin identity is verified, show the page first.
  // Firestore account loading must never keep the whole route behind a spinner.
  render();
  showApp();
  try{
    const snap=await safeDocs("users");
    applyDocs("users",snap);
  }catch(error){
    console.warn("[CASHIER ADMIN] Could not load cashier accounts yet.",error);
    cashiers=[];
  }
  render();
  // Preload secondary sections in the background. A failure here must never
  // prevent the Cashier Management page from opening.
  for(const target of ["transactions","receipts","remittances","escalations"]){
    loadTabData(target).catch(error=>console.warn(`[CASHIER ADMIN] ${target} background load failed.`,error));
  }
}
async function showAuthFailure(message){
  console.error("[CASHIER ADMIN AUTH]",message);
  const loader=$("#authLoading");
  if(!loader)return;
  loader.innerHTML=`<div class="auth-error"><strong>Cashier Management could not load</strong><span>${esc(message||"Unable to verify the Admin session.")}</span><div style="display:flex;gap:10px;justify-content:center;margin-top:16px"><button type="button" id="retryCashierAdmin">Retry</button><button type="button" id="returnAdminLogin">Back to Admin</button></div></div>`;
  loader.classList.remove("hidden");
  $("#retryCashierAdmin")?.addEventListener("click",()=>location.reload());
  $("#returnAdminLogin")?.addEventListener("click",()=>location.replace("/admin/dashboard.html#dashboard"));
}

async function bootCashierAdmin(){
  setLoading("Restoring Admin session…");
  try{
    // Match the main Admin portal: wait for Firebase's persisted auth state,
    // rather than relying only on an auth-state callback that can stall here.
    if(typeof auth.authStateReady === "function"){
      await Promise.race([auth.authStateReady(),new Promise((_,reject)=>setTimeout(()=>reject(new Error("Admin session check timed out. Open Admin again and choose Cashier Management.")),8000))]);
    } else {
      await new Promise((resolve,reject)=>{
        let settled=false,unsubscribe=()=>{};
        const timer=setTimeout(()=>finish(new Error("Admin session check timed out.")),8000);
        function finish(err){if(settled)return;settled=true;clearTimeout(timer);unsubscribe();err?reject(err):resolve();}
        unsubscribe=onAuthStateChanged(auth,()=>finish(),finish);
      });
    }
    const u=auth.currentUser;
    if(!u) return deny();
    const email=String(u.email||"").trim().toLowerCase();
    if(email!=="pisonet@admin.com") return deny();
    setLoading("Opening Cashier Management…");
    await load();
  }catch(e){ await showAuthFailure(e?.message||"Firebase Authentication could not be initialized."); }
}
bootCashierAdmin();
