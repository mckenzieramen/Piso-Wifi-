import { auth, db } from "./firebase.js";
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { calculateFinancialRecord } from "./finance.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, writeBatch,
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
let units = [], records = [], payments = [], notifications = [], activities = [];
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
const clientAuthEmailFromUnitId=(unitCode)=>`${String(unitCode||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"-")}${CLIENT_AUTH_DOMAIN}`;

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
function totals(rows){ return rows.reduce((a,x)=>{a.gross+=x.c.gross;a.internet+=x.c.internet;a.net+=x.c.net;a.owner+=x.c.owner;a.client+=x.c.client;a.elec+=x.c.elec;a.due+=x.c.clientTotal;a.paid+=x.c.paid;a.balance+=x.c.balance;return a},{gross:0,internet:0,net:0,owner:0,client:0,elec:0,due:0,paid:0,balance:0}); }

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
    const a=await getDocs(collection(db,"activities"));
    activities=a.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>timeValue(b.createdAt)-timeValue(a.createdAt));
  } catch(e) {
    console.warn("Activities collection is not readable yet. Publish the latest Firestore rules.",e);
    activities=[];
  }

  updateNotificationBadge();
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
function nav(){ document.querySelectorAll("#nav a").forEach(a=>a.classList.toggle("active",a.dataset.route===route)); }
function closeMenu(){ $("#sidebar").classList.remove("open"); $("#overlay").classList.remove("show"); }
function baseHead(title,sub,button=""){ return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div>${button}</div>`; }
function statusBadge(s){ return `<span class="badge ${String(s).toLowerCase()}">${esc(s)}</span>`; }
function pageLoader(){ view.innerHTML=`<div class="loading-panel"><div class="loader"></div><p>Loading data…</p></div>`; }

function render(){
  nav();
  const renderers={dashboard:renderDashboard,units:renderUnits,reports:renderReports,payments:renderPayments,statements:renderStatements,notifications:renderNotifications,activity:renderActivity,settings:renderSettings,profile:renderProfile};
  (renderers[route]||renderDashboard)();
  closeMenu();
  updateNotificationBadge();
  window.scrollTo({top:0,behavior:"smooth"});
}

function renderDashboard(){
  const rows=normalizeRows(), t=totals(rows), active=units.filter(u=>u.active!==false).length;
  // Dashboard-only metric: Client Net = Customer 30% share less electricity.
  // This is intentionally display-only and does NOT change the existing financial calculation flow.
  const customerNet = Math.max(0, t.client - t.elec);
  const top=[...rows].sort((a,b)=>b.c.gross-a.c.gross).slice(0,5);
  const outstanding=rows.filter(x=>x.c.balance>0).sort((a,b)=>b.c.balance-a.c.balance).slice(0,5);
  view.innerHTML=baseHead("Dashboard","Overview of your Piso WiFi business.",`<button class="primary-btn" id="addUnitTop">+ Add New Unit</button>`)+`
  <div class="dashboard-grid">
    <div class="kpis">
      ${kpi("▦","Total Units",units.length,"All registered units")}
      ${kpi("●","Active Units",active,"Currently active","green")}
      ${kpi("₱","Gross Sales",money(t.gross),"This month","orange")}
      ${kpi("−","Internet Cost",money(t.internet),"Monthly internet cost","red")}
      ${kpi("=","Net Sales",money(t.net),"Gross sales − internet","net-sales")}
      ${kpi("70%","Owner Share",money(t.owner),settings.ownerPercent+"% share","gold")}
      ${kpi("30%","Client Share",money(t.client),settings.clientPercent+"% share","purple")}
      ${kpi("✓","Client Net",money(customerNet),"Client share less electricity","customer-net")}
      ${kpi("!","Total Due",money(t.due),"Pending payments","red")}
    </div>
    <div class="analytics-grid">
      <div class="panel chart-panel"><div class="panel-head"><div><h3>Sales Trend (Last 6 Months)</h3><p>Gross sales from actual monthly records</p></div><select class="compact-select" id="chartMetric"><option>Gross Sales</option><option>Owner Share</option><option>Client Share</option><option>Payments</option></select></div><div class="chart-wrap" id="salesChart">${salesChart()}</div></div>
      <div class="panel"><div class="panel-head"><div><h3>Top Performing Units</h3><p>Ranked by gross sales</p></div><select class="compact-select" id="topPeriod"><option value="month">This Month</option><option value="last">Last Month</option><option value="3">Last 3 Months</option><option value="year">This Year</option></select></div><div class="rank-list accumulating-list" id="topUnits">${topUnitsHtml(top)}</div></div>
      <div class="panel"><div class="panel-head"><div><h3>Outstanding Payments</h3><p>Clients with balances greater than zero</p></div><button class="link-btn" id="viewOutstanding">View All</button></div><div class="outstanding-list accumulating-list">${outstanding.length?outstanding.map(x=>`<button class="outstanding-row" data-pay-unit="${x.u.id}"><span><b>${esc(x.u.unitCode)}</b><small>${esc(x.u.name)}</small></span><strong>${money(x.c.balance)}</strong></button>`).join(""):empty("No outstanding payments.")}</div></div>
    </div>
    <div class="panel"><div class="panel-head"><div><h3>Units / Clients</h3><p>Monthly computation for ${monthLabel(selectedMonth)}</p></div><div class="tools"><input class="search" id="dashSearch" placeholder="Search client or unit…"><select id="dashStatus" class="search"><option value="">All Payment Status</option><option>Paid</option><option>Partial</option><option>Unpaid</option></select></div></div><div class="table-wrap accumulating-table"><table><thead><tr><th>Unit Code</th><th>Client Name</th><th>Location</th><th>Status</th><th>This Month</th><th>Payment</th><th>Actions</th></tr></thead><tbody id="dashBody">${rows.length?rows.map(dashboardRow).join(""):emptyRow(7,"No clients or units found.")}</tbody></table></div></div>
  </div>`;
  $("#addUnitTop").onclick=()=>openUnitModal();
  $("#dashSearch").oninput=e=>filterDashboard(e.target.value,$("#dashStatus").value);
  $("#dashStatus").onchange=e=>filterDashboard($("#dashSearch").value,e.target.value);
  $("#viewOutstanding").onclick=()=>{location.hash="#payments";};
  $("#chartMetric").onchange=e=>$("#salesChart").innerHTML=salesChart(e.target.value);
  $("#topPeriod").onchange=e=>renderTopUnits(e.target.value);
  bindDynamicButtons();
  document.querySelectorAll("[data-pay-unit]").forEach(b=>b.onclick=()=>openPaymentModal(b.dataset.payUnit));
}
function kpi(icon,title,value,sub,cls=""){ return `<article class="kpi ${cls}"><div class="kpi-icon">${icon}</div><span>${title}</span><b>${value}</b><small>${sub}</small></article>`; }
function empty(msg){ return `<div class="empty">${esc(msg)}</div>`; }
function emptyRow(cols,msg){ return `<tr><td colspan="${cols}" class="empty">${esc(msg)}</td></tr>`; }
function dashboardRow(x){ return `<tr><td><b>${esc(x.u.unitCode||"—")}</b></td><td><b>${esc(x.u.name||"—")}</b></td><td>${esc(x.u.location||"—")}</td><td>${statusBadge(x.u.active!==false?"Active":"Inactive")}</td><td class="amount">${money(x.c.gross)}</td><td>${statusBadge(x.c.status)}</td><td><button class="action-btn" data-profile="${x.u.id}">View</button><button class="action-btn" data-sale="${x.u.id}">Gross Sale</button></td></tr>`; }
function filterDashboard(q,status){ const rows=normalizeRows().filter(x=>(!q||`${x.u.name} ${x.u.unitCode} ${x.u.location} ${x.u.contact}`.toLowerCase().includes(q.toLowerCase()))&&(!status||x.c.status===status)); $("#dashBody").innerHTML=rows.length?rows.map(dashboardRow).join(""):emptyRow(7,"No matching units."); bindDynamicButtons(); }
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
function metricTotal(month,metric){ const rs=records.filter(r=>r.month===month); return rs.reduce((sum,r)=>{const c=calc(r); return sum+(metric==="Owner Share"?c.owner:metric==="Client Share"?c.client:metric==="Payments"?c.paid:c.gross)},0); }
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
  view.innerHTML=baseHead("Units / Clients","Manage your Piso WiFi units and clients.",`<button class="primary-btn" id="addUnitBtn">+ Add Client / Unit</button>`)+`<div class="panel"><div class="panel-head"><div><h3>Registered Units</h3><p>Showing ${rows.length} of ${units.length} units · ${monthLabel(selectedMonth)}</p></div><div class="tools"><input id="unitSearch" class="search" placeholder="Search client or unit…" value="${esc(unitSearch)}"><select id="unitStatus" class="search"><option value="">All Status</option><option ${unitStatus==="Active"?"selected":""}>Active</option><option ${unitStatus==="Inactive"?"selected":""}>Inactive</option></select><select id="unitPaymentStatus" class="search"><option value="">All Payment Status</option><option ${unitPaymentStatus==="Paid"?"selected":""}>Paid</option><option ${unitPaymentStatus==="Partial"?"selected":""}>Partial</option><option ${unitPaymentStatus==="Unpaid"?"selected":""}>Unpaid</option></select><button class="secondary-btn" id="exportUnits">Export Excel/CSV</button></div></div><div class="table-wrap accumulating-table"><table><thead><tr><th>Unit Code</th><th>Client Name</th><th>Location</th><th>Contact</th><th>Status</th><th>This Month</th><th>Payment</th><th>Actions</th></tr></thead><tbody>${rows.length?rows.map(x=>`<tr><td><b>${esc(x.u.unitCode||"—")}</b></td><td>${esc(x.u.name||"—")}</td><td>${esc(x.u.location||"—")}</td><td>${esc(x.u.contact||"—")}</td><td>${statusBadge(x.u.active!==false?"Active":"Inactive")}</td><td class="amount">${money(x.c.gross)}</td><td>${statusBadge(x.c.status)}</td><td><button class="action-btn" data-sale="${x.u.id}">Gross Sale</button><button class="action-btn" data-profile="${x.u.id}">View</button><button class="action-btn" data-edit-unit="${x.u.id}">Edit</button><button class="action-btn danger" data-toggle-unit="${x.u.id}">${x.u.active!==false?"Deactivate":"Activate"}</button>${ENABLE_CLIENT_DELETE?`<button class="action-btn danger solid-danger" data-delete-unit="${x.u.id}">Delete</button>`:""}</td></tr>`).join(""):emptyRow(8,"No clients or units found.")}</tbody></table></div></div>`;
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
function statementHtml(u,c,month){return `<div class="statement-sheet"><div class="statement-brand"><div class="statement-logo">◔</div><div><h2>PISO WIFI</h2><span>Management System</span></div><div class="statement-actions"><button class="primary-btn" data-print-inline="1">Print</button><button class="secondary-btn" data-html-inline="1">Download</button></div></div><div class="statement-meta"><div><b>Client:</b><span>${esc(u?.name||"—")}</span><b>Unit:</b><span>${esc(u?.unitCode||"—")}</span><b>Location:</b><span>${esc(u?.location||"—")}</span><b>Contact:</b><span>${esc(u?.contact||"—")}</span></div><div><b>Period:</b><span>${monthLabel(month)}</span><b>Date Generated:</b><span>${dateLabel(new Date())}</span><b>Status:</b><span>${c.status}</span></div></div><table class="statement-table"><tbody><tr><td>Gross Sales</td><td>${money(c.gross)}</td></tr><tr><td>Internet Cost</td><td>${money(c.internet)}</td></tr><tr><td>Net Sales</td><td>${money(c.net)}</td></tr><tr><td>Owner Share (${settings.ownerPercent}%)</td><td>${money(c.owner)}</td></tr><tr><td>Client Share (${settings.clientPercent}%)</td><td>${money(c.client)}</td></tr><tr><td>Electricity Share</td><td>${money(c.elec)}</td></tr><tr class="customer-net"><td>Client Net</td><td>${money(Math.max(0,c.client-c.elec))}</td></tr><tr class="total"><td>Amount Due</td><td>${money(c.clientTotal)}</td></tr><tr><td>Payments</td><td>${money(c.paid)}</td></tr><tr class="balance"><td>Balance</td><td>${money(c.balance)}</td></tr></tbody></table></div>`;}
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
  const lines=[["Gross Sales",money(c.gross)],["Internet Cost",money(c.internet)],["Net Sales",money(c.net)],[`Owner Share (${settings.ownerPercent}%)`,money(c.owner)],[`Client Share (${settings.clientPercent}%)`,money(c.client)],["Electricity Share",money(c.elec)],["Client Net",money(Math.max(0,c.client-c.elec))],["Amount Due",money(c.clientTotal)],["Payments",money(c.paid)],["Balance",money(c.balance)]];
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
  if(tab==="overview"){const r=records.find(x=>x.unitId===id&&x.month===selectedMonth)||{unitId:id,month:selectedMonth,grossSales:0};const c=calc(r);host.innerHTML=`<div class="summary-grid"><div class="summary-card"><h3>GROSS SALES</h3><strong>${money(c.gross)}</strong></div><div class="summary-card"><h3>INTERNET COST</h3><strong>${money(c.internet)}</strong></div><div class="summary-card"><h3>NET SALES</h3><strong>${money(c.net)}</strong></div><div class="summary-card"><h3>OWNER SHARE (${settings.ownerPercent}%)</h3><strong>${money(c.owner)}</strong></div><div class="summary-card"><h3>CLIENT SHARE (${settings.clientPercent}%)</h3><strong>${money(c.client)}</strong></div><div class="summary-card customer-net-card"><h3>CLIENT NET</h3><strong>${money(Math.max(0,c.client-c.elec))}</strong></div><div class="summary-card"><h3>ELECTRICITY</h3><strong>${money(c.elec)}</strong></div><div class="summary-card"><h3>AMOUNT DUE</h3><strong>${money(c.clientTotal)}</strong></div><div class="summary-card"><h3>AMOUNT PAID</h3><strong class="success-text">${money(c.paid)}</strong></div><div class="summary-card"><h3>BALANCE</h3><strong class="danger-text">${money(c.balance)}</strong></div></div><div class="panel profile-contact"><h3>Client Details</h3><p><b>Phone:</b> ${esc(u.contact||"—")}</p><p><b>Location:</b> ${esc(u.location||"—")}</p></div>`;return;}
  if(tab==="sales"){const rows=records.filter(r=>r.unitId===id).sort((a,b)=>String(b.month).localeCompare(String(a.month)));host.innerHTML=`<div class="panel"><div class="panel-head"><div><h3>Monthly Sales History</h3><p>Historical records are kept by month.</p></div><button class="primary-btn" data-sale="${id}">Gross Sale</button></div><div class="table-wrap"><table><thead><tr><th>Month</th><th>Gross Sales</th><th>Internet</th><th>Net Sales</th><th>Owner Share</th><th>Client Share</th><th>Electricity</th><th>Client Net</th><th>Amount Due</th><th>Actions</th></tr></thead><tbody>${rows.length?rows.map(r=>{const c=calc(r);return `<tr><td>${monthLabel(r.month)}</td><td>${money(c.gross)}</td><td>${money(c.internet)}</td><td>${money(c.net)}</td><td>${money(c.owner)}</td><td>${money(c.client)}</td><td>${money(c.elec)}</td><td>${money(Math.max(0,c.client-c.elec))}</td><td>${money(c.clientTotal)}</td><td><button class="action-btn" data-edit-sale="${r.id}">Edit</button><button class="action-btn danger" data-delete-sale="${r.id}">Delete</button></td></tr>`}).join(""):emptyRow(10,"No sales recorded for this client.")}</tbody></table></div></div>`;bindDynamicButtons();return;}
  if(tab==="payments"){const ps=payments.filter(p=>p.unitId===id).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));host.innerHTML=`<div class="panel"><div class="panel-head"><div><h3>Payment History</h3><p>All recorded payments for ${esc(u.name)}.</p></div><button class="primary-btn" data-payment="${id}">Record Payment</button></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Month</th><th>Amount</th><th>Method</th><th>Reference</th><th>Status</th></tr></thead><tbody>${ps.length?ps.map(p=>`<tr><td>${dateLabel(p.date)}</td><td>${monthLabel(p.month)}</td><td>${money(p.amount)}</td><td>${esc(p.method||"—")}</td><td>${esc(p.reference||"—")}</td><td>${statusBadge("Paid")}</td></tr>`).join(""):emptyRow(5,"No payments recorded.")}</tbody></table></div></div>`;bindDynamicButtons();return;}
  if(tab==="statement"){host.innerHTML=`<div class="panel"><div class="panel-head"><div><h3>Statement</h3><p>${monthLabel(selectedMonth)}</p></div><button class="primary-btn" id="profilePrintStatement">Print / PDF</button></div>${statementHtml(u,calc(records.find(r=>r.unitId===id&&r.month===selectedMonth)||{unitId:id,month:selectedMonth,grossSales:0}),selectedMonth)}</div>`;$("#profilePrintStatement").onclick=()=>printStatement(id,selectedMonth);}
}

function openModal(title,body,saveText,onSave,{danger=false}={}){
  $("#modalRoot").innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><div class="modal ${danger?"danger-modal":""}"><div class="modal-head"><h3>${title}</h3><button class="close" id="closeModal">×</button></div><div class="modal-body">${body}</div><div class="modal-actions"><button class="secondary-btn" id="cancelModal">Cancel</button><button class="${danger?"danger-btn":"primary-btn"}" id="saveModal">${saveText}</button></div></div></div>`;
  $("#closeModal").onclick=closeModal; $("#cancelModal").onclick=closeModal; $("#modalBackdrop").onclick=e=>{if(e.target.id==="modalBackdrop")closeModal()};
  $("#saveModal").onclick=async()=>{try{await onSave();closeModal();await loadData();render();notify("Saved successfully.");}catch(e){notify(e?.message||"Unable to save.","error");}};
  setTimeout(()=>document.querySelector("#modalRoot input, #modalRoot select")?.focus(),50);
}
function closeModal(){ $("#modalRoot").innerHTML=""; }
function openUnitModal(id=null){
  const u=id?units.find(x=>x.id===id):null;
  const suggestedCode = u?.clientCode || `C-${String(units.length+1).padStart(3,"0")}`;
  const suggestedDate = u?.dateJoined || new Date().toISOString().slice(0,10);
  openModal(id?"Edit Client / Unit":"Add New Client / Unit",`
    <div class="form-grid">
      <div class="field"><label>Client ID *</label><input id="fClientCode" value="${esc(suggestedCode)}" placeholder="C-001"></div>
      <div class="field"><label>Unit Code *</label><input id="fCode" value="${esc(u?.unitCode||"")}" placeholder="UNIT-001"></div>
      <div class="field"><label>Client Name *</label><input id="fName" value="${esc(u?.name||"")}" placeholder="Juan Dela Cruz"></div>
      <div class="field"><label>Client Email *</label><input id="fEmail" type="email" value="${esc(u?.email||"")}" placeholder="client@example.com"><small class="hint">Used for contact/recovery records. Client signs in with Unit ID.</small></div>
      <div class="field"><label>Contact Number</label><input id="fContact" value="${esc(u?.contact||"")}" placeholder="09171234567"></div>
      <div class="field"><label>Date Joined</label><input id="fDateJoined" type="date" value="${esc(suggestedDate)}"></div>
      <div class="field full"><label>Unit Location</label><input id="fLocation" value="${esc(u?.location||"")}" placeholder="Brgy. San Isidro, Antipolo"></div>
      <div class="field full"><label>Client Address</label><input id="fAddress" value="${esc(u?.address||u?.location||"")}" placeholder="Client residential/contact address"></div>
      <div class="field"><label>Status</label><select id="fStatus"><option value="active" ${u?.active!==false?"selected":""}>Active</option><option value="inactive" ${u?.active===false?"selected":""}>Inactive</option></select></div>
      <div class="field"><label>Customer Account Login</label><input id="fAuthUserId" value="${esc(u?.authUserId||"")}" placeholder="Created automatically" disabled><small class="hint">Login ID is the Unit Code. Firebase Auth ID is created automatically for new clients.</small></div>
      ${id?"":`<div class="field"><label>Temporary Password *</label><input id="fTempPassword" type="text" minlength="8" placeholder="Give client a temporary password"><small class="hint">Client must create a private password after first login.</small></div>`}
      <div class="field full"><label>Notes</label><textarea id="fNotes" rows="3">${esc(u?.notes||"")}</textarea></div>
    </div>`,`Save Client`,async()=>{
      const clientCode=$("#fClientCode").value.trim(), unitCode=$("#fCode").value.trim(), name=$("#fName").value.trim(), email=$("#fEmail").value.trim().toLowerCase();
      if(!clientCode||!unitCode||!name||!email) throw new Error("Client ID, Unit Code, Client Name and Client Email are required.");
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid client email address.");
      const data={
        clientCode,
        unitCode,
        name,
        email,
        location:$("#fLocation").value.trim(),
        address:$("#fAddress").value.trim(),
        contact:$("#fContact").value.trim(),
        dateJoined:$("#fDateJoined").value||suggestedDate,
        authUserId:$("#fAuthUserId").value.trim(),
        notes:$("#fNotes").value.trim(),
        active:$("#fStatus").value==="active",
        updatedAt:serverTimestamp()
      };
      if(id){
        await updateDoc(doc(db,"units",id),data);
        await logActivity("Clients",`Edited ${unitCode} — ${name}`,id);
        await addNotification("client","Client profile updated.",`${name} (${clientCode}) was updated.`,id);
      }else{
        const tempPassword=$("#fTempPassword")?.value||"";
        if(tempPassword.length<8) throw new Error("Temporary password must be at least 8 characters.");
        const authEmail=clientAuthEmailFromUnitId(unitCode);
        let cred;
        try{
          cred=await createUserWithEmailAndPassword(clientProvisionerAuth,authEmail,tempPassword);
        }catch(e){
          if(e?.code==="auth/email-already-in-use") throw new Error("This Unit ID already has a client login account. Use a different Unit Code or edit the existing client.");
          throw e;
        }
        data.authUserId=cred.user.uid;
        data.forcePasswordChange=true;
        data.loginId=unitCode;
        data.authEmail=authEmail;
        const ref=await addDoc(collection(db,"units"),{...data,createdAt:serverTimestamp()});
        await setDoc(doc(db,"users",cred.user.uid),{role:"client",clientUnitId:ref.id,unitId:ref.id,clientCode,loginId:unitCode,email,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
        await logActivity("Clients",`Added client account ${clientCode} — ${unitCode} — ${name}`,ref.id);
        await addNotification("client","New client account created.",`${name} (${clientCode}) can now log in using ${unitCode}.`,ref.id);
      }
  });
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
  openModal(existing?"Edit Monthly Sales":"Record Monthly Sales",`<div class="notice">${esc(u?.unitCode||"")} — ${esc(u?.name||"")}</div><div class="form-grid"><div class="field"><label>Unit</label><input value="${esc(u?.unitCode||"")} — ${esc(u?.name||"")}" disabled></div><div class="field"><label>Month *</label><input id="saleMonth" type="month" value="${month}" ${recordId?"disabled":""}></div><div class="field full"><label>Gross Sales *</label><input id="saleGross" type="number" min="0" step="0.01" value="${existing?.grossSales??0}"><small class="hint">System will automatically calculate internet cost, net sales, shares, electricity and amount due.</small></div></div>`,existing?"Update Sales":"Save Sales",async()=>{
    const gross=Number($("#saleGross").value); const saleMonth=$("#saleMonth").value; if(!saleMonth)throw new Error("Month is required."); if(Number.isNaN(gross)||gross<0)throw new Error("Gross sales must be a valid non-negative number.");
    const duplicate=records.find(r=>r.unitId===unitId&&r.month===saleMonth&&r.id!==(existing?.id||"")); if(duplicate)throw new Error("This unit already has a sales record for the selected month. Edit the existing record instead.");
    if(existing){const old=Number(existing.grossSales||0);await updateDoc(doc(db,"monthlyRecords",existing.id),{grossSales:gross,month:saleMonth,updatedAt:serverTimestamp()});await logActivity("Sales",`Edited sales ${u.unitCode} — ${money(old)} → ${money(gross)}`,existing.id);await addNotification("sales","Sales record updated.",`${u.unitCode} changed to ${money(gross)} for ${monthLabel(saleMonth)}.`,u.id);}else{const ref=await addDoc(collection(db,"monthlyRecords"),{unitId,month:saleMonth,grossSales:gross,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});await logActivity("Sales",`Recorded sales ${u.unitCode} — ${money(gross)}`,ref.id);const c=calc({unitId,month:saleMonth,grossSales:gross});if(c.balance>0)await addNotification("balance",`${u.name} has ${money(c.balance)} balance.`,`Outstanding amount for ${monthLabel(saleMonth)}.`,u.id);}
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

function showAuthError(message){console.error("[PISO WIFI]",message);const loader=$("#authLoading");if(loader){loader.innerHTML=`<div class="auth-error"><strong>Unable to open the dashboard</strong><span>${esc(message)}</span><button onclick="location.href='index.html'">Return to Login</button></div>`;loader.classList.remove("hidden");}}
async function bootstrap(user){if(!user){location.replace("index.html");return;}currentUser=user;try{await authorize(user);await loadData();await logActivity("System",`Admin login — ${user.email||"Admin"}`);setupMonthSelector();$("#authLoading").classList.add("hidden");$("#app").classList.remove("hidden");$("#userEmail").textContent=user.email||"Owner";route=location.hash.replace("#","").split("?")[0]||"dashboard";render();}catch(e){showAuthError(e?.message||"Firebase authorization or database access failed.");}}

function parseRoute(){const raw=location.hash.replace("#","");return raw.split("?")[0]||"dashboard";}
document.addEventListener("click",e=>{const a=e.target.closest("[data-route]");if(a){e.preventDefault();location.hash="#"+a.dataset.route;} const p=e.target.closest("[data-print-inline]");if(p){const id=$("#statementUnit")?.value;if(id)printStatement(id,$("#statementMonth").value);} const pdf=e.target.closest("[data-pdf-inline]");if(pdf){const id=$("#statementUnit")?.value;if(id)downloadStatementPdf(id,$("#statementMonth").value);} const html=e.target.closest("[data-html-inline]");if(html){const id=$("#statementUnit")?.value;if(id)downloadStatementHtml(id,$("#statementMonth").value);}});
window.addEventListener("hashchange",()=>{route=parseRoute();render();});
$("#menuBtn").onclick=()=>{$("#sidebar").classList.add("open");$("#overlay").classList.add("show")};$("#overlay").onclick=closeMenu;
$("#logoutBtn").onclick=async()=>{await signOut(auth);location.href="index.html"};
$("#globalSearch").oninput=e=>{const q=e.target.value.trim();if(q.length>=2){unitSearch=q;route="units";if(location.hash!=="#units")location.hash="#units";else renderUnits();}else if(!q){unitSearch="";if(route==="units")renderUnits();}};

let authResolved=false;
const authTimeout=setTimeout(()=>{if(!authResolved){const u=auth.currentUser;if(u)bootstrap(u);else showAuthError("Firebase Authentication did not finish loading. Please refresh the page and try logging in again.");}},8000);
onAuthStateChanged(auth,user=>{authResolved=true;clearTimeout(authTimeout);bootstrap(user);});
