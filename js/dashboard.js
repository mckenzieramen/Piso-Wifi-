import { auth, db } from "./firebase.js";
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { calculateFinancialRecord } from "./finance.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, runTransaction, onSnapshot, arrayUnion,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const $ = (s) => document.querySelector(s);
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
let units = [], records = [], payments = [], notifications = [], activities = [], supportChats = [], passwordResetRequests = [];
let supportUnsub=null, selectedSupportChatId="";
let coreRealtimeUnsubs=[];
let dashboardRealtimeTimer=null;
let settings = { internetCost:1000, ownerPercent:70, clientPercent:30, electricity:100, electricityRule:"ADD_TO_CLIENT" };
let route = "dashboard";
let selectedMonth = localStorage.getItem("pisoSelectedMonth") || todayKey();
let unitSearch = "", unitStatus = "", unitPaymentStatus = "";

// TEMPORARY ADMIN FEATURE: keep true while client deletion is needed.
// Set to false later to remove the Delete Client button without changing the rest of the system.
const ENABLE_CLIENT_DELETE = true;
const CLIENT_AUTH_DOMAIN="@client-login.pisowifi.local";
const clientProvisionerApp=initializeApp(firebaseConfig,"clientProvisioner");
const clientProvisionerAuth=getAuth(clientProvisionerApp);
const clientAuthEmailFromUsername=(username)=>`${String(username||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"-")}${CLIENT_AUTH_DOMAIN}`;
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
    let next=Number(snap.exists()?snap.data().next:(maxExisting+1));
    if(!Number.isInteger(next)||next<1) next=maxExisting+1;
    tx.set(ref,{next:next+1,updatedAt:serverTimestamp()},{merge:true});
    return `CID-${String(next).padStart(3,"0")}`;
  });
}
function availableUnitCodes(currentCode=""){
  const activeCodes=new Set(units.filter(u=>u.active!==false && String(u.unitCode)!==String(currentCode)).map(u=>String(u.unitCode)));
  return Array.from({length:50},(_,i)=>String(i+1)).map(code=>({code,used:activeCodes.has(code)}));
}

async function syncCustomerDirectory(){
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
    const rr=await getDocs(collection(db,"passwordResetRequests"));
    passwordResetRequests=rr.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>timeValue(b.createdAt)-timeValue(a.createdAt));
  } catch(e) {
    console.warn("Password recovery requests are not readable yet. Publish the latest Firestore rules.",e);
    passwordResetRequests=[];
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
function recoveryNotifications(){return passwordResetRequests.map(r=>({id:`reset:${r.id}`,source:"passwordResetRequest",requestId:r.id,type:"password-reset",title:"Account Recovery Request",message:`${r.clientCode||"Customer"} requested a password reset${r.email?` — ${r.email}`:""}.`,read:r.adminRead===true||r.status!=="pending",createdAt:r.createdAt,relatedId:r.clientCode||""}));}
function allAdminNotifications(){return [...notifications,...recoveryNotifications()].sort((a,b)=>timeValue(b.createdAt)-timeValue(a.createdAt));}
function unreadCount(){return allAdminNotifications().filter(n=>n.read!==true).length;}
function updateNotificationBadge(){const el=document.querySelector("#adminNotificationBadge");if(!el)return;const count=unreadCount();el.textContent=count>99?"99+":String(count);el.classList.toggle("hidden",count===0);}
function nav(){ document.querySelectorAll("#nav [data-route]").forEach(a=>a.classList.toggle("active",a.dataset.route===route)); }
function closeMenu(){ $("#sidebar").classList.remove("open"); $("#overlay").classList.remove("show"); }
function baseHead(title,sub,button=""){ return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div>${button}</div>`; }
function statusBadge(s){ return `<span class="badge ${String(s).toLowerCase()}">${esc(s)}</span>`; }
function pageLoader(){ view.innerHTML=`<div class="loading-panel"><div class="loader"></div><p>Loading data…</p></div>`; }

function render(){
  nav();
  const renderers={dashboard:renderDashboard,units:renderUnits,reports:renderReports,payments:renderPayments,statements:renderStatements,notifications:renderNotifications,activity:renderActivity,settings:renderSettings,profile:renderProfile,support:renderSupport};
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

    <div class="panel dashboard-recovery-card">
      <div class="panel-head"><div><h3>Account Recovery Requests</h3><p>Password reset requests waiting for Admin review.</p></div><button class="link-btn" data-route="notifications">View Notifications</button></div>
      <div class="recovery-summary-list">${passwordResetRequests.filter(r=>String(r.status||"pending")==="pending").slice(0,4).map(r=>{const u=units.find(x=>String(x.clientCode||"").toUpperCase()===String(r.clientCode||"").toUpperCase());return `<button class="recovery-summary-row" data-recovery-request="${esc(r.id)}"><span><b>${esc(r.clientCode||"Customer")}</b><small>${esc(u?.name||r.email||"Recovery request")}</small></span><strong>Review</strong></button>`}).join("")||empty("No pending recovery requests.")}</div>
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
  document.querySelectorAll("[data-recovery-request]").forEach(b=>b.onclick=()=>openRecoveryRequestModal(passwordResetRequests.find(r=>r.id===b.dataset.recoveryRequest)));
  bindDynamicButtons();
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
  view.innerHTML=baseHead("Monthly Reports","View and export monthly summaries.",`<div class="tools"><button class="secondary-btn" id="downloadReport">Download</button><button class="primary-btn" id="printReport">Print</button></div>`)+`<div class="report-cards">${reportCard("Total Units",units.length)}${reportCard("Total Gross Sales",money(t.gross))}${reportCard("Total Internet Cost",money(t.internet))}${reportCard("Total Net Sales",money(t.net),"net-sales")}${reportCard("Total Owner Share",money(t.owner))}${reportCard("Total Client Share",money(t.client))}${reportCard("Client Net",money(Math.max(0,t.client-t.elec)),"customer-net")}${reportCard("Total Electricity",money(t.elec))}${reportCard("Total Amount Due",money(t.due))}${reportCard("Total Collected",money(t.paid),"green")}${reportCard("Outstanding",money(t.balance),"red")}</div><div class="panel"><div class="panel-head"><div><h3>${monthLabel(selectedMonth)} Detail</h3><p>All calculations use the current business settings.</p></div><span class="report-rule">Internet ${money(settings.internetCost)} · Owner ${settings.ownerPercent}% · Client ${settings.clientPercent}% · Electricity ${money(settings.electricity)}</span></div><div class="table-wrap"><table><thead><tr><th>Unit</th><th>Client</th><th>Gross Sales</th><th>Internet</th><th>Net Sales</th><th>Owner Share</th><th>Client Share</th><th>Electricity</th><th>Client Net</th><th>Amount Due</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rows.length?rows.map(x=>`<tr><td>${esc(x.u.unitCode)}</td><td>${esc(x.u.name)}</td><td>${money(x.c.gross)}</td><td>${money(x.c.internet)}</td><td>${money(x.c.net)}</td><td>${money(x.c.owner)}</td><td>${money(x.c.client)}</td><td>${money(x.c.elec)}</td><td>${money(Math.max(0,x.c.client-x.c.elec))}</td><td>${money(x.c.clientTotal)}</td><td>${money(x.c.paid)}</td><td class="amount">${money(x.c.balance)}</td><td>${statusBadge(x.c.status)}</td></tr>`).join(""):emptyRow(13,"No sales recorded for this month.")}</tbody></table></div></div>`;
  $("#downloadReport").onclick=()=>downloadReportHtml(t,rows); $("#printReport").onclick=()=>printReport(t,rows);
}
function reportCard(label,value,cls=""){return `<article class="report-card ${cls}"><span>${label}</span><strong>${value}</strong></article>`;}
function exportReportCsv(rows){downloadCsv(`piso-wifi-report-${selectedMonth}.csv`,[["Unit","Client","Gross Sales","Internet","Net Sales","Owner Share","Client Share","Electricity","Client Net","Amount Due","Paid","Balance","Status"],...rows.map(x=>[x.u.unitCode,x.u.name,x.c.gross,x.c.internet,x.c.net,x.c.owner,x.c.client,x.c.elec,Math.max(0,x.c.client-x.c.elec),x.c.clientTotal,x.c.paid,x.c.balance,x.c.status])]);}
function exportReportExcel(rows){downloadXlsx(`piso-wifi-report-${selectedMonth}.xlsx`,"Monthly Report",[["Unit","Client","Gross Sales","Internet","Net Sales","Owner Share","Client Share","Electricity","Client Net","Amount Due","Paid","Balance","Status"],...rows.map(x=>[x.u.unitCode,x.u.name,x.c.gross,x.c.internet,x.c.net,x.c.owner,x.c.client,x.c.elec,Math.max(0,x.c.client-x.c.elec),x.c.clientTotal,x.c.paid,x.c.balance,x.c.status])]);}
function reportDocumentHtml(t,rows){return `<!doctype html><html><head><meta charset="utf-8"><title>PISO WIFI Monthly Report — ${esc(monthLabel(selectedMonth))}</title><style>${printCss()}body{max-width:1200px;margin:auto}.brand{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1685f5;padding-bottom:16px}.customer-net{background:#eef8ff!important;border:1px solid #bfe1ff!important}.amount{text-align:right;font-weight:700}</style></head><body><div class="brand"><div><h1>PISO WIFI</h1><p>Management System · Monthly Report</p></div><div><b>${monthLabel(selectedMonth)}</b><br>Generated ${dateLabel(new Date())}</div></div><div class="print-grid">${[["Total Units",units.length],["Gross Sales",money(t.gross)],["Internet",money(t.internet)],["Net Sales",money(t.net)],["Owner Share",money(t.owner)],["Client Share",money(t.client)],["Client Net",money(Math.max(0,t.client-t.elec))],["Electricity",money(t.elec)],["Amount Due",money(t.due)],["Collected",money(t.paid)],["Outstanding",money(t.balance)]].map(x=>`<div class="${x[0]==="Client Net"?"customer-net":""}"><b>${x[0]}</b><strong>${x[1]}</strong></div>`).join("")}</div><table><thead><tr><th>Unit</th><th>Client</th><th>Gross</th><th>Internet</th><th>Net</th><th>Owner</th><th>Client</th><th>Electricity</th><th>Client Net</th><th>Due</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.u.unitCode)}</td><td>${esc(x.u.name)}</td><td>${money(x.c.gross)}</td><td>${money(x.c.internet)}</td><td>${money(x.c.net)}</td><td>${money(x.c.owner)}</td><td>${money(x.c.client)}</td><td>${money(x.c.elec)}</td><td>${money(Math.max(0,x.c.client-x.c.elec))}</td><td>${money(x.c.clientTotal)}</td><td>${money(x.c.paid)}</td><td>${money(x.c.balance)}</td><td>${esc(x.c.status)}</td></tr>`).join("")}</tbody></table></body></html>`;}
function downloadReportHtml(t,rows){downloadHtmlFile(`piso-wifi-report-${selectedMonth}.html`,reportDocumentHtml(t,rows));}
function downloadXlsx(name,sheetName,data){if(!window.XLSX){notify("Excel exporter is still loading. Please try again.","error");return;}const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet(data);XLSX.utils.book_append_sheet(wb,ws,sheetName);XLSX.writeFile(wb,name);}
function downloadCsv(name,data){const csv=data.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);}
function printReport(t,rows){openPrintWindow(reportDocumentHtml(t,rows));}

function renderPayments(){
  const rows=normalizeRows().filter(x=>x.c.balance>0);
  const all=payments.filter(p=>p.month===selectedMonth).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  view.innerHTML=baseHead("Payments","Record and track client payments.",`<button class="primary-btn" id="recordPayment">+ Record Payment</button>`)+`<div class="summary-grid"><div class="summary-card"><h3>CLIENT NET</h3><strong>${money(Math.max(0,totals(normalizeRows()).client-totals(normalizeRows()).elec))}</strong></div><div class="summary-card"><h3>AMOUNT DUE</h3><strong>${money(totals(normalizeRows()).due)}</strong></div><div class="summary-card"><h3>COLLECTED</h3><strong class="success-text">${money(totals(normalizeRows()).paid)}</strong></div><div class="summary-card"><h3>OUTSTANDING</h3><strong class="danger-text">${money(totals(normalizeRows()).balance)}</strong></div></div><div class="panel"><div class="panel-head"><div><h3>Outstanding Payments</h3><p>Clients with balances for ${monthLabel(selectedMonth)}</p></div><button class="secondary-btn" id="paymentSearchAll">Show Payment History</button></div><div class="table-wrap"><table><thead><tr><th>Unit</th><th>Client</th><th>Amount Due</th><th>Paid</th><th>Balance</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.length?rows.map(x=>`<tr><td>${esc(x.u.unitCode)}</td><td>${esc(x.u.name)}</td><td>${money(x.c.clientTotal)}</td><td>${money(x.c.paid)}</td><td class="amount">${money(x.c.balance)}</td><td>${statusBadge(x.c.status)}</td><td><button class="action-btn" data-payment="${x.u.id}">Record Payment</button></td></tr>`).join(""):emptyRow(7,"No outstanding payments.")}</tbody></table></div></div><div class="panel" id="paymentHistory"><div class="panel-head"><div><h3>Payment History</h3><p>${monthLabel(selectedMonth)}</p></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Unit</th><th>Client</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead><tbody>${all.length?all.map(p=>{const u=units.find(x=>x.id===p.unitId);return `<tr><td>${dateLabel(p.date)}</td><td>${esc(u?.unitCode||"—")}</td><td>${esc(u?.name||"—")}</td><td class="amount">${money(p.amount)}</td><td>${esc(p.method||"—")}</td><td>${esc(p.reference||"—")}</td></tr>`}).join(""):emptyRow(6,"No payments recorded.")}</tbody></table></div></div>`;
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
  const list=allAdminNotifications();
  view.innerHTML=baseHead("Notifications","Stay updated on payments, balances, reports and system changes.",`<button class="secondary-btn" id="markAllRead">Mark all as read</button>`)+`<div class="notification-list">${list.length?list.map(n=>`<button class="notification-card ${n.read===true?"read":"unread"}" data-notification="${esc(n.id)}"><span class="notification-icon">${n.type==="payment"?"₱":n.type==="balance"?"!":n.type==="report"?"▥":n.type==="password-reset"?"🔐":"●"}</span><span><b>${esc(n.title)}</b><small>${esc(n.message)}</small><time>${dateTimeLabel(n.createdAt)}</time></span>${n.read!==true?"<em>NEW</em>":""}</button>`).join(""):empty("You're all caught up.")}</div>`;
  $("#markAllRead").onclick=markAllNotificationsRead;document.querySelectorAll("[data-notification]").forEach(b=>b.onclick=()=>openNotification(b.dataset.notification));
}
async function openNotification(id){const n=allAdminNotifications().find(x=>x.id===id);if(!n)return;if(n.source==="passwordResetRequest"){const r=passwordResetRequests.find(x=>x.id===n.requestId);if(!r)return;if(r.adminRead!==true)await updateDoc(doc(db,"passwordResetRequests",r.id),{adminRead:true});openRecoveryRequestModal(r);return;}if(n.read!==true){await updateDoc(doc(db,"notifications",id),{read:true});await loadData();}if(n.relatedId&&units.some(u=>u.id===n.relatedId))openProfile(n.relatedId);else render();}
async function markAllNotificationsRead(){const jobs=[...notifications.filter(n=>n.read!==true).map(n=>updateDoc(doc(db,"notifications",n.id),{read:true})),...passwordResetRequests.filter(r=>r.adminRead!==true).map(r=>updateDoc(doc(db,"passwordResetRequests",r.id),{adminRead:true}))];await Promise.all(jobs);await loadData();render();notify("All notifications marked as read.");}
function openRecoveryRequestModal(request){
 if(!request){notify("Recovery request not found.","error");return;}
 const status=String(request.status||"pending").toLowerCase();
 const statusText=status==="pending"?"Pending Review":status==="approved"?"Approved":"Rejected";
 const html=`<div class="recovery-review"><div class="recovery-review-status ${esc(status)}">${esc(statusText)}</div><div class="recovery-review-grid"><div><small>Customer</small><strong>${esc(request.customerName||request.clientCode||"Customer")}</strong></div><div><small>Client ID</small><strong>${esc(request.clientCode||"—")}</strong></div><div><small>Registered Gmail</small><strong>${esc(request.email||"—")}</strong></div><div><small>Unit</small><strong>${esc(request.unitCode||"—")}</strong></div><div><small>Requested</small><strong>${dateTimeLabel(request.createdAt)}</strong></div></div><div class="recovery-review-note">${status==="pending"?"Approve this request by setting a new temporary password. The customer must use it once, then create a private password. The final private password is never shown to Admin.":status==="approved"?"A temporary password has been set. The customer must create a private password after signing in.":"This recovery request was rejected."}</div></div>`;
 openModal("Account Recovery Request",html,status==="pending"?"Approve & Set Temporary Password":"Close",async()=>{
   if(status!=="pending")return;
   const existing=document.querySelector("#recoveryTempPasswordModal"); if(existing)existing.remove();
   const wrap=document.createElement("div"); wrap.id="recoveryTempPasswordModal"; wrap.className="recovery-temp-modal";
   wrap.innerHTML=`<div class="recovery-temp-backdrop"></div><section class="recovery-temp-card" role="dialog" aria-modal="true"><button type="button" class="recovery-temp-close" aria-label="Close">×</button><div class="recovery-temp-icon">🔐</div><span class="eyebrow">SET TEMPORARY PASSWORD</span><h2>Approve & Set Password</h2><p>Enter the temporary password that the customer will use for the next login.</p><label class="recovery-password-field"><span>Temporary Password</span><div><input id="recoveryTempPassword" type="password" minlength="8" autocomplete="new-password" placeholder="Enter temporary password"><button type="button" data-toggle-temp>Show</button></div></label><label class="recovery-password-field"><span>Confirm Temporary Password</span><div><input id="recoveryTempPasswordConfirm" type="password" minlength="8" autocomplete="new-password" placeholder="Re-enter temporary password"><button type="button" data-toggle-temp-confirm>Show</button></div></label><div id="recoveryTempMessage" class="recovery-temp-message"></div><div class="recovery-temp-actions"><button type="button" class="secondary-btn" data-temp-cancel>Cancel</button><button type="button" class="primary-btn" data-temp-save>Approve & Set Password</button></div><small class="recovery-temp-security">The temporary password is not stored in Firestore. After login, the customer must create a private password that Admin cannot see.</small></section>`;
   document.body.appendChild(wrap);
   const close=()=>wrap.remove(); wrap.querySelector(".recovery-temp-close").onclick=close; wrap.querySelector("[data-temp-cancel]").onclick=close;
   wrap.querySelector("[data-toggle-temp]").onclick=()=>{const i=wrap.querySelector("#recoveryTempPassword");i.type=i.type==="password"?"text":"password";};
   wrap.querySelector("[data-toggle-temp-confirm]").onclick=()=>{const i=wrap.querySelector("#recoveryTempPasswordConfirm");i.type=i.type==="password"?"text":"password";};
   wrap.querySelector("[data-temp-save]").onclick=async()=>{const a=wrap.querySelector("#recoveryTempPassword").value,b=wrap.querySelector("#recoveryTempPasswordConfirm").value,m=wrap.querySelector("#recoveryTempMessage"),btn=wrap.querySelector("[data-temp-save]");if(a.length<8){m.textContent="Use at least 8 characters.";m.className="recovery-temp-message error";return;}if(a!==b){m.textContent="Passwords do not match.";m.className="recovery-temp-message error";return;}btn.disabled=true;btn.textContent="Saving…";m.textContent="Setting temporary password securely…";try{const token=await currentUser.getIdToken(true);let res;try{res=await fetch("/api/set-client-temporary-password",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},body:JSON.stringify({requestId:request.id,temporaryPassword:a})});}catch(fetchErr){throw new Error("Temporary password service is not configured on this site yet. Please complete the one-time Cloudflare recovery setup, then try again.");}const data=await res.json().catch(()=>({}));if(!res.ok||data.error)throw new Error(data.error||"Unable to set the temporary password.");close();closeModal();await loadData();render();notify("Recovery approved. Temporary password has been set.");}catch(e){console.error("[PISO WIFI RECOVERY]",e);m.textContent=e?.message||"Unable to set the temporary password.";m.className="recovery-temp-message error";btn.disabled=false;btn.textContent="Approve & Set Password";}};
   wrap.querySelector("#recoveryTempPassword").focus();
 });
 if(status==="pending")setTimeout(()=>{const actions=document.querySelector("#modalRoot .modal-actions");if(!actions)return;const reject=document.createElement("button");reject.className="danger-outline-btn";reject.textContent="Reject Request";reject.onclick=async()=>{try{await updateDoc(doc(db,"passwordResetRequests",request.id),{status:"rejected",adminRead:true,reviewedAt:serverTimestamp(),reviewedBy:currentUser?.email||"Admin"});closeModal();await loadData();render();notify("Recovery request rejected.");}catch(e){notify(e?.message||"Unable to reject recovery request.","error");}};actions.insertBefore(reject,actions.firstChild);},0);
}

function renderActivity(){
  view.innerHTML=baseHead("Activity Log","Track important system, client, sales, payment and settings actions.",`<select class="search" id="activityFilter"><option value="">All Activities</option><option>System</option><option>Sales</option><option>Payments</option><option>Clients</option><option>Units</option><option>Settings</option><option>Reports</option></select>`)+`<div class="panel"><div class="panel-head"><div><h3>Recent Activity</h3><p>Newest actions appear first and are stored in Firebase.</p></div></div><div class="table-wrap"><table><thead><tr><th>Date & Time</th><th>Activity</th><th>Details</th><th>Admin</th></tr></thead><tbody id="activityBody">${activityRows("")}</tbody></table></div></div>`;
  $("#activityFilter").onchange=e=>$("#activityBody").innerHTML=activityRows(e.target.value);
}
function activityRows(filter){const list=activities.filter(a=>!filter||a.activityType===filter);return list.length?list.map(a=>`<tr><td>${dateTimeLabel(a.createdAt)}</td><td><span class="activity-dot"></span>${esc(a.activityType||"Activity")}</td><td>${esc(a.description||"—")}</td><td>${esc(a.userEmail||currentUser?.email||"Admin")}</td></tr>`).join(""):emptyRow(4,"No activity recorded yet. Actions you perform will appear here automatically.");}

function renderSettings(){
  view.innerHTML=baseHead("Settings","Configure the business rules used by all calculations.")+`<div class="settings-layout"><div class="panel settings-card"><div class="panel-head"><div><h3>Business Settings</h3><p>These values drive dashboard, payments, statements and reports.</p></div></div><div class="settings-body"><div class="setting-row"><div><b>Internet Cost</b><small>Fixed internet cost per unit/month.</small></div><input id="sInternet" type="number" min="0" step="0.01" value="${settings.internetCost}"></div><div class="setting-row"><div><b>Owner Share</b><small>Percentage of net sales allocated to owner.</small></div><input id="sOwner" type="number" min="0" max="100" step="1" value="${settings.ownerPercent}"></div><div class="setting-row"><div><b>Client Share</b><small>Percentage of net sales allocated to client.</small></div><input id="sClient" type="number" min="0" max="100" step="1" value="${settings.clientPercent}"></div><div class="setting-row"><div><b>Electricity</b><small>Electricity amount per unit/month.</small></div><input id="sElec" type="number" min="0" step="0.01" value="${settings.electricity}"></div><div class="setting-row"><div><b>Electricity Rule</b><small>How electricity affects the client amount.</small></div><select id="sRule"><option value="ADD_TO_CLIENT" ${settings.electricityRule==="ADD_TO_CLIENT"?"selected":""}>Add to Client</option><option value="SUBTRACT_FROM_CLIENT" ${settings.electricityRule==="SUBTRACT_FROM_CLIENT"?"selected":""}>Deduct from Client</option><option value="SEPARATE_CHARGE" ${settings.electricityRule==="SEPARATE_CHARGE"?"selected":""}>Separate Charge</option></select></div><div class="settings-actions"><button class="primary-btn" id="saveSettings">Save Settings</button></div></div></div><div class="panel"><div class="panel-head"><div><h3>Current Formula</h3><p>Used for ${monthLabel(selectedMonth)}</p></div></div><div class="formula-box"><div>Gross Sales</div><strong>− ${money(settings.internetCost)} Internet</strong><div>= Net Sales</div><strong>× ${settings.ownerPercent}% Owner</strong><strong>× ${settings.clientPercent}% Client</strong><div>Electricity: <b>${settings.electricityRule.replaceAll("_"," ")}</b></div></div></div></div>`;
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
async function sendAdminSupportMessage(id){const input=$("#adminSupportInput");const text=String(input?.value||"").trim();if(!text)return;try{await updateDoc(doc(db,"supportChats",id),{messages:arrayUnion({senderType:"admin",text,createdAt:new Date().toISOString()}),updatedAt:new Date().toISOString(),unreadForAdmin:false,unreadForCustomer:true,"typingBy.admin":false,status:"Open"});input.value="";}catch(e){notify(e?.message||"Unable to send support reply.","error");}}
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
  if(tab==="sales"){const rows=records.filter(r=>r.unitId===id).sort((a,b)=>String(b.month).localeCompare(String(a.month)));host.innerHTML=`<div class="panel"><div class="panel-head"><div><h3>Monthly Sales History</h3><p>Historical records are kept by month.</p></div><button class="primary-btn" data-sale="${id}">Gross Sale</button></div><div class="table-wrap"><table><thead><tr><th>Month</th><th>Gross Sales</th><th>Internet</th><th>Net Sales</th><th>Owner Share</th><th>Client Share</th><th>Electricity</th><th>Client Net</th><th>Amount Due</th><th>Actions</th></tr></thead><tbody>${rows.length?rows.map(r=>{const c=calc(r);return `<tr><td>${monthLabel(r.month)}</td><td>${money(c.gross)}</td><td>${money(c.internet)}</td><td>${money(c.net)}</td><td>${money(c.owner)}</td><td>${money(c.client)}</td><td>${money(c.elec)}</td><td>${money(Math.max(0,c.client-c.elec))}</td><td>${money(c.clientTotal)}</td><td><button class="action-btn" data-edit-sale="${r.id}">Edit</button><button class="action-btn danger" data-delete-sale="${r.id}">Delete</button></td></tr>`}).join(""):emptyRow(10,"No sales recorded for this client.")}</tbody></table></div></div>`;bindDynamicButtons();return;}
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
function openUnitModal(id=null){
  const u=id?units.find(x=>x.id===id):null;
  const suggestedDate = u?.dateJoined || new Date().toISOString().slice(0,10);
  const codes=availableUnitCodes(u?.unitCode||"");
  const currentCode=String(u?.unitCode||"");
  const codeOptions=codes.map(x=>`<button type="button" class="unit-option ${x.used?"is-used":""}" data-unit-code="${x.code}" ${x.used?"disabled":""}><span>${x.code}</span><small>${x.used?"Active / Unavailable":"Available"}</small></button>`).join("");
  openModal(id?"Edit Client / Unit":"Add New Client",`
    <div class="form-grid">
      <div class="field"><label>Client ID *</label><input id="fClientCode" value="${esc(u?.clientCode||"")}" placeholder="CID-0001" ${id?"disabled":"disabled"}><small class="hint">Automatically generated in sequence. This ID is never reused.</small></div>
      <div class="field"><label>Unit Code *</label><div class="unit-combobox"><input id="fCodeSearch" value="${esc(currentCode)}" placeholder="Search or select 1–50" autocomplete="off" aria-autocomplete="list"><input id="fCode" type="hidden" value="${esc(currentCode)}"><div id="unitCodeOptions" class="unit-options">${codeOptions}</div></div><small class="hint">Active unit codes cannot be selected. Deactivated unit codes become available again.</small></div>
      <div class="field"><label>First Name *</label><input id="fFirstName" value="${esc(u?.firstName||"")}" placeholder="First Name" autocomplete="off"></div>
      <div class="field"><label>Last Name *</label><input id="fLastName" value="${esc(u?.lastName||String(u?.name||"").trim().split(/\s+/).slice(1).join(" "))}" placeholder="Last Name" autocomplete="off"></div>
      <div class="field full"><label>Registered Gmail *</label><input id="fEmail" type="email" value="${esc(u?.email||"")}" placeholder="customer@gmail.com" autocomplete="off"><small class="hint">Used for account recovery and customer records.</small></div>
      <div class="field"><label>Contact Number</label><input id="fContact" value="${esc(u?.contact||"")}" placeholder="09171234567" autocomplete="off"></div>
      <div class="field"><label>Date Joined</label><input id="fDateJoined" type="date" value="${esc(suggestedDate)}"></div>
      <div class="field full"><label>Unit Location</label><input id="fLocation" value="${esc(u?.location||"")}" placeholder="Brgy. San Isidro, Antipolo" autocomplete="off"></div>
      <div class="field full"><label>Client Address</label><input id="fAddress" value="${esc(u?.address||u?.location||"")}" placeholder="Client residential/contact address" autocomplete="off"></div>
      <div class="field"><label>Status</label><select id="fStatus"><option value="active" ${u?.active!==false?"selected":""}>Active</option><option value="inactive" ${u?.active===false?"selected":""}>Inactive</option></select></div>
      <div class="field"><label>Username</label><input id="fUsername" value="${esc(u?.username||"")}" placeholder="Generated automatically" disabled><small class="hint">Generated as FirstName + Client ID, e.g. JuanCID-001.</small></div>
      <div class="field full"><label>Notes</label><textarea id="fNotes" rows="3">${esc(u?.notes||"")}</textarea></div>
    </div>`,`Save Client`,async()=>{
      const clientCode=id?String(u?.clientCode||"").trim().toUpperCase():await nextClientId();
      const unitCode=$("#fCode").value.trim();
      const firstName=$("#fFirstName").value.trim();
      const lastName=$("#fLastName").value.trim();
      const name=`${firstName} ${lastName}`.trim();
      const email=$("#fEmail").value.trim().toLowerCase();
      if(!clientCode||!unitCode||!firstName||!lastName||!email) throw new Error("Client ID, Unit Code, First Name, Last Name and Registered Gmail are required.");
      if(!/^CID-\d{3,}$/.test(clientCode)) throw new Error("Client ID must use the CID-001 format.");
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
        if(u?.authUserId) await setDoc(doc(db,"users",u.authUserId),{role:"client",clientUnitId:id,unitId:id,clientCode,username,email,updatedAt:serverTimestamp()},{merge:true});
        await logActivity("Clients",`Edited ${unitCode} — ${name}`,id);
        await addNotification("client","Client profile updated.",`${name} (${clientCode}) was updated.`,id);
      }else{
        const authEmail=clientAuthEmailFromUsername(username);
        const temporaryPassword=clientCode;
        let cred;
        try{ cred=await createUserWithEmailAndPassword(clientProvisionerAuth,authEmail,temporaryPassword); }
        catch(e){
          if(e?.code==="auth/email-already-in-use") throw new Error("This generated username already has a login account. Please try again.");
          throw e;
        }
        data.authUserId=cred.user.uid;
        data.forcePasswordChange=true;
        data.loginId=username;
        data.authEmail=authEmail;
        const ref=await addDoc(collection(db,"units"),{...data,createdAt:serverTimestamp()});
        await setDoc(doc(db,"users",cred.user.uid),{role:"client",clientUnitId:ref.id,unitId:ref.id,clientCode,username,email,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
        await logActivity("Clients",`Added client account ${clientCode} — ${username} — ${name}`,ref.id);
        await addNotification("client","New client account created.",`${name} (${clientCode}) can now log in using username ${username}.`,ref.id);
        notify(`Created ${clientCode}. Username: ${username} · Temporary password: ${temporaryPassword}`);
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
  coreRealtimeUnsubs.push(onSnapshot(collection(db,"passwordResetRequests"),snap=>{passwordResetRequests=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>timeValue(b.createdAt)-timeValue(a.createdAt));updateNotificationBadge();if(route==="notifications"||route==="dashboard")scheduleDashboardRealtime();},err=>console.warn("PISO WIFI realtime password recovery requests unavailable",err)));
}

function showAuthError(message){console.error("[PISO WIFI]",message);const loader=$("#authLoading");if(loader){loader.innerHTML=`<div class="auth-error"><strong>Unable to open the dashboard</strong><span>${esc(message)}</span><button onclick="location.href='index.html'">Return to Login</button></div>`;loader.classList.remove("hidden");}}
async function bootstrap(user){if(!user){location.replace("index.html");return;}currentUser=user;try{await authorize(user);await loadData();await logActivity("System",`Admin login — ${user.email||"Admin"}`);setupMonthSelector();startSupportRealtime();startCoreRealtime();$("#authLoading").classList.add("hidden");$("#app").classList.remove("hidden");$("#userEmail").textContent=user.email||"Owner";route=location.hash.replace("#","").split("?")[0]||"dashboard";render();}catch(e){showAuthError(e?.message||"Firebase authorization or database access failed.");}}

function parseRoute(){const raw=location.hash.replace("#","");return raw.split("?")[0]||"dashboard";}
document.addEventListener("click",e=>{const a=e.target.closest("[data-route]");if(a){e.preventDefault();location.hash="#"+a.dataset.route;} const p=e.target.closest("[data-print-inline]");if(p){const id=$("#statementUnit")?.value;if(id)printStatement(id,$("#statementMonth").value);} const pdf=e.target.closest("[data-pdf-inline]");if(pdf){const id=$("#statementUnit")?.value;if(id)downloadStatementPdf(id,$("#statementMonth").value);} const html=e.target.closest("[data-html-inline]");if(html){const id=$("#statementUnit")?.value;if(id)downloadStatementHtml(id,$("#statementMonth").value);}});
window.addEventListener("hashchange",()=>{route=parseRoute();render();});
$("#menuBtn").onclick=()=>{$("#sidebar").classList.add("open");$("#overlay").classList.add("show")};$("#overlay").onclick=closeMenu;
$("#logoutBtn").onclick=async()=>{await signOut(auth);location.href="index.html"};
$("#globalSearch").oninput=e=>{const q=e.target.value.trim();if(q.length>=2){unitSearch=q;route="units";if(location.hash!=="#units")location.hash="#units";else renderUnits();}else if(!q){unitSearch="";if(route==="units")renderUnits();}};

let authResolved=false;
const authTimeout=setTimeout(()=>{if(!authResolved){const u=auth.currentUser;if(u)bootstrap(u);else showAuthError("Firebase Authentication did not finish loading. Please refresh the page and try logging in again.");}},8000);
onAuthStateChanged(auth,user=>{authResolved=true;clearTimeout(authTimeout);bootstrap(user);});
