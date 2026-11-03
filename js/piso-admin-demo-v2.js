(()=>{
'use strict';
if(!location.pathname.includes('/admin/'))return;
const q=s=>document.querySelector(s), sleep=ms=>new Promise(r=>setTimeout(r,ms));
const css=document.createElement('style');css.textContent=`
.padv2-menu,.padv2-card{position:fixed;z-index:2147483600;font-family:Inter,system-ui,sans-serif;color:#fff;background:linear-gradient(145deg,#071b31,#0b3155);border:1px solid #2a8ed8;box-shadow:0 28px 90px #001a2f66}.padv2-menu{left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,calc(100vw - 30px));max-height:84vh;overflow:auto;border-radius:22px;padding:22px}.padv2-menu h2{margin:0 0 5px}.padv2-menu p,.padv2-card p{color:#bed0df;font-size:12px;line-height:1.55}.padv2-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:16px}.padv2-grid button{padding:14px;border-radius:13px;border:1px solid #245b83;background:#0a2945;color:#fff;text-align:left;font-weight:800}.padv2-grid small{display:block;color:#a8bed0;margin-top:5px;font-weight:500}.padv2-x{position:absolute;right:16px;top:14px;background:#153b59!important;width:36px;padding:8px!important;text-align:center!important}.padv2-shade{position:fixed;inset:0;z-index:2147483500;background:#03101f52;pointer-events:none}.padv2-card{width:min(390px,calc(100vw - 24px));border-radius:18px;padding:17px}.padv2-card h3{margin:5px 0 7px}.padv2-step{font-size:10px;font-weight:900;color:#67c8ff;letter-spacing:.1em}.padv2-actions{display:flex;justify-content:space-between;gap:8px;margin-top:14px}.padv2-actions button{border:0;border-radius:9px;padding:9px 12px;font-weight:800}.padv2-next{background:#1685f5;color:#fff}.padv2-back,.padv2-exit{background:#173d5c;color:#fff}.padv2-spot{position:fixed;z-index:2147483550;border:3px solid #16a3ff;border-radius:13px;box-shadow:0 0 0 7px #16a3ff22,0 0 30px #1685f577;pointer-events:none}.padv2-arrow{position:fixed;z-index:2147483650;color:#1685f5;font-size:34px;font-weight:900;filter:drop-shadow(0 3px 4px #fff)}.padv2-formula{margin-top:9px;padding:10px;border-radius:10px;background:#0c3a60;border:1px solid #236995;color:#e7f6ff;font-size:11px}.padv2-readonly{pointer-events:none!important}
@media(max-width:650px){.padv2-grid{grid-template-columns:1fr}}
`;document.head.appendChild(css);
let nodes=[],steps=[],idx=0,modalOpened=false;
const clear=()=>{nodes.forEach(n=>n?.remove());nodes=[];};
const wait=async(sel,t=3500)=>{const st=Date.now();while(Date.now()-st<t){const e=q(sel);if(e&&e.offsetParent!==null)return e;await sleep(70)}return null};
const route=async(r,sel)=>{if(sel&&q(sel)?.offsetParent!==null)return;const b=q(`[data-route="${r}"]`);if(b){b.click();await sleep(350)}};
const cats=[
 ['dashboard','Dashboard','KPIs, charts, subscriptions, outstanding balances and support.'],
 ['units','Units / Clients','Client list, filters, actions and detailed Add New Client form.'],
 ['reports','Monthly Reports','Financial summaries, formulas and report controls.'],
 ['payments','Payments','Balances, payment records and payment workflow.'],
 ['wifi-subscription','WiFi Subscription','Subscription periods, payments and expiry tracking.'],
 ['support','Customer Support','Customer support tickets and conversations.'],
 ['notifications','Notifications','System and account activity notices.'],
 ['statements','Client Statements','Monthly client statement generation.'],
 ['cashier-management','Cashier Management','Cashier accounts and remittance management.'],
 ['settings','Settings','Business rules and system configuration.']
];
const basic=(r,name,desc)=>[
 {r,sel:'.page-head',title:name,text:desc},
 {r,sel:'#view .panel,#view',title:`${name} Workspace`,text:'This is the actual working area for this section. Use the controls shown here to manage its records and actions.'}
];
function getSteps(c){
 if(c==='dashboard')return [
  {r:'dashboard',sel:'.page-head',title:'Dashboard',text:'Your live Piso WiFi business overview.'},
  {r:'dashboard',sel:'.dashboard-kpis',title:'KPI Cards',text:'Shows Gross Sales, Customer Earnings, Amount Collected, Outstanding, fees, electricity, units and open tickets.',formula:'Values follow the currently selected reporting month.'},
  {r:'dashboard',sel:'.analytics-grid .panel:nth-child(1)',title:'Sales Overview',text:'Compares recent sales performance using the selected metric.'},
  {r:'dashboard',sel:'.analytics-grid .panel:nth-child(2)',title:'Top Performing Units',text:'Ranks the strongest units for the selected period.'},
  {r:'dashboard',sel:'[data-route="wifi-subscription"],.subscription-panel',title:'WiFi Subscription',text:'Use this section to review subscription payment and expiry information.'},
  {r:'dashboard',sel:'.outstanding-list',title:'Outstanding Payments',text:'Shows customers that still have unpaid balances.'}
 ];
 if(c==='units')return [
  {r:'units',sel:'.page-head',title:'Units / Clients',text:'Manage registered customers and their Piso WiFi units.'},
  {r:'units',sel:'#addUnitBtn',title:'Add New Client',text:'This button opens the real Add New Client form. The tutorial will open it automatically.',open:true},
  {r:'units',sel:'#fClientCode',title:'Client ID',text:'System-generated unique Client ID.'},
  {r:'units',sel:'#fCodeSearch',title:'Unit Code',text:'Assign an available Piso WiFi unit number.'},
  {r:'units',sel:'#fFirstName',title:'First Name',text:'Enter the customer first name.'},
  {r:'units',sel:'#fLastName',title:'Last Name',text:'Enter the customer last name.'},
  {r:'units',sel:'#fEmail',title:'Registered Gmail',text:'Used for the customer account and login.'},
  {r:'units',sel:'#fPassword',title:'Temporary Password',text:'Initial password used for first access.'},
  {r:'units',sel:'#fContact',title:'Contact Number',text:'Customer contact information.'},
  {r:'units',sel:'#fDateJoined',title:'Date Joined',text:'Records the customer joining date.'},
  {r:'units',sel:'#fLocation',title:'Unit Location',text:'Installation location of the Piso WiFi unit.'},
  {r:'units',sel:'#fAddress',title:'Client Address',text:'Customer address saved with the profile.'},
  {r:'units',sel:'#fStatus',title:'Account Status',text:'Controls whether the client/unit record is Active or Inactive.'},
  {r:'units',sel:'#fUsername',title:'Generated Username',text:'System-generated username based on the client information.'},
  {r:'units',sel:'#fNotes',title:'Notes',text:'Optional Admin notes for the client.'},
  {r:'units',sel:'#modalRoot .modal-actions',title:'Save Client',text:'This normally saves the client. During the demo it stays read-only and no sample client is created.',formula:'Tutorial safety: no Firebase write is performed.',close:true},
  {r:'units',sel:'#unitSearch',title:'Search Clients',text:'Search the client list quickly.'},
  {r:'units',sel:'#unitStatus',title:'Status Filter',text:'Filter Active and Inactive clients.'},
  {r:'units',sel:'.table-wrap',title:'Client Table',text:'Review clients and use available row actions.'}
 ];
 const x=cats.find(x=>x[0]===c);return basic(c,x?.[1]||c,x?.[2]||'');
}
async function openModal(){if(q('#fClientCode'))return;const b=await wait('#addUnitBtn');b?.click();modalOpened=true;await wait('#fClientCode');q('#modalRoot .modal')?.classList.add('padv2-readonly')}
function closeModal(){if(!modalOpened)return;const x=q('#modalRoot .close,#modalRoot .modal-close');if(x)x.click();else if(q('#modalRoot'))q('#modalRoot').innerHTML='';modalOpened=false}
function place(el,card){el.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>{const r=el.getBoundingClientRect();const spot=document.createElement('div');spot.className='padv2-spot';Object.assign(spot.style,{left:`${Math.max(5,r.left-6)}px`,top:`${Math.max(5,r.top-6)}px`,width:`${Math.min(innerWidth-10,r.width+12)}px`,height:`${Math.min(innerHeight-10,r.height+12)}px`});const ar=document.createElement('div');ar.className='padv2-arrow';const right=innerWidth-r.right>430;ar.textContent=right?'➜':'⬅';ar.style.left=(right?Math.min(innerWidth-40,r.right+8):Math.max(5,r.left-40))+'px';ar.style.top=Math.max(5,Math.min(innerHeight-45,r.top+r.height/2-18))+'px';document.body.append(spot,ar);nodes.push(spot,ar);const w=Math.min(390,innerWidth-24);card.style.left=Math.max(12,Math.min(innerWidth-w-12,right?r.right+55:r.left-w-55))+'px';card.style.top=Math.max(12,Math.min(innerHeight-card.offsetHeight-12,r.top))+'px'},180)}
async function show(){clear();const s=steps[idx];await route(s.r,s.sel);if(s.open)await openModal();let el=await wait(s.sel);if(!el)el=q('#view')||document.body;const shade=document.createElement('div');shade.className='padv2-shade';const card=document.createElement('div');card.className='padv2-card';card.innerHTML=`<div class="padv2-step">STEP ${idx+1} OF ${steps.length}</div><h3>${s.title}</h3><p><b style="color:#fff">Function:</b> ${s.text}</p>${s.formula?`<div class="padv2-formula"><b>How it works</b><br>${s.formula}</div>`:''}<div class="padv2-actions"><button class="padv2-exit">Exit</button><div>${idx?'<button class="padv2-back">Back</button> ':''}<button class="padv2-next">${idx===steps.length-1?'Finish':'Next'}</button></div></div>`;document.body.append(shade,card);nodes.push(shade,card);place(el,card);card.querySelector('.padv2-exit').onclick=()=>{clear();closeModal()};card.querySelector('.padv2-back')?.addEventListener('click',()=>{idx--;show()});card.querySelector('.padv2-next').onclick=()=>{if(s.close)closeModal();if(idx<steps.length-1){idx++;show()}else{clear();closeModal()}}}
function menu(){clear();closeModal();const shade=document.createElement('div');shade.className='padv2-shade';shade.style.pointerEvents='auto';const m=document.createElement('div');m.className='padv2-menu';m.innerHTML=`<button class="padv2-x">×</button><h2>Admin Help Center</h2><p>Select what you want to learn. The demo opens the actual page and points to the real controls.</p><div class="padv2-grid">${cats.map((c,i)=>`<button data-c="${c[0]}">${c[1]}<small>${c[2]}</small></button>`).join('')}</div>`;document.body.append(shade,m);nodes.push(shade,m);m.querySelector('.padv2-x').onclick=clear;m.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{steps=getSteps(b.dataset.c);idx=0;show()})}
function bind(){const h=q('#pisoHelpBtn');if(!h)return setTimeout(bind,150);h.onclick=menu;h.style.display='inline-flex';h.style.alignItems='center';h.style.visibility='visible';h.style.opacity='1';}
bind();
window.PisoAdminPremiumDemo={open:menu};
})();
