import { auth, db } from "./firebase.js";
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateEmail, signOut as provisionerSignOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { calculateFinancialRecord } from "./finance.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, runTransaction, onSnapshot, arrayUnion,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

console.info("[PISO WIFI] BUILD v64 — WiFi subscription labels + cashier email onboarding");

const $ = (s) => document.querySelector(s);
const APPS_SCRIPT_SHEET_SYNC_URL = "https://script.google.com/macros/s/AKfycbzJcIf9rpdunJ8-1kDvgePWTT1L-cQOFzZLQHFQMaqBYTlviovyxjz4JOX-FpvUrjFu/exec";
async function postSheetSyncPayload(payload){
  const form=document.createElement("form");
  form.method="POST";
  form.action=APPS_SCRIPT_SHEET_SYNC_URL;
  form.target="pisoSheetSyncFrame";
  form.style.display="none";
  const input=document.createElement("input");
  input.type="hidden";
  input.name="payload";
  input.value=JSON.stringify(payload);
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  setTimeout(()=>form.remove(),1500);
  return {ok:true,action:"submitted"};
}

function ensureSheetSyncFrame(){
  if(document.getElementById("pisoSheetSyncFrame")) return;
  const frame=document.createElement("iframe");
  frame.id="pisoSheetSyncFrame";
  frame.name="pisoSheetSyncFrame";
  frame.style.display="none";
  frame.setAttribute("aria-hidden","true");
  document.body.appendChild(frame);
}

async function syncClientToSheet(client){
  if(!currentUser) throw new Error("Admin session is not ready for Google Sheets sync.");
  ensureSheetSyncFrame();
  const idToken=await currentUser.getIdToken(true);
  const payload={
    action:"syncClient", idToken,
    clientId:String(client.clientCode||client.clientId||"").trim().toUpperCase(),
    unitCode:String(client.unitCode||"").trim(),
    firstName:String(client.firstName||"").trim(),
    lastName:String(client.lastName||"").trim(),
    email:String(client.email||"").trim().toLowerCase(),
    phone:String(client.contact||client.phone||"").trim(),
    temporaryPassword:String(client.temporaryPassword||client.clientCode||client.clientId||"").trim(),
    passwordChanged:client.passwordChanged===true,
    accountStatus:client.active===false?"Inactive":"Active",
    createdAt:client.createdAt||new Date().toISOString(),
    lastLogin:client.lastLogin||""
  };
  if(!/^CID-\d{3,}$/.test(payload.clientId)) throw new Error("Invalid Client ID for Google Sheets sync: "+payload.clientId);
  return postSheetSyncPayload(payload);
}

async function syncAllClientsToSheet(){
  if(!currentUser) throw new Error("Admin session is not ready for Google Sheets sync.");
  ensureSheetSyncFrame();
  let count=0;
  for(const u of units){
    if(!(u?.clientCode||u?.clientId)||!u?.email) continue;
    await syncClientToSheet({...u,clientCode:u.clientCode||u.clientId,temporaryPassword:u.temporaryPassword||u.clientCode||u.clientId,passwordChanged:u.forcePasswordChange===false});
    count++;
  }
  console.info("[PISO WIFI] Google Sheets backfill submitted:",count);
  return count;
}

const view = $("#view");
const toastEl = $("#toast");
const money = (n) => `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
const monthLabel = (k) => { const [y,m] = String(k).split("-"); return new Date(Number(y), Number(m)-1, 1).toLocaleString("en-US", { month:"long", year:"numeric" }); };
const dateLabel = (v) => { if (!v) return "—"; const d = v?.toDate ? v.toDate() : new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-US", {month:"long",day:"numeric",year:"numeric"}); };
const dateTimeLabel = (v) => { if (!v) return "—"; const d = v?.toDate ? v.toDate() : new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("en-US", {month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}); };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

let currentUser = null;
let units = [], records = [], payments = [], notifications = [], activities = [], supportChats = [];
let supportUnsub=null, selectedSupportChatId="";
let cashierSales=[], cashierSalesUnsub=null;
let coreRealtimeUnsubs=[];
let dashboardRealtimeTimer=null;
let settings = { internetCost:1000, ownerPercent:70, clientPercent:30, electricity:100, electricityRule:"ADD_TO_CLIENT" };
let route = "dashboard";
let selectedMonth = localStorage.getItem("pisoSelectedMonth") || todayKey();
let unitSearch = "", unitStatus = "", unitPaymentStatus = "";

// TEMPORARY ADMIN FEATURE: keep true while client deletion is needed.
// Set to false later to remove the Delete Client button without changing the rest of the system.
const ENABLE_CLIENT_DELETE = true;
const clientProvisionerApp=initializeApp(firebaseConfig,"clientProvisioner");
const clientProvisionerAuth=getAuth(clientProvisionerApp);
const firstNameFromFullName=(name)=>String(name||"").trim().split(/\s+/)[0]||"Client";
const sanitizeUsernamePart=(name)=>firstNameFromFullName(name).replace(/[^A-Za-z0-9]/g,"")||"Client";
async function nextClientId(){
  const ref=doc(db,"settings","clientSequence");
  const maxExisting=units.reduce((max,u)=>{
    const m=String(u.clientCode||"").match(/^CID-(\d+)$/i);
    return m?Math.max(max,Number(m[1])):max;
  },0);
  return await runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    const storedNext=Number(snap.exists()?snap.data().next:0);
    // Never trust a stale/lower sequence value. Existing client IDs are the source of truth.
    // This guarantees the next ID is always greater than every existing CID and never reused.
    let next=Math.max(
      Number.isInteger(storedNext) && storedNext > 0 ? storedNext : 1,
      maxExisting + 1
    );
    tx.set(ref,{next:next+1,updatedAt:serverTimestamp()},{merge:true});
    return `CID-${String(next).padStart(4,"0")}`;
  });
}
async function previewNextClientId(){
  const ref=doc(db,"settings","clientSequence");
  const maxExisting=units.reduce((max,u)=>{
    const m=String(u.clientCode||"").match(/^CID-(\d+)$/i);
    return m?Math.max(max,Number(m[1])):max;
  },0);
  const snap=await getDoc(ref);
  const storedNext=Number(snap.exists()?snap.data().next:0);
  const next=Math.max(Number.isInteger(storedNext)&&storedNext>0?storedNext:1,maxExisting+1);
  return `CID-${String(next).padStart(4,"0")}`;
}

function availableUnitCodes(currentCode=""){
  const activeCodes=new Set(units.filter(u=>u.active!==false && String(u.unitCode)!==String(currentCode)).map(u=>String(u.unitCode)));
  return Array.from({length:50},(_,i)=>String(i+1)).map(code=>({code,used:activeCodes.has(code)}));
}

async function provisionMissingOrLegacyClientAuth(){
  const candidates=units.filter(u=>u?.clientCode&&u?.email);
  for(const u of candidates){
    const clientCode=String(u.clientCode).trim().toUpperCase();
    const realEmail=String(u.email).trim().toLowerCase();
    const temporaryPassword=clientCode;
    if(!realEmail || !/^CID-\d{3,}$/i.test(clientCode)) continue;

    const legacyEmail=String(u.authEmail||"").trim().toLowerCase();
    const isLegacySynthetic=legacyEmail && /@client-login\.pisowifi\.local$/i.test(legacyEmail);

    // Existing v53 accounts used a synthetic login email. If the client is
    // still on the temporary password, migrate that same Firebase UID to the
    // real registered Gmail so the customer can log in with the credentials
    // shown by Admin.
    if(u.authUserId && isLegacySynthetic){
      try{
        const cred=await signInWithEmailAndPassword(clientProvisionerAuth,legacyEmail,temporaryPassword);
        if(String(cred.user.email||"").toLowerCase()!==realEmail){
          await updateEmail(cred.user,realEmail);
        }
        await setDoc(doc(db,"users",cred.user.uid),{
          role:"client",clientUnitId:u.id,unitId:u.id,clientCode,username:u.username||"",
          email:realEmail,authEmail:realEmail,updatedAt:serverTimestamp()
        },{merge:true});
        await updateDoc(doc(db,"units",u.id),{authEmail:realEmail,authUserId:cred.user.uid,updatedAt:serverTimestamp()});
        u.authEmail=realEmail; u.authUserId=cred.user.uid;
        console.info("[PISO WIFI] Migrated legacy client auth:",clientCode,realEmail);
      }catch(e){
        console.warn("[PISO WIFI] Legacy auth migration skipped for",clientCode,e?.code||e?.message||e);
      }finally{
        try{await provisionerSignOut(clientProvisionerAuth);}catch{}
      }
      continue;
    }

    // New/current records without an Auth UID get a real Firebase account
    // using the registered Gmail and the Client ID as the temporary password.
    if(!u.authUserId){
      try{
        let cred;
        try{
          cred=await createUserWithEmailAndPassword(clientProvisionerAuth,realEmail,temporaryPassword);
        }catch(e){
          if(e?.code!=="auth/email-already-in-use") throw e;
          cred=await signInWithEmailAndPassword(clientProvisionerAuth,realEmail,temporaryPassword);
        }
        await setDoc(doc(db,"users",cred.user.uid),{
          role:"client",clientUnitId:u.id,unitId:u.id,clientCode,username:u.username||"",
          email:realEmail,authEmail:realEmail,createdAt:u.createdAt||serverTimestamp(),updatedAt:serverTimestamp()
        },{merge:true});
        await updateDoc(doc(db,"units",u.id),{authUserId:cred.user.uid,authEmail:realEmail,forcePasswordChange:true,updatedAt:serverTimestamp()});
        u.authUserId=cred.user.uid; u.authEmail=realEmail; u.forcePasswordChange=true;
        console.info("[PISO WIFI] Provisioned client auth:",clientCode,realEmail);
      }catch(e){
        console.warn("[PISO WIFI] Client auth provisioning skipped for",clientCode,e?.code||e?.message||e);
      }finally{
        try{await provisionerSignOut(clientProvisionerAuth);}catch{}
      }
    }
  }
}

async function syncCustomerDirectory(){
  try{ await provisionMissingOrLegacyClientAuth(); }catch(e){ console.warn("[PISO WIFI] Client auth provisioning pass failed:",e); }
  const jobs=units.filter(u=>u.clientCode&&u.unitCode&&u.email).map(u=>
    setDoc(doc(db,"customerLoginDirectory",String(u.clientCode).toUpperCase()),{
      clientCode:String(u.clientCode).toUpperCase(),
      unitCode:String(u.unitCode).toUpperCase(),
      email:String(u.email).trim().toLowerCase(),
      unitDocId:u.id,
      authUserId:u.authUserId||"",
      active:u.active!==false,
      updatedAt:serverTimestamp()
    },{merge:true})
  );
  if(jobs.length) await Promise.all(jobs);
}


function notify(msg, type="success") {
  if(type==="error") window.pisoDebug?.capture(msg,{type:"admin.notify"});
  toastEl.textContent = msg;
  toastEl.className = `toast show ${type}`;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
}
function setMonth(k) { selectedMonth = k || todayKey(); localStorage.setItem("pisoSelectedMonth", selectedMonth); $("#globalMonth").value = selectedMonth; render(); }
function monthsList() {
  const out=[]; const now=new Date();
  for(let i=0;i<24;i++){ const d=new Date(now.getFullYear(), now.getMonth()-i,1); out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`); }
  return out;
}
function setupMonthSelector(){
  $("#globalMonth").innerHTML=monthsList().map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join("");
  $("#globalMonth").value=selectedMonth;
  $("#globalMonth").onchange=e=>setMonth(e.target.value);
}
function normalizeRows(month=selectedMonth){
  return units.map(u=>{
    const r=records.find(x=>x.unitId===u.id && x.month===month) || {unitId:u.id,month,grossSales:0};
    return {u,r,c:calc(r)};
  });
}
function calc(r){
  return calculateFinancialRecord(r, settings, payments);
}
function totals(rows){ return rows.reduce((a,x)=>{a.gross+=x.c.gross;a.internet+=x.c.internet;a.net+=x.c.net;a.owner+=x.c.owner;a.client+=x.c.client;a.elec+=x.c.elec;a.misc+=x.c.miscellaneous||0;a.due+=x.c.clientTotal;a.paid+=x.c.paid;a.balance+=x.c.balance;return a},{gross:0,internet:0,net:0,owner:0,client:0,elec:0,due:0,paid:0,balance:0}); }

async function loadData(){
  // Core financial collections are required for the dashboard.
  // Notifications and Activity Log are optional during rollout so a missing
  // Firestore rule for those newer collections cannot blank the whole app.
  const [u,r,p,s] = await Promise.all([
    getDocs(collection(db,"units")),
    getDocs(collection(db,"monthlyRecords")),
    getDocs(collection(db,"payments")),
    getDoc(doc(db,"settings","business"))
  ]);

  units=u.docs.map(d=>({id:d.id,...d.data()}));
  try { await syncCustomerDirectory(); } catch(e) { console.warn("Customer directory sync skipped",e); }
  try {
    await syncAllClientsToSheet();
    localStorage.setItem("pisoSheetSyncV2","1");
  } catch(e) {
    console.error("Google Sheets client backfill failed",e);
  }
  records=r.docs.map(d=>({id:d.id,...d.data()}));
  payments=p.docs.map(d=>({id:d.id,...d.data()}));
  if(s.exists()) settings={...settings,...s.data()};

  try {
    const n=await getDocs(collection(db,"notifications"));
    notifications=n.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>timeValue(b.createdAt)-timeValue(a.createdAt));
  } catch(e) {
    console.warn("Notifications collection is not readable yet. Publish the latest Firestore rules.",e);
    notifications=[];
  }

  try {
    const a=await getDocs(collection(db,"activities"));
    activities=a.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>timeValue(b.createdAt)-timeValue(a.createdAt));
  } catch(e) {
    console.warn("Activities collection is not readable yet. Publish the latest Firestore rules.",e);
    activities=[];
  }

  try {
    const sc=await getDocs(collection(db,"supportChats"));
    supportChats=sc.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>timeValue(b.updatedAt||b.createdAt)-timeValue(a.updatedAt||a.createdAt));
  } catch(e) {
    console.warn("Support chats collection is not readable yet. Publish the latest Firestore rules.",e);
    supportChats=[];
  }
  updateNotificationBadge();
  updateSupportBadge();
}
function timeValue(v){ if(!v)return 0; if(v.toMillis)return v.toMillis(); const n=new Date(v).getTime(); return Number.isNaN(n)?0:n; }
async function authorize(user){
  const snap=await getDoc(doc(db,"users",user.uid));
  if(!snap.exists()) throw new Error("Your Firebase account is not authorized as an admin.");
  const d=snap.data();

  // Admin is identified by role. The active field is optional for legacy
  // Admin records; only an explicit false value disables access.
  if(d.role!=="admin" || d.active===false){
    throw new Error("Your account is not authorized as an Admin.");
  }
}
async function logActivity(type,description,relatedId=""){
  try {
    const ref = await addDoc(collection(db,"activities"),{
      userId:currentUser?.uid||"",
      userEmail:currentUser?.email||"",
      activityType:type,
      description,
      relatedId,
      createdAt:serverTimestamp()
    });
    activities.unshift({id:ref.id,userId:currentUser?.uid||"",userEmail:currentUser?.email||"",activityType:type,description,relatedId,createdAt:new Date()});
    return ref;
  } catch(e){ console.warn("Activity log failed",e); return null; }
}
async function addNotification(type,title,message,relatedId=""){
  try { await addDoc(collection(db,"notifications"),{type,title,message,relatedId,read:false,createdAt:serverTimestamp()}); } catch(e){ console.warn("Notification failed",e); }
}
function unreadCount(){ return notifications.filter(n=>n.read!==true).length; }
function updateNotificationBadge(){
  const el=document.querySelector("#adminNotificationBadge");
  if(!el)return;
  const count=unreadCount();
  el.textContent=count>99?"99+":String(count);
  el.classList.toggle("hidden",count===0);
}
function navigateTo(next){
  const target=String(next||"dashboard").replace(/^#/,"").split("?")[0]||"dashboard";
  route=target;
  if(location.hash!=="#"+target) location.hash="#"+target;
  render();
}
function nav(){ document.querySelectorAll("#nav [data-route]").forEach(a=>a.classList.toggle("active",a.dataset.route===route)); }
function closeMenu(){ $("#sidebar").classList.remove("open"); $("#overlay").classList.remove("show"); }
function baseHead(title,sub,button=""){ return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div>${button}</div>`; }
function statusBadge(s){ return `<span class="badge ${String(s).toLowerCase()}">${esc(s)}</span>`; }
function pageLoader(){ view.innerHTML=`<div class="loading-panel"><div class="loader"></div><p>Loading data…</p></div>`; }

function render(){
  nav();
  const renderers={dashboard:renderDashboard,units:renderUnits,reports:renderReports,payments:renderPayments,statements:renderStatements,notifications:renderNotifications,activity:renderActivity,settings:renderSettings,profile:renderProfile,support:renderSupport,"wifi-subscription":renderWiFiSubscriptions,"cashier-management":renderCashierManagement,"cashier-sales":renderCashierSales};
  (renderers[route]||renderDashboard)();
  closeMenu();
  updateNotificationBadge();
  window.scrollTo({top:0,behavior:"smooth"});
}

function renderDashboard(){
  const rows=normalizeRows(), t=totals(rows), active=units.filter(u=>u.active!==false).length;
  const customerEarnings=t.client;
  const top=[...rows].sort((a,b)=>b.c.gross-a.c.gross).slice(0,5);
  const outstanding=rows.filter(x=>x.c.balance>0).sort((a,b)=>b.c.balance-a.c.balance).slice(0,5);
  const openTickets=supportChats.filter(c=>String(c.status||"Open")==="Open").length;
  const solvedTickets=supportChats.filter(c=>String(c.status||"")==="Solved").length;
  const closedTickets=supportChats.filter(c=>String(c.status||"")==="Closed").length;
  const recent=[...activities].sort((a,b)=>timeValue(b.createdAt)-timeValue(a.createdAt)).slice(0,6);
  const supportRecent=[...supportChats].sort((a,b)=>timeValue(b.updatedAt||b.createdAt)-timeValue(a.updatedAt||a.createdAt)).slice(0,4);

  view.innerHTML=baseHead("Dashboard","Overview of your Piso WiFi business.",`<div class="dashboard-head-actions"><button class="secondary-btn" data-route="reports">Monthly Report</button><button class="primary-btn" data-route="support">Support Tickets <span class="inline-count">${openTickets}</span></button></div>`)+`
  <div class="dashboard-grid">
    <div class="kpis dashboard-kpis">
      ${kpi(metricIcons.money,"Gross Sales",money(t.gross),monthLabel(selectedMonth),"orange", "#reports")}
      ${kpi(metricIcons.client,"Customer Earnings",money(customerEarnings),settings.clientPercent+"% customer share","customer-net", "#reports")}
      ${kpi(metricIcons.money,"Amount Collected",money(t.paid),"Recorded payments","green", "#payments")}
      ${kpi(metricIcons.due,"Outstanding",money(t.balance),"Remaining customer balance","red", "#payments")}
      ${kpi(metricIcons.tag,"Miscellaneous Fees",money(t.misc||0),"Custom admin fees","purple", "#reports")}
      ${kpi(metricIcons.bolt,"Electricity",money(t.elec),"Electricity share","gold", "#reports")}
      ${kpi(metricIcons.units,"Total Units",units.length,active+" active","", "#units")}
      ${kpi(metricIcons.ticket,"Open Tickets",openTickets,solvedTickets+" solved · "+closedTickets+" closed","", "#support")}
    </div>

    <div class="analytics-grid dashboard-main-grid">
      <div class="panel chart-panel dashboard-chart-card">
        <div class="panel-head"><div><h3>Sales Overview</h3><p>Gross sales and customer earnings for the last 6 months.</p></div><div class="tools"><select class="compact-select" id="chartMetric"><option>Gross Sales</option><option>Customer Earnings</option><option>Owner Share</option><option>Payments</option></select></div></div>
        <div class="chart-legend"><span><i class="legend-dot gross"></i>Gross Sales</span><span><i class="legend-dot earnings"></i>Customer Earnings</span></div>
        <div class="chart-wrap" id="salesChart">${salesChart("Gross Sales")}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Top Performing Units</h3><p>Ranked by gross sales.</p></div><select class="compact-select" id="topPeriod"><option value="month">This Month</option><option value="last">Last Month</option><option value="3">Last 3 Months</option><option value="year">This Year</option></select></div>
        <div class="rank-list accumulating-list" id="topUnits">${topUnitsHtml(top)}</div>
        <button class="dashboard-link" data-route="units">View all units →</button>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Recent Activities</h3><p>Latest system actions.</p></div><button class="link-btn" data-route="activity">View All</button></div>
        <div class="dashboard-activity-list">${recent.length?recent.map(a=>`<button class="dashboard-activity-row" data-route="activity"><span class="activity-dot"></span><span><b>${esc(a.description||a.activityType||"Activity")}</b><small>${dateTimeLabel(a.createdAt)}</small></span></button>`).join(""):empty("No recent activity yet.")}</div>
      </div>
    </div>

    <div class="panel" style="margin:18px 0"><div class="panel-head"><div><h3>WiFi Subscription</h3><p>Track subscription payments and upcoming expiry dates.</p></div><button class="primary-btn" data-route="wifi-subscription">Manage Subscriptions</button></div><div id="wifiSubscriptionSummary" style="padding:14px 18px;color:#52637a">Open WiFi Subscription to view total paid and reminders.</div></div>

    <div class="dashboard-lower-grid">
      <div class="panel">
        <div class="panel-head"><div><h3>Outstanding Payments</h3><p>Customers with an unpaid balance.</p></div><button class="link-btn" data-route="payments">View All</button></div>
        <div class="outstanding-list accumulating-list">${outstanding.length?outstanding.map(x=>`<button class="outstanding-row" data-pay-unit="${x.u.id}"><span><b>${esc(x.u.unitCode)}</b><small>${esc(x.u.name)}</small></span><strong>${money(x.c.balance)}</strong></button>`).join(""):empty("No outstanding payments.")}</div>
      </div>
      <div class="panel dashboard-support-card">
        <div class="panel-head"><div><h3>Support Tickets</h3><p>Customer support activity.</p></div><button class="link-btn" data-route="support">Open Support</button></div>
        <div class="support-summary-grid"><button data-route="support" data-support-filter-link="Open"><b>${openTickets}</b><span>Open</span></button><button data-route="support" data-support-filter-link="Solved"><b>${solvedTickets}</b><span>Solved</span></button><button data-route="support" data-support-filter-link="Closed"><b>${closedTickets}</b><span>Closed</span></button></div>
        <div class="dashboard-support-list">${supportRecent.length?supportRecent.map(c=>`<button data-route="support"><span class="support-mini-avatar">${esc(String(c.customerName||"CU").trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase())}</span><span><b>${esc(c.customerName||"Customer")}</b><small>${esc((Array.isArray(c.messages)&&c.messages.length?c.messages[c.messages.length-1].text:"No messages yet").slice(0,48))}</small></span><i class="${supportStatusClass(c.status)}">${esc(c.status||"Open")}</i></button>`).join(""):empty("No support tickets yet.")}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><div><h3>Units / Clients</h3><p>Monthly computation for ${monthLabel(selectedMonth)}.</p></div><div class="tools"><input class="search" id="dashSearch" placeholder="Search client or unit…"><select id="dashStatus" class="search"><option value="">All Payment Status</option><option>Paid</option><option>Partial</option><option>Unpaid</option></select><button class="secondary-btn" data-route="units">Manage Clients</button></div></div>
      <div class="table-wrap accumulating-table"><table><thead><tr><th>Unit Code</th><th>Client Name</th><th>Location</th><th>Status</th><th>Gross Sales</th><th>Customer Earnings</th><th>Payment</th><th>Actions</th></tr></thead><tbody id="dashBody">${rows.length?rows.map(dashboardRow).join(""):emptyRow(8,"No clients or units found.")}</tbody></table></div>
    </div>
  </div>`;

  $("#dashSearch").oninput=e=>filterDashboard(e.target.value,$("#dashStatus").value);
  $("#dashStatus").onchange=e=>filterDashboard($("#dashSearch").value,e.target.value);
  $("#chartMetric").onchange=e=>{$("#salesChart").innerHTML=salesChart(e.target.value);};
  $("#topPeriod").onchange=e=>renderTopUnits(e.target.value);
  document.querySelectorAll("[data-pay-unit]").forEach(b=>b.onclick=()=>openPaymentModal(b.dataset.payUnit));
  bindDynamicButtons();
  updateWiFiSubscriptionSummary();
}
function kpi(icon,title,value,sub,cls="",routeTarget=""){ return `<article class="kpi ${cls} ${routeTarget?"is-clickable":""}" ${routeTarget?`data-route="${routeTarget.replace("#","")}" tabindex="0" role="button"`:""}><div class="kpi-icon">${icon}</div><span>${title}</span><b>${value}</b><small>${sub}</small></article>`; }
const metricIcons={
  units:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V8l8-4 8 4v12M8 20v-5h8v5M9 9h.01M15 9h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  active:`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m8.5 12 2.3 2.3 4.8-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  money:`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 12h8M12 9v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  net:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18 10 13l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 9h4v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  owner:`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v10M15 9.5c-.8-1-4-1.3-4.6.2-.7 1.8 4.7 1.4 4.7 3.4 0 1.8-3.7 2-4.9.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  client:`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  due:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14v12H5z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 10h8M8 14h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  tag:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11V5h6l9 9-5 5-10-8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/></svg>`,
  bolt:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-8 12h6l-1 8 8-12h-6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  ticket:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v5a2 2 0 0 0 0 4v5H5v-5a2 2 0 0 0 0-4z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 8h4M10 12h4M10 16h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`
};
function empty(msg){ return `<div class="empty">${esc(msg)}</div>`; }
function emptyRow(cols,msg){ return `<tr><td colspan="${cols}" class="empty">${esc(msg)}</td></tr>`; }
function dashboardRow(x){ return `<tr><td><span class="unit-logo" aria-hidden="true">⌁</span><b>${esc(x.u.unitCode||"—")}</b></td><td><b>${esc(x.u.name||"—")}</b></td><td>${esc(x.u.location||"—")}</td><td>${statusBadge(x.u.active!==false?"Active":"Inactive")}</td><td class="amount">${money(x.c.gross)}</td><td class="amount customer-earnings-cell">${money(x.c.clientTotal)}</td><td>${statusBadge(x.c.status)}</td><td><button class="action-btn" data-profile="${x.u.id}">View</button><button class="action-btn" data-sale="${x.u.id}">Gross Sale</button></td></tr>`; }
function filterDashboard(q,status){ const rows=normalizeRows().filter(x=>(!q||`${x.u.name} ${x.u.unitCode} ${x.u.location} ${x.u.contact}`.toLowerCase().includes(q.toLowerCase()))&&(!status||x.c.status===status)); $("#dashBody").innerHTML=rows.length?rows.map(dashboardRow).join(""):emptyRow(8,"No matching units."); bindDynamicButtons(); }
function bindDynamicButtons(){
  document.querySelectorAll("[data-profile]").forEach(b=>b.onclick=()=>openProfile(b.dataset.profile));
  document.querySelectorAll("[data-sale]").forEach(b=>b.onclick=()=>openSalesModal(b.dataset.sale));
  document.querySelectorAll("[data-edit-sale]").forEach(b=>b.onclick=()=>openSalesModal(b.dataset.editSale));
  document.querySelectorAll("[data-delete-sale]").forEach(b=>b.onclick=()=>confirmDeleteSale(b.dataset.deleteSale));
  document.querySelectorAll("[data-edit-unit]").forEach(b=>b.onclick=()=>openUnitModal(b.dataset.editUnit));
  document.querySelectorAll("[data-toggle-unit]").forEach(b=>b.onclick=()=>toggleUnit(b.dataset.toggleUnit));
  document.querySelectorAll("[data-delete-unit]").forEach(b=>b.onclick=()=>confirmDeleteUnit(b.dataset.deleteUnit));
  document.querySelectorAll("[data-payment]").forEach(b=>b.onclick=()=>openPaymentModal(b.dataset.payment));
  document.querySelectorAll("[data-view-statement]").forEach(b=>b.onclick=()=>{location.hash=`#statements?unit=${encodeURIComponent(b.dataset.viewStatement)}`;});
}

function sixMonths(){ const out=[]; const [y,m]=selectedMonth.split("-").map(Number); for(let i=5;i>=0;i--){const d=new Date(y,m-1-i,1);out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);} return out; }
function metricTotal(month,metric){ const rs=records.filter(r=>r.month===month); return rs.reduce((sum,r)=>{const c=calc(r); return sum+(metric==="Owner Share"?c.owner:metric==="Client Share"||metric==="Customer Earnings"?c.clientTotal:metric==="Payments"?c.paid:c.gross)},0); }
function salesChart(metric="Gross Sales"){
  const ms=sixMonths(), vals=ms.map(m=>metricTotal(m,metric)), max=Math.max(...vals,1);
  return `<div class="bars">${vals.map((v,i)=>`<div class="bar-col"><div class="bar-value">${money(v)}</div><div class="bar" style="height:${Math.max(8,(v/max)*150)}px"></div><small>${new Date(ms[i]+"-01").toLocaleString("en-US",{month:"short"})}</small></div>`).join("")}</div>`;
}
function topUnitsHtml(rows){ return rows.length?rows.map((x,i)=>`<div class="rank-row"><span class="rank-num">${i+1}</span><span><b>${esc(x.u.unitCode)}</b><small>${esc(x.u.name)}</small></span><strong>${money(x.c.gross)}</strong></div>`).join(""):empty("No sales recorded for this period."); }
function renderTopUnits(period){
  const ms=period==="month"?[selectedMonth]:period==="last"?[shiftMonth(selectedMonth,-1)]:period==="3"?rangeMonths(3):yearMonths(selectedMonth);
  const map=units.map(u=>{const gross=records.filter(r=>r.unitId===u.id&&ms.includes(r.month)).reduce((s,r)=>s+Number(r.grossSales||0),0);return{u,c:{gross}}}).sort((a,b)=>b.c.gross-a.c.gross).slice(0,5);
  $("#topUnits").innerHTML=topUnitsHtml(map);
}
function shiftMonth(k,delta){const [y,m]=k.split("-").map(Number);const d=new Date(y,m-1+delta,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;}
function rangeMonths(n){return Array.from({length:n},(_,i)=>shiftMonth(selectedMonth,-i));}
function yearMonths(k){const y=Number(k.slice(0,4));return Array.from({length:12},(_,i)=>`${y}-${String(i+1).padStart(2,"0")}`);}

function updateWiFiSubscriptionSummary(){const el=$("#wifiSubscriptionSummary");if(!el)return;const upcoming=wifiSubscriptions.filter(x=>{const d=subscriptionDate(x.periodEnd);return d&&d>=new Date()&&d<=new Date(Date.now()+7*86400000)});el.innerHTML=`<b>Total paid: ${money(subscriptionTotalPaid())}</b> · ${wifiSubscriptions.length} payment record(s) · <span style="color:${upcoming.length?"#c2410c":"#15803d"}">${upcoming.length} subscription(s) ending within 7 days</span>${upcoming.length?`<ul>${upcoming.map(x=>`<li>${esc(x.wifiName)} — ${esc(expiryLabel(x))}</li>`).join("")}</ul>`:""}`;}

function renderUnits(){
  const rows=normalizeRows().filter(x=>(!unitSearch||`${x.u.name} ${x.u.unitCode} ${x.u.location} ${x.u.contact}`.toLowerCase().includes(unitSearch.toLowerCase()))&&(!unitStatus||String(x.u.active!==false?"Active":"Inactive")===unitStatus)&&(!unitPaymentStatus||x.c.status===unitPaymentStatus));
  view.innerHTML=baseHead("Units / Clients","Manage your Piso WiFi units and clients.",`<button class="primary-btn" id="addUnitBtn">+ Add New Client</button>`)+`<div class="panel"><div class="panel-head"><div><h3>Registered Units</h3><p>Showing ${rows.length} of ${units.length} units · ${monthLabel(selectedMonth)}</p></div><div class="tools"><input id="unitSearch" class="search" placeholder="Search client or unit…" value="${esc(unitSearch)}"><select id="unitStatus" class="search"><option value="">All Status</option><option ${unitStatus==="Active"?"selected":""}>Active</option><option ${unitStatus==="Inactive"?"selected":""}>Inactive</option></select><select id="unitPaymentStatus" class="search"><option value="">All Payment Status</option><option ${unitPaymentStatus==="Paid"?"selected":""}>Paid</option><option ${unitPaymentStatus==="Partial"?"selected":""}>Partial</option><option ${unitPaymentStatus==="Unpaid"?"selected":""}>Unpaid</option></select><button class="secondary-btn" id="exportUnits">Export Excel/CSV</button></div></div><div class="table-wrap accumulating-table"><table><thead><tr><th>Unit Code</th><th>Client Name</th><th>Location</th><th>Contact</th><th>Status</th><th>This Month</th><th>Payment</th><th>Actions</th></tr></thead><tbody>${rows.length?rows.map(x=>`<tr><td><b>${esc(x.u.unitCode||"—")}</b></td><td>${esc(x.u.name||"—")}</td><td>${esc(x.u.location||"—")}</td><td>${esc(x.u.contact||"—")}</td><td>${statusBadge(x.u.active!==false?"Active":"Inactive")}</td><td class="amount">${money(x.c.gross)}</td><td>${statusBadge(x.c.status)}</td><td><button class="action-btn" data-sale="${x.u.id}">Gross Sale</button><button class="action-btn" data-profile="${x.u.id}">View</button><button class="action-btn" data-edit-unit="${x.u.id}">Edit</button><button class="action-btn danger" data-toggle-unit="${x.u.id}">${x.u.active!==false?"Deactivate":"Activate"}</button>${ENABLE_CLIENT_DELETE?`<button class="action-btn danger solid-danger" data-delete-unit="${x.u.id}">Delete</button>`:""}</td></tr>`).join(""):emptyRow(8,"No clients or units found.")}</tbody></table></div></div>`;
  $("#addUnitBtn").onclick=()=>openUnitModal();
  $("#unitSearch").oninput=e=>{unitSearch=e.target.value;renderUnits()};
  $("#unitStatus").onchange=e=>{unitStatus=e.target.value;renderUnits()};
  $("#unitPaymentStatus").onchange=e=>{unitPaymentStatus=e.target.value;renderUnits()};
  $("#exportUnits").onclick=()=>exportUnitsExcel(rows);
  bindDynamicButtons();
}
function exportUnitsCsv(rows){ downloadCsv(`piso-wifi-units-${selectedMonth}.csv`,[["Unit Code","Client","Location","Contact","Status","Gross Sales","Amount Due","Paid","Balance","Payment Status"],...rows.map(x=>[x.u.unitCode,x.u.name,x.u.location,x.u.contact,x.u.active!==false?"Active":"Inactive",x.c.gross,x.c.clientTotal,x.c.paid,x.c.balance,x.c.status])]); }

function renderReports(){
  const rows=normalizeRows(), t=totals(rows);
  view.innerHTML=baseHead("Monthly Reports","View and export monthly summaries.",`<div class="tools"><button class="secondary-btn" id="downloadReport">Download</button><button class="primary-btn" id="printReport">Print</button></div>`)+`<div class="report-cards">${reportCard("Total Units",units.length)}${reportCard("Total Gross Sales",money(t.gross))}${reportCard("Total Internet Cost",money(t.internet))}${reportCard("Total Owner Earn",money(Math.max(0,t.owner-t.elec)),"green")}${reportCard("Customer Earnings",money(t.due),"customer-earnings")}${reportCard("Client Net",money(t.due),"customer-net")}${reportCard("Total Electricity",money(t.elec))}${reportCard("Total Amount Due",money(t.due))}${reportCard("Customer Accumulated Earnings",money(t.paid),"green")}${reportCard("Outstanding",money(t.balance),"red")}</div><div class="panel"><div class="panel-head"><div><h3>${monthLabel(selectedMonth)} Detail</h3><p>All calculations use the current business settings.</p></div><span class="report-rule">Internet ${money(settings.internetCost)} separate · Owner ${settings.ownerPercent}% · Client ${settings.clientPercent}% · Electricity +${money(settings.electricity)}</span></div><div class="table-wrap"><table><thead><tr><th>Unit</th><th>Client</th><th>Gross Sales</th><th>Internet</th><th>Net Sales</th><th>Owner Share</th><th>Customer Earnings</th><th>Electricity</th><th>Client Net</th><th>Amount Due</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rows.length?rows.map(x=>`<tr><td>${esc(x.u.unitCode)}</td><td>${esc(x.u.name)}</td><td>${money(x.c.gross)}</td><td>${money(x.c.internet)}</td><td>${money(x.c.net)}</td><td>${money(x.c.owner)}</td><td>${money(x.c.clientTotal)}</td><td>${money(x.c.elec)}</td><td>${money(x.c.clientTotal)}</td><td>${money(x.c.clientTotal)}</td><td>${money(x.c.paid)}</td><td class="amount">${money(x.c.balance)}</td><td>${statusBadge(x.c.status)}</td></tr>`).join(""):emptyRow(13,"No sales recorded for this month.")}</tbody></table></div></div>`;
  $("#downloadReport").onclick=()=>downloadReportHtml(t,rows); $("#printReport").onclick=()=>printReport(t,rows);
}
function reportCard(label,value,cls=""){return `<article class="report-card ${cls}"><span>${label}</span><strong>${value}</strong></article>`;}
function exportReportCsv(rows){downloadCsv(`piso-wifi-report-${selectedMonth}.csv`,[["Unit","Client","Gross Sales","Internet","Net Sales","Owner Share","Client Share","Electricity","Client Net","Amount Due","Paid","Balance","Status"],...rows.map(x=>[x.u.unitCode,x.u.name,x.c.gross,x.c.internet,x.c.net,x.c.owner,x.c.client,x.c.elec,x.c.clientTotal,x.c.clientTotal,x.c.paid,x.c.balance,x.c.status])]);}
function exportReportExcel(rows){downloadXlsx(`piso-wifi-report-${selectedMonth}.xlsx`,"Monthly Report",[["Unit","Client","Gross Sales","Internet","Net Sales","Owner Share","Client Share","Electricity","Client Net","Amount Due","Paid","Balance","Status"],...rows.map(x=>[x.u.unitCode,x.u.name,x.c.gross,x.c.internet,x.c.net,x.c.owner,x.c.client,x.c.elec,x.c.clientTotal,x.c.clientTotal,x.c.paid,x.c.balance,x.c.status])]);}
function reportDocumentHtml(t,rows){return `<!doctype html><html><head><meta charset="utf-8"><title>PISO WIFI Monthly Report — ${esc(monthLabel(selectedMonth))}</title><style>${printCss()}body{max-width:1200px;margin:auto}.brand{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1685f5;padding-bottom:16px}.customer-net{background:#eef8ff!important;border:1px solid #bfe1ff!important}.amount{text-align:right;font-weight:700}</style></head><body><div class="brand"><div><h1>PISO WIFI</h1><p>Management System · Monthly Report</p></div><div><b>${monthLabel(selectedMonth)}</b><br>Generated ${dateLabel(new Date())}</div></div><div class="print-grid">${[["Total Units",units.length],["Gross Sales",money(t.gross)],["Internet",money(t.internet)],["Total Owner Earn",money(Math.max(0,t.owner-t.elec))],["Client Share",money(t.client)],["Client Net",money(t.due)],["Electricity",money(t.elec)],["Amount Due",money(t.due)],["Customer Accumulated Earnings",money(t.paid)],["Outstanding",money(t.balance)]].map(x=>`<div class="${x[0]==="Client Net"?"customer-net":""}"><b>${x[0]}</b><strong>${x[1]}</strong></div>`).join("")}</div><table><thead><tr><th>Unit</th><th>Client</th><th>Gross</th><th>Internet</th><th>Net</th><th>Owner</th><th>Client</th><th>Electricity</th><th>Client Net</th><th>Due</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.u.unitCode)}</td><td>${esc(x.u.name)}</td><td>${money(x.c.gross)}</td><td>${money(x.c.internet)}</td><td>${money(x.c.net)}</td><td>${money(x.c.owner)}</td><td>${money(x.c.clientTotal)}</td><td>${money(x.c.elec)}</td><td>${money(x.c.clientTotal)}</td><td>${money(x.c.clientTotal)}</td><td>${money(x.c.paid)}</td><td>${money(x.c.balance)}</td><td>${esc(x.c.status)}</td></tr>`).join("")}</tbody></table></body></html>`;}
function downloadReportHtml(t,rows){downloadHtmlFile(`piso-wifi-report-${selectedMonth}.html`,reportDocumentHtml(t,rows));}
function downloadXlsx(name,sheetName,data){if(!window.XLSX){notify("Excel exporter is still loading. Please try again.","error");return;}const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet(data);XLSX.utils.book_append_sheet(wb,ws,sheetName);XLSX.writeFile(wb,name);}
function downloadCsv(name,data){const csv=data.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);}
function printReport(t,rows){openPrintWindow(reportDocumentHtml(t,rows));}

function renderPayments(){
  const rows=normalizeRows().filter(x=>x.c.balance>0);
  const all=payments.filter(p=>p.month===selectedMonth).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  view.innerHTML=baseHead("Payments","Record and track client payments.",`<button class="primary-btn" id="recordPayment">+ Record Payment</button>`)+`<div class="summary-grid"><div class="summary-card"><h3>TOTAL GROSS THIS MONTH</h3><strong>${money(totals(normalizeRows()).gross)}</strong></div><div class="summary-card"><h3>CLIENT EARNINGS</h3><strong>${money(totals(normalizeRows()).client)}</strong></div><div class="summary-card"><h3>ELECTRICITY</h3><strong class="success-text">${money(totals(normalizeRows()).elec)}</strong></div><div class="summary-card"><h3>TOTAL CUSTOMER EARNINGS</h3><strong class="danger-text">${money(totals(normalizeRows()).due)}</strong></div></div><div class="panel"><div class="panel-head"><div><h3>Outstanding Payments</h3><p>Clients with balances for ${monthLabel(selectedMonth)}</p></div><button class="secondary-btn" id="paymentSearchAll">Show Payment History</button></div><div class="table-wrap"><table><thead><tr><th>Unit</th><th>Client</th><th>Amount Due</th><th>Paid</th><th>Balance</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.length?rows.map(x=>`<tr><td>${esc(x.u.unitCode)}</td><td>${esc(x.u.name)}</td><td>${money(x.c.clientTotal)}</td><td>${money(x.c.paid)}</td><td class="amount">${money(x.c.balance)}</td><td>${statusBadge(x.c.status)}</td><td><button class="action-btn" data-payment="${x.u.id}">Record Payment</button></td></tr>`).join(""):emptyRow(7,"No outstanding payments.")}</tbody></table></div></div><div class="panel" id="paymentHistory"><div class="panel-head"><div><h3>Payment History</h3><p>${monthLabel(selectedMonth)}</p></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Unit</th><th>Client</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead><tbody>${all.length?all.map(p=>{const u=units.find(x=>x.id===p.unitId);return `<tr><td>${dateLabel(p.date)}</td><td>${esc(u?.unitCode||"—")}</td><td>${esc(u?.name||"—")}</td><td class="amount">${money(p.amount)}</td><td>${esc(p.method||"—")}</td><td>${esc(p.reference||"—")}</td></tr>`}).join(""):emptyRow(6,"No payments recorded.")}</tbody></table></div></div>`;
  $("#recordPayment").onclick=()=>openPaymentModal(); $("#paymentSearchAll").onclick=()=>$("#paymentHistory").scrollIntoView({behavior:"smooth"}); bindDynamicButtons();
}

function renderStatements(){
  view.innerHTML=baseHead("Client Statements","Generate printable statements for a selected client/month.",`<button class="secondary-btn" id="printSelectedStatement">Print Selected Statement</button>`)+`<div class="panel"><div class="panel-head"><div><h3>Statement of Account</h3><p>Select a client and month.</p></div><div class="tools"><select class="search" id="statementUnit"><option value="">Select client / unit</option>${units.map(u=>`<option value="${u.id}">${esc(u.unitCode)} — ${esc(u.name)}</option>`).join("")}</select><select class="search" id="statementMonth">${monthsList().map(m=>`<option value="${m}" ${m===selectedMonth?"selected":""}>${monthLabel(m)}</option>`).join("")}</select></div></div><div id="statementPreview" class="statement-preview">${empty("Select a client to view the statement.")}</div></div>`;
  $("#statementUnit").onchange=()=>renderStatementPreview(); $("#statementMonth").onchange=()=>renderStatementPreview(); $("#printSelectedStatement").onclick=()=>{const id=$("#statementUnit").value;if(id)printStatement(id,$("#statementMonth").value);else notify("Select a client first.","error");};
}
function statementData(unitId,month){ const u=units.find(x=>x.id===unitId); const r=records.find(x=>x.unitId===unitId&&x.month===month)||{unitId,month,grossSales:0}; return {u,r,c:calc(r)}; }
function renderStatementPreview(){ const id=$("#statementUnit").value; if(!id){$("#statementPreview").innerHTML=empty("Select a client to view the statement.");return;} const month=$("#statementMonth").value; const {u,c}=statementData(id,month); $("#statementPreview").innerHTML=statementHtml(u,c,month); }
function statementHtml(u,c,month){return `<div class="statement-sheet"><div class="statement-brand"><div class="statement-logo">◔</div><div><h2>PISO WIFI</h2><span>Management System</span></div><div class="statement-actions"><button class="primary-btn" data-print-inline="1">Print</button><button class="secondary-btn" data-html-inline="1">Download</button></div></div><div class="statement-meta"><div><b>Client:</b><span>${esc(u?.name||"—")}</span><b>Unit:</b><span>${esc(u?.unitCode||"—")}</span><b>Location:</b><span>${esc(u?.location||"—")}</span><b>Contact:</b><span>${esc(u?.contact||"—")}</span></div><div><b>Period:</b><span>${monthLabel(month)}</span><b>Date Generated:</b><span>${dateLabel(new Date())}</span><b>Status:</b><span>${c.status}</span></div></div><table class="statement-table"><tbody><tr><td>Gross Sales</td><td>${money(c.gross)}</td></tr><tr><td>Internet Cost</td><td>${money(c.internet)}</td></tr><tr><td>Net Sales</td><td>${money(c.net)}</td></tr><tr><td>Owner Share (${settings.ownerPercent}%)</td><td>${money(c.owner)}</td></tr><tr><td>Client Share (${settings.clientPercent}%)</td><td>${money(c.client)}</td></tr><tr><td>Electricity Share</td><td>${money(c.elec)}</td></tr><tr><td>Miscellaneous Fee</td><td>${money(c.miscellaneous)}</td></tr><tr class="customer-net"><td>Customer Earnings</td><td>${money(c.clientTotal)}</td></tr><tr class="total"><td>Amount Due</td><td>${money(c.clientTotal)}</td></tr><tr><td>Payments</td><td>${money(c.paid)}</td></tr><tr class="balance"><td>Balance</td><td>${money(c.balance)}</td></tr></tbody></table></div>`;}
function statementDocumentHtml(u,c,month){return `<!doctype html><html><head><meta charset="utf-8"><title>PISO WIFI Statement — ${esc(u?.unitCode||"client")} — ${esc(month)}</title><style>${printCss()}body{max-width:900px;margin:auto}.brand{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1685f5;padding-bottom:16px}.customer-net td{background:#eef8ff!important;font-weight:850}.total td{background:#fff7df!important;font-weight:850}.balance td{background:#fff0f2!important;color:#e94355!important;font-weight:850}</style></head><body><div class="brand"><div><h1>PISO WIFI</h1><p>Management System — Statement of Account</p></div><div><b>${esc(monthLabel(month))}</b><br>Generated ${esc(dateLabel(new Date()))}</div></div><div style="margin:20px 0"><b>Client:</b> ${esc(u?.name||"—")}<br><b>Unit:</b> ${esc(u?.unitCode||"—")}<br><b>Location:</b> ${esc(u?.location||"—")}<br><b>Contact:</b> ${esc(u?.contact||"—")}<br><b>Status:</b> ${esc(c.status)}</div><table><tbody><tr><th>Gross Sales</th><td>${money(c.gross)}</td></tr><tr><th>Internet Cost</th><td>${money(c.internet)}</td></tr><tr><th>Net Sales</th><td>${money(c.net)}</td></tr><tr><th>Owner Share (${settings.ownerPercent}%)</th><td>${money(c.owner)}</td></tr><tr><th>Client Share (${settings.clientPercent}%)</th><td>${money(c.client)}</td></tr><tr><th>Electricity Share</th><td>${money(c.elec)}</td></tr><tr class="customer-net"><th>Client Net</th><td>${money(Math.max(0,c.client-c.elec))}</td></tr><tr class="total"><th>Amount Due</th><td>${money(c.clientTotal)}</td></tr><tr><th>Payments</th><td>${money(c.paid)}</td></tr><tr class="balance"><th>Balance</th><td>${money(c.balance)}</td></tr></tbody></table></body></html>`;}
function downloadStatementHtml(id,month){const {u,c}=statementData(id,month);downloadHtmlFile(`piso-wifi-statement-${u?.unitCode||"client"}-${month}.html`,statementDocumentHtml(u,c,month));}
function downloadHtmlFile(name,html){const blob=new Blob([html],{type:"text/html;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function downloadStatementPdf(id,month){
  const {u,c}=statementData(id,month);
  const api=window.jspdf;
  if(!api?.jsPDF){notify("PDF exporter is still loading. Please try again.","error");return;}
  const pdf=new api.jsPDF();
  pdf.setFontSize(18); pdf.text("PISO WIFI",20,20);
  pdf.setFontSize(10); pdf.setTextColor(100,116,139); pdf.text("Management System — Statement of Account",20,27);
  pdf.setTextColor(23,36,58); pdf.setFontSize(11);
  pdf.text(`Client: ${u?.name||"—"}`,20,40); pdf.text(`Unit: ${u?.unitCode||"—"}`,20,47); pdf.text(`Location: ${u?.location||"—"}`,20,54); pdf.text(`Period: ${monthLabel(month)}`,125,40); pdf.text(`Status: ${c.status}`,125,47);
  const lines=[["Gross Sales",money(c.gross)],["Internet Cost",money(c.internet)],["Net Sales",money(c.net)],[`Owner Share (${settings.ownerPercent}%)`,money(c.owner)],[`Client Share (${settings.clientPercent}%)`,money(c.client)],["Electricity Share",money(c.elec)],["Miscellaneous Fee",money(c.miscellaneous)],["Customer Earnings",money(c.clientTotal)],["Amount Due",money(c.clientTotal)],["Payments",money(c.paid)],["Balance",money(c.balance)]];
  let y=70; pdf.setFontSize(10); lines.forEach(([label,value],i)=>{if(i===5)pdf.setFont(undefined,"bold");pdf.text(label,22,y);pdf.text(value,170,y,{align:"right"});pdf.setDrawColor(225,231,239);pdf.line(20,y+3,190,y+3);if(i===5)pdf.setFont(undefined,"normal");y+=12;});
  pdf.save(`piso-wifi-statement-${u?.unitCode||"client"}-${month}.pdf`);
}
function printStatement(id,month){const {u,c}=statementData(id,month);openPrintWindow(statementDocumentHtml(u,c,month));}

function renderNotifications(){
  view.innerHTML=baseHead("Notifications","Stay updated on payments, balances, reports and system changes.",`<button class="secondary-btn" id="markAllRead">Mark all as read</button>`)+`<div class="notification-list">${notifications.length?notifications.map(n=>`<button class="notification-card ${n.read===true?"read":"unread"}" data-notification="${n.id}"><span class="notification-icon">${n.type==="payment"?"₱":n.type==="balance"?"!":n.type==="report"?"▥":n.type==="password-reset"?"🔐":"●"}</span><span><b>${esc(n.title)}</b><small>${esc(n.message)}</small><time>${dateTimeLabel(n.createdAt)}</time></span>${n.read!==true?"<em>NEW</em>":""}</button>`).join(""):empty("You're all caught up.")}</div>`;
  $("#markAllRead").onclick=markAllNotificationsRead; document.querySelectorAll("[data-notification]").forEach(b=>b.onclick=()=>openNotification(b.dataset.notification));
}
async function openNotification(id){const n=notifications.find(x=>x.id===id);if(!n)return;if(n.read!==true){await updateDoc(doc(db,"notifications",id),{read:true});await loadData();} if(n.relatedId && units.some(u=>u.id===n.relatedId)){openProfile(n.relatedId);}else{render();}}
async function markAllNotificationsRead(){const unread=notifications.filter(n=>n.read!==true);await Promise.all(unread.map(n=>updateDoc(doc(db,"notifications",n.id),{read:true})));await loadData();render();notify("All notifications marked as read.");}

function renderActivity(){
  view.innerHTML=baseHead("Activity Log","Track important system, client, sales, payment and settings actions.",`<select class="search" id="activityFilter"><option value="">All Activities</option><option>System</option><option>Sales</option><option>Payments</option><option>Clients</option><option>Units</option><option>Settings</option><option>Reports</option></select>`)+`<div class="panel"><div class="panel-head"><div><h3>Recent Activity</h3><p>Newest actions appear first and are stored in Firebase.</p></div></div><div class="table-wrap"><table><thead><tr><th>Date & Time</th><th>Activity</th><th>Details</th><th>Admin</th></tr></thead><tbody id="activityBody">${activityRows("")}</tbody></table></div></div>`;
  $("#activityFilter").onchange=e=>$("#activityBody").innerHTML=activityRows(e.target.value);
}
function activityRows(filter){const list=activities.filter(a=>!filter||a.activityType===filter);return list.length?list.map(a=>`<tr><td>${dateTimeLabel(a.createdAt)}</td><td><span class="activity-dot"></span>${esc(a.activityType||"Activity")}</td><td>${esc(a.description||"—")}</td><td>${esc(a.userEmail||currentUser?.email||"Admin")}</td></tr>`).join(""):emptyRow(4,"No activity recorded yet. Actions you perform will appear here automatically.");}

let wifiSubscriptions=[];
function subscriptionDate(v){if(!v)return null;const d=v?.toDate?v.toDate():new Date(v);return Number.isNaN(d.getTime())?null:d;}
function subscriptionTotalPaid(){return wifiSubscriptions.reduce((sum,x)=>sum+Math.max(0,Number(x.paymentAmount||0)),0);}
function expiryLabel(x){const end=subscriptionDate(x.periodEnd);if(!end)return "No end date";const days=Math.ceil((new Date(end.getFullYear(),end.getMonth(),end.getDate())-new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()))/86400000);if(days<0)return `Expired ${Math.abs(days)} day(s) ago`;if(days===0)return "Expires today";if(days<=7)return `Ends in ${days} day(s)`;return `Ends ${end.toLocaleDateString()}`;}
function subscriptionEndingSoon(x){const d=subscriptionDate(x.periodEnd);return !!d&&d>=new Date(new Date().setHours(0,0,0,0))&&d<=new Date(Date.now()+7*86400000);}
async function loadWiFiSubscriptions(){
  const snap=await getDocs(collection(db,"wifiSubscriptions"));
  wifiSubscriptions=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(subscriptionDate(b.paymentDate)?.getTime()||0)-(subscriptionDate(a.paymentDate)?.getTime()||0));
  updateWiFiSubscriptionSummary();
  // Create one Admin notification per subscription end date when it enters the
  // 7-day reminder window. Updating the period later allows a fresh reminder.
  for(const sub of wifiSubscriptions){
    const end=subscriptionDate(sub.periodEnd);if(!end)continue;
    const days=Math.ceil((new Date(end.getFullYear(),end.getMonth(),end.getDate())-new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()))/86400000);
    if(days<0||days>7||sub.expiryReminderSentFor===sub.periodEnd)continue;
    try{
      await addDoc(collection(db,"notifications"),{type:"wifi-subscription-expiry",title:"WiFi subscription expiring soon",message:`${sub.wifiName||"WiFi subscription"} — ${days===0?"expires today":`expires in ${days} day(s)`} (${sub.periodEnd}). Please review renewal/payment.`,relatedId:sub.id,read:false,createdAt:serverTimestamp()});
      await updateDoc(doc(db,"wifiSubscriptions",sub.id),{expiryReminderSentFor:sub.periodEnd,expiryReminderSentAt:serverTimestamp()});
      sub.expiryReminderSentFor=sub.periodEnd;
    }catch(error){console.warn("Could not save WiFi subscription expiry reminder",sub.id,error);}
  }
}
function renderWiFiSubscriptions(){
  const ending=wifiSubscriptions.filter(subscriptionEndingSoon).length;
  view.innerHTML=baseHead("WiFi Subscription","Track WiFi subscriptions, payments, receipts and renewal reminders.",`<button class="primary-btn" id="addWiFiSubscription">+ Add WiFi Subscription</button>`)+`<div class="report-cards">${reportCard("Total Paid",money(subscriptionTotalPaid()),"green")}${reportCard("Subscriptions",wifiSubscriptions.length)}${reportCard("Ending Soon",ending,ending?"red":"green")}</div>${ending?`<div class="notice" style="margin-bottom:16px;border-left:4px solid #d97706"><b>Upcoming expiry reminders</b><ul>${wifiSubscriptions.filter(subscriptionEndingSoon).map(x=>`<li>${esc(x.wifiName)} — ${esc(expiryLabel(x))}</li>`).join("")}</ul></div>`:""}<div class="panel"><div class="panel-head"><div><h3>Subscription Payment History</h3><p>Every saved payment and receipt is listed here. Receipt images are stored in Firestore, not Firebase Storage.</p></div></div><div class="table-wrap"><table><thead><tr><th>Wi-Fi Name</th><th>Subscription Info</th><th>Payment</th><th>Payment Date</th><th>Period</th><th>Mode</th><th>Reference</th><th>Receipt</th><th>Reminder</th></tr></thead><tbody>${wifiSubscriptions.length?wifiSubscriptions.map(x=>{const d=subscriptionDate(x.periodEnd),soon=subscriptionEndingSoon(x),expired=d&&d<new Date(new Date().setHours(0,0,0,0));return `<tr><td>${esc(x.wifiName||"—")}</td><td>${esc(x.subscriptionInfo||"—")}</td><td>${money(x.paymentAmount)}</td><td>${esc(x.paymentDate||"—")}</td><td>${esc(x.periodStart||"—")} – ${esc(x.periodEnd||"—")}</td><td>${esc(x.paymentMode||"—")}</td><td>${esc(x.referenceNumber||"—")}</td><td>${x.receiptDataUrl?`<button type="button" class="action-btn" data-view-wifi-receipt="${x.id}">View</button> <button type="button" class="action-btn" data-download-wifi-receipt="${x.id}">Download</button>`:"—"}</td><td style="color:${soon||expired?"#d33":"#15803d"};font-weight:700">${esc(expiryLabel(x))}</td></tr>`}).join(""):`<tr><td colspan="9">No WiFi subscriptions recorded yet.</td></tr>`}</tbody></table></div></div>`;
  $("#addWiFiSubscription")?.addEventListener("click",openWiFiSubscriptionModal);
  document.querySelectorAll("[data-view-wifi-receipt]").forEach(b=>b.addEventListener("click",()=>viewWiFiReceipt(b.dataset.viewWifiReceipt)));
  document.querySelectorAll("[data-download-wifi-receipt]").forEach(b=>b.addEventListener("click",()=>downloadWiFiReceipt(b.dataset.downloadWifiReceipt)));
}
function compressReceiptImage(file){
  return new Promise((resolve,reject)=>{
    if(!file||!file.type.startsWith("image/")){reject(new Error("Please upload a JPG, PNG or WEBP receipt photo."));return;}
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error("Could not read the receipt image."));
    reader.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error("This receipt image could not be opened. Try a JPG or PNG photo."));
      img.onload=()=>{
        const maxDimension=1400,scale=Math.min(1,maxDimension/Math.max(img.width,img.height));
        const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
        const ctx=canvas.getContext("2d");if(!ctx){reject(new Error("Image compression is not supported by this browser."));return;}
        ctx.fillStyle="#ffffff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
        let quality=.78,data=canvas.toDataURL("image/jpeg",quality);
        while(data.length>650000&&quality>.35){quality-=.08;data=canvas.toDataURL("image/jpeg",quality);}
        if(data.length>650000){const shrink=Math.sqrt(500000/data.length);canvas.width=Math.max(1,Math.round(canvas.width*shrink));canvas.height=Math.max(1,Math.round(canvas.height*shrink));ctx.drawImage(img,0,0,canvas.width,canvas.height);data=canvas.toDataURL("image/jpeg",.48);}
        if(data.length>700000){reject(new Error("Receipt photo is too large after compression. Please crop the image closer to the receipt and try again."));return;}
        resolve({dataUrl:data,mimeType:"image/jpeg",fileName:(file.name||"receipt").replace(/\.[^.]+$/,".jpg"),size:data.length});
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function viewWiFiReceipt(id){const x=wifiSubscriptions.find(r=>r.id===id);if(!x?.receiptDataUrl)return;const root=$("#modalRoot");root.innerHTML=`<div class="modal-backdrop" id="receiptBackdrop"><div class="modal" style="width:min(900px,96vw)"><div class="modal-head"><h3>${esc(x.wifiName)} — Receipt</h3><button class="close" id="closeReceipt">×</button></div><div class="modal-body" style="text-align:center"><img src="${x.receiptDataUrl}" alt="Receipt for ${esc(x.wifiName)}" style="max-width:100%;max-height:68vh;object-fit:contain;border:1px solid #e2e8f0;border-radius:8px"></div><div class="modal-actions"><button class="secondary-btn" id="cancelReceipt">Close</button><button class="primary-btn" id="downloadReceiptNow">Download Receipt</button></div></div></div>`;$("#closeReceipt").onclick=closeModal;$("#cancelReceipt").onclick=closeModal;$("#downloadReceiptNow").onclick=()=>downloadWiFiReceipt(id);}
function downloadWiFiReceipt(id){const x=wifiSubscriptions.find(r=>r.id===id);if(!x?.receiptDataUrl)return;const a=document.createElement("a");a.href=x.receiptDataUrl;a.download=x.receiptFileName||`wifi-receipt-${id}.jpg`;document.body.appendChild(a);a.click();a.remove();}
function openWiFiSubscriptionModal(){
  openModal("Add WiFi Subscription",`<div class="form-grid"><div class="field full"><label>Wi-Fi Name *</label><input id="wsName" required placeholder="PLDT"></div><div class="field full"><label>WiFi Subscription Information *</label><input id="wsInfo" required placeholder="UNLI FIBER"></div><div class="field"><label>Payment Information (Amount Paid) *</label><input id="wsAmount" type="number" min="0.01" step="0.01" required placeholder="Amount paid"></div><div class="field"><label>Subscription Period *</label><div style="display:flex;gap:8px"><input id="wsStart" type="date" required aria-label="Period start"><input id="wsEnd" type="date" required aria-label="Period end"></div></div><div class="field"><label>Payment Date *</label><input id="wsPaymentDate" type="date" required value="${new Date().toISOString().slice(0,10)}"></div><div class="field"><label>Mode of Payment *</label><select id="wsMode"><option>GCash</option><option>Bank Transfer</option><option>Cash</option><option>Credit/Debit Card</option><option>Other</option></select></div><div class="field full"><label>Reference Number</label><input id="wsReference" placeholder="Reference / transaction number"></div><div class="field full"><label>Upload Photo of Receipt *</label><input id="wsReceipt" type="file" accept="image/jpeg,image/png,image/webp" required><small>JPG, PNG or WEBP only. The photo is compressed and saved in Firestore. No Firebase Storage or billing upgrade is used. Please use a clear, cropped photo of the receipt.</small></div></div>`,"Save Subscription Payment",async()=>{
    const wifiName=$("#wsName").value.trim(),subscriptionInfo=$("#wsInfo").value.trim(),paymentAmount=Number($("#wsAmount").value),periodStart=$("#wsStart").value,periodEnd=$("#wsEnd").value,paymentDate=$("#wsPaymentDate").value,paymentMode=$("#wsMode").value,referenceNumber=$("#wsReference").value.trim(),file=$("#wsReceipt").files[0];
    if(!wifiName||!subscriptionInfo||!(paymentAmount>0)||!periodStart||!periodEnd||periodEnd<periodStart||!paymentDate||!file)throw new Error("Complete all required fields and ensure the subscription end date is on or after the start date.");
    if(file.size>15*1024*1024)throw new Error("Choose a receipt photo smaller than 15 MB before compression.");
    const receipt=await compressReceiptImage(file);
    await addDoc(collection(db,"wifiSubscriptions"),{wifiName,subscriptionInfo,paymentAmount,periodStart,periodEnd,paymentDate,paymentMode,referenceNumber,receiptDataUrl:receipt.dataUrl,receiptMimeType:receipt.mimeType,receiptFileName:receipt.fileName,receiptSize:receipt.size,createdBy:currentUser.uid,createdAt:serverTimestamp()});
    await logActivity("WiFi Subscription",`Recorded subscription payment for ${wifiName} — ${money(paymentAmount)}`);await loadWiFiSubscriptions();
  });
}

// CASHIER SALES — Admin review and corrections. Cashier-submitted records are read-only to the cashier.
function renderCashierSales(){
  view.innerHTML=baseHead("Cashier Sales","Review submitted sales and make corrections as Admin.",'<button class="secondary-btn" id="refreshCashierSales">Refresh</button>')+`<div class="panel"><div class="panel-head"><div><h3>Submitted Sales</h3><p>Cashier entries are locked after submission. Only Admin can edit these records.</p></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Customer</th><th>Unit Code</th><th>Cashier</th><th>Gross Sales</th><th>Internet Fee</th><th>Electricity</th><th>30% Earnings</th><th>Total Customer Earn</th><th>Status</th><th>Action</th></tr></thead><tbody id="cashierSalesBody"><tr><td colspan="11">Loading sales…</td></tr></tbody></table></div></div>`;
  const body=$("#cashierSalesBody");
  const paint=rows=>{cashierSales=rows.sort((a,b)=>timeValue(b.createdAt)-timeValue(a.createdAt));if(!$("#cashierSalesBody"))return;$("#cashierSalesBody").innerHTML=rows.length?rows.map(x=>`<tr><td>${dateTimeLabel(x.createdAt)}</td><td>${esc(x.customerName||"—")}</td><td>${esc(x.unitCode||"—")}</td><td>${esc(x.cashierName||"—")}</td><td>${money(x.grossSales)}</td><td>${money(x.internetFee??1000)}</td><td>${money(x.electricityShare??100)}</td><td>${money(x.clientShare??Number(x.grossSales||0)*.3)}</td><td><b>${money(x.totalCustomerEarnings??Number(x.grossSales||0)*.3+100)}</b></td><td>${statusBadge(x.status||"PENDING ADMIN REVIEW")}</td><td><button class="action-btn" data-edit-cashier-sale="${esc(x.id)}">Edit / Review</button></td></tr>`).join(""):`<tr><td colspan="11">No cashier sales submitted yet.</td></tr>`;document.querySelectorAll("[data-edit-cashier-sale]").forEach(b=>b.onclick=()=>editCashierSale(b.dataset.editCashierSale));};
  if(cashierSalesUnsub)cashierSalesUnsub();cashierSalesUnsub=onSnapshot(collection(db,"cashierTransactions"),snap=>paint(snap.docs.map(d=>({id:d.id,...d.data()}))),err=>{if(body)body.innerHTML=`<tr><td colspan="11">Could not load cashier sales: ${esc(err.message||"Check Firestore Rules")}</td></tr>`;});
  $("#refreshCashierSales").onclick=async()=>{try{const snap=await getDocs(collection(db,"cashierTransactions"));paint(snap.docs.map(d=>({id:d.id,...d.data()})));}catch(e){toast(e.message||"Could not refresh sales.","error");}};
}
async function editCashierSale(id){
  const x=cashierSales.find(r=>r.id===id);if(!x)return;
  const grossInput=window.prompt("Correct Gross Sales (₱):",String(x.grossSales??0));if(grossInput===null)return;const gross=Number(grossInput);if(!(gross>0)){alert("Gross sales must be greater than zero.");return;}
  const status=window.prompt("Set status (PENDING ADMIN REVIEW, APPROVED, or REJECTED):",String(x.status||"PENDING ADMIN REVIEW"));if(status===null)return;const normalized=status.trim().toUpperCase();if(!["PENDING ADMIN REVIEW","APPROVED","REJECTED"].includes(normalized)){alert("Invalid status.");return;}
  const clientShare=gross*.30,electricity=100,totalCustomerEarnings=clientShare+electricity;
  await updateDoc(doc(db,"cashierTransactions",id),{grossSales:gross,ownerShare:gross*.70,clientShare,internetFee:1000,electricityShare:electricity,totalCustomerEarnings,status:normalized,adminEditedBy:currentUser.uid,adminEditedAt:serverTimestamp(),cashierLocked:true});
  await logActivity("Cashier Sale",`Admin corrected ${x.transactionId||id}; gross ${money(gross)}, status ${normalized}`);toast("Cashier sale updated by Admin.");
}

// CASHIER ACCOUNT MANAGEMENT — stays inside the Admin dashboard.
let cashierAccounts=[];
async function loadCashierAccounts(){
  const tableBody=$("#cashierAccountsBody");
  if(tableBody)tableBody.innerHTML='<tr><td colspan="4">Loading cashier accounts…</td></tr>';
  try{
    const snap=await getDocs(collection(db,"users"));
    cashierAccounts=snap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>String(u.role||"").toLowerCase()==="cashier");
    const body=$("#cashierAccountsBody");
    if(!body)return;
    body.innerHTML=cashierAccounts.length?cashierAccounts.map(c=>`<tr><td>${esc(c.name||"—")}</td><td>${esc(c.email||"—")}</td><td><span class="badge ${c.active===false?"inactive":"active"}">${c.active===false?"Inactive":"Active"}</span></td><td>${c.createdAt?.toDate?esc(c.createdAt.toDate().toLocaleDateString()):esc(c.createdAt||"—")}</td></tr>`).join(""):'<tr><td colspan="4">No cashier accounts yet. Use “Create Cashier Account” to add one.</td></tr>';
  }catch(error){
    console.error("Could not load cashier accounts",error);
    const body=$("#cashierAccountsBody");
    if(body)body.innerHTML=`<tr><td colspan="4">Could not load accounts: ${esc(error.message||"Check Firestore Rules and Admin access.")}</td></tr>`;
  }
}
function renderCashierManagement(){
  view.innerHTML=baseHead("Cashier Management","Create cashier login accounts here. Cashiers use their own separate portal.",'<button class="primary-btn" id="addAdminCashier">+ Create Cashier Account</button>')+
    `<div class="panel"><div class="panel-head"><div><h3>Cashier Accounts</h3><p>Only Admin can create cashier accounts. This page remains inside the Admin dashboard.</p></div><button type="button" class="secondary-btn" id="refreshCashierAccounts">Refresh</button></div><div class="table-wrap"><table><thead><tr><th>Cashier Name</th><th>Email</th><th>Status</th><th>Created</th></tr></thead><tbody id="cashierAccountsBody"><tr><td colspan="4">Loading cashier accounts…</td></tr></tbody></table></div></div>`;
  $("#addAdminCashier")?.addEventListener("click",openAdminCashierModal);
  $("#refreshCashierAccounts")?.addEventListener("click",loadCashierAccounts);
  loadCashierAccounts();
}
function openAdminCashierModal(){
  openModal("Create Cashier Account",`<div class="form-grid"><div class="field full"><label>Cashier Name *</label><input id="adminCashierName" required placeholder="Cashier full name" autocomplete="name"></div><div class="field full"><label>Cashier Email *</label><input id="adminCashierEmail" type="email" required placeholder="cashier@example.com" autocomplete="email"></div><div class="field full"><label>Temporary Password *</label><input id="adminCashierPassword" type="text" minlength="6" required placeholder="At least 6 characters" autocomplete="new-password"><small>The temporary password will be shown after creation and included in the HTML welcome email sent to this cashier.</small></div></div>`,"Create Account",async()=>{
    const name=$("#adminCashierName").value.trim();
    const email=$("#adminCashierEmail").value.trim().toLowerCase();
    const password=$("#adminCashierPassword").value;
    if(!name||!email||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<6)throw new Error("Enter the cashier name, a valid email address, and a temporary password of at least 6 characters.");
    let credential=null,profileSaved=false,emailSent=false,emailError="";
    try{
      credential=await createUserWithEmailAndPassword(clientProvisionerAuth,email,password);
      await setDoc(doc(db,"users",credential.user.uid),{role:"cashier",name,email,active:true,forcePasswordChange:true,createdAt:serverTimestamp(),createdBy:currentUser.uid});
      profileSaved=true;
      await provisionerSignOut(clientProvisionerAuth);
      try{
        const idToken=await currentUser.getIdToken(true);
        const response=await fetch("/api/password-recovery",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"sendCashierWelcome",idToken,name,email,temporaryPassword:password,cashierPortalUrl:"https://piso-wifi.pages.dev/cashier/"})});
        const result=await response.json().catch(()=>({ok:false,error:"Email service returned an unreadable response."}));
        if(!response.ok||result.ok!==true)throw new Error(result.error||"The email service could not send the welcome email.");
        emailSent=true;
      }catch(mailError){emailError=mailError?.message||"Email service is not configured yet.";console.error("Cashier created, welcome email failed:",mailError);}
      await loadCashierAccounts();
      const message=emailSent
        ? `Cashier account created and HTML welcome email sent.\n\nName: ${name}\nEmail: ${email}\nTemporary password: ${password}\n\nPortal: https://piso-wifi.pages.dev/cashier/\n\nThe cashier should sign in and change this temporary password.`
        : `Cashier account was created, but the welcome email was NOT sent.\n\nName: ${name}\nEmail: ${email}\nTemporary password: ${password}\n\nEmail error: ${emailError}\n\nDeploy the updated Google Apps Script email handler, then try again. Keep this password private.`;
      window.alert(message);
    }catch(error){
      try{if(clientProvisionerAuth.currentUser)await provisionerSignOut(clientProvisionerAuth);}catch(_e){}
      if(credential && !profileSaved)console.error("Cashier account profile save failed",error);
      throw new Error(error?.code==="auth/email-already-in-use"?"This email already has a Firebase Authentication account.":(error.message||"Could not create cashier account."));
    }
  });
}
function renderSettings(){
  view.innerHTML=baseHead("Settings","Configure the business rules used by all calculations.")+`<div class="settings-layout"><div class="panel settings-card"><div class="panel-head"><div><h3>Business Settings</h3><p>These values drive dashboard, payments, statements and reports.</p></div></div><div class="settings-body"><div class="setting-row"><div><b>Internet Cost</b><small>Fixed internet cost per unit/month.</small></div><input id="sInternet" type="number" min="0" step="0.01" value="${settings.internetCost}"></div><div class="setting-row"><div><b>Owner Share</b><small>Percentage of net sales allocated to owner.</small></div><input id="sOwner" type="number" min="0" max="100" step="1" value="${settings.ownerPercent}"></div><div class="setting-row"><div><b>Client Share</b><small>Percentage of net sales allocated to client.</small></div><input id="sClient" type="number" min="0" max="100" step="1" value="${settings.clientPercent}"></div><div class="setting-row"><div><b>Electricity</b><small>Electricity amount per unit/month.</small></div><input id="sElec" type="number" min="0" step="0.01" value="${settings.electricity}"></div><div class="setting-row"><div><b>Electricity Rule</b><small>How electricity affects the client amount.</small></div><select id="sRule"><option value="ADD_TO_CLIENT" ${settings.electricityRule==="ADD_TO_CLIENT"?"selected":""}>Add to Client</option><option value="SUBTRACT_FROM_CLIENT" ${settings.electricityRule==="SUBTRACT_FROM_CLIENT"?"selected":""}>Deduct from Client</option><option value="SEPARATE_CHARGE" ${settings.electricityRule==="SEPARATE_CHARGE"?"selected":""}>Separate Charge</option></select></div><div class="settings-actions"><button class="primary-btn" id="saveSettings">Save Settings</button></div></div></div><div class="panel"><div class="panel-head"><div><h3>Current Formula</h3><p>Used for ${monthLabel(selectedMonth)}</p></div></div><div class="formula-box"><div>Gross Sales</div><div>= Gross Split Base</div><strong>× ${settings.ownerPercent}% Owner = ${money(10000 * settings.ownerPercent / 100)} per ₱10,000</strong><strong>× ${settings.clientPercent}% Client = ${money(10000 * settings.clientPercent / 100)} per ₱10,000</strong><div>Internet: <b>${money(settings.internetCost)}</b> (separate cost — not deducted before 70/30)</div><div>Electricity: <b>+ ${money(settings.electricity)}</b> added to customer earnings</div></div></div></div>`;
  $("#saveSettings").onclick=saveSettings;
}
async function saveSettings(){
  const internet=Number($("#sInternet").value), owner=Number($("#sOwner").value), client=Number($("#sClient").value), electricity=Number($("#sElec").value);
  if([internet,owner,client,electricity].some(n=>Number.isNaN(n)||n<0))return notify("Settings must contain valid non-negative numbers.","error");
  if(owner+client!==100)return notify("Owner + Client share must equal 100%.","error");
  settings={internetCost:internet,ownerPercent:owner,clientPercent:client,electricity,electricityRule:$("#sRule").value};
  await setDoc(doc(db,"settings","business"),settings,{merge:true});
  await logActivity("Settings",`Updated settings — Internet ${money(internet)}, Owner ${owner}%, Client ${client}%, Electricity ${money(electricity)}`);
  await addNotification("settings","Settings were updated.",`Internet cost is now ${money(internet)}.`,"");
  await loadData(); render(); notify("Settings saved.");
}


function supportStatusClass(status){return String(status||"Open").toLowerCase();}
function updateSupportBadge(){const el=$("#adminSupportBadge");if(!el)return;const n=supportChats.filter(c=>c.unreadForAdmin===true).length;el.textContent=n>99?"99+":String(n);el.classList.toggle("hidden",n===0);}
function supportMessagesHtml(chat){const msgs=Array.isArray(chat?.messages)?chat.messages:[];return msgs.map(m=>{const t=m.senderType==="customer"?"customer":m.senderType==="admin"?"admin":"system";const who=t==="customer"?(chat.customerName||"Customer"):t==="admin"?"PISO WIFI Admin":"PISO WIFI Support";return `<div class="piso-admin-chat-msg ${t}"><div class="piso-admin-chat-bubble">${esc(m.text||"")}</div><small>${esc(who)} · ${esc(dateTimeLabel(m.createdAt))}</small></div>`}).join("")||`<div class="piso-admin-chat-empty">No messages yet.</div>`;}
function startSupportRealtime(){
  if(supportUnsub)supportUnsub();
  supportUnsub=onSnapshot(collection(db,"supportChats"),snap=>{
    supportChats=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>timeValue(b.updatedAt||b.createdAt)-timeValue(a.updatedAt||a.createdAt));
    updateSupportBadge();

    // Do NOT rebuild the whole support page on every Firestore event.
    // Re-rendering the compose area on every keystroke caused the admin
    // input to lose focus and the conversation to jump back to the top.
    if(route!=="support")return;

    const all=[...supportChats].sort((a,b)=>timeValue(b.updatedAt||b.createdAt)-timeValue(a.updatedAt||a.createdAt));
    const filtered=supportStatusFilter==="All"
      ? all
      : all.filter(c=>String(c.status||"Open")===supportStatusFilter);

    if(!selectedSupportChatId && filtered[0]){
      selectedSupportChatId=filtered[0].id;
      renderSupport();
      return;
    }

    const listBox=$("#supportChatList");
    if(listBox){
      const savedTop=listBox.scrollTop;
      const q=String($("#supportSearch")?.value||"").toLowerCase();
      const visible=filtered.filter(c=>`${c.customerName||""} ${c.customerEmail||""} ${c.clientCode||""}`.toLowerCase().includes(q));
      listBox.innerHTML=renderSupportList(visible);
      listBox.scrollTop=savedTop;
      bindSupportList();
    }

    // Update filter counts without replacing the conversation/input area.
    const counts={Open:0,Solved:0,Closed:0};
    all.forEach(c=>{const st=String(c.status||"Open");if(counts[st]!==undefined)counts[st]++;});
    document.querySelectorAll("[data-support-filter]").forEach(btn=>{
      const st=btn.dataset.supportFilter;
      const span=btn.querySelector("span");
      if(span)span.textContent=st==="All"?String(all.length):String(counts[st]||0);
    });
  },err=>console.warn("PISO WIFI support realtime unavailable",err));
}
let supportStatusFilter="Open";
function renderSupport(){
  const view=$("#view"); if(!view)return;
  const all=[...supportChats].sort((a,b)=>timeValue(b.updatedAt||b.createdAt)-timeValue(a.updatedAt||a.createdAt));
  const counts={Open:0,Solved:0,Closed:0};
  all.forEach(c=>{const st=String(c.status||"Open"); if(counts[st]!==undefined)counts[st]++; else counts.Open++;});
  if(!["Open","Solved","Closed","All"].includes(supportStatusFilter))supportStatusFilter="Open";
  const filtered=supportStatusFilter==="All"?all:all.filter(c=>String(c.status||"Open")===supportStatusFilter);
  if(!selectedSupportChatId && filtered[0]) selectedSupportChatId=filtered[0].id;
  const selected=filtered.find(c=>c.id===selectedSupportChatId)||null;
  view.innerHTML=baseHead("Customer Support","Real-time conversations with your PISO WIFI customers.",`<div class="support-admin-live"><span></span> Live</div>`)+`<div class="admin-support-layout"><aside class="admin-support-list"><div class="admin-support-list-head"><div><b>Conversations</b><small>${all.length} customer chat${all.length===1?"":"s"}</small></div><button class="secondary-btn" id="refreshSupport">Refresh</button></div><div class="admin-support-filters" id="supportStatusFilters"><button type="button" data-support-filter="Open" class="${supportStatusFilter==="Open"?"active":""}">Open <span>${counts.Open}</span></button><button type="button" data-support-filter="Solved" class="${supportStatusFilter==="Solved"?"active":""}">Solved <span>${counts.Solved}</span></button><button type="button" data-support-filter="Closed" class="${supportStatusFilter==="Closed"?"active":""}">Closed <span>${counts.Closed}</span></button><button type="button" data-support-filter="All" class="${supportStatusFilter==="All"?"active":""}">All <span>${all.length}</span></button></div><div class="admin-support-search"><input id="supportSearch" placeholder="Search customer…"></div><div id="supportChatList">${renderSupportList(filtered)}</div></aside><section class="admin-support-window">${selected?renderAdminChatWindow(selected):`<div class="admin-support-empty"><div class="support-admin-empty-icon">⌁</div><h3>${filtered.length?"No conversation selected":"No "+supportStatusFilter.toLowerCase()+" conversations"}</h3><p>${filtered.length?"Customer conversations will appear here when a client starts a chat.":"Conversations with this status will appear here."}</p></div>`}</section></div>`;
  $("#refreshSupport").onclick=async()=>{await loadData();renderSupport();};
  document.querySelectorAll("[data-support-filter]").forEach(btn=>btn.onclick=()=>{supportStatusFilter=btn.dataset.supportFilter;const next=all.find(c=>supportStatusFilter==="All"||String(c.status||"Open")===supportStatusFilter);selectedSupportChatId=next?.id||"";renderSupport();});
  $("#supportSearch").oninput=e=>{const q=e.target.value.toLowerCase();$("#supportChatList").innerHTML=renderSupportList(filtered.filter(c=>`${c.customerName||""} ${c.customerEmail||""} ${c.clientCode||""}`.toLowerCase().includes(q)));bindSupportList();};
  bindSupportList(); bindAdminChatEvents(selected);
  if(selected)subscribeSelectedSupport(selected.id);
}
function renderSupportList(list){return list.length?list.map(c=>`<button type="button" class="admin-support-item ${c.id===selectedSupportChatId?"active":""}" data-support-id="${esc(c.id)}"><span class="support-item-avatar">${esc(String(c.customerName||"CU").trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase())}</span><span class="support-item-copy"><b>${esc(c.customerName||"Customer")}</b><small>${esc(c.customerEmail||c.clientCode||"Customer Account")}</small><em>${esc((Array.isArray(c.messages)&&c.messages.length?c.messages[c.messages.length-1].text:"No messages yet").slice(0,55))}</em></span><span class="support-item-side"><i class="${supportStatusClass(c.status)}">${esc(c.status||"Open")}</i>${c.unreadForAdmin?'<strong>NEW</strong>':''}</span></button>`).join(""):`<div class="admin-support-no-chats">No customer conversations yet.</div>`;}
function bindSupportList(){document.querySelectorAll("[data-support-id]").forEach(b=>b.onclick=()=>{selectedSupportChatId=b.dataset.supportId;renderSupport();const c=supportChats.find(x=>x.id===selectedSupportChatId);if(c?.unreadForAdmin===true){updateDoc(doc(db,"supportChats",selectedSupportChatId),{unreadForAdmin:false,updatedAt:new Date().toISOString()}).catch(()=>{});}});}
function renderAdminChatWindow(chat){const status=String(chat.status||"Open");const disabled="";return `<div class="admin-chat-head"><div class="support-admin-avatar">${esc(String(chat.customerName||"CU").trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase())}</div><div><h3>${esc(chat.customerName||"Customer")}</h3><p>${esc(chat.customerEmail||"")} · ${esc(chat.clientCode||"")}</p></div><span class="admin-chat-status ${supportStatusClass(status)}">${esc(status)}</span><div class="admin-chat-actions"><button class="secondary-btn" id="supportOpenBtn" ${status==="Open"?"disabled":""}>Open</button><button class="secondary-btn" id="supportSolveBtn" ${status!=="Open"?"disabled":""}>Solve</button><button class="danger-outline-btn" id="supportCloseBtn" ${status==="Closed"?"disabled":""}>Close</button></div></div><div id="adminSupportMessages" class="admin-support-messages">${supportMessagesHtml(chat)}</div><div id="adminSupportTyping" class="admin-support-typing ${chat.typingBy?.customer?"show":""}">${chat.typingBy?.customer?"Customer is typing…":""}</div><div class="admin-support-compose"><textarea id="adminSupportInput" placeholder="Reply to customer…" ${disabled}></textarea><button id="adminSupportSend" class="primary-btn" ${disabled}>Send</button></div>`;}
let selectedSupportUnsub=null;
function subscribeSelectedSupport(id){
  if(selectedSupportUnsub)selectedSupportUnsub();
  const ref=doc(db,"supportChats",id);
  selectedSupportUnsub=onSnapshot(ref,snap=>{
    if(!snap.exists())return;
    const c={id:snap.id,...snap.data()};
    const idx=supportChats.findIndex(x=>x.id===id);
    if(idx>=0)supportChats[idx]=c;else supportChats.unshift(c);
    updateSupportBadge();

    if(route==="support"&&selectedSupportChatId===id){
      const box=$("#adminSupportMessages");
      if(box){
        // Preserve the exact scroll position across realtime updates.
        // If the admin is already at the bottom, keep them at the bottom;
        // otherwise never force the conversation back to the top.
        const previousTop=box.scrollTop;
        const previousHeight=box.scrollHeight;
        const clientHeight=box.clientHeight;
        const wasAtBottom=previousHeight-previousTop-clientHeight<32;
        box.innerHTML=supportMessagesHtml(c);
        requestAnimationFrame(()=>{
          if(wasAtBottom)box.scrollTop=box.scrollHeight;
          else box.scrollTop=previousTop;
        });
      }
      const typ=$("#adminSupportTyping");
      if(typ){
        typ.textContent=c.typingBy?.customer?"Customer is typing…":"";
        typ.classList.toggle("show",!!c.typingBy?.customer);
      }
      const status=String(c.status||"Open");
      const statusEl=document.querySelector(".admin-chat-status");
      if(statusEl){
        statusEl.textContent=status;
        statusEl.className=`admin-chat-status ${supportStatusClass(status)}`;
      }
      const openBtn=$("#supportOpenBtn"),solveBtn=$("#supportSolveBtn"),closeBtn=$("#supportCloseBtn");
      if(openBtn)openBtn.disabled=status==="Open";
      if(solveBtn)solveBtn.disabled=status!=="Open";
      if(closeBtn)closeBtn.disabled=status==="Closed";
    }
  });
}
let adminSupportTypingTimer=null;
function bindAdminChatEvents(chat){if(!chat)return;const input=$("#adminSupportInput"),send=$("#adminSupportSend");if(send)send.onclick=()=>sendAdminSupportMessage(chat.id);if(input){input.oninput=()=>{clearTimeout(adminSupportTypingTimer);setAdminSupportTyping(chat.id,true);adminSupportTypingTimer=setTimeout(()=>setAdminSupportTyping(chat.id,false),1200);};input.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendAdminSupportMessage(chat.id);}};}$("#supportOpenBtn")?.addEventListener("click",()=>setSupportStatus(chat.id,"Open"));$("#supportSolveBtn")?.addEventListener("click",()=>setSupportStatus(chat.id,"Solved"));$("#supportCloseBtn")?.addEventListener("click",()=>setSupportStatus(chat.id,"Closed"));}
async function setAdminSupportTyping(id,on){try{await updateDoc(doc(db,"supportChats",id),{"typingBy.admin":!!on,updatedAt:new Date().toISOString()});}catch(e){}}
async function sendAdminSupportMessage(id){const input=$("#adminSupportInput");const text=String(input?.value||"").trim();if(!text)return;try{await updateDoc(doc(db,"supportChats",id),{messages:arrayUnion({senderType:"admin",text,createdAt:new Date().toISOString()}),lastMessage:text,lastMessageSender:"admin",lastMessageAt:new Date().toISOString(),updatedAt:new Date().toISOString(),unreadForAdmin:false,unreadForCustomer:true,"typingBy.admin":false,status:"Open"});input.value="";}catch(e){notify(e?.message||"Unable to send support reply.","error");}}
async function setSupportStatus(id,status){try{
  const patch={status,updatedAt:new Date().toISOString(),unreadForAdmin:false};
  if(status==="Solved"){
    patch.messages=arrayUnion({senderType:"system",text:"Thank you for contacting PISO WIFI Support. We’re glad we could assist you. This ticket has been closed. If you need further assistance, please contact us again.",createdAt:new Date().toISOString(),kind:"ticket-closed"});
    patch.unreadForCustomer=true;
    patch["typingBy.admin"]=false;
  }
  await updateDoc(doc(db,"supportChats",id),patch);
  await logActivity("Support",`${status} customer support conversation`,id);
  render();
}catch(e){notify(e?.message||"Unable to update support status.","error");}}

function renderProfile(){ renderDashboard(); }
function openProfile(id){
  const u=units.find(x=>x.id===id); if(!u)return;
  const rows=records.filter(r=>r.unitId===id).sort((a,b)=>String(b.month).localeCompare(String(a.month)));
  const r=records.find(x=>x.unitId===id&&x.month===selectedMonth)||{unitId:id,month:selectedMonth,grossSales:0}; const c=calc(r);
  view.innerHTML=baseHead("Client Profile","Financial and historical information for this unit.",`<button class="secondary-btn" id="backUnits">← Back to Units</button><button class="primary-btn" id="profileEdit">Edit</button>`)+`<div class="profile-hero"><div class="avatar big">${esc((u.name||"CL").slice(0,2).toUpperCase())}</div><div><h2>${esc(u.name)}</h2><p>${esc(u.unitCode)} · ${esc(u.location||"No location")}</p><span>${statusBadge(u.active!==false?"Active":"Inactive")}</span></div></div><div class="tabs"><button class="tab active" data-tab="overview">Overview</button><button class="tab" data-tab="sales">Monthly Sales</button><button class="tab" data-tab="payments">Payments</button><button class="tab" data-tab="statement">Statement</button></div><div id="profileTab"></div>`;
  const tab=localStorage.getItem("pisoProfileTab")||"overview"; renderProfileTab(id,tab);
  $("#backUnits").onclick=()=>{location.hash="#units"}; $("#profileEdit").onclick=()=>openUnitModal(id);
  document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{localStorage.setItem("pisoProfileTab",b.dataset.tab);document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));renderProfileTab(id,b.dataset.tab);});
}
function renderProfileTab(id,tab){
  const u=units.find(x=>x.id===id), host=$("#profileTab"); if(!host)return;
  if(tab==="overview"){const r=records.find(x=>x.unitId===id&&x.month===selectedMonth)||{unitId:id,month:selectedMonth,grossSales:0};const c=calc(r);host.innerHTML=`<div class="summary-grid"><div class="summary-card"><h3>GROSS SALES</h3><strong>${money(c.gross)}</strong></div><div class="summary-card"><h3>INTERNET COST</h3><strong>${money(c.internet)}</strong></div><div class="summary-card"><h3>NET SALES</h3><strong>${money(c.net)}</strong></div><div class="summary-card"><h3>OWNER SHARE (${settings.ownerPercent}%)</h3><strong>${money(c.owner)}</strong></div><div class="summary-card"><h3>CLIENT SHARE (${settings.clientPercent}%)</h3><strong>${money(c.client)}</strong></div><div class="summary-card customer-net-card"><h3>CUSTOMER EARNINGS</h3><strong>${money(c.clientTotal)}</strong></div><div class="summary-card"><h3>ELECTRICITY</h3><strong>${money(c.elec)}</strong></div><div class="summary-card"><h3>AMOUNT DUE</h3><strong>${money(c.clientTotal)}</strong></div><div class="summary-card"><h3>AMOUNT PAID</h3><strong class="success-text">${money(c.paid)}</strong></div><div class="summary-card"><h3>BALANCE</h3><strong class="danger-text">${money(c.balance)}</strong></div></div><div class="panel profile-contact"><h3>Client Details</h3><p><b>Phone:</b> ${esc(u.contact||"—")}</p><p><b>Location:</b> ${esc(u.location||"—")}</p></div>`;return;}
  if(tab==="sales"){const rows=records.filter(r=>r.unitId===id).sort((a,b)=>String(b.month).localeCompare(String(a.month)));host.innerHTML=`<div class="panel"><div class="panel-head"><div><h3>Monthly Sales History</h3><p>Historical records are kept by month.</p></div><button class="primary-btn" data-sale="${id}">Gross Sale</button></div><div class="table-wrap"><table><thead><tr><th>Month</th><th>Gross Sales</th><th>Internet</th><th>Net Sales</th><th>Owner Share</th><th>Customer Earnings</th><th>Electricity</th><th>Client Net</th><th>Amount Due</th><th>Actions</th></tr></thead><tbody>${rows.length?rows.map(r=>{const c=calc(r);return `<tr><td>${monthLabel(r.month)}</td><td>${money(c.gross)}</td><td>${money(c.internet)}</td><td>${money(c.net)}</td><td>${money(c.owner)}</td><td>${money(c.client)}</td><td>${money(c.elec)}</td><td>${money(Math.max(0,c.client-c.elec))}</td><td>${money(c.clientTotal)}</td><td><button class="action-btn" data-edit-sale="${r.id}">Edit</button><button class="action-btn danger" data-delete-sale="${r.id}">Delete</button></td></tr>`}).join(""):emptyRow(10,"No sales recorded for this client.")}</tbody></table></div></div>`;bindDynamicButtons();return;}
  if(tab==="payments"){const ps=payments.filter(p=>p.unitId===id).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));host.innerHTML=`<div class="panel"><div class="panel-head"><div><h3>Payment History</h3><p>All recorded payments for ${esc(u.name)}.</p></div><button class="primary-btn" data-payment="${id}">Record Payment</button></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Month</th><th>Amount</th><th>Method</th><th>Reference</th><th>Status</th></tr></thead><tbody>${ps.length?ps.map(p=>`<tr><td>${dateLabel(p.date)}</td><td>${monthLabel(p.month)}</td><td>${money(p.amount)}</td><td>${esc(p.method||"—")}</td><td>${esc(p.reference||"—")}</td><td>${statusBadge("Paid")}</td></tr>`).join(""):emptyRow(5,"No payments recorded.")}</tbody></table></div></div>`;bindDynamicButtons();return;}
  if(tab==="statement"){host.innerHTML=`<div class="panel"><div class="panel-head"><div><h3>Statement</h3><p>${monthLabel(selectedMonth)}</p></div><button class="primary-btn" id="profilePrintStatement">Print / PDF</button></div>${statementHtml(u,calc(records.find(r=>r.unitId===id&&r.month===selectedMonth)||{unitId:id,month:selectedMonth,grossSales:0}),selectedMonth)}</div>`;$("#profilePrintStatement").onclick=()=>printStatement(id,selectedMonth);}
}

function openModal(title,body,saveText,onSave,{danger=false}={}){
  $("#modalRoot").innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><div class="modal ${danger?"danger-modal":""}"><div class="modal-head"><h3>${title}</h3><button class="close" id="closeModal">×</button></div><div class="modal-body">${body}</div><div class="modal-actions"><button class="secondary-btn" id="cancelModal">Cancel</button><button class="${danger?"danger-btn":"primary-btn"}" id="saveModal">${saveText}</button></div></div></div>`;
  $("#closeModal").onclick=closeModal; $("#cancelModal").onclick=closeModal;
  // Keep the form open when the user clicks outside the modal. Only the explicit X/Cancel controls close it.
  $("#modalBackdrop").onclick=e=>{ e.stopPropagation(); };
  $("#saveModal").onclick=async()=>{try{await onSave();closeModal();await loadData();render();notify("Saved successfully.");}catch(e){notify(e?.message||"Unable to save.","error");}};
  setTimeout(()=>document.querySelector("#modalRoot input, #modalRoot select")?.focus(),50);
}
function closeModal(){ $("#modalRoot").innerHTML=""; }
async function openUnitModal(id=null){
  const u=id?units.find(x=>x.id===id):null;
  const suggestedDate = u?.dateJoined || new Date().toISOString().slice(0,10);
  const codes=availableUnitCodes(u?.unitCode||"");
  const currentCode=String(u?.unitCode||"");
  const codeOptions=codes.map(x=>`<button type="button" class="unit-option ${x.used?"is-used":""}" data-unit-code="${x.code}" ${x.used?"disabled":""}><span>${x.code}</span><small>${x.used?"Active / Unavailable":"Available"}</small></button>`).join("");
  openModal(id?"Edit Client / Unit":"Add New Client",`
    <div class="form-grid">
      <div class="field"><label>Client ID *</label><input id="fClientCode" value="${esc(u?.clientCode || (id ? "" : await previewNextClientId()))}" placeholder="CID-0001" disabled><small class="hint">Automatically generated in sequence. This ID is never reused.</small></div>
      <div class="field"><label>Unit Code *</label><div class="unit-combobox"><input id="fCodeSearch" value="${esc(currentCode)}" placeholder="Search or select 1–50" autocomplete="off" aria-autocomplete="list"><input id="fCode" type="hidden" value="${esc(currentCode)}"><div id="unitCodeOptions" class="unit-options">${codeOptions}</div></div><small class="hint">Active unit codes cannot be selected. Deactivated unit codes become available again.</small></div>
      <div class="field"><label>First Name *</label><input id="fFirstName" value="${esc(u?.firstName||"")}" placeholder="First Name" autocomplete="off"></div>
      <div class="field"><label>Last Name *</label><input id="fLastName" value="${esc(u?.lastName||String(u?.name||"").trim().split(/\s+/).slice(1).join(" "))}" placeholder="Last Name" autocomplete="off"></div>
      <div class="field full"><label>Registered Gmail *</label><input id="fEmail" type="email" value="${esc(u?.email||"")}" placeholder="customer@gmail.com" autocomplete="off"><small class="hint">Used for Customer Account login and account recovery.</small></div>
      ${id?"":`<div class="field full"><label>Temporary Password *</label><input id="fPassword" type="password" value="" placeholder="Create temporary password" autocomplete="new-password" minlength="6"><small class="hint">Customer will use this password for the first login, then create a private permanent password.</small></div>`}
      <div class="field"><label>Contact Number</label><input id="fContact" value="${esc(u?.contact||"")}" placeholder="09171234567" autocomplete="off"></div>
      <div class="field"><label>Date Joined</label><input id="fDateJoined" type="date" value="${esc(suggestedDate)}"></div>
      <div class="field full"><label>Unit Location</label><input id="fLocation" value="${esc(u?.location||"")}" placeholder="Brgy. San Isidro, Antipolo" autocomplete="off"></div>
      <div class="field full"><label>Client Address</label><input id="fAddress" value="${esc(u?.address||u?.location||"")}" placeholder="Client residential/contact address" autocomplete="off"></div>
      <div class="field"><label>Status</label><select id="fStatus"><option value="active" ${u?.active!==false?"selected":""}>Active</option><option value="inactive" ${u?.active===false?"selected":""}>Inactive</option></select></div>
      <div class="field"><label>Username</label><input id="fUsername" value="${esc(u?.username||"")}" placeholder="Generated automatically" disabled><small class="hint">Generated as FirstName + Client ID, e.g. JuanCID-0001.</small></div>
      <div class="field full"><label>Notes</label><textarea id="fNotes" rows="3">${esc(u?.notes||"")}</textarea></div>
    </div>`,`Save Client`,async()=>{
      const clientCode=id?String(u?.clientCode||"").trim().toUpperCase():await nextClientId();
      const unitCode=$("#fCode").value.trim();
      const firstName=$("#fFirstName").value.trim();
      const lastName=$("#fLastName").value.trim();
      const name=`${firstName} ${lastName}`.trim();
      const email=$("#fEmail").value.trim().toLowerCase();
      if(!clientCode||!unitCode||!firstName||!lastName||!email) throw new Error("Client ID, Unit Code, First Name, Last Name and Registered Gmail are required.");
      if(!/^CID-\d{3,}$/.test(clientCode)) throw new Error("Invalid Client ID format.");
      if(!/^([1-9]|[1-4]\d|50)$/.test(unitCode)) throw new Error("Unit Code must be between 1 and 50.");
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid Gmail address.");
      const activeConflict=units.find(x=>x.id!==id&&x.active!==false&&String(x.unitCode)===unitCode);
      if(activeConflict) throw new Error(`Unit Code ${unitCode} is already assigned to an active client.`);
      const username=id?String(u?.username||`${sanitizeUsernamePart(firstName)}${clientCode}`):`${sanitizeUsernamePart(firstName)}${clientCode}`;
      const data={
        clientCode,unitCode,firstName,lastName,name,email,username,
        location:$("#fLocation").value.trim(),address:$("#fAddress").value.trim(),contact:$("#fContact").value.trim(),
        dateJoined:$("#fDateJoined").value||suggestedDate,notes:$("#fNotes").value.trim(),active:$("#fStatus").value==="active",updatedAt:serverTimestamp()
      };
      if(id){
        await updateDoc(doc(db,"units",id),data);
        await syncClientToSheet({
          ...u,
          ...data,
          temporaryPassword:u?.clientCode||clientCode,
          passwordChanged:u?.forcePasswordChange===false,
          createdAt:u?.createdAt||new Date().toISOString(),
          lastLogin:u?.lastLogin||""
        });
        if(u?.authUserId) await setDoc(doc(db,"users",u.authUserId),{role:"client",clientUnitId:id,unitId:id,clientCode,username,email,updatedAt:serverTimestamp()},{merge:true});
        await logActivity("Clients",`Edited ${unitCode} — ${name}`,id);
        await addNotification("client","Client profile updated.",`${name} (${clientCode}) was updated.`,id);
      }else{
        const authEmail=email;
        const enteredPassword=String($("#fPassword")?.value||"").trim();
        const temporaryPassword=enteredPassword || clientCode;
        if(temporaryPassword.length<6) throw new Error("Temporary password must be at least 6 characters.");
        let cred;
        try{ cred=await createUserWithEmailAndPassword(clientProvisionerAuth,authEmail,temporaryPassword); }
        catch(e){
          if(e?.code==="auth/email-already-in-use") throw new Error("This registered Gmail already has a Firebase login. Use the existing client record instead of creating a duplicate account.");
          throw e;
        }
        data.authUserId=cred.user.uid;
        data.forcePasswordChange=true;
        data.loginId=username;
        data.authEmail=authEmail;
        const ref=await addDoc(collection(db,"units"),{...data,createdAt:serverTimestamp()});
        await syncClientToSheet({
          ...data,
          temporaryPassword,
          passwordChanged:false,
          createdAt:new Date().toISOString(),
          lastLogin:""
        });
        await setDoc(doc(db,"users",cred.user.uid),{role:"client",clientUnitId:ref.id,unitId:ref.id,clientCode,username,email,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
        await logActivity("Clients",`Added client account ${clientCode} — ${username} — ${name}`,ref.id);
        await addNotification("client","New client account created.",`${name} (${clientCode}) can now log in using the registered Gmail.`,ref.id);
        notify(`Created ${clientCode}. Gmail: ${email} · Temporary password: ${temporaryPassword}`);
      }
  });
  const search=$("#fCodeSearch"), hidden=$("#fCode"), list=$("#unitCodeOptions");
  const refreshOptions=()=>{
    const q=search.value.trim().toLowerCase();
    list.querySelectorAll(".unit-option").forEach(btn=>btn.style.display=btn.dataset.unitCode.includes(q)?"flex":"none");
  };
  search.onfocus=()=>list.classList.add("show");
  search.oninput=()=>{hidden.value=search.value.trim();list.classList.add("show");refreshOptions();};
  list.querySelectorAll("[data-unit-code]").forEach(btn=>btn.onclick=()=>{hidden.value=btn.dataset.unitCode;search.value=btn.dataset.unitCode;list.classList.remove("show");});
  document.addEventListener("click",function closeUnitPicker(e){if(!e.target.closest(".unit-combobox")){list.classList.remove("show");document.removeEventListener("click",closeUnitPicker);}}, {once:false});
}
async function toggleUnit(id){const u=units.find(x=>x.id===id);if(!u)return;const next=u.active===false; if(!confirm(`${next?"Activate":"Deactivate"} ${u.unitCode}? Historical sales and payments will remain.`))return;await updateDoc(doc(db,"units",id),{active:next,updatedAt:serverTimestamp()});await logActivity("Units",`${next?"Activated":"Deactivated"} ${u.unitCode}`,id);await addNotification("unit",`${u.unitCode} is ${next?"active":"inactive"}.`,`Unit status was changed.`,id);await loadData();render();notify(`Unit ${next?"activated":"deactivated"}.`);}

async function confirmDeleteUnit(id){
  if(!ENABLE_CLIENT_DELETE)return;
  const u=units.find(x=>x.id===id); if(!u)return;
  const relatedSales=records.filter(r=>r.unitId===id);
  const relatedPayments=payments.filter(p=>p.unitId===id);
  const relatedNotifications=notifications.filter(n=>n.relatedId===id);
  const relatedActivities=activities.filter(a=>a.relatedId===id);
  openModal("Delete Client / Unit?",`<div class="delete-confirm client-delete-confirm">
    <div class="delete-icon">⌫</div>
    <h4>Delete ${esc(u.name||u.unitCode)}?</h4>
    <p>This temporary delete feature permanently removes the client/unit and its linked monthly sales and payment records.</p>
    <div class="delete-warning"><b>${relatedSales.length}</b> sales record(s) · <b>${relatedPayments.length}</b> payment record(s)</div>
    <p class="danger-text"><b>This cannot be undone.</b> For normal operations, use Deactivate so financial history remains available.</p>
    <div class="field"><label>Type DELETE to confirm</label><input id="deleteClientConfirm" autocomplete="off" placeholder="DELETE"></div>
  </div>`,"Delete Client",async()=>{
    if (($('#deleteClientConfirm')?.value||'').trim() !== 'DELETE') throw new Error('Type DELETE to confirm permanent client removal.');
    const batch=writeBatch(db);
    batch.delete(doc(db,"units",id));
    relatedSales.forEach(r=>batch.delete(doc(db,"monthlyRecords",r.id)));
    relatedPayments.forEach(p=>batch.delete(doc(db,"payments",p.id)));
    relatedNotifications.forEach(n=>batch.delete(doc(db,"notifications",n.id)));
    relatedActivities.forEach(a=>batch.delete(doc(db,"activities",a.id)));
    await batch.commit();
    // The activity for the deletion itself cannot point to a now-deleted client record,
    // so store the unit code/name in the description and leave a fresh activity entry.
    await logActivity("Clients",`Permanently deleted ${u.unitCode} — ${u.name} (temporary delete feature)`,"");
    await addNotification("client","Client deleted.",`${u.name||u.unitCode} was permanently removed.`,"");
  },{danger:true});
}

function openSalesModal(unitId,recordId=null){
  const u=units.find(x=>x.id===unitId); const existing=recordId?records.find(r=>r.id===recordId):records.find(r=>r.unitId===unitId&&r.month===selectedMonth); const month=existing?.month||selectedMonth;
  openModal(existing?"Edit Monthly Sales":"Record Monthly Sales",`<div class="notice">${esc(u?.unitCode||"")} — ${esc(u?.name||"")}</div><div class="form-grid"><div class="field"><label>Unit</label><input value="${esc(u?.unitCode||"")} — ${esc(u?.name||"")}" disabled></div><div class="field"><label>Month *</label><input id="saleMonth" type="month" value="${month}" ${recordId?"disabled":""}></div><div class="field"><label>Gross Sales *</label><input id="saleGross" type="number" min="0" step="0.01" value="${existing?.grossSales??0}"></div><div class="field"><label>Miscellaneous Fee</label><input id="saleMisc" type="number" min="0" step="0.01" value="${existing?.miscellaneousFee??0}"><small class="hint">Optional custom fee deducted from the customer's share.</small></div><div class="field full"><small class="hint">System will automatically calculate internet cost, net sales, shares, electricity and the final customer Amount Due.</small></div></div>`,existing?"Update Sales":"Save Sales",async()=>{
    const gross=Number($("#saleGross").value); const miscellaneousFee=Number($("#saleMisc").value||0); const saleMonth=$("#saleMonth").value; if(!saleMonth)throw new Error("Month is required."); if(Number.isNaN(gross)||gross<0)throw new Error("Gross sales must be a valid non-negative number."); if(Number.isNaN(miscellaneousFee)||miscellaneousFee<0)throw new Error("Miscellaneous fee must be a valid non-negative number.");
    const duplicate=records.find(r=>r.unitId===unitId&&r.month===saleMonth&&r.id!==(existing?.id||"")); if(duplicate)throw new Error("This unit already has a sales record for the selected month. Edit the existing record instead.");
    if(existing){const old=Number(existing.grossSales||0);await updateDoc(doc(db,"monthlyRecords",existing.id),{grossSales:gross,miscellaneousFee,month:saleMonth,updatedAt:serverTimestamp()});await logActivity("Sales",`Edited sales ${u.unitCode} — ${money(old)} → ${money(gross)}${miscellaneousFee?` · Misc. fee ${money(miscellaneousFee)}`:""}`,existing.id);await addNotification("sales","Sales record updated.",`${u.unitCode} changed to ${money(gross)} for ${monthLabel(saleMonth)}.`,u.id);}else{const ref=await addDoc(collection(db,"monthlyRecords"),{unitId,month:saleMonth,grossSales:gross,miscellaneousFee,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});await logActivity("Sales",`Recorded sales ${u.unitCode} — ${money(gross)}${miscellaneousFee?` · Misc. fee ${money(miscellaneousFee)}`:""}`,ref.id);const c=calc({unitId,month:saleMonth,grossSales:gross,miscellaneousFee});if(c.balance>0)await addNotification("balance",`${u.name} has ${money(c.balance)} balance.`,`Outstanding amount for ${monthLabel(saleMonth)}.`,u.id);}
  });
}
async function confirmDeleteSale(id){
  const r=records.find(x=>x.id===id),u=units.find(x=>x.id===r?.unitId);if(!r||!u)return;
  openModal("Delete Monthly Sales?",`<div class="delete-confirm"><div class="delete-icon">⌫</div><h4>Delete Monthly Sales?</h4><p>Are you sure you want to delete the sales record for <b>${monthLabel(r.month)}</b>?</p><p class="danger-text">This action cannot be undone.</p></div>`,"Delete",async()=>{await deleteDoc(doc(db,"monthlyRecords",id));await logActivity("Sales",`Deleted sales ${u.unitCode} — ${monthLabel(r.month)} — ${money(r.grossSales)}`,id);await addNotification("sales","Sales record deleted.",`${u.unitCode} sales for ${monthLabel(r.month)} were deleted.`,u.id);});
  $("#saveModal").classList.add("danger-btn");
}
function openPaymentModal(unitId=""){
  const eligible=units.filter(u=>u.active!==false); const defaultUnit=unitId||eligible[0]?.id||"";
  openModal("Record Payment",`<div class="form-grid"><div class="field full"><label>Unit / Client *</label><select id="pUnit">${eligible.length?eligible.map(u=>`<option value="${u.id}" ${u.id===defaultUnit?"selected":""}>${esc(u.unitCode)} — ${esc(u.name)}</option>`).join(""):"<option value=\"\">No active units</option>"}</select></div><div class="field"><label>Month *</label><input id="pMonth" type="month" value="${selectedMonth}"></div><div class="field"><label>Amount Due</label><input id="pDue" value="${money(calc(records.find(r=>r.unitId===defaultUnit&&r.month===selectedMonth)||{unitId:defaultUnit,month:selectedMonth,grossSales:0}).clientTotal)}" disabled></div><div class="field"><label>Payment Amount *</label><input id="pAmount" type="number" min="0" step="0.01"></div><div class="field"><label>Payment Date *</label><input id="pDate" type="date" value="${new Date().toISOString().slice(0,10)}"></div><div class="field"><label>Payment Method</label><select id="pMethod"><option>Cash</option><option>GCash</option><option>Bank Transfer</option><option>Other</option></select></div><div class="field full"><label>Reference</label><input id="pRef" placeholder="OR#12345"></div></div>`,"Save Payment",async()=>{
    const uid=$("#pUnit").value,month=$("#pMonth").value,amount=Number($("#pAmount").value);if(!uid||!month||Number.isNaN(amount)||amount<=0)throw new Error("Unit, month and a positive payment amount are required.");
    const due=calc(records.find(r=>r.unitId===uid&&r.month===month)||{unitId:uid,month,grossSales:0}).clientTotal; const paid=payments.filter(p=>p.unitId===uid&&p.month===month).reduce((s,p)=>s+Number(p.amount||0),0); if(amount>Math.max(0,due-paid))throw new Error(`Payment cannot exceed the remaining balance of ${money(Math.max(0,due-paid))}.`);
    const ref=await addDoc(collection(db,"payments"),{unitId:uid,month,amount,paymentDate:$("#pDate").value,method:$("#pMethod").value,reference:$("#pRef").value.trim(),createdAt:serverTimestamp()});
    const u=units.find(x=>x.id===uid); await logActivity("Payments",`Recorded payment ${u?.unitCode||uid} — ${money(amount)} — ${$("#pMethod").value}`,ref.id); await addNotification("payment","Payment received.",`${u?.name||"Client"} paid ${money(amount)}.`,uid);
  });
  $("#pUnit").onchange=updatePaymentDue; $("#pMonth").onchange=updatePaymentDue;
}
function updatePaymentDue(){const uid=$("#pUnit").value,month=$("#pMonth").value;const c=calc(records.find(r=>r.unitId===uid&&r.month===month)||{unitId:uid,month,grossSales:0});const paid=payments.filter(p=>p.unitId===uid&&p.month===month).reduce((s,p)=>s+Number(p.amount||0),0);$("#pDue").value=money(Math.max(0,c.clientTotal-paid));}

function printCss(){return `body{font-family:Arial,sans-serif;color:#17243a;padding:30px}h1{margin-bottom:4px}p{color:#64748b}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{border:1px solid #dbe3ee;padding:8px;text-align:left;font-size:12px}th{background:#f5f8fc}.print-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}.print-grid div{border:1px solid #dbe3ee;padding:12px}.print-grid b,.print-grid strong{display:block}.print-grid strong{font-size:18px;margin-top:5px}`;}
function openPrintWindow(html){const w=window.open("","_blank","width=1200,height=800");if(!w){notify("Please allow pop-ups to print.","error");return;}w.document.open();w.document.write(html);w.document.close();w.focus();setTimeout(()=>w.print(),350);}

function stopCoreRealtime(){coreRealtimeUnsubs.forEach(fn=>{try{fn()}catch(e){}});coreRealtimeUnsubs=[];}
function scheduleDashboardRealtime(){
  if(route!=="dashboard")return;
  clearTimeout(dashboardRealtimeTimer);
  const scrollY=window.scrollY;
  const active=document.activeElement;
  const activeId=active?.id||"";
  const activeValue=active && "value" in active ? active.value : "";
  dashboardRealtimeTimer=setTimeout(()=>{
    if(route!=="dashboard")return;
    renderDashboard();
    window.scrollTo(0,scrollY);
    if(activeId){const next=document.getElementById(activeId);if(next){next.focus({preventScroll:true});if("value" in next)next.value=activeValue;}}
  },120);
}
function startCoreRealtime(){
  stopCoreRealtime();
  const bind=(path,apply)=>{
    const unsub=onSnapshot(collection(db,path),snap=>{apply(snap.docs.map(d=>({id:d.id,...d.data()})));scheduleDashboardRealtime();},err=>{console.warn(`PISO WIFI realtime ${path} unavailable`,err);});
    coreRealtimeUnsubs.push(unsub);
  };
  bind("units",rows=>{units=rows;});
  bind("monthlyRecords",rows=>{records=rows;});
  bind("payments",rows=>{payments=rows;});
  coreRealtimeUnsubs.push(onSnapshot(doc(db,"settings","business"),snap=>{if(snap.exists())settings={...settings,...snap.data()};scheduleDashboardRealtime();},err=>console.warn("PISO WIFI realtime settings unavailable",err)));
  coreRealtimeUnsubs.push(onSnapshot(collection(db,"activities"),snap=>{activities=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>timeValue(b.createdAt)-timeValue(a.createdAt));scheduleDashboardRealtime();},err=>console.warn("PISO WIFI realtime activities unavailable",err)));
}

function showAuthError(message){console.error("[PISO WIFI]",message);const loader=$("#authLoading");if(loader){loader.innerHTML=`<div class="auth-error"><strong>Unable to open the dashboard</strong><span>${esc(message)}</span><button type="button" id="returnAdminLogin">Return to Login</button></div>`;loader.classList.remove("hidden");$("#returnAdminLogin")?.addEventListener("click",()=>location.replace("/admin/index.html"));}}
let bootstrappedUserUid="";
async function bootstrap(user){if(!user){location.replace("/admin/index.html");return;}if(bootstrappedUserUid===user.uid && !$("#app")?.classList.contains("hidden"))return;bootstrappedUserUid=user.uid;currentUser=user;try{await authorize(user);await loadData();try{await loadWiFiSubscriptions();}catch(e){console.warn("WiFi subscriptions unavailable",e);}await logActivity("System",`Admin login — ${user.email||"Admin"}`);setupMonthSelector();startSupportRealtime();startCoreRealtime();$("#authLoading").classList.add("hidden");$("#app").classList.remove("hidden");$("#userEmail").textContent=user.email||"Owner";route=parseRoute();render();}catch(e){bootstrappedUserUid="";showAuthError(e?.message||"Firebase authorization or database access failed.");}}

function parseRoute(){const raw=location.hash.replace("#","");return raw.split("?")[0]||"dashboard";}
document.addEventListener("click",e=>{const a=e.target.closest("[data-route]");if(a){e.preventDefault();e.stopPropagation();navigateTo(a.dataset.route);return;} const p=e.target.closest("[data-print-inline]");if(p){const id=$("#statementUnit")?.value;if(id)printStatement(id,$("#statementMonth").value);} const pdf=e.target.closest("[data-pdf-inline]");if(pdf){const id=$("#statementUnit")?.value;if(id)downloadStatementPdf(id,$("#statementMonth").value);} const html=e.target.closest("[data-html-inline]");if(html){const id=$("#statementUnit")?.value;if(id)downloadStatementHtml(id,$("#statementMonth").value);}});
window.addEventListener("hashchange",()=>{route=parseRoute();render();});
$("#menuBtn").onclick=()=>{$("#sidebar").classList.add("open");$("#overlay").classList.add("show")};$("#overlay").onclick=closeMenu;
async function forceAdminRelogin(){try{await signOut(auth);}finally{location.replace("/admin/index.html?relogin=1");}}
$("#reloginBtn").onclick=forceAdminRelogin;
$("#logoutBtn").onclick=async()=>{await signOut(auth);location.href="/admin/index.html"};
$("#globalSearch").oninput=e=>{const q=e.target.value.trim();if(q.length>=2){unitSearch=q;route="units";if(location.hash!=="#units")location.hash="#units";else renderUnits();}else if(!q){unitSearch="";if(route==="units")renderUnits();}};

let authResolved=false;
(async()=>{
  try{
    if(typeof auth.authStateReady === "function") await auth.authStateReady();
    authResolved=true;
    await bootstrap(auth.currentUser);
  }catch(e){
    authResolved=true;
    showAuthError(e?.message||"Firebase Authentication could not be initialized.");
  }
})();
onAuthStateChanged(auth,user=>{if(!authResolved) return; bootstrap(user);});
