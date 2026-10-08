import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { collection, doc, getDoc, getDocs, addDoc, updateDoc, serverTimestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const money=n=>`₱${Number(n||0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
function loading(msg="Checking Admin access…"){const e=$("#authLoading");e.innerHTML=`<div class="loader"></div><span>${esc(msg)}</span>`;e.classList.remove("hidden");$("#app")?.classList.add("hidden");}
function error(msg){const e=$("#authLoading");e.innerHTML=`<div class="auth-error"><strong>WiFi Plans could not load</strong><span>${esc(msg)}</span><div style="display:flex;gap:10px;justify-content:center;margin-top:16px"><button type="button" id="retry">Retry</button><button type="button" id="back">Back to Admin</button></div></div>`;e.classList.remove("hidden");$("#retry").onclick=boot;$("#back").onclick=()=>location.replace("/admin/dashboard.html#dashboard");}
function show(){$("#authLoading").classList.add("hidden");$("#app").classList.remove("hidden");}
async function isAdmin(u){if(!u)return false; if(u.email?.toLowerCase()==="pisonet@admin.com")return true; const s=await getDoc(doc(db,"users",u.uid)); const d=s.exists()?s.data():{}; return d.role==="admin"&&d.active!==false;}
async function loadPlans(){
 const v=$("#view");
 v.innerHTML=`<div class="admin-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div><h2>WiFi Plans</h2><p>Only ACTIVE plans are available for Cashiers.</p></div><button class="primary-btn" id="addPlan">+ Add WiFi Plan</button></div></div><div class="admin-card" id="plansBox"><div>Loading plans…</div></div>`;
 $("#addPlan").onclick=openPlan;
 try{
   let snap; try{snap=await getDocs(query(collection(db,"wifi_plans"),orderBy("sortOrder","asc")));}catch(e){snap=await getDocs(collection(db,"wifi_plans"));}
   const plans=snap.docs.map(d=>({id:d.id,...d.data()}));
   $("#plansBox").innerHTML=plans.length?`<div style="overflow:auto"><table><thead><tr><th>Plan</th><th>Price</th><th>Duration</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead><tbody>${plans.map(p=>`<tr><td>${esc(p.name)}</td><td>${money(p.price)}</td><td>${esc(p.duration||"—")}</td><td>${esc(p.description||"—")}</td><td><span class="status-pill ${p.status==="ACTIVE"?"":"rejected"}">${esc(p.status||"ACTIVE")}</span></td><td><button class="secondary-btn" data-toggle="${p.id}" data-status="${esc(p.status||"ACTIVE")}">${p.status==="ACTIVE"?"Deactivate":"Activate"}</button></td></tr>`).join("")}</tbody></table></div>`:`<div style="padding:25px;color:#64748b">No WiFi plans yet. Add your first plan.</div>`;
   document.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=async()=>{await updateDoc(doc(db,"wifi_plans",b.dataset.toggle),{status:b.dataset.status==="ACTIVE"?"INACTIVE":"ACTIVE",updatedAt:serverTimestamp()});loadPlans();});
 }catch(e){console.error(e);$("#plansBox").innerHTML=`<div class="auth-error"><strong>Unable to load WiFi Plans</strong><span>${esc(e.message)}</span></div>`;}
}
function openPlan(){
 $("#modalRoot").innerHTML=`<div class="admin-modal-backdrop"><div class="admin-modal"><h2>Add WiFi Plan</h2><div class="admin-grid"><div class="admin-field"><label>Plan Name *</label><input id="pName" placeholder="1 Day"></div><div class="admin-field"><label>Price *</label><input id="pPrice" type="number" min="0" step="0.01" placeholder="20"></div><div class="admin-field"><label>Duration *</label><input id="pDuration" placeholder="24 Hours"></div><div class="admin-field"><label>Status</label><select id="pStatus"><option>ACTIVE</option><option>INACTIVE</option></select></div><div class="admin-field full"><label>Description</label><textarea id="pDescription" placeholder="Plan description"></textarea></div></div><div class="admin-actions"><button class="secondary-btn" id="cancel">Cancel</button><button class="primary-btn" id="save">Save Plan</button></div></div></div>`;
 $("#cancel").onclick=()=>$("#modalRoot").innerHTML="";
 $("#save").onclick=async()=>{const name=$("#pName").value.trim(),price=Number($("#pPrice").value),duration=$("#pDuration").value.trim(),status=$("#pStatus").value;if(!name||!Number.isFinite(price)||price<0||!duration)return alert("Plan name, price and duration are required.");await addDoc(collection(db,"wifi_plans"),{name,price,duration,description:$("#pDescription").value.trim(),status,sortOrder:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});$("#modalRoot").innerHTML="";loadPlans();};
}
async function boot(){loading();try{await new Promise((resolve,reject)=>{let done=false;const stop=onAuthStateChanged(auth,u=>{if(done)return;done=true;stop();u?resolve(u):reject(new Error("No Admin session found. Please log in to the Admin portal first."));});setTimeout(()=>{if(!done){done=true;stop();reject(new Error("Firebase Authentication timed out. Please reload the Admin portal."));}},8000);});const u=auth.currentUser;if(!(await isAdmin(u)))throw new Error("Your account is not authorized as Admin.");show();await loadPlans();}catch(e){console.error(e);error(e.message||"Unable to verify Admin access.");}}
boot();
