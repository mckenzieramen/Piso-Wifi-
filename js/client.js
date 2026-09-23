import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged, signOut, updatePassword
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, query, where, updateDoc, setDoc, onSnapshot, arrayUnion,
  serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { calculateFinancialRecord } from "./finance.js";

const $ = s => document.querySelector(s);
const money = n => `₱${Number(n || 0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const esc = v => String(v ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const monthLabel = k => {
  const [y,m]=String(k).split("-");
  return new Date(Number(y),Number(m)-1,1).toLocaleString("en-US",{month:"long",year:"numeric"});
};
const dateLabel = v => {
  if(!v) return "—";
  const d=v?.toDate?v.toDate():new Date(v);
  return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
};
const dateLong = v => {
  if(!v) return "—";
  const d=v?.toDate?v.toDate():new Date(v);
  return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
};
const dateTime = v => {
  if(!v) return "—";
  const d=v?.toDate?v.toDate():new Date(v);
  return Number.isNaN(d.getTime())?String(v):d.toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
};
const todayMonth = () => {
  const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
};
const monthOptions = (records=[]) => {
  const set=new Set(records.map(r=>r.month).filter(Boolean));
  set.add(todayMonth());
  return [...set].sort().reverse();
};
const initials = name => String(name||"Client").trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase() || "CL";
const empty = msg => `<div class="client-empty"><div class="empty-icon">⌁</div><h3>${esc(msg)}</h3></div>`;
const statusBadge = s => `<span class="client-badge ${String(s||"").toLowerCase()}">${esc(s||"—")}</span>`;
const icons = {
  dashboard:`<svg viewBox="0 0 24 24"><path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></svg>`,
  units:`<svg viewBox="0 0 24 24"><path d="M4 20V8l8-4 8 4v12M8 20v-5h8v5M9 9h.01M15 9h.01"/></svg>`,
  sales:`<svg viewBox="0 0 24 24"><path d="M7 3h8l4 4v14H7zM15 3v5h4M10 12h6M10 16h6"/></svg>`,
  payments:`<svg viewBox="0 0 24 24"><path d="M4 7h16v12H4zM7 4h10M8 12h8M8 15h5"/></svg>`,
  statement:`<svg viewBox="0 0 24 24"><path d="M7 3h8l4 4v14H7zM15 3v5h4M10 12h6M10 16h6"/></svg>`,
  profile:`<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/></svg>`,
  bell:`<svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>`,
  logout:`<svg viewBox="0 0 24 24"><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/></svg>`,
  mail:`<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>`,
  lock:`<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`,
  calendar:`<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 9h16"/></svg>`,
  money:`<svg viewBox="0 0 24 24"><path d="M4 7h16v12H4zM7 4h10M8 13h8M10 16h4"/></svg>`,
  download:`<svg viewBox="0 0 24 24"><path d="M12 4v11M8 11l4 4 4-4M5 20h14"/></svg>`,
  printer:`<svg viewBox="0 0 24 24"><path d="M6 9V4h12v5M6 17H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M6 14h12v6H6z"/></svg>`
};

let currentUser=null;
let clientUnits=[];
let records=[];
let payments=[];
let notifications=[];
let settings={internetCost:1000,ownerPercent:70,clientPercent:30,electricity:100,electricityRule:"ADD_TO_CLIENT"};
let selectedMonth=localStorage.getItem("pisoClientMonth") || todayMonth();
let selectedYear=String(new Date().getFullYear());
let selectedUnitId="all";
let route="dashboard";
let clientRealtimeUnsubs=[];
let clientRecordUnsubs=[];
let clientPaymentUnsubs=[];
let clientNotificationUnsubs=[];
let clientSettingsUnsub=null;

function toast(message,type="success"){
  if(type==="error") window.pisoDebug?.capture(message,{type:"client.toast"});
  const el=$("#clientToast"); if(!el)return;
  el.textContent=message; el.className=`client-toast show ${type}`;
  clearTimeout(window.__clientToast); window.__clientToast=setTimeout(()=>el.classList.remove("show"),2800);
}
function unitMatches(id){return clientUnits.some(u=>u.id===id);}
function ownRecords(){
  return records.filter(r=>unitMatches(r.unitId));
}
function ownPayments(){
  return payments.filter(p=>unitMatches(p.unitId));
}
function filteredUnits(){
  return selectedUnitId==="all"?clientUnits:clientUnits.filter(u=>u.id===selectedUnitId);
}
function recordFor(unitId,month){
  return records.find(r=>r.unitId===unitId&&r.month===month) || {unitId,month,grossSales:0};
}
function calc(r){
  return calculateFinancialRecord(r,settings,payments);
}
function rowsForMonth(month=selectedMonth){
  return filteredUnits().map(u=>({u,r:recordFor(u.id,month),c:calc(recordFor(u.id,month))}));
}
function aggregate(month=selectedMonth){
  return rowsForMonth(month).reduce((a,x)=>{
    a.gross+=x.c.gross;a.internet+=x.c.internet;a.net+=x.c.net;a.owner+=x.c.owner;a.client+=x.c.client;a.elec+=x.c.elec;
    a.due+=x.c.clientTotal;a.paid+=x.c.paid;a.balance+=x.c.balance;return a;
  },{gross:0,internet:0,net:0,owner:0,client:0,elec:0,due:0,paid:0,balance:0});
}
function paymentStatus(total){
  if(total.due===0) return total.paid>0?"Paid":"Unpaid";
  return total.paid>=total.due?"Paid":total.paid>0?"Partial":"Unpaid";
}
function primaryUnit(){return clientUnits[0]||{};}
function clientName(){return primaryUnit().name||currentUser?.displayName||"Client";}
function clientCode(){return primaryUnit().clientCode||"—";}
function clientEmail(){return primaryUnit().email||currentUser?.email||"—";}
function clientContact(){return primaryUnit().contact||"—";}
function clientAddress(){return primaryUnit().address||primaryUnit().location||"—";}
function joinedDate(){return primaryUnit().dateJoined||primaryUnit().createdAt;}
function pageTitle(title,sub,actions=""){return `<div class="client-page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="client-head-actions">${actions}</div></div>`;}
function financialCard(icon,title,value,sub,cls=""){return `<article class="financial-card ${cls}"><div class="financial-icon">${icon}</div><span>${esc(title)}</span><strong>${money(value)}</strong><small>${esc(sub)}</small></article>`;}

async function findClientUnits(user){
  const results=[];
  if(user.uid){
    try{
      const byUid=await getDocs(query(collection(db,"units"),where("authUserId","==",user.uid)));
      byUid.docs.forEach(d=>results.push({id:d.id,...d.data()}));
    }catch(e){ console.warn("authUserId lookup unavailable",e); }
  }
  return results;
}
async function getChunked(collectionName,field,ids){
  const out=new Map();
  if(!ids.length)return [];
  for(let i=0;i<ids.length;i+=30){
    const chunk=ids.slice(i,i+30);
    const snap=await getDocs(query(collection(db,collectionName),where(field,"in",chunk)));
    snap.docs.forEach(d=>out.set(d.id,{id:d.id,...d.data()}));
  }
  return [...out.values()];
}
async function loadClientData(){
  clientUnits=await findClientUnits(currentUser);
  if(!clientUnits.length) throw new Error("Your account is not linked to a client profile yet. Please contact the Admin.");
  if(clientUnits.every(u=>u.active===false)) throw new Error("Your client account is inactive. Please contact the Admin.");
  const ids=clientUnits.map(u=>u.id);
  const [r,p,s]=await Promise.all([
    getChunked("monthlyRecords","unitId",ids),
    getChunked("payments","unitId",ids),
    getDoc(doc(db,"settings","business"))
  ]);
  records=r;payments=p;if(s.exists())settings={...settings,...s.data()};
  try{
    notifications=await getChunked("notifications","relatedId",ids);
    notifications.sort((a,b)=>timeValue(b.createdAt)-timeValue(a.createdAt));
  }catch(e){notifications=[];}
}
function clearClientRealtimeSubscriptions(){
  [...clientRealtimeUnsubs,...clientRecordUnsubs,...clientPaymentUnsubs,...clientNotificationUnsubs].forEach(fn=>{try{fn?.();}catch(e){}});
  clientRealtimeUnsubs=[];clientRecordUnsubs=[];clientPaymentUnsubs=[];clientNotificationUnsubs=[];
  try{clientSettingsUnsub?.();}catch(e){}
  clientSettingsUnsub=null;
}
function clientRealtimeRender(){
  if(!currentUser)return;
  renderMonthSelectors();
  renderUnitSelector();
  updateBell();
  if(document.querySelector("#clientApp")?.classList.contains("hidden"))return;
  render();
}
function subscribeClientCollectionChunks(collectionName,field,ids,assign,unsubStore){
  const chunks=[];
  for(let i=0;i<ids.length;i+=30)chunks.push(ids.slice(i,i+30));
  if(!chunks.length){assign([]);return;}
  const merged=new Map();
  chunks.forEach(chunk=>{
    const q=query(collection(db,collectionName),where(field,"in",chunk));
    const unsub=onSnapshot(q,snap=>{
      snap.docs.forEach(d=>merged.set(d.id,{id:d.id,...d.data()}));
      const activeIds=new Set(chunks.flat());
      [...merged.keys()].forEach(id=>{const row=merged.get(id);if(row&&!activeIds.has(row[field]))merged.delete(id);});
      assign([...merged.values()]);
      clientRealtimeRender();
    },err=>{
      console.warn(`PISO WIFI realtime ${collectionName} error`,err);
      window.pisoDebug?.capture(err?.message||err,{type:"firebase.realtime",source:`client.js → ${collectionName} realtime (${field} in [...])`,stack:err?.stack});
    });
    unsubStore.push(unsub);
  });
}
function startClientRealtime(){
  clearClientRealtimeSubscriptions();
  if(!currentUser?.uid)return;
  const unitQuery=query(collection(db,"units"),where("authUserId","==",currentUser.uid));
  const unitUnsub=onSnapshot(unitQuery,snap=>{
    clientUnits=snap.docs.map(d=>({id:d.id,...d.data()}));
    const ids=clientUnits.map(u=>u.id);
    clientRecordUnsubs.forEach(fn=>{try{fn?.();}catch(e){}});clientRecordUnsubs=[];
    clientPaymentUnsubs.forEach(fn=>{try{fn?.();}catch(e){}});clientPaymentUnsubs=[];
    clientNotificationUnsubs.forEach(fn=>{try{fn?.();}catch(e){}});clientNotificationUnsubs=[];
    subscribeClientCollectionChunks("monthlyRecords","unitId",ids,v=>{records=v;},clientRecordUnsubs);
    subscribeClientCollectionChunks("payments","unitId",ids,v=>{payments=v;},clientPaymentUnsubs);
    subscribeClientCollectionChunks("notifications","relatedId",ids,v=>{notifications=v.sort((a,b)=>timeValue(b.createdAt)-timeValue(a.createdAt));},clientNotificationUnsubs);
    clientRealtimeRender();
  },err=>{
    console.warn("PISO WIFI realtime units error",err);
    window.pisoDebug?.capture(err?.message||err,{type:"firebase.realtime",source:"client.js → units realtime (authUserId == currentUser.uid)",stack:err?.stack});
  });
  clientRealtimeUnsubs.push(unitUnsub);
  clientSettingsUnsub=onSnapshot(doc(db,"settings","business"),snap=>{
    if(snap.exists())settings={...settings,...snap.data()};
    clientRealtimeRender();
  },err=>{
    console.warn("PISO WIFI realtime settings error",err);
    window.pisoDebug?.capture(err?.message||err,{type:"firebase.realtime",source:"client.js → settings/business realtime",stack:err?.stack});
  });
  clientRealtimeUnsubs.push(clientSettingsUnsub);
}
function timeValue(v){if(!v)return 0;if(v.toMillis)return v.toMillis();const n=new Date(v).getTime();return Number.isNaN(n)?0:n;}
function unread(){return notifications.filter(n=>n.read!==true).length;}


let supportChatUnsub=null;
let supportChat=null;
let supportChatOpen=false;
let supportChatSending=false;
let supportTypingTimer=null;
let supportChatDocId="";
const supportChatId=()=>String(supportChatDocId||currentUser?.uid||"");
const supportChatRef=()=>supportChatId()?doc(db,"supportChats",supportChatId()):null;
function supportNow(){return new Date().toISOString();}
function supportMessageHtml(m){
  const type=m?.senderType==="customer"?"customer":m?.senderType==="admin"?"admin":"system";
  const who=type==="customer"?clientName():type==="admin"?"PISO WIFI Support":"PISO WIFI Support";
  return `<div class="piso-chat-message ${type}"><div class="piso-chat-bubble">${esc(m?.text||"")}</div><div class="piso-chat-meta">${esc(who)} · ${esc(dateTime(m?.createdAt||""))}</div></div>`;
}
function renderSupportConversation(){
  const host=$("#supportConversation"); if(!host)return;
  const msgs=Array.isArray(supportChat?.messages)?supportChat.messages:[];
  host.innerHTML=msgs.length?msgs.map(supportMessageHtml).join(""):`<div class="piso-chat-empty"><div class="support-icon">${icons.mail}</div><b>Start a conversation</b><span>Tell us what you need help with and our Admin can reply here.</span></div>`;
  const typing=$("#supportTyping");
  if(typing){const adminTyping=!!supportChat?.typingBy?.admin;typing.classList.toggle("show",adminTyping);typing.textContent=adminTyping?"PISO WIFI Support is typing…":"";}
  requestAnimationFrame(()=>{host.scrollTop=host.scrollHeight;});
}
function hasRealSupportConversation(chat){
  const messages=Array.isArray(chat?.messages)?chat.messages:[];
  return messages.some(m=>String(m?.senderType||"").toLowerCase()==="customer") || messages.length>1;
}
function renderSupportLobby(){
  const lobby=$("#supportLobby"), convo=$("#supportConversationView"); if(!lobby||!convo)return;
  const status=String(supportChat?.status||"Open");
  const active=hasRealSupportConversation(supportChat);
  const closed=status==="Closed"||status==="Solved";
  lobby.innerHTML=`<div class="piso-support-hero"><div class="support-icon">${icons.bell}</div><span class="eyebrow">PISO WIFI CUSTOMER SUPPORT</span><h2>How can we help?</h2><p>Chat directly with the PISO WIFI Admin. Your conversation stays connected to your Customer Account.</p></div><div class="piso-ticket-card"><div><b>Customer Support</b><small>${status==="Closed"?"This conversation is closed.":status==="Solved"?"This conversation was marked solved.":active?"Your active support conversation.":"No conversation started yet."}</small></div><span class="piso-ticket-status ${status.toLowerCase()}">${esc(status)}</span></div><button id="startSupportChat" class="client-primary piso-support-start" ${closed?"disabled":""}>${active?"Open Conversation":"Start Chat"}</button>`;
  convo.classList.add("hidden");
  const start=$("#startSupportChat");
  if(start&&!closed) start.onclick=()=>openSupportConversation();
}
function renderSupportChat(){
  const lobby=$("#supportLobby"), convo=$("#supportConversationView"); if(!lobby||!convo)return;
  lobby.classList.add("hidden"); convo.classList.remove("hidden");
  $("#supportStatus").textContent=String(supportChat?.status||"Open");
  $("#supportChatCustomer").textContent=clientName();
  renderSupportConversation();
}
async function loadExistingSupportChat(){
  if(!currentUser?.uid) return null;
  const direct=doc(db,"supportChats",currentUser.uid);
  const directSnap=await getDoc(direct);
  if(directSnap.exists()){
    supportChatDocId=directSnap.id;
    supportChat={id:directSnap.id,...directSnap.data()};
    return supportChat;
  }
  supportChatDocId=currentUser.uid;
  supportChat=null;
  return null;
}
async function createSupportChat(){
  if(!currentUser?.uid)throw new Error("Customer account is not ready.");
  if(!supportChat) await loadExistingSupportChat();
  if(supportChat) return supportChat;
  supportChatDocId=currentUser.uid;
  const ref=supportChatRef();
  const unit=primaryUnit();
  const greeting={senderType:"admin",text:"Hi! I’m PISO WIFI Customer Support. Let us know what you need help with, and our Admin will assist you here.",createdAt:supportNow()};
  const payload={authUserId:currentUser.uid,unitId:unit.id||"",clientCode:unit.clientCode||"",customerName:clientName(),customerEmail:clientEmail(),status:"Open",messages:[greeting],typingBy:{customer:false,admin:false},unreadForAdmin:true,unreadForCustomer:false,createdAt:serverTimestamp(),updatedAt:supportNow()};
  await setDoc(ref,payload);
  supportChat={id:ref.id,...payload,createdAt:new Date()};
  return supportChat;
}
function subscribeSupportChat(){
  if(supportChatUnsub) supportChatUnsub();
  const ref=supportChatRef(); if(!ref)return;
  supportChatUnsub=onSnapshot(ref,snap=>{
    supportChat=snap.exists()?{id:snap.id,...snap.data()}:null;
    if(snap.exists())supportChatDocId=snap.id;
    updateSupportBadge();
    if(supportChatOpen){
      if($("#supportConversationView")?.classList.contains("hidden"))renderSupportLobby();else renderSupportChat();
    }
  },err=>{
    console.warn("PISO WIFI support chat realtime error",err);
    window.pisoDebug?.capture(err?.message||err,{type:"firebase.support.realtime",source:`client.js → onSnapshot(supportChats/${currentUser?.uid||"uid"})`,stack:err?.stack});
  });
}
async function openSupportConversation(){
  try{await createSupportChat();subscribeSupportChat();supportChatOpen=true;renderSupportChat();await updateDoc(supportChatRef(),{unreadForCustomer:false,updatedAt:supportNow()});}catch(e){toast(e?.message||"Unable to open support chat. Please contact Admin if this continues.","error");}
}
function closeSupportChat(){supportChatOpen=false;$("#supportConversationView")?.classList.add("hidden");$("#supportLobby")?.classList.remove("hidden");}
async function sendSupportMessage(){
  if(supportChatSending)return; const input=$("#supportChatInput");const text=String(input?.value||"").trim();if(!text)return;
  if(String(supportChat?.status||"Open")==="Closed"){toast("This support conversation is closed.","error");return;}
  supportChatSending=true;
  try{await createSupportChat();await updateDoc(supportChatRef(),{messages:arrayUnion({senderType:"customer",text,createdAt:supportNow()}),updatedAt:supportNow(),unreadForAdmin:true,unreadForCustomer:false,"typingBy.customer":false});input.value="";}
  catch(e){
    window.pisoDebug?.capture(e?.message||e,{type:"firebase.support.send",source:`client.js → updateDoc(supportChats/${currentUser?.uid||"uid"})`,stack:e?.stack});
    toast(e?.message||"Unable to send your message.","error");
  }
  finally{supportChatSending=false;}
}
async function setSupportTyping(isTyping){
  try{if(!supportChatRef())return;await updateDoc(supportChatRef(),{"typingBy.customer":!!isTyping,updatedAt:supportNow()});}catch(e){/* typing is non-blocking */}
}
function bindSupportTyping(){const input=$("#supportChatInput");if(!input)return;input.oninput=()=>{clearTimeout(supportTypingTimer);setSupportTyping(true);supportTypingTimer=setTimeout(()=>setSupportTyping(false),1200);};input.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendSupportMessage();}};}
async function openSupportModal(){
  const modal=$("#clientSupportModal");if(!modal)return;modal.classList.remove("hidden");modal.setAttribute("aria-hidden","false");supportChatOpen=false;renderSupportLobby();
  try{
    await loadExistingSupportChat();
    subscribeSupportChat();
    renderSupportLobby();
  }catch(e){
    console.warn("Unable to restore PISO WIFI support conversation",e);
    window.pisoDebug?.capture(e?.message||e,{type:"firebase.support.load",source:`client.js → getDoc(supportChats/${currentUser?.uid||"uid"})`,stack:e?.stack});
    // Keep the lobby usable so Start Chat remains available even while Firebase rules are being debugged.
    supportChat=null; supportChatDocId=currentUser?.uid||""; renderSupportLobby();
  }
  bindSupportTyping();
}

function setupShell(){
  const nameEl=$("#clientName");
  const roleEl=$("#clientRole");
  const avatarEl=$("#clientAvatar");
  const emailEl=$("#clientEmail");
  if(nameEl) nameEl.textContent=clientName();
  if(roleEl) roleEl.textContent="Client";
  if(avatarEl) avatarEl.textContent=initials(clientName());
  if(emailEl) emailEl.textContent=clientEmail();
  renderMonthSelectors();
  renderUnitSelector();
  renderNotificationsPopover();
  updateBell();
  syncProfileMenu?.();
  subscribeSupportChat();
  updateSupportBadge();
}
function renderMonthSelectors(){
  const opts=monthOptions(records).map(m=>`<option value="${m}" ${m===selectedMonth?"selected":""}>${monthLabel(m)}</option>`).join("");
  ["dashboardMonth","statementMonth"].forEach(id=>{const el=$("#"+id);if(el)el.innerHTML=opts;});
  const yearSet=[...new Set(records.map(r=>String(r.month||"").slice(0,4)).filter(Boolean))];
  if(!yearSet.includes(String(new Date().getFullYear())))yearSet.push(String(new Date().getFullYear()));
  yearSet.sort((a,b)=>Number(b)-Number(a));
  const y=$("#salesYear");if(y)y.innerHTML=yearSet.map(v=>`<option ${v===selectedYear?"selected":""}>${v}</option>`).join("");
}
function renderUnitSelector(){
  const els=[$("#unitSelector"),$("#statementUnit")];
  els.forEach(el=>{
    if(!el)return;
    el.innerHTML=`<option value="all">All Units</option>`+clientUnits.map(u=>`<option value="${u.id}">${esc(u.unitCode||"Unit")} — ${esc(u.location||u.name||"")}</option>`).join("");
    if(el.id==="unitSelector")el.value=selectedUnitId;
  });
}
function setSelectedMonth(m){
  selectedMonth=m||todayMonth();localStorage.setItem("pisoClientMonth",selectedMonth);
  renderMonthSelectors();render();
}
function setUnit(id){
  selectedUnitId=id||"all";renderUnitSelector();render();
}

function renderDashboard(){
  const total=aggregate(selectedMonth), status=paymentStatus(total), unitList=filteredUnits();
  $("#view").innerHTML=`
    <div class="client-welcome">
      <div><h1>Hello, ${esc(clientName())}!</h1><p>Here's your summary for ${esc(monthLabel(selectedMonth))}.</p></div>
      <div class="dashboard-filters">
        <label class="client-select-wrap">${icons.calendar}<select id="dashboardMonth">${monthOptions(records).map(m=>`<option value="${m}" ${m===selectedMonth?"selected":""}>${monthLabel(m)}</option>`).join("")}</select></label>
        ${clientUnits.length>1?`<label class="client-select-wrap"><select id="unitSelector"><option value="all">All Units</option>${clientUnits.map(u=>`<option value="${u.id}" ${u.id===selectedUnitId?"selected":""}>${esc(u.unitCode)} — ${esc(u.location||"")}</option>`).join("")}</select></label>`:""}
      </div>
    </div>
    <div class="financial-grid">
      ${financialCard("▥","Gross Sales",total.gross,"Gross Sales","gross")}
      ${financialCard("◉","Your Share",total.client,`${settings.clientPercent}% share`,"share")}
      ${financialCard("−","Total Deductions",Math.max(0,total.internet+total.elec),`Internet + electricity`,"deductions")}
      ${financialCard("₱","Total Earnings",Math.max(0,total.due),"Customer earnings for this period","earnings")}
    </div>
    <div class="client-two-col">
      <section class="client-panel">
        <div class="client-panel-head"><div><h3>My Piso WiFi Unit${unitList.length===1?"":"s"}</h3><p>Your assigned unit information.</p></div><button class="text-btn" data-route="units">View all</button></div>
        <div class="unit-card-grid">${unitList.length?unitList.map(unitCard).join(""):empty("No unit has been assigned to your account yet.")}</div>
      </section>
      <section class="client-panel">
        <div class="client-panel-head"><div><h3>This Month's Breakdown</h3><p>${esc(monthLabel(selectedMonth))}</p></div><span>${statusBadge(status)}</span></div>
        ${breakdown(total)}
      </section>
    </div>
    <section class="client-panel recent-panel">
      <div class="client-panel-head"><div><h3>Recent Payments</h3><p>Latest payments recorded by Admin.</p></div><button class="text-btn" data-route="payments">View history</button></div>
      ${recentPaymentsHtml()}
    </section>`;
  $("#dashboardMonth").onchange=e=>setSelectedMonth(e.target.value);
  $("#unitSelector")?.addEventListener("change",e=>setUnit(e.target.value));
  bindRouteButtons();
}
function unitCard(u){
  const status=u.active===false?"Inactive":"Active";
  return `<article class="unit-card"><div class="unit-card-top"><div class="unit-symbol">⌁</div>${statusBadge(status)}</div><h3>${esc(u.unitCode||"—")}</h3><p class="unit-location">${esc(u.location||"Location not provided")}</p><div class="unit-divider"></div><div class="unit-meta"><span><b>Installed</b>${esc(dateLong(u.dateJoined||u.createdAt))}</span><span><b>Client ID</b>${esc(u.clientCode||"—")}</span></div></article>`;
}
function breakdown(t){
  const net=Math.max(0,t.client - t.elec);
  return `<div class="breakdown-list"><div><span>Gross Sales</span><b>${money(t.gross)}</b></div><div><span>Internet Fee</span><b>${money(t.internet)}</b></div><div><span>Electricity Share</span><b>${money(t.elec)}</b></div><div><span>Your Share (${settings.clientPercent}%)</span><b>${money(t.client)}</b></div><div class="highlight"><span>Amount Due</span><b>${money(t.due)}</b></div><div><span>Amount Paid</span><b>${money(t.paid)}</b></div><div class="balance-row"><span>Balance</span><b>${money(t.balance)}</b></div></div>`;
}
function recentPaymentsHtml(){
  const list=ownPayments().sort((a,b)=>timeValue(b.paymentDate||b.date||b.createdAt)-timeValue(a.paymentDate||a.date||a.createdAt)).slice(0,5);
  if(!list.length)return empty("No payments recorded yet.");
  return `<div class="payment-mini-list">${list.map(p=>{const u=clientUnits.find(x=>x.id===p.unitId);return `<div class="payment-mini"><span class="payment-method-icon">₱</span><div><b>${money(p.amount)}</b><small>${esc(u?.unitCode||"Unit")} · ${monthLabel(p.month)}</small></div><span>${statusBadge(p.status||"Completed")}</span></div>`}).join("")}</div>`;
}

function renderUnits(){
  $("#view").innerHTML=pageTitle("My Piso WiFi Units","View the Piso WiFi units assigned to your client account.")+
    `<section class="client-panel"><div class="unit-card-grid large">${filteredUnits().length?filteredUnits().map(u=>unitCardDetailed(u)).join(""):empty("No unit has been assigned to your account yet.")}</div></section>`;
}
function unitCardDetailed(u){
  return `<article class="unit-detail-card"><div class="unit-detail-icon">⌁</div><div class="unit-detail-main"><div class="unit-detail-head"><div><span class="eyebrow">UNIT</span><h2>${esc(u.unitCode||"—")}</h2></div>${statusBadge(u.active===false?"Inactive":"Active")}</div><div class="unit-info-grid"><div><span>Location</span><b>${esc(u.location||"—")}</b></div><div><span>Client ID</span><b>${esc(u.clientCode||"—")}</b></div><div><span>Installed</span><b>${esc(dateLong(u.dateJoined||u.createdAt))}</b></div><div><span>Contact</span><b>${esc(u.contact||"—")}</b></div></div></div></article>`;
}

function renderSales(){
  const year=selectedYear;
  const list=ownRecords().filter(r=>String(r.month||"").startsWith(year+"-")).sort((a,b)=>String(b.month).localeCompare(String(a.month)));
  $("#view").innerHTML=pageTitle("Sales History","View your monthly sales and computations.",`<div class="filter-row"><select id="salesYear" class="client-filter"></select><select id="salesUnit" class="client-filter"><option value="all">All Units</option>${clientUnits.map(u=>`<option value="${u.id}" ${u.id===selectedUnitId?"selected":""}>${esc(u.unitCode)}</option>`).join("")}</select></div>`)+
    `<section class="client-panel table-panel"><div class="table-scroll"><table class="client-table"><thead><tr><th>Month</th><th>Unit</th><th>Gross Sales</th><th>Internet Fee</th><th>Electricity Share</th><th>Your Share</th><th>Amount Due</th><th>Status</th></tr></thead><tbody>${
      list.filter(r=>selectedUnitId==="all"||r.unitId===selectedUnitId).length
      ? list.filter(r=>selectedUnitId==="all"||r.unitId===selectedUnitId).map(r=>{const u=clientUnits.find(x=>x.id===r.unitId),c=calc(r);return `<tr><td>${monthLabel(r.month)}</td><td><b>${esc(u?.unitCode||"—")}</b></td><td>${money(c.gross)}</td><td>${money(c.internet)}</td><td>${money(c.elec)}</td><td>${money(c.client)}</td><td class="strong-amount">${money(c.clientTotal)}</td><td>${statusBadge(c.status)}</td></tr>`}).join("")
      : `<tr><td colspan="8">${empty("No sales records available.")}</td></tr>`
    }</tbody></table></div></section>`;
  $("#salesYear").innerHTML=[...new Set(ownRecords().map(r=>String(r.month||"").slice(0,4)).filter(Boolean))].sort((a,b)=>Number(b)-Number(a)).map(y=>`<option ${y===year?"selected":""}>${y}</option>`).join("")||`<option>${year}</option>`;
  $("#salesYear").onchange=e=>{selectedYear=e.target.value;renderSales();};
  $("#salesUnit").onchange=e=>{selectedUnitId=e.target.value;renderSales();};
}
function renderPayments(){
  const list=ownPayments().filter(p=>selectedUnitId==="all"||p.unitId===selectedUnitId).sort((a,b)=>timeValue(b.paymentDate||b.date||b.createdAt)-timeValue(a.paymentDate||a.date||a.createdAt));
  $("#view").innerHTML=pageTitle("Payment History","View your payments and remaining balance.",`<select id="paymentUnit" class="client-filter"><option value="all">All Units</option>${clientUnits.map(u=>`<option value="${u.id}" ${u.id===selectedUnitId?"selected":""}>${esc(u.unitCode)}</option>`).join("")}</select>`)+
    `<section class="client-panel table-panel"><div class="table-scroll"><table class="client-table"><thead><tr><th>Date Paid</th><th>Unit</th><th>Amount Paid</th><th>Reference</th><th>Month Covered</th><th>Status</th></tr></thead><tbody>${
      list.length?list.map(p=>{const u=clientUnits.find(x=>x.id===p.unitId);return `<tr><td>${dateLong(p.paymentDate||p.date||p.createdAt)}</td><td><b>${esc(u?.unitCode||"—")}</b></td><td class="strong-amount">${money(p.amount)}</td><td>${esc(p.reference||"—")}</td><td>${p.month?monthLabel(p.month):"—"}</td><td>${statusBadge(p.status||"Completed")}</td></tr>`}).join(""):`<tr><td colspan="6">${empty("No payments recorded.")}</td></tr>`
    }</tbody></table></div></section>`;
  $("#paymentUnit").onchange=e=>{selectedUnitId=e.target.value;renderPayments();};
}
function renderStatement(){
  const units=filteredUnits();
  const u=units[0]||primaryUnit();
  const month=selectedMonth;
  const total=aggregate(month);
  $("#view").innerHTML=pageTitle("Statement","Generate and download your statement.",`<div class="filter-row"><select id="statementMonth" class="client-filter"></select>${clientUnits.length>1?`<select id="statementUnit" class="client-filter"><option value="all">All Units</option>${clientUnits.map(x=>`<option value="${x.id}" ${x.id===selectedUnitId?"selected":""}>${esc(x.unitCode)}</option>`).join("")}</select>`:""}<button class="client-primary" id="downloadPdf">${icons.download}Download PDF</button><button class="client-secondary" id="printStatement">${icons.printer}Print</button></div>`)+
    `<section class="statement-sheet" id="statementSheet"><div class="statement-header"><div class="statement-brand"><div class="brand-logo">${wifiLogo()}</div><div><h2>PISO WIFI</h2><span>Client Statement</span></div></div><div class="statement-period"><b>${monthLabel(month)}</b><span>Generated ${dateLong(new Date())}</span></div></div>
      <div class="statement-client-grid"><div><b>Client Name</b><span>${esc(clientName())}</span></div><div><b>Client ID</b><span>${esc(clientCode())}</span></div><div><b>Unit${units.length>1?"s":""}</b><span>${esc(units.map(x=>x.unitCode).join(", ")||"—")}</span></div><div><b>Location</b><span>${esc(units.length===1?units[0].location:"Multiple assigned units")}</span></div></div>
      <div class="statement-table-wrap"><table class="client-table statement-table"><tbody><tr><td>Gross Sales</td><td>${money(total.gross)}</td></tr><tr><td>Internet Fee</td><td>${money(total.internet)}</td></tr><tr><td>Electricity Share</td><td>${money(total.elec)}</td></tr><tr><td>Your Share (${settings.clientPercent}%)</td><td>${money(total.client)}</td></tr><tr class="total-row"><td>Amount Due</td><td>${money(total.due)}</td></tr><tr><td>Amount Paid</td><td>${money(total.paid)}</td></tr><tr class="balance-row"><td>Balance</td><td>${money(total.balance)}</td></tr></tbody></table></div>
      <div class="statement-footer"><span>Status ${statusBadge(paymentStatus(total))}</span><small>This statement reflects records maintained in the PISO WIFI Management System.</small></div>
    </section>`;
  renderMonthSelectors();
  $("#statementMonth").value=month;
  $("#statementMonth").onchange=e=>{selectedMonth=e.target.value;renderStatement();};
  $("#statementUnit")?.addEventListener("change",e=>{selectedUnitId=e.target.value;renderStatement();});
  $("#downloadPdf").onclick=()=>downloadStatementPdf(total,units,month);
  $("#printStatement").onclick=()=>printStatement(total,units,month);
}
function wifiLogo(){return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 20c10-9 24-9 34 0M12 26c7-6 17-6 24 0M18 32c3.5-3 8.5-3 12 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="38" r="2.5" fill="currentColor"/></svg>`;}
function statementHtmlForPdf(total,units,month){return {title:`PISO WIFI Client Statement — ${monthLabel(month)}`,lines:[["Client Name",clientName()],["Client ID",clientCode()],["Unit",units.map(u=>u.unitCode).join(", ")||"—"],["Location",units.length===1?units[0].location:"Multiple assigned units"],["Period",monthLabel(month)],["Status",paymentStatus(total)],["Gross Sales",money(total.gross)],["Internet Fee",money(total.internet)],["Electricity Share",money(total.elec)],[`Your Share (${settings.clientPercent}%)`,money(total.client)],["Amount Due",money(total.due)],["Amount Paid",money(total.paid)],["Balance",money(total.balance)]]};}
function downloadStatementPdf(total,units,month){
  const api=window.jspdf;
  if(!api?.jsPDF){toast("PDF exporter is still loading. Please try again.","error");return;}
  const pdf=new api.jsPDF();
  pdf.setTextColor(15,35,63);pdf.setFontSize(19);pdf.text("PISO WIFI",20,20);
  pdf.setFontSize(11);pdf.setTextColor(71,85,105);pdf.text("Client Statement",20,27);
  pdf.setFontSize(10);pdf.text(monthLabel(month),150,20);
  pdf.setTextColor(15,35,63);
  const lines=statementHtmlForPdf(total,units,month).lines;
  let y=42; lines.forEach(([label,value],i)=>{pdf.setFontSize(i<6?10:11);pdf.text(String(label),20,y);pdf.text(String(value),190,y,{align:"right"});pdf.setDrawColor(226,232,240);pdf.line(20,y+3,190,y+3);y+=11;});
  pdf.setFontSize(9);pdf.setTextColor(100,116,139);pdf.text(`Generated ${dateLong(new Date())}`,20,285);
  pdf.save(`piso-wifi-client-statement-${month}.pdf`);
}
function printStatement(total,units,month){
  const w=window.open("","_blank","width=900,height=800");
  if(!w){toast("Please allow pop-ups to print.","error");return;}
  w.document.write(`<!doctype html><html><head><title>PISO WIFI Client Statement</title><style>
  *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#0f233f;padding:36px;max-width:900px;margin:auto}
  .brand{display:flex;justify-content:space-between;border-bottom:3px solid #0b79e8;padding-bottom:16px}.brand h1{margin:0}.muted{color:#64748b}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:24px 0}.meta div{padding:12px;border:1px solid #dce4ef;border-radius:10px}
  table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:12px;border:1px solid #dce4ef;text-align:left}td:last-child{text-align:right;font-weight:700}
  .total{font-weight:800;background:#f3f8ff}.balance{font-weight:800;background:#fff3f3}.foot{margin-top:30px;color:#64748b}
  @media print{body{padding:10px}}
  </style></head><body><div class="brand"><div><h1>PISO WIFI</h1><div class="muted">Client Statement</div></div><div>${monthLabel(month)}<br><span class="muted">Generated ${dateLong(new Date())}</span></div></div>
  <div class="meta"><div><b>Client Name</b><br>${esc(clientName())}</div><div><b>Client ID</b><br>${esc(clientCode())}</div><div><b>Unit${units.length>1?"s":""}</b><br>${esc(units.map(u=>u.unitCode).join(", "))}</div><div><b>Location</b><br>${esc(units.length===1?units[0].location:"Multiple assigned units")}</div></div>
  <table><tbody><tr><td>Gross Sales</td><td>${money(total.gross)}</td></tr><tr><td>Internet Fee</td><td>${money(total.internet)}</td></tr><tr><td>Electricity Share</td><td>${money(total.elec)}</td></tr><tr><td>Your Share (${settings.clientPercent}%)</td><td>${money(total.client)}</td></tr><tr class="total"><td>Amount Due</td><td>${money(total.due)}</td></tr><tr><td>Amount Paid</td><td>${money(total.paid)}</td></tr><tr class="balance"><td>Balance</td><td>${money(total.balance)}</td></tr></tbody></table>
  <div class="foot">Status: ${paymentStatus(total)} · PISO WIFI Management System</div></body></html>`);
  w.document.close();w.focus();setTimeout(()=>w.print(),350);
}

function renderProfile(){
  const u=primaryUnit();
  $("#view").innerHTML=pageTitle("My Profile","View and update your account information.")+
  `<div class="profile-two-col"><section class="client-panel profile-card"><div class="client-panel-head"><div><h3>Personal Information</h3><p>Keep your contact details up to date.</p></div></div>
    <div class="profile-form"><label>Full Name<input id="profileName" value="${esc(clientName())}"></label><label>Email Address<input id="profileEmail" value="${esc(clientEmail())}" disabled></label><label>Contact Number<input id="profileContact" value="${esc(clientContact()==="—"?"":clientContact())}"></label><label>Address<input id="profileAddress" value="${esc(u.address||u.location||"")}"></label><button class="client-primary" id="updateProfile">Update Profile</button></div>
  </section><section class="client-panel profile-card"><div class="client-panel-head"><div><h3>Account Information</h3><p>Account details managed by the system.</p></div></div>
    <div class="account-info"><div><span>Client ID</span><b>${esc(clientCode())}</b></div><div><span>Date Joined</span><b>${esc(dateLong(joinedDate()))}</b></div><div><span>Status</span><b>${statusBadge(u.active===false?"Inactive":"Active")}</b></div><div><span>Assigned Unit${clientUnits.length>1?"s":""}</span><b>${esc(clientUnits.map(x=>x.unitCode).join(", ")||"—")}</b></div><div><span>Authentication</span><b>${currentUser?.emailVerified?"Verified":"Email account"}</b></div></div>
  </section></div>`;
  $("#updateProfile").onclick=updateProfile;
}
async function updateProfile(){
  const name=$("#profileName").value.trim(),contact=$("#profileContact").value.trim(),address=$("#profileAddress").value.trim();
  if(!name) return toast("Full name is required.","error");
  try{
    const batch=writeBatch(db);
    clientUnits.forEach(u=>batch.update(doc(db,"units",u.id),{name,contact,address,updatedAt:serverTimestamp()}));
    await batch.commit();
    clientUnits=clientUnits.map(u=>({...u,name,contact,address}));
    setupShell();renderProfile();toast("Profile updated successfully.");
  }catch(e){console.error(e);toast("Unable to update your profile right now.","error");}
}

function renderNotifications(){
  $("#view").innerHTML=pageTitle("Notifications","Updates related only to your client account.",`<button class="client-secondary" id="markAll">Mark all as read</button>`)+
  `<section class="notification-grid">${notifications.length?notifications.map(n=>`<button class="client-notification ${n.read===true?"read":"unread"}" data-notif="${n.id}"><span class="notif-symbol">${n.type==="payment"?"₱":n.type==="balance"?"!":"•"}</span><span><b>${esc(n.title||"Notification")}</b><small>${esc(n.message||"")}</small><time>${dateTime(n.createdAt)}</time></span>${n.read!==true?"<em>NEW</em>":""}</button>`).join(""):empty("You're all caught up.")}</section>`;
  $("#markAll").onclick=markAllNotifications;
  document.querySelectorAll("[data-notif]").forEach(b=>b.onclick=()=>markNotification(b.dataset.notif));
}
async function markNotification(id){
  const n=notifications.find(x=>x.id===id);if(!n)return;
  try{if(n.read!==true){await updateDoc(doc(db,"notifications",id),{read:true});n.read=true;updateBell();}renderNotifications();}catch(e){toast("Unable to update notification.","error");}
}
async function markAllNotifications(){
  try{
    const batch=writeBatch(db);notifications.filter(n=>n.read!==true).forEach(n=>batch.update(doc(db,"notifications",n.id),{read:true}));
    await batch.commit();notifications.forEach(n=>n.read=true);updateBell();renderNotifications();toast("All notifications marked as read.");
  }catch(e){toast("Unable to update notifications.","error");}
}
function updateBell(){
  const count=unread();
  const badge=$("#notificationCount");if(badge){badge.textContent=count>99?"99+":String(count);badge.classList.toggle("hidden",count===0);}
  renderNotificationsPopover();
}
function renderNotificationsPopover(){
  const pop=$("#notificationPopover");if(!pop)return;
  const recent=notifications.filter(n=>n.read!==true).slice(0,4);
  pop.innerHTML=recent.length?recent.map(n=>`<button data-pop-notif="${n.id}"><b>${esc(n.title||"Notification")}</b><small>${esc(n.message||"")}</small></button>`).join(""):`<div class="popover-empty">You're all caught up.</div>`;
  pop.querySelectorAll("[data-pop-notif]").forEach(b=>b.onclick=()=>markNotification(b.dataset.popNotif));
}
function toggleNotificationPopover(){
  $("#notificationPopover")?.classList.toggle("show");
}

function bindRouteButtons(){
  document.querySelectorAll("[data-route]").forEach(el=>el.onclick=e=>{e.preventDefault();location.hash="#"+el.dataset.route;});
}
function renderNav(){
  document.querySelectorAll("#clientNav a[data-route]").forEach(a=>a.classList.toggle("active",a.dataset.route===route));
}
function render(){
  renderNav();
  const pages={dashboard:renderDashboard,units:renderUnits,sales:renderSales,payments:renderPayments,statement:renderStatement,profile:renderProfile,notifications:renderNotifications};
  (pages[route]||renderDashboard)();
  document.body.classList.toggle("mobile-menu-open",false);
  $("#clientSidebar")?.classList.remove("open");$("#clientOverlay")?.classList.remove("show");
  window.scrollTo({top:0,behavior:"smooth"});
}
function parseRoute(){return location.hash.replace("#","").split("?")[0]||"dashboard";}

function openAuthError(message){
  const loader=$("#clientAuthLoading");loader.innerHTML=`<div class="client-auth-error"><strong>Unable to open Customer Account</strong><span>${esc(message)}</span><a href="client-login.html">Return to Customer Account Login</a></div>`;
  loader.classList.remove("hidden");
}
function setupPasswordVisibilityToggles(){
  document.querySelectorAll("[data-password-target]").forEach(toggle=>{
    if(toggle.dataset.bound==="1") return;
    toggle.dataset.bound="1";
    toggle.addEventListener("click",()=>{
      const input=document.getElementById(toggle.dataset.passwordTarget);
      if(!input) return;
      const showing=input.type==="text";
      input.type=showing?"password":"text";
      toggle.textContent=showing?"Show":"Hide";
      toggle.setAttribute("aria-label",showing?"Show password":"Hide password");
      toggle.setAttribute("aria-pressed",showing?"false":"true");
    });
  });
}

async function maybeShowFirstLoginPasswordSetup(){
  const unit=clientUnits[0];
  if(!unit || unit.forcePasswordChange!==true) return;
  const modal=$("#clientPasswordSetup");
  if(!modal) return;
  modal.classList.remove("hidden"); modal.setAttribute("aria-hidden","false");
  const form=$("#clientPasswordForm"), msg=$("#clientPasswordMessage");
  setupPasswordVisibilityToggles();
  form.onsubmit=async e=>{
    e.preventDefault();
    const a=$("#newClientPassword").value, b=$("#confirmClientPassword").value;
    if(a.length<8){msg.textContent="Use at least 8 characters.";msg.className="client-login-message error";return;}
    if(a!==b){msg.textContent="Passwords do not match.";msg.className="client-login-message error";return;}
    const btn=form.querySelector("button"); btn.disabled=true; btn.textContent="Saving…";
    try{
      await updatePassword(currentUser,a);
      await updateDoc(doc(db,"units",unit.id),{forcePasswordChange:false,passwordChangedAt:serverTimestamp(),updatedAt:serverTimestamp()});
      unit.forcePasswordChange=false;
      modal.classList.add("hidden"); modal.setAttribute("aria-hidden","true");
      toast("Your new password has been saved.");
    }catch(err){
      console.error(err); msg.textContent="Unable to update your password. Please sign in again and try once more.";msg.className="client-login-message error";
      btn.disabled=false;btn.textContent="Save My Password";
    }
  };
}

let bootstrapFinished=false;
const BOOT_TIMEOUT_MS=10000;
const bootTimer=setTimeout(()=>{
  if(!bootstrapFinished){
    openAuthError("The Customer Account is taking too long to connect to Firebase. Check your internet connection and make sure this site is authorized in Firebase, then try again.");
  }
},BOOT_TIMEOUT_MS);

async function withTimeout(promise,ms,label){
  return await Promise.race([
    promise,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error(label)),ms))
  ]);
}

async function bootstrap(user){
  if(!user){
    bootstrapFinished=true; clearTimeout(bootTimer);
    location.replace("/");
    return;
  }
  currentUser=user;
  try{
    const userSnap=await withTimeout(getDoc(doc(db,"users",user.uid)),8000,"Firebase user profile request timed out.");
    if(userSnap.exists() && userSnap.data().role==="admin"){
      bootstrapFinished=true; clearTimeout(bootTimer);
      location.replace("/admin/dashboard.html");
      return;
    }
    await withTimeout(loadClientData(),8000,"Client records request timed out. Please check Firebase rules and your connection.");
    $("#clientAuthLoading").classList.add("hidden");
    $("#clientApp").classList.remove("hidden");
    setupShell();
    startClientRealtime();
    route=parseRoute();render();
    bootstrapFinished=true; clearTimeout(bootTimer);
    await maybeShowFirstLoginPasswordSetup();
  }catch(e){
    console.error("Client bootstrap failed:",e);
    bootstrapFinished=true; clearTimeout(bootTimer);
    openAuthError(e?.message||"Client profile or database access could not be loaded.");
  }
}
$("#clientMenuBtn").onclick=()=>{$("#clientSidebar").classList.add("open");$("#clientOverlay").classList.add("show");};
$("#clientOverlay").onclick=()=>{$("#clientSidebar").classList.remove("open");$("#clientOverlay").classList.remove("show");};
async function logoutClient(){await signOut(auth);location.replace("/");}
$("#clientLogout").onclick=logoutClient;
$("#menuLogout").onclick=logoutClient;
$("#notificationBtn").onclick=toggleNotificationPopover;
$("#clientProfileBtn").onclick=()=>{const m=$("#clientProfileMenu"),b=$("#clientProfileBtn"),open=m?.classList.toggle("show");b?.setAttribute("aria-expanded",open?"true":"false");};
$("#clientSupportBtn").onclick=openSupportModal;
$("#closeSupportModal").onclick=()=>{$("#clientSupportModal")?.classList.add("hidden");$("#clientSupportModal")?.setAttribute("aria-hidden","true");closeSupportChat();};
$("#supportBack").onclick=()=>{closeSupportChat();renderSupportLobby();};
$("#supportSend").onclick=sendSupportMessage;
function updateSupportBadge(){const b=$("#supportUnreadBadge");if(!b)return;const n=supportChat?.unreadForCustomer?1:0;b.textContent=n;b.classList.toggle("hidden",n===0);}

$("#menuChangePassword").onclick=()=>{$("#clientProfileMenu")?.classList.remove("show");$("#clientProfileBtn")?.setAttribute("aria-expanded","false");const modal=$("#clientPasswordSetup");if(modal){modal.classList.remove("hidden");modal.setAttribute("aria-hidden","false");}};
function syncProfileMenu(){const name=clientName(), av=initials(name);if($("#menuClientName"))$("#menuClientName").textContent=name;if($("#menuAvatar"))$("#menuAvatar").textContent=av;}
function routeFromSearch(q){const v=String(q||"").trim().toLowerCase();if(!v)return null;if(v.includes("dashboard")||v.includes("home"))return"dashboard";if(v.includes("unit"))return"units";if(v.includes("sale")||v.includes("revenue"))return"sales";if(v.includes("pay"))return"payments";if(v.includes("statement")||v.includes("bill"))return"statement";if(v.includes("profile")||v.includes("account"))return"profile";if(v.includes("notification")||v.includes("alert"))return"notifications";return null;}
function bindQuickSearch(){const input=$("#clientQuickSearch"),box=$("#clientSearchSuggestions");if(!input||!box)return;const items=[['dashboard','Dashboard','Overview of your account'],['units','My Units','Assigned Piso WiFi units'],['sales','Sales History','Monthly sales records'],['payments','Payments','Payment history and balance'],['statement','Statement','Monthly client statement'],['profile','My Profile','Account information'],['notifications','Notifications','Updates from Admin']];const draw=(q='')=>{const f=items.filter(x=>!q||x[1].toLowerCase().includes(q.toLowerCase())||x[2].toLowerCase().includes(q.toLowerCase()));box.innerHTML=f.slice(0,5).map(x=>`<button type="button" data-search-route="${x[0]}"><b>${esc(x[1])}</b><small>${esc(x[2])}</small></button>`).join('');box.querySelectorAll('[data-search-route]').forEach(b=>b.onclick=()=>{location.hash='#'+b.dataset.searchRoute;box.classList.add('hidden');input.value='';});box.classList.toggle('hidden',f.length===0);};input.addEventListener('focus',()=>draw(input.value));input.addEventListener('input',()=>{const target=routeFromSearch(input.value);if(target&&input.value.trim().length>=3){draw(input.value)}else draw(input.value)});}
bindQuickSearch();
syncProfileMenu();
document.addEventListener("click",e=>{
  if(!e.target.closest("#notificationWrap"))$("#notificationPopover")?.classList.remove("show");
  if(!e.target.closest("#clientProfileWrap")){ $("#clientProfileMenu")?.classList.remove("show"); $("#clientProfileBtn")?.setAttribute("aria-expanded","false"); }
  if(!e.target.closest("#clientSearchWrap"))$("#clientSearchSuggestions")?.classList.add("hidden");
  const routeEl=e.target.closest("[data-route]");if(routeEl&&routeEl.closest("#clientProfileMenu")){e.preventDefault();location.hash="#"+routeEl.dataset.route;$("#clientProfileMenu")?.classList.remove("show");$("#clientProfileBtn")?.setAttribute("aria-expanded","false");}
});
window.addEventListener("hashchange",()=>{route=parseRoute();render();syncProfileMenu();});
onAuthStateChanged(auth,bootstrap);
