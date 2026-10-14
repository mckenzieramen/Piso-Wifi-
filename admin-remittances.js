import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { collection, doc, getDoc, onSnapshot, writeBatch, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const money=n=>`₱${Number(n||0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const date=v=>{try{const d=v?.toDate?v.toDate():new Date(v);return Number.isNaN(d.getTime())?"—":d.toLocaleString("en-PH")}catch{return "—"}};
let currentUser=null, remittances=[], showAll=false, unsub=null, busy=false;
function message(text,error=false){const el=$("#message");el.textContent=text;el.className="message"+(error?" error":"");}
function statusBadge(status){const s=String(status||"PENDING").toUpperCase();const cls=s==="APPROVED"?"ok":s==="REJECTED"?"no":"";return `<span class="badge ${cls}">${esc(s.replaceAll("_"," "))}</span>`;}
function render(){
  const visible=showAll?remittances:remittances.filter(r=>["PENDING ADMIN AUTHORIZATION","PENDING"].includes(String(r.status||"").toUpperCase()));
  $("#count").textContent=`${visible.length} record(s)`;
  if(!visible.length){$("#items").innerHTML=`<div class="panel empty">${showAll?"No remittance records yet.":"No remittances awaiting Admin approval."}</div>`;return;}
  $("#items").innerHTML=visible.map(r=>{
    const ids=Array.isArray(r.transactionIds)?r.transactionIds:[];
    const pending=["PENDING ADMIN AUTHORIZATION","PENDING"].includes(String(r.status||"").toUpperCase());
    return `<article class="panel"><div class="row"><div><h2>${esc(r.remittanceId||r.id)}</h2><p class="muted">Cashier: ${esc(r.cashierName||r.cashierId||"—")} · ${esc(date(r.createdAt))}</p></div>${statusBadge(r.status)}</div>
    <div class="meta">
      <div><small>Expected collection</small><strong>${money(r.expectedCollection)}</strong></div>
      <div><small>Actual cash remitted</small><strong>${money(r.actualRemittance)}</strong></div>
      <div><small>Customer earnings</small><strong>${money(r.customerEarningsTotal)}</strong></div>
      <div><small>Gross sales</small><strong>${money(r.grossCollected)}</strong></div>
      <div><small>Short / Over</small><strong>${r.variance<0?"Short ":r.variance>0?"Over ":""}${money(Math.abs(Number(r.variance||0)))}</strong></div>
      <div><small>Remitted to</small><strong>${esc(r.remittedTo||r.recipientName||"—")}</strong></div>
    </div>
    <p class="muted">${ids.length} sale record(s) included</p>
    ${r.rejectionNote?`<p class="muted">Admin note: ${esc(r.rejectionNote)}</p>`:""}
    ${pending?`<div class="actions"><button class="primary" data-approve="${esc(r.id)}">Approve Remittance</button><button class="danger" data-reject="${esc(r.id)}">Reject</button></div>`:""}
    </article>`;
  }).join("");
  document.querySelectorAll("[data-approve]").forEach(b=>b.onclick=()=>approve(b.dataset.approve));
  document.querySelectorAll("[data-reject]").forEach(b=>b.onclick=()=>reject(b.dataset.reject));
}
async function approve(id){
  if(busy)return;
  const r=remittances.find(x=>x.id===id);if(!r)return;
  const ids=Array.isArray(r.transactionIds)?r.transactionIds:[];
  if(ids.length>450){message("This remittance has too many sale records for one approval batch. Ask the developer to split the batch.",true);return;}
  if(!confirm(`Approve remittance ${r.remittanceId||id} for ${money(r.actualRemittance)} to ${r.remittedTo||r.recipientName||"the named recipient"}?`))return;
  busy=true;render();
  try{
    const batch=writeBatch(db);
    batch.update(doc(db,"remittances",id),{status:"APPROVED",approvedBy:currentUser.uid,approvedAt:serverTimestamp()});
    ids.forEach(txId=>batch.update(doc(db,"cashierTransactions",txId),{remittanceId:id,remittanceApproved:true,remittanceApprovedAt:serverTimestamp()}));
    await batch.commit();
    message("Remittance approved. Included sales are now marked as remitted.");
  }catch(e){message("Approval failed: "+(e?.message||"Firestore denied the update. Check the Admin remittance rules."),true);}
  finally{busy=false;render();}
}
async function reject(id){
  if(busy)return;
  const note=prompt("Optional reason for rejecting this remittance:","");if(note===null)return;
  busy=true;render();
  try{
    await updateDoc(doc(db,"remittances",id),{status:"REJECTED",rejectedBy:currentUser.uid,rejectedAt:serverTimestamp(),rejectionNote:note.trim()});
    message("Remittance rejected. The Cashier can review the status and submit a corrected request.");
  }catch(e){message("Rejection failed: "+(e?.message||"Firestore denied the update. Check the Admin remittance rules."),true);}
  finally{busy=false;render();}
}
$("#filterPending").onclick=()=>{showAll=false;render();};
$("#filterAll").onclick=()=>{showAll=true;render();};
$("#logout").onclick=()=>signOut(auth).then(()=>location.href="/admin/");
onAuthStateChanged(auth,async user=>{
  if(unsub){unsub();unsub=null;}
  currentUser=user||null;
  if(!user){message("Please sign in to Admin first. Redirecting…",true);setTimeout(()=>location.href="/admin/",900);return;}
  try{
    const profile=await getDoc(doc(db,"users",user.uid));
    const data=profile.exists()?profile.data():{};
    if(String(data.role||"").toLowerCase()!=="admin"||data.active===false){
      message("Access denied. This page is for active Admin accounts only.",true);await signOut(auth);return;
    }
    $("#app").classList.remove("hidden");
    message("Admin access verified. Remittance requests update live.");
    unsub=onSnapshot(collection(db,"remittances"),snap=>{
      remittances=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
        const at=a.createdAt?.toDate?a.createdAt.toDate().getTime():new Date(a.createdAt||0).getTime();
        const bt=b.createdAt?.toDate?b.createdAt.toDate().getTime():new Date(b.createdAt||0).getTime();
        return bt-at;
      });render();
    },err=>message("Could not load remittances: "+(err?.message||"Firestore access denied."),true));
  }catch(e){message("Could not verify Admin access: "+(e?.message||"Unknown error."),true);}
});
