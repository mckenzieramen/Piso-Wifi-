const ADMIN_EMAIL="bigguy@admin.com",ADMIN_PASSWORD="bigguyadmin123";
const KEY="bigguys_dtr_v2",MODEL_URLS=["https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights","https://justadudewhohacks.github.io/face-api.js/models"];
let state=JSON.parse(localStorage.getItem(KEY)||'{"employees":[],"attendance":[],"sales":[],"faces":{},"dailyReports":{}}');
state.employees=Array.isArray(state.employees)?state.employees:[];
state.attendance=Array.isArray(state.attendance)?state.attendance:[];
state.sales=Array.isArray(state.sales)?state.sales:[];
state.faces=state.faces&&typeof state.faces==="object"?state.faces:{};
state.faceUpdatedAt=state.faceUpdatedAt&&typeof state.faceUpdatedAt==="object"?state.faceUpdatedAt:{};
state.dailyReports=state.dailyReports&&typeof state.dailyReports==="object"?state.dailyReports:{};
let enrollStream=null,modelsReady=false;
let attendanceCaptureDisplayedKey=null;
let selectedDtrEmployeeId="";
let attendanceCaptureHideTimer=null;
const $=id=>document.getElementById(id);
const cacheState=()=>{const c={...state,faces:{},faceUpdatedAt:{},lastFaceCapture:null};try{localStorage.setItem(KEY,JSON.stringify(c));}catch(e){console.warn("Local cache skipped:",e);}};
const save=async()=>{
 cacheState();
 if(!window.BigGuysCloud?.configured) return state;
 try{
   await window.BigGuysCloud.init(state,remote=>{ state=remote; cacheState(); },'admin');
   if(window.BigGuysCloud?.ready){
     const merged=await window.BigGuysCloud.push(state);
     if(merged){state=merged;cacheState();}
   }
   return state;
 }catch(err){
   console.error('Central Firebase save failed:',err);
   throw err;
 }
};
async function syncAdminNow(){
 if(!window.BigGuysCloud?.configured) return state;
 await window.BigGuysCloud.init(state,remote=>{ state=remote; cacheState(); },'admin');
 const merged=await window.BigGuysCloud.push(state);
 if(merged){state=merged;cacheState();}
 return state;
}
function syncStateFromStorage(){
 try{
   const raw=JSON.parse(localStorage.getItem(KEY)||"{}");
   if(!raw||typeof raw!=="object")return;
   state.employees=Array.isArray(raw.employees)?raw.employees:[];
   state.attendance=Array.isArray(raw.attendance)?raw.attendance:[];
   state.sales=Array.isArray(raw.sales)?raw.sales:[];
   // Face descriptors are intentionally NOT stored in localStorage. Firebase is
   // the source of truth for faces, so never replace a live Firebase face map
   // with the empty cache placeholder written by cacheState().
   if(raw.faces&&typeof raw.faces==="object"&&Object.keys(raw.faces).length)state.faces=raw.faces;
   if(raw.faceUpdatedAt&&typeof raw.faceUpdatedAt==="object"&&Object.keys(raw.faceUpdatedAt).length)state.faceUpdatedAt=raw.faceUpdatedAt;
   state.dailyReports=raw.dailyReports&&typeof raw.dailyReports==="object"?raw.dailyReports:{};
 }catch(e){console.warn("Could not sync dashboard data",e)}
}
const today=()=>{const n=new Date();const y=n.getFullYear(),m=String(n.getMonth()+1).padStart(2,"0"),d=String(n.getDate()).padStart(2,"0");return `${y}-${m}-${d}`};
const money=n=>"₱"+Number(n||0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2});
const WEEKDAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function employeeOffDays(e){return Array.isArray(e?.offDays)?e.offDays:[];}
function isEmployeeOff(e,date){if(!e||!date)return false;return employeeOffDays(e).includes(WEEKDAYS[new Date(date+"T00:00:00").getDay()]);}
function isBeforeHire(e,date){return !!(e?.hireDate&&date<e.hireDate);}
function previousDate(date){const d=new Date(date+"T00:00:00");d.setDate(d.getDate()-1);return d.toISOString().slice(0,10);}
function previousDayPenaltyApplies(emp,date){
 const prev=previousDate(date);
 if(isBeforeHire(emp,prev))return false;
 const a=state.attendance.find(x=>String(x.employeeId)===String(emp.id)&&x.date===prev);
 const status=String(a?.status||"").toLowerCase();
 return status==="absent"||status==="awol";
}
function effectiveCommissionRate(emp,date,status){return previousDayPenaltyApplies(emp,date)?0.30:commRate(status);}
async function ensureAutomaticAbsences(){
 const yesterday=previousDate(today()),pending=[];
 for(const e of state.employees){
   if(isBeforeHire(e,yesterday)||isEmployeeOff(e,yesterday))continue;
   const existing=state.attendance.find(x=>String(x.employeeId)===String(e.id)&&x.date===yesterday);
   if(existing)continue;
   pending.push({id:`attendance_${String(e.id).replace(/[^a-zA-Z0-9_-]/g,"_")}_${yesterday}`,employeeId:e.id,date:yesterday,status:"absent",punchType:"automatic",markedAbsentAt:new Date().toISOString(),autoAbsent:true});
 }
 if(!pending.length)return;
 try{
   for(const record of pending){state.attendance.push(record);if(window.BigGuysCloud?.saveAttendance)state=await window.BigGuysCloud.saveAttendance(record);}
   cacheState();refresh();
 }catch(err){console.error("Automatic absent marking failed:",err);}
}
function attendanceDateValue(){return $("attendanceDate")?.value||today();}

// Employee IDs: YYYYMM + monthly hire sequence. The sequence never reuses an
// existing number for that month, so deleting an employee will not recycle an ID.
// Example: first hire in September 2026 = 20260901, next = 20260902.
function nextEmployeeId(hireDate){
 const m=/^(\d{4})-(\d{2})-\d{2}$/.exec(hireDate||"");
 if(!m){const d=today(); return nextEmployeeId(d);}
 const prefix=m[1]+m[2];
 let max=0;
 state.employees.forEach(e=>{
   const id=String(e?.id||"");
   if(id.startsWith(prefix)){
     const n=Number(id.slice(prefix.length));
     if(Number.isFinite(n)&&n>max)max=n;
   }
 });
 const next=max+1;
 return prefix+String(next).padStart(2,"0");
}
function updateEmployeeIdPreview(){
 const date=$("empHireDate")?.value;
 const input=$("empId");
 if(input)input.value=date?nextEmployeeId(date):"";
}
const baseRate=t=>t==="full"?250:t==="semi"?200:150;
const commRate=s=>{const v=String(s||"awol").toLowerCase().replace(/[\s_-]+/g,"");if(v==="late")return .35;if(v==="awol"||v==="absent")return .30;return .40;};
function table(rows,heads){if(!rows.length)return'<p class="muted">No records yet.</p>';return`<table class="table"><thead><tr>${heads.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`}
function isWorkedAttendance(a){return !!(a&&a.clockIn&&a.status&&! ["absent","awol","off","excuse"].includes(String(a.status).toLowerCase()));}
function pay(emp,date){
 const a=state.attendance.find(x=>String(x.employeeId)===String(emp.id)&&x.date===date);
 if(!isWorkedAttendance(a))return 0;
 const sales=state.sales.filter(x=>String(x.employeeId)===String(emp.id)&&x.date===date).reduce((t,x)=>t+Number(x.amount||0),0);
 const rate=effectiveCommissionRate(emp,date,a.status),commission=sales*rate;
 if(previousDayPenaltyApplies(emp,date)||String(a.status).toLowerCase()==="late")return commission;
 return Math.max(baseRate(emp.type),commission);
}
function commissionFor(emp,date){
 const a=state.attendance.find(x=>String(x.employeeId)===String(emp.id)&&x.date===date);
 if(!isWorkedAttendance(a))return 0;
 const rate=effectiveCommissionRate(emp,date,a.status);
 return state.sales.filter(x=>String(x.employeeId)===String(emp.id)&&x.date===date).reduce((t,x)=>t+Number(x.amount||0)*rate,0);
}
function statusBadge(status){
 const s=(status||"AWOL").toLowerCase();
 const label=s==="ontime"?"On Time":s.charAt(0).toUpperCase()+s.slice(1);
 const cls=s==="early"?"status-early":s==="late"||s==="awol"?"status-late":s==="absent"?"status-absent":s==="excuse"?"status-excuse":s==="off"?"status-off":"status-ontime";
 return `<span class="${cls}">${label}</span>`;
}
function dateLabel(date){return new Date(date+"T00:00:00").toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"})}
function refreshDashboardCharts(){
 const now=new Date(), d=today();
 const dayNames=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
 const week=[]; for(let i=6;i>=0;i--){const x=new Date(now);x.setDate(now.getDate()-i);week.push(x.toISOString().slice(0,10));}
 const period=document.getElementById("salesChartPeriod")?.value||"week";
 let labels=[],dates=[];
 if(period==="today"){labels=["Today"];dates=[d]}
 else if(period==="month"){const days=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();const step=Math.max(1,Math.ceil(days/7));for(let i=0;i<days;i+=step){const end=Math.min(days,i+step);labels.push(`${i+1}-${end}`);dates.push({start:new Date(now.getFullYear(),now.getMonth(),i+1),end:new Date(now.getFullYear(),now.getMonth(),end)});}}
 else if(period==="year"){labels=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];dates=labels.map((_,i)=>({start:new Date(now.getFullYear(),i,1),end:new Date(now.getFullYear(),i+1,0)}));}
 else {dates=week;labels=week.map(x=>dayNames[new Date(x+"T00:00:00").getDay()]);}
 const amounts=dates.map(x=>{if(typeof x==="string")return state.sales.filter(s=>s.date===x).reduce((t,s)=>t+Number(s.amount||0),0);return state.sales.filter(s=>{const q=new Date(s.date+"T00:00:00");return q>=x.start&&q<=x.end}).reduce((t,s)=>t+Number(s.amount||0),0)});
 const max=Math.max(1,...amounts);
 const chart=document.getElementById("salesChart");
 if(chart)chart.innerHTML=amounts.map((v,i)=>`<div class="bar-col"><span class="bar-value">${v?money(v):"₱0"}</span><div class="bar" style="height:${Math.max(2,(v/max)*150)}px"></div><span class="bar-label">${labels[i]}</span></div>`).join("");
 const cperiod=document.getElementById("carwashChartPeriod")?.value||"week";
 let cdates=dates,clabels=labels;
 if(cperiod!==period){ if(cperiod==="today"){clabels=["Today"];cdates=[d]} else if(cperiod==="week"){cdates=week;clabels=week.map(x=>dayNames[new Date(x+"T00:00:00").getDay()]);} else if(cperiod==="year"){clabels=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];cdates=clabels.map((_,i)=>({start:new Date(now.getFullYear(),i,1),end:new Date(now.getFullYear(),i+1,0)}));} else {const days=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();const step=Math.max(1,Math.ceil(days/7));clabels=[];cdates=[];for(let i=0;i<days;i+=step){const end=Math.min(days,i+step);clabels.push(`${i+1}-${end}`);cdates.push({start:new Date(now.getFullYear(),now.getMonth(),i+1),end:new Date(now.getFullYear(),now.getMonth(),end)});}}}
 const counts=cdates.map(x=>{const ok=s=>!s.category||String(s.category).toLowerCase()==="carwash";if(typeof x==="string")return state.sales.filter(s=>s.date===x&&ok(s)).length;return state.sales.filter(s=>{const q=new Date(s.date+"T00:00:00");return q>=x.start&&q<=x.end&&ok(s)}).length});
 const cmax=Math.max(1,...counts),line=document.getElementById("carwashChart");
 if(line){const w=520,h=175,pad=12;const pts=counts.map((v,i)=>{const x=pad+(i*(w-pad*2))/Math.max(1,counts.length-1),y=h-pad-(v/cmax)*(h-pad*2);return `${x},${y}`}).join(" ");line.innerHTML=`<svg class="line-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#18df8a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${counts.map((v,i)=>{const x=pad+(i*(w-pad*2))/Math.max(1,counts.length-1),y=h-pad-(v/cmax)*(h-pad*2);return `<circle cx="${x}" cy="${y}" r="4" fill="#18df8a"/>`}).join("")}</svg><div class="line-labels">${clabels.map(x=>`<span>${x}</span>`).join("")}</div>`;}
 const total=state.sales.filter(s=>s.date===d).reduce((t,s)=>t+Number(s.amount||0),0);
 const carwash=state.sales.filter(s=>s.date===d&&(String(s.category||"").toLowerCase()==="carwash"||(!s.category&&/carwash|wash/i.test(s.note||"")))).reduce((t,s)=>t+Number(s.amount||0),0);
 const detail=state.sales.filter(s=>s.date===d&&(String(s.category||"").toLowerCase()==="detailing"||(!s.category&&/detail/i.test(s.note||"")))).reduce((t,s)=>t+Number(s.amount||0),0);
 const addon=state.sales.filter(s=>s.date===d&&String(s.category||"").toLowerCase()==="add-ons").reduce((t,s)=>t+Number(s.amount||0),0);
 const classified=carwash+detail+addon, rest=Math.max(0,total-classified), values=classified? [carwash,detail,addon+rest]:[0,0,0];
 const perc=total?[Math.round(values[0]/total*100),Math.round(values[1]/total*100),Math.max(0,100-Math.round(values[0]/total*100)-Math.round(values[1]/total*100))]:[0,0,0];
 const donut=document.getElementById("incomeDonut"); if(donut)donut.style.background=`conic-gradient(#1687ff 0 ${perc[0]}%,#ffb51b ${perc[0]}% ${perc[0]+perc[1]}%,#d5e3ef ${perc[0]+perc[1]}% 100%)`;
 if($("incomeTotal"))$("incomeTotal").textContent=money(total); if($("incomeCarwash"))$("incomeCarwash").textContent=perc[0]+"%"; if($("incomeDetailing"))$("incomeDetailing").textContent=perc[1]+"%"; if($("incomeAddons"))$("incomeAddons").textContent=perc[2]+"%";
}
function refreshRightPanel(){
 const d=today(), records=state.attendance.filter(a=>a.date===d).slice().sort((a,b)=>(b.clockIn||"").localeCompare(a.clockIn||""));
 const captureEl=$("rightFaceCapture"),capturePlaceholder=$("rightFacePlaceholder");
 let captured=state.lastFaceCapture||null;
 if(!captured){try{captured=JSON.parse(localStorage.getItem("bigguys_last_face_capture")||"null");}catch(e){}}
 const capturedEmployee=captured?.employeeId?state.employees.find(x=>x.id===captured.employeeId):null;
 const captureKey=captured?.capturedAt||((captured?.employeeId||"")+"|"+(captured?.dataUrl||""));
 const consumedKey=localStorage.getItem("bigguys_consumed_attendance_capture")||"";
 const shouldShowCapture=!!(captured?.dataUrl&&captureEl&&capturedEmployee&&captureKey&&captureKey!==consumedKey);
 if(shouldShowCapture){
   attendanceCaptureDisplayedKey=captureKey;
   localStorage.setItem("bigguys_consumed_attendance_capture",captureKey);
   if(attendanceCaptureHideTimer)clearTimeout(attendanceCaptureHideTimer);
   captureEl.src=captured.dataUrl;
   captureEl.classList.remove("hidden");
   capturePlaceholder?.classList.add("hidden");
   attendanceCaptureHideTimer=setTimeout(()=>{
     captureEl?.classList.add("hidden");
     capturePlaceholder?.classList.remove("hidden");
     attendanceCaptureHideTimer=null;
   },1000);
 }else{
   captureEl?.classList.add("hidden");
   capturePlaceholder?.classList.remove("hidden");
 }
 const a=records[0],e=capturedEmployee|| (a?state.employees.find(x=>x.id===a.employeeId):state.employees[0]);
 const title=$("rightStatusTitle"),text=$("rightStatusText"),notice=$("rightNoticeTitle"),noticeText=$("rightNoticeText");
 if(e){const attendance=a&&a.employeeId===e.id?a:state.attendance.find(x=>x.employeeId===e.id&&x.date===d);$("rightEmployeeId").textContent=e.id;$("rightEmployeeType").textContent=e.type==="full"?"Full Time":e.type==="semi"?"Semi Full Time":"Part Time";$("rightSchedule").textContent=e.start;$("rightClockIn").textContent=attendance?.clockIn||"—";const st=attendance?.status||"AWOL";title.textContent=attendance?"Attendance Recorded":"Ready for Attendance";text.textContent=attendance?`${e.name} is marked ${st.toUpperCase()}.`:`Latest employee: ${e.name}.`;notice.textContent=attendance?.clockOut?"Clock-out Recorded":attendance?"Clock In Successful!":"Attendance Status";noticeText.textContent=attendance?.clockOut?"Clock-out recorded successfully.":attendance?`${st==="early"?"Early arrival recorded.":st==="late"?"Late arrival recorded.":"You are on time."}`:"No attendance action recorded yet.";}else{$("rightEmployeeId").textContent="—";$('rightEmployeeType').textContent="—";$('rightSchedule').textContent="—";$('rightClockIn').textContent="—";title.textContent="Ready for Attendance";text.textContent="Add an employee to begin tracking attendance.";notice.textContent="Attendance Status";noticeText.textContent="No employee records yet.";}
}

function wrapTableScroll(id){
 const host=$(id);
 if(!host)return;
 const t=host.querySelector(':scope > table');
 if(!t)return;
 const wrap=document.createElement('div');
 wrap.className='table-scroll';
 host.replaceChildren(wrap);
 wrap.appendChild(t);
}
function wrapAllTableScrolls(){
 ['overviewAttendance','employeeTable','attendanceTable','salesTable','payrollTable','payrollDailyTable','reportOutput','reportMonthlyEmployees','topSalesToday','employeeTypeSummary','recentSales'].forEach(wrapTableScroll);
}

function renderAttendanceAdmin(date){
 const target=date||today();
 if($("attendanceDate") && $("attendanceDate").value!==target)$("attendanceDate").value=target;
 const rows=state.employees.map((e,i)=>{
   const a=state.attendance.find(x=>String(x.employeeId)===String(e.id)&&x.date===target);
   const off=isEmployeeOff(e,target);
   const sales=state.sales.filter(x=>String(x.employeeId)===String(e.id)&&x.date===target).reduce((t,x)=>t+Number(x.amount||0),0);
   const rate=isWorkedAttendance(a)?effectiveCommissionRate(e,target,a.status):0;
   let status=a?.status||"awol";
   let action="—";
   if(off && !a) status="off";
   else if(!a) action=`<button type="button" class="small-action mark-excuse" data-id="${e.id}" data-date="${target}">MARK EXCUSE</button>`;
   return [e.id,e.name,e.start,a?.clockIn||"—",a?.clockOut||"—",dtrHours(a),statusBadge(status),money(sales),`${Math.round(rate*100)}%`,money(commissionFor(e,target)),money(pay(e,target)),action];
 });
 $("attendanceTable").innerHTML=table(rows,["ID","Employee","Scheduled","Time In","Time Out","Hours","Status","Sales","Commission %","Commission","Daily Pay","Action"]);
 document.querySelectorAll(".mark-excuse").forEach(btn=>btn.onclick=()=>markEmployeeExcuse(btn.dataset.id,btn.dataset.date));
 wrapTableScroll("attendanceTable");
}
async function markEmployeeExcuse(employeeId,date){
 const e=state.employees.find(x=>String(x.id)===String(employeeId));
 if(!e||!date)return;
 if(isEmployeeOff(e,date)){alert(`${e.name} is scheduled OFF on ${date}.`);return;}
 const existing=state.attendance.find(x=>String(x.employeeId)===String(employeeId)&&x.date===date);
 if(existing?.clockIn){alert("This employee already has a Time In record for this date.");return;}
 const record={...(existing||{}),id:existing?.id||`attendance_${String(employeeId).replace(/[^a-zA-Z0-9_-]/g,"_")}_${date}`,employeeId,date,status:"excuse",punchType:"manual",markedExcuseAt:new Date().toISOString()};
 try{
   if(existing){const idx=state.attendance.findIndex(x=>x.id===existing.id);if(idx>=0)state.attendance[idx]=record;}else state.attendance.push(record);
   if(window.BigGuysCloud?.saveAttendance)state=await window.BigGuysCloud.saveAttendance(record);else state=await save();
   cacheState();refresh();
 }catch(err){console.error("Mark excuse failed",err);alert(`Unable to mark excuse: ${err?.code||err?.message||err}`);}
}
function renderSettings(){
 const select=$("settingsEmployee"); if(!select)return;
 const current=select.value;
 select.innerHTML='<option value="">Select Employee</option>'+state.employees.map(e=>`<option value="${e.id}">${e.name} — ${e.id}</option>`).join("");
 if(state.employees.some(e=>String(e.id)===String(current)))select.value=current;
 const e=state.employees.find(x=>String(x.id)===String(select.value));
 const wrap=$("employeeOffDays"); if(!wrap)return;
 const selected=new Set(employeeOffDays(e));
 wrap.innerHTML=WEEKDAYS.map(day=>`<label class="off-day-option ${selected.has(day)?"selected":""}"><input type="checkbox" value="${day}" ${selected.has(day)?"checked":""}><span>${day}</span></label>`).join("");
 wrap.querySelectorAll('input[type="checkbox"]').forEach(input=>input.addEventListener("change",()=>input.closest(".off-day-option")?.classList.toggle("selected",input.checked)));
 $("offDaysSummary").innerHTML=e?`<strong>${e.name}</strong><span>${selected.size?Array.from(selected).join(" • "):"No regular days off selected."}</span>`:"Select an employee to configure days off.";
}
async function saveEmployeeOffDays(){
 const id=$("settingsEmployee")?.value;
 const current=state.employees.find(x=>String(x.id)===String(id));
 if(!current){alert("Select an employee first.");return;}
 const offDays=[...document.querySelectorAll('#employeeOffDays input[type="checkbox"]:checked')].map(x=>x.value);
 const employee={...current,offDays:[...new Set(offDays)]};
 try{
   let next;
   if(window.BigGuysCloud?.saveEmployee) next=await window.BigGuysCloud.saveEmployee(employee);
   else next=await save();
   if(next&&Array.isArray(next.employees)) state=next; else { const local=state.employees.find(x=>String(x.id)===String(id)); if(local)local.offDays=employee.offDays; }
   cacheState();
   renderSettings();
   renderAttendanceAdmin(attendanceDateValue());
   renderPayroll();
   alert(employee.offDays.length?`Days off saved: ${employee.offDays.join(", ")}`:"Days off cleared. No regular days off are set.");
 }catch(err){
   console.error("Days off save failed",err);
   alert(`Unable to save days off: ${err?.code||err?.message||err}`);
 }
}
function preserveTableScrollPositions(){
 const positions={};
 document.querySelectorAll('.table-scroll').forEach((el,i)=>{
   const host=el.parentElement;
   const key=host?.id || el.dataset.scrollKey || `table-scroll-${i}`;
   positions[key]=el.scrollLeft;
 });
 return positions;
}
function restoreTableScrollPositions(positions){
 if(!positions)return;
 document.querySelectorAll('.table-scroll').forEach((el,i)=>{
   const host=el.parentElement;
   const key=host?.id || el.dataset.scrollKey || `table-scroll-${i}`;
   if(Object.prototype.hasOwnProperty.call(positions,key)){
     const x=positions[key];
     requestAnimationFrame(()=>{el.scrollLeft=x;});
   }
 });
}
function refresh(){
 const __scrollPositions=preserveTableScrollPositions();
 syncStateFromStorage();
 const d=today(),ds=state.sales.filter(x=>x.date===d),totalSales=ds.reduce((t,x)=>t+Number(x.amount||0),0);
 if($("salesTotal"))$("salesTotal").textContent=money(totalSales);
 if($("carsWashed"))$("carsWashed").textContent=ds.filter(x=>String(x.category||"").toLowerCase()==="carwash"||(!x.category&&/carwash|wash/i.test(x.note||""))).length;
 if($("employeeTotal"))$("employeeTotal").textContent=state.employees.length;
 if($("payrollTotal"))$("payrollTotal").textContent=money(state.employees.reduce((t,e)=>t+pay(e,d),0));
 const attendanceRows=state.employees.map((e,i)=>{const a=state.attendance.find(x=>x.employeeId===e.id&&x.date===d);const sales=state.sales.filter(x=>x.employeeId===e.id&&x.date===d).reduce((t,x)=>t+Number(x.amount||0),0);return[i+1,e.name,e.type,e.start,a?.clockIn||"—",statusBadge(a?.status||"awol"),money(sales),money(sales*effectiveCommissionRate(e,d,a?.status||"awol")),money(pay(e,d))]});
 $("overviewAttendance").innerHTML=table(attendanceRows,["#","Employee","Type","Schedule","Clock In","Status","Sales","Commission","Daily Pay"]);
 renderAttendanceAdmin(attendanceDateValue());
 $("employeeTable").innerHTML=table(state.employees.map(e=>[e.id,e.name,e.type,e.start,money(baseRate(e.type)),state.faces[e.id]?"Enrolled":"Not enrolled",`<button class="history-employee" data-id="${e.id}">HISTORY</button> <button class="face-employee" data-id="${e.id}">FACE</button> <button class="delete-employee" data-id="${e.id}">DELETE</button>`]),["ID","Name","Type","Start","Base/Day","Face","Action"]);
 document.querySelectorAll(".history-employee").forEach(btn=>btn.onclick=()=>showEmployeeHistory(btn.dataset.id));
document.querySelectorAll(".face-employee").forEach(btn=>btn.onclick=()=>openEnrollmentModal(btn.dataset.id));
document.querySelectorAll(".delete-employee").forEach(btn=>btn.onclick=()=>deleteEmployee(btn.dataset.id));
 refreshDtrSelector();
 renderSettings();
 const opts=state.employees.map(e=>`<option value="${e.id}">${e.name} (${e.id})</option>`).join(""); if($("saleEmployee"))$("saleEmployee").innerHTML=opts;if($("enrollEmployee"))$("enrollEmployee").innerHTML=opts;
 $("salesTable").innerHTML=table(state.sales.slice().reverse().map(s=>[s.date,state.employees.find(e=>e.id===s.employeeId)?.name||s.employeeId,money(s.amount),s.note||"—"]),["Date","Employee","Amount","Service / Note"]);
 wrapAllTableScrolls();
 renderPayroll();
 const top=state.employees.map(e=>({name:e.name,sales:state.sales.filter(s=>s.date===d&&s.employeeId===e.id).reduce((t,s)=>t+Number(s.amount||0),0)})).filter(x=>x.sales>0).sort((a,b)=>b.sales-a.sales);
 $("topSalesToday").innerHTML=table(top.slice(0,6).map((x,i)=>[i+1,x.name,money(x.sales)]),["#","Employee","Sales"]);
 const types={full:"Full Time",semi:"Semi Full Time",part:"Part Time"}; const counts={};state.employees.forEach(e=>counts[e.type]=(counts[e.type]||0)+1);$("employeeTypeSummary").innerHTML=table(Object.keys(counts).map(k=>[types[k]||k,counts[k]]),["Type","Count"]);
 $("recentSales").innerHTML=table(state.sales.slice().reverse().slice(0,6).map(s=>[new Date((s.date||d)+"T"+(s.time||"12:00") ).toLocaleTimeString("en-PH",{hour:"numeric",minute:"2-digit"}),s.note||"Carwash",money(s.amount)]),["Time","Service","Amount"]);
 refreshDashboardCharts();refreshRightPanel();if(!$('sales').classList.contains('hidden'))renderSalesPage('daily');if(!$('reports').classList.contains('hidden'))makeReport(currentReportView);
 restoreTableScrollPositions(__scrollPositions);
}
async function loadModels(){
 if(modelsReady)return true;
 if(typeof faceapi==="undefined"){
   $("enrollStatus").textContent="Face recognition library did not load. Refresh the page.";
   return false;
 }
 $("enrollStatus").textContent="Loading face recognition model…";
 for(const url of MODEL_URLS){
   try{
     await Promise.all([
       faceapi.nets.tinyFaceDetector.loadFromUri(url),
       faceapi.nets.faceLandmark68TinyNet.loadFromUri(url),
       faceapi.nets.faceRecognitionNet.loadFromUri(url)
     ]);
     modelsReady=true;
     $("enrollStatus").textContent="Face recognition ready.";
     return true;
   }catch(e){ console.warn("Face model source failed:",url,e); }
 }
 $("enrollStatus").textContent="Could not load face models. Check your internet connection and refresh.";
 return false;
}
if($("empHireDate")){
 $("empHireDate").value=today();
 $("empHireDate").addEventListener("change",updateEmployeeIdPreview);
 updateEmployeeIdPreview();
}

$("loginBtn").onclick=async()=>{
  const email=$("adminEmail").value.trim(),password=$("adminPassword").value;
  $("loginBtn").disabled=true;$("loginError").textContent="Signing in…";
  try{
    if(!window.BigGuysCloud?.configured)throw new Error("Firebase is not configured.");
    if(email!==ADMIN_EMAIL)throw new Error("This account is not authorized as the Big Guy's administrator.");
    await BigGuysCloud.adminLogin(email,password);
    // Show the dashboard immediately after Firebase Authentication succeeds.
    // Firestore sync continues in the background so login is not blocked by
    // network reads/writes.
    $("adminLogin").classList.add("hidden");$("dashboard").classList.remove("hidden");document.body.classList.add("logged-in");
    $("loginError").textContent="";refresh();startClock();
    BigGuysCloud.init(state,remote=>{
      state=remote;
      cacheState();
      refresh();
    },'admin').catch(err=>{
      console.error('Background Firestore sync failed:',err);
    });
  }catch(err){
    console.error(err);
    $("loginError").textContent=err?.message||"Invalid admin email or password.";
  }finally{$("loginBtn").disabled=false;}
};
$("logoutBtn").onclick=async()=>{
  try{sessionStorage.removeItem(FACE_SCAN_SESSION_KEY);}catch(e){}
  try{await BigGuysCloud.adminLogout();}catch(e){console.warn(e)}
  $("dashboard").classList.add("hidden");$("adminLogin").classList.remove("hidden");$("adminPassword").value="";document.body.classList.remove("logged-in");
};
$("employeeForm").onsubmit=async e=>{
 e.preventDefault();
 const btn=e.target.querySelector('button[type="submit"]');
 const first=$("empFirstName").value.trim(),last=$("empLastName").value.trim();
 if(!first||!last)return;
 if(btn){btn.disabled=true;btn.textContent='SAVING EMPLOYEE…';}
 try{
   await window.BigGuysCloud?.init?.(state,remote=>{
     state=remote;
     cacheState();
   },'admin');
   const hireDate=$("empHireDate").value||today();
   const id=window.BigGuysCloud?.reserveEmployeeId ? await window.BigGuysCloud.reserveEmployeeId(hireDate) : nextEmployeeId(hireDate);
   const employee={id,firstName:first,lastName:last,name:`${first} ${last}`.trim(),type:$("empType").value,start:$("empStart").value,hireDate,offDays:[]};
   state.employees.push(employee);
   cacheState();
   if(window.BigGuysCloud?.saveEmployee){
     state=await window.BigGuysCloud.saveEmployee(employee);
     cacheState();
   }else{
     await syncAdminNow();
   }
   e.target.reset();
   $("empStart").value='08:00';
   $("empHireDate").value=today();
   updateEmployeeIdPreview();
   refresh();
   openEnrollmentModal(id);
 }catch(err){
   console.error('Employee creation failed:',err);
   alert('Employee was not fully saved. Please check the Firebase connection and try again.');
 }finally{
   if(btn){btn.disabled=false;btn.textContent='ADD EMPLOYEE & ENROLL FACE';}
 }
};
$("salesForm").onsubmit=async e=>{e.preventDefault();const now=new Date();const sale={id:(crypto.randomUUID?crypto.randomUUID():`sale_${Date.now()}_${Math.random().toString(36).slice(2)}`),date:today(),time:now.toTimeString().slice(0,8),createdAtISO:now.toISOString(),employeeId:$("saleEmployee").value,amount:Number($("saleAmount").value||0),remittance:Number($("saleRemittance").value||0),expense:Number($("saleExpense").value||0),category:$("saleCategory").value,note:"",paymentMethod:"Cash"};if(sale.amount<0||sale.remittance<0||sale.expense<0){alert('Please enter valid amounts.');return;}state.sales.push(sale);try{if(window.BigGuysCloud?.saveSale){state=await window.BigGuysCloud.saveSale(sale);}else{state=await save();}cacheState();try{const f=dailyFinancials(sale.date);await saveReportRecord(sale.date,{cash:f.cash,expenses:f.expenses,cashRemitted:f.cashRemitted,expectedRemittance:f.expected,short:f.short,over:f.over,lastSaleAtISO:sale.createdAtISO});}catch(reportErr){console.warn("Automatic report snapshot failed:",reportErr);}e.target.reset();$("salesViewDate").value=sale.date;refresh()}catch(err){console.error(err);alert(`Sale cloud save failed: ${err?.code||err?.message||err}`)}};
document.querySelectorAll(".tabs button").forEach(btn=>btn.onclick=()=>{document.querySelectorAll(".tabs button").forEach(x=>x.classList.remove("active"));btn.classList.add("active");document.querySelectorAll(".tab-panel").forEach(x=>x.classList.add("hidden"));$(btn.dataset.tab).classList.remove("hidden")});
let enrollmentRunning=false,enrollmentSamples=[];
const ENROLL_STEPS=[
  {name:"Normal face",instruction:"Look straight at the camera with your face centered."},
  {name:"Slight left",instruction:"Turn your face slightly to the LEFT."},
  {name:"Slight right",instruction:"Turn your face slightly to the RIGHT."},
  {name:"Slight up/down",instruction:"Tilt your face slightly UP, then slightly DOWN."},
  {name:"Normal expression",instruction:"Return to center with a natural, relaxed expression."}
];
let enrollmentStep=0;
function normalizeFaceRecords(value){
 if(!value)return [];
 if(Array.isArray(value)&&value.length&&Array.isArray(value[0]))return value;
 if(Array.isArray(value))return [value];
 return [];
}
function averageDescriptor(samples){
 const len=samples[0].length,avg=new Array(len).fill(0);
 for(const sample of samples)for(let i=0;i<len;i++)avg[i]+=sample[i];
 for(let i=0;i<len;i++)avg[i]/=samples.length;
 return avg;
}
function enrollmentFaceIsInsideOval(d){
 const video=$("enrollCamera"),w=video.videoWidth||720,h=video.videoHeight||720,box=d.detection.box;
 const cx=(box.x+box.width/2)/w,cy=(box.y+box.height/2)/h;
 const rx=.23,ry=.40;
 const ellipse=((cx-.5)**2)/(rx**2)+((cy-.50)**2)/(ry**2);
 const faceHeight=box.height/h,faceWidth=box.width/w;
 return ellipse<=1&&faceHeight>=.22&&faceHeight<=.82&&faceWidth>=.14&&faceWidth<=.72;
}
function facePoseForStep(d,step){
 const pos=d?.landmarks?.positions||[];
 if(pos.length<68)return true;
 const nose=pos[30], leftEye=pos[36], rightEye=pos[45], chin=pos[8], brow=pos[27];
 const eyeMidX=(leftEye.x+rightEye.x)/2, eyeDist=Math.max(1,Math.abs(rightEye.x-leftEye.x));
 const yaw=(nose.x-eyeMidX)/eyeDist;
 const faceVertical=Math.max(1,chin.y-brow.y);
 const pitch=(nose.y-(brow.y+faceVertical*.45))/faceVertical;
 if(step===0||step===4)return Math.abs(yaw)<.16;
 if(step===1)return yaw<-.08;
 if(step===2)return yaw>.08;
 if(step===3)return Math.abs(yaw)<.22 && pitch<.20;
 return true;
}
async function captureEnrollmentSample(id,step){
 const d=await faceapi.detectSingleFace($("enrollCamera"),new faceapi.TinyFaceDetectorOptions({inputSize:416,scoreThreshold:.45})).withFaceLandmarks(true).withFaceDescriptor();
 if(!d)return false;
 const good=enrollmentFaceIsInsideOval(d) && facePoseForStep(d,step);
 const frame=$("enrollOvalFrame");
 frame?.classList.toggle("oval-green",good); frame?.classList.toggle("oval-red",!good);
 if(!good)return false;
 const descriptor=Array.from(d.descriptor);
 if(descriptor.length!==128||descriptor.some(v=>!Number.isFinite(Number(v))))return false;
 enrollmentSamples.push(descriptor);
 const next=enrollmentSamples.length;
 $("enrollResult").innerHTML=`<div class="result success enrollment-progress"><strong>${ENROLL_STEPS[step].name}</strong><br>Sample ${next}/5 captured ✓<br><small>${next<5?ENROLL_STEPS[next].instruction:"All 5 face samples captured. Saving to Firebase…"}</small></div>`;
 return true;
}
function stopEnrollmentCamera(){
 if(enrollStream){enrollStream.getTracks().forEach(t=>t.stop());enrollStream=null;}
 const v=$("enrollCamera");if(v)v.srcObject=null;
}
function setEnrollmentRetryVisible(show){const b=$("retryEnrollment");if(b)b.classList.toggle("hidden",!show);}
function closeEnrollmentModal(){
 stopEnrollmentCamera();
 enrollmentRunning=false;
 setEnrollmentRetryVisible(false);
 $("enrollmentModal")?.classList.add('hidden');
}
async function runAutoEnrollment(){
 const id=$("enrollEmployee").value;if(!id||enrollmentRunning)return false;
 setEnrollmentRetryVisible(false);
 enrollmentRunning=true;enrollmentSamples=[];enrollmentStep=0;
 $("enrollStatus").textContent=`Step 1/5 — ${ENROLL_STEPS[0].instruction}`;
 $("enrollResult").innerHTML=`<div class="result success enrollment-progress"><strong>${ENROLL_STEPS[0].name}</strong><br><small>${ENROLL_STEPS[0].instruction}</small></div>`;
 for(enrollmentStep=0;enrollmentStep<ENROLL_STEPS.length&&enrollmentRunning;enrollmentStep++){
   let captured=false, attempts=0;
   $("enrollStatus").textContent=`Step ${enrollmentStep+1}/5 — ${ENROLL_STEPS[enrollmentStep].instruction}`;
   while(!captured&&attempts<80&&enrollmentRunning){
     attempts++;
     try{captured=await captureEnrollmentSample(id,enrollmentStep);}catch(err){console.warn('Enrollment detection error:',err);}
     if(!captured)$("enrollStatus").textContent=`🔴 Step ${enrollmentStep+1}/5 — ${ENROLL_STEPS[enrollmentStep].instruction}`;
     else if(enrollmentStep<4)$("enrollStatus").textContent=`🟢 Step ${enrollmentStep+1}/5 captured — now: ${ENROLL_STEPS[enrollmentStep+1].instruction}`;
     await new Promise(r=>setTimeout(r,350));
   }
   if(!captured){
     $("enrollStatus").textContent="Enrollment paused — please reposition and try again.";
     $("enrollResult").innerHTML='<div class="result late-result">Could not capture this required face position. Keep your face inside the oval and follow the instruction.</div>';
     enrollmentRunning=false;
    setEnrollmentRetryVisible(true);
    return false;
   }
   await new Promise(r=>setTimeout(r,500));
 }
 if(enrollmentSamples.length===5){
   state.faces[id]=enrollmentSamples;
   state.faceUpdatedAt=state.faceUpdatedAt||{};state.faceUpdatedAt[id]=new Date().toISOString();cacheState();
   try{
     let lastErr=null,confirmed=false;
     for(let attempt=1;attempt<=5&&!confirmed;attempt++){
       try{
         if(window.BigGuysCloud?.saveFaceEnrollment)state=await window.BigGuysCloud.saveFaceEnrollment(id,enrollmentSamples);else await syncAdminNow();
         // Keep the just-confirmed samples visible locally even if a realtime listener
         // delivers an older collection snapshot during the same save cycle.
         state.faces=state.faces&&typeof state.faces==='object'?state.faces:{};
         state.faces[id]=enrollmentSamples.map(sample=>Array.from(sample));
         state.faceUpdatedAt=state.faceUpdatedAt&&typeof state.faceUpdatedAt==='object'?state.faceUpdatedAt:{};
         state.faceUpdatedAt[id]=new Date().toISOString();
         cacheState();
         const enrolledEmployee=state.employees.find(e=>String(e.id)===String(id));
         confirmed=Array.isArray(state.faces?.[id])&&state.faces[id].length>=5&&enrolledEmployee?.faceEnrolled===true;
         if(!confirmed)throw new Error('Firebase returned without confirming the enrolled face.');
       }catch(err){lastErr=err;if(attempt<5)await new Promise(r=>setTimeout(r,500*attempt));}
     }
     if(!confirmed)throw lastErr||new Error('Firebase did not confirm the face enrollment.');
     const employee=state.employees.find(e=>e.id===id);
     $("enrollStatus").textContent="✓ Employee enrolled successfully.";
     $("enrollResult").innerHTML=`<div class="enrolled-success"><div class="enrolled-check">✓</div><strong>EMPLOYEE ENROLLED</strong><span>${employee?.name||''}</span><small>${id} • 5 face samples saved to Firebase</small></div>`;
     refresh();
     setTimeout(()=>{closeEnrollmentModal();const nav=document.querySelector('.side-nav[data-tab="employees"]');if(nav)nav.click();const form=$("employeeForm");if(form){form.reset();$("empStart").value='08:00';$("empHireDate").value=today();updateEmployeeIdPreview();}$("empFirstName")?.focus();},1400);
     enrollmentRunning=false;return true;
   }catch(err){
     console.error('Face enrollment cloud save failed:',err);const detail=[err?.code,err?.message].filter(Boolean).join(' — ')||'Unknown Firebase error';
     $("enrollStatus").textContent="Cloud save could not be confirmed.";
     $("enrollResult").innerHTML=`<div class="result late-result">Face samples captured, but Firebase did not confirm the save.<br><small>${detail}</small></div>`;
     setEnrollmentRetryVisible(true);
   }
 }else{$("enrollStatus").textContent="Enrollment failed — all 5 face samples are required.";$("enrollResult").innerHTML='<div class="result late-result">All 5 guided face samples are required.</div>';setEnrollmentRetryVisible(true)}
 enrollmentRunning=false;return false;
}
async function startEnrollmentCamera(){
 if(!await loadModels())return false;
 try{
   stopEnrollmentCamera();
   enrollStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:720},height:{ideal:720}},audio:false});
   const video=$("enrollCamera");
   video.srcObject=enrollStream;
   await new Promise(resolve=>{
     if(video.readyState>=2)return resolve();
     video.onloadedmetadata=()=>resolve();
   });
   try{await video.play();}catch(e){}
   $("enrollStatus").textContent="Camera ready — position your face inside the oval.";
   return true;
 }catch(e){
   console.error(e);
   $("enrollStatus").textContent="Camera permission denied or unavailable. Please allow camera access and try again.";
   return false;
 }
}

async function openEnrollmentModal(id){
 const employee=state.employees.find(e=>e.id===id);
 if(!employee)return;
 const modal=$("enrollmentModal"),select=$("enrollEmployee");
 if(select){select.innerHTML=`<option value="${employee.id}">${employee.name} (${employee.id})</option>`;select.value=employee.id;}
 $("enrollmentEmployeeName").textContent=employee.name;
 $("enrollmentEmployeeId").textContent=employee.id;
 $("enrollmentEmployeeLabel").textContent="Position your face inside the oval. Enrollment will start automatically.";
 $("enrollResult").innerHTML='';
 setEnrollmentRetryVisible(false);
 $("enrollOvalFrame")?.classList.remove('oval-green');
 $("enrollOvalFrame")?.classList.add('oval-red');
 modal?.classList.remove('hidden');
 const cameraReady=await startEnrollmentCamera();
 if(cameraReady) await runAutoEnrollment();
}
$("startEnrollCamera").onclick=startEnrollmentCamera;
$("enrollFace").onclick=runAutoEnrollment;
$("retryEnrollment").onclick=async()=>{setEnrollmentRetryVisible(false);if(!enrollStream){const ready=await startEnrollmentCamera();if(!ready){setEnrollmentRetryVisible(true);return;}}await runAutoEnrollment();};
$("closeEnrollmentModal").onclick=closeEnrollmentModal;
$("enrollmentModal")?.querySelector('.enrollment-modal-backdrop')?.addEventListener('click',()=>{if(!enrollmentRunning)closeEnrollmentModal();});

function dtrMinutes(a){
 const start=a?.clockInAt?new Date(a.clockInAt):null, end=a?.clockOutAt?new Date(a.clockOutAt):null;
 if(start&&end&&!Number.isNaN(start.getTime())&&!Number.isNaN(end.getTime()))return Math.max(0,(end-start)/60000);
 if(a?.clockIn&&a?.clockOut){const [h1,m1,s1=0]=a.clockIn.split(":").map(Number),[h2,m2,s2=0]=a.clockOut.split(":").map(Number);return Math.max(0,(h2*60+m2+s2/60)-(h1*60+m1+s1/60));}
 return null;
}
function dtrHours(a){const mins=dtrMinutes(a);return mins==null?"—":(mins/60).toFixed(2)+" hrs";}
function payrollMonthValue(){ return $("payrollMonth")?.value || today().slice(0,7); }
function payrollDates(month){
 const [y,m]=month.split("-").map(Number); if(!y||!m)return [];
 const out=[]; const last=new Date(y,m,0).getDate();
 for(let d=1;d<=last;d++)out.push(`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`);
 return out;
}
function renderPayroll(){
 const month=payrollMonthValue(); if($("payrollMonth"))$("payrollMonth").value=month;
 const dates=payrollDates(month);
 const rows=state.employees.map(e=>{
   let accumulated=0,days=0,totalSales=0,totalCommission=0;
   dates.forEach(date=>{
     const a=state.attendance.find(x=>String(x.employeeId)===String(e.id)&&x.date===date);
     if(!isWorkedAttendance(a))return;
     days++;
     const sales=state.sales.filter(x=>String(x.employeeId)===String(e.id)&&x.date===date).reduce((t,x)=>t+Number(x.amount||0),0);
     const commission=commissionFor(e,date);
     totalSales+=sales; totalCommission+=commission; accumulated+=pay(e,date);
   });
   return {e,days,totalSales,totalCommission,accumulated};
 }).sort((a,b)=>b.accumulated-a.accumulated||b.totalSales-a.totalSales);
 const total=rows.reduce((t,r)=>t+r.accumulated,0);
 const worked=rows.reduce((t,r)=>t+r.days,0);
 if($("payrollPeriodLabel"))$("payrollPeriodLabel").textContent=`${month} • ${dates[0]} to ${dates[dates.length-1]}`;
 if($("payrollSummary"))$("payrollSummary").innerHTML=`<div><span>Monthly Payroll</span><b>${money(total)}</b></div><div><span>Employees</span><b>${rows.length}</b></div><div><span>Work / Attendance Days</span><b>${worked}</b></div><div><span>Highest Accumulated</span><b>${money(rows[0]?.accumulated||0)}</b></div>`;
 if($("payrollTable"))$("payrollTable").innerHTML=table(rows.map((r,i)=>[i+1,r.e.name,r.e.type,r.days,money(r.totalSales),money(r.totalCommission),money(r.accumulated)]),["#","Employee","Type","Days Worked","Sales","Commission","Accumulated Pay"]);
 let running={}; const daily=[];
 dates.forEach(date=>state.employees.forEach(e=>{
   const a=state.attendance.find(x=>String(x.employeeId)===String(e.id)&&x.date===date); if(!isWorkedAttendance(a))return;
   const sales=state.sales.filter(x=>String(x.employeeId)===String(e.id)&&x.date===date).reduce((t,x)=>t+Number(x.amount||0),0);
   const rate=effectiveCommissionRate(e,date,a.status), commission=commissionFor(e,date), dailyPay=pay(e,date);
   running[e.id]=(running[e.id]||0)+dailyPay;
   daily.push([date,e.name,statusBadge(a.status),money(sales),`${Math.round(rate*100)}%`,money(dailyPay),money(running[e.id])]);
 }));
 daily.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
 if($("payrollDailyTable"))$("payrollDailyTable").innerHTML=daily.length?table(daily,["Date","Employee","Status","Sales","Commission %","Daily Pay","Accumulated"]):'<p class="muted">No actual work / attendance records for this month.</p>';
}
function renderEmployeeDtr(id){
 const box=$("employeeDtrProfile"); if(!box)return;
 const e=state.employees.find(x=>String(x.id)===String(id));
 if(!e){box.className="employee-dtr-profile empty-dtr";box.innerHTML='<div class="dtr-empty-icon">◷</div><h3>Select an employee</h3><p class="muted">The employee\'s DTR details will appear here.</p>';return;}
 selectedDtrEmployeeId=e.id;
 const rows=state.attendance.filter(a=>String(a.employeeId)===String(e.id)).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.clockInAt||b.clockIn||"").localeCompare(a.clockInAt||a.clockIn||""));
 const totalSales=state.sales.filter(x=>String(x.employeeId)===String(e.id)).reduce((t,x)=>t+Number(x.amount||0),0);
 const completed=rows.filter(a=>a.clockIn&&a.clockOut); const totalMinutes=completed.reduce((t,a)=>t+(dtrMinutes(a)||0),0);
 const todayRecord=rows.find(a=>a.date===today()); const todaySales=state.sales.filter(x=>String(x.employeeId)===String(e.id)&&x.date===today()).reduce((t,x)=>t+Number(x.amount||0),0);
 const rate=isWorkedAttendance(todayRecord)?effectiveCommissionRate(e,today(),todayRecord.status):0;
 const commission=isWorkedAttendance(todayRecord)?todaySales*rate:0;
 const totalSalary=rows.reduce((t,a)=>t+pay(e,a.date),0);
 const type=e.type==="full"?"Full Time":e.type==="semi"?"Semi Full Time":"Part Time";
 const history=rows.length?rows.map(a=>{
   const sales=state.sales.filter(x=>String(x.employeeId)===String(e.id)&&x.date===a.date).reduce((t,x)=>t+Number(x.amount||0),0);
   const r=effectiveCommissionRate(e,date,a.status||"awol");
   return [dateLabel(a.date),e.start||"—",a.clockIn||"—",a.clockOut||"—",dtrHours(a),money(sales),`${Math.round(r*100)}%`,money(isWorkedAttendance(a)?sales*r:0),statusBadge(a.status||"awol")];
 }):[];
 box.className="employee-dtr-profile";
 box.innerHTML=`<div class="dtr-employee-header"><div class="dtr-avatar">${(e.name||"?").split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase()}</div><div class="dtr-employee-main"><span class="section-kicker">EMPLOYEE DTR PROFILE</span><h3>${e.name}</h3><p>${e.id} · ${type} · Schedule ${e.start||"—"}</p></div><button type="button" class="dtr-print" onclick="window.print()">PRINT DTR</button></div>
 <div class="dtr-kpi-grid"><div class="dtr-kpi"><span>TIME IN TODAY</span><b>${todayRecord?.clockIn||"—"}</b><small>${todayRecord?statusBadge(todayRecord.status||"awol"):"No record yet"}</small></div><div class="dtr-kpi"><span>TIME OUT TODAY</span><b>${todayRecord?.clockOut||"—"}</b><small>${todayRecord?.clockOut?dtrHours(todayRecord):"Pending"}</small></div><div class="dtr-kpi"><span>TODAY'S SALES</span><b>${money(todaySales)}</b><small>Commission ${Math.round(rate*100)}%</small></div><div class="dtr-kpi"><span>TOTAL SALES</span><b>${money(totalSales)}</b><small>${rows.length} attendance record${rows.length===1?"":"s"}</small></div><div class="dtr-kpi"><span>TOTAL HOURS</span><b>${(totalMinutes/60).toFixed(2)}</b><small>Completed shifts</small></div><div class="dtr-kpi"><span>TOTAL SALARY</span><b>${money(totalSalary)}</b><small>Higher of minimum pay or commission</small></div><div class="dtr-kpi"><span>TODAY COMMISSION</span><b>${money(commission)}</b><small>${Math.round(rate*100)}% of today's sales</small></div></div>
 <div class="dtr-table-wrap">${history.length?table(history,["DATE","SCHEDULE","TIME IN","TIME OUT","HOURS","SALES","COMMISSION %","COMMISSION","STATUS"]):'<p class="muted dtr-no-records">No DTR history for this employee yet.</p>'}</div>`;
}
function refreshDtrSelector(){
 const select=$("dtrEmployeeSelect"); if(!select)return;
 const current=selectedDtrEmployeeId||select.value||"";
 select.innerHTML='<option value="">Select Employee</option>'+state.employees.map(e=>`<option value="${e.id}">${e.name} — ${e.id}</option>`).join("");
 if(state.employees.some(e=>String(e.id)===String(current))){select.value=current;renderEmployeeDtr(current);}else{select.value="";selectedDtrEmployeeId="";renderEmployeeDtr("");}
}

function showEmployeeHistory(id){
 const e=state.employees.find(x=>x.id===id);
 if(!e)return;
 const rows=state.attendance.filter(a=>a.employeeId===id).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.clockIn||"").localeCompare(a.clockIn||""));
 const html=rows.length?table(rows.map(a=>{
   const sales=state.sales.filter(x=>x.employeeId===id&&x.date===a.date).reduce((t,x)=>t+Number(x.amount||0),0);
   const hours=a.clockIn&&a.clockOut?((minutes(a.clockOut)-minutes(a.clockIn))/60).toFixed(2):"—";
   return [a.date,a.clockIn||"—",a.clockOut||"—",statusBadge(a.status||"awol"),hours,money(sales),money(pay(e,a.date))];
 }),["DATE","TIME IN","TIME OUT","STATUS","HOURS","SALES","DAILY PAY"]):'<p class="muted">No DTR history for this employee yet.</p>';
 const box=$("employeeHistory");
 if(box){
   box.innerHTML=`<div class="history-head"><div><h3>${e.name} — DTR History</h3><p class="muted">${e.id}</p></div><button type="button" id="closeHistory">CLOSE</button></div>${html}`;
   box.classList.remove("hidden");
   $("closeHistory").onclick=()=>box.classList.add("hidden");
   box.scrollIntoView({behavior:"smooth",block:"nearest"});
 }
}
async function deleteEmployee(id){
 const employee=state.employees.find(e=>e.id===id);
 if(!employee)return;
 const ok=confirm(`Delete employee ${employee.name} (${employee.id})?\n\nThis will also delete the employee's enrolled face, attendance records, and sales records from Firebase.`);
 if(!ok)return;
 try{
   if(window.BigGuysCloud?.deleteEmployee){
     state=await window.BigGuysCloud.deleteEmployee(id);
   }else{
     state.employees=state.employees.filter(e=>e.id!==id);
     state.attendance=state.attendance.filter(a=>a.employeeId!==id);
     state.sales=state.sales.filter(s=>s.employeeId!==id);
     delete state.faces[id];
     await save();
   }
   cacheState();
   refresh();
 }catch(err){
   console.error('Employee delete failed:',err);
   alert(`Employee could not be deleted from Firebase: ${err?.code||err?.message||err}`);
 }
}

function expenseItemsFor(date){
 const logged=state.sales.filter(s=>s.date===date&&Number(s.expense||0)>0);
 if(logged.length)return logged.map(s=>({category:'Other Expense',description:s.note||'Daily sales expense',amount:Number(s.expense||0),paymentMethod:'Cash',notes:`${s.time||''} • ${state.employees.find(e=>String(e.id)===String(s.employeeId))?.name||s.employeeId}`}));
 const r=state.dailyReports?.[date]||{};return Array.isArray(r.expenseItems)?r.expenseItems:[];
}
function totalExpensesForDate(date){
 const logged=state.sales.filter(s=>s.date===date);
 if(logged.length)return logged.reduce((t,x)=>t+Number(x.expense||0),0);
 return Number((state.dailyReports?.[date]||{}).expenses||0);
}
function totalRemittanceForDate(date){return state.sales.filter(s=>s.date===date).reduce((t,x)=>t+Number(x.remittance||0),0);}
function reportDates(){
 const dates=new Set();state.sales.forEach(s=>{if(s.date)dates.add(s.date)});Object.keys(state.dailyReports||{}).forEach(d=>dates.add(d));return [...dates].sort().reverse();
}
function salesForDate(date){return state.sales.filter(x=>x.date===date)}
function dailyFinancials(date){
 const rows=salesForDate(date),totalSale=rows.reduce((t,x)=>t+Number(x.amount||0),0),expenses=totalExpensesForDate(date),cashRemitted=totalRemittanceForDate(date);
 const legacy=state.dailyReports?.[date]||{};const legacyCash=Number(legacy.cash||0);const cash=rows.length?totalSale:legacyCash;
 const expected=totalSale-expenses,difference=cashRemitted-expected,hasRemitted=rows.some(x=>x.remittance!==undefined&&x.remittance!==null)||legacy.cashRemitted!==undefined;
 return {totalSale,cash,expenses,cashRemitted,expected,difference,short:difference<0?Math.abs(difference):0,over:difference>0?difference:0,hasRemitted};
}
async function saveReportRecord(date,patch){
 const current=state.dailyReports?.[date]||{};
 const report={...current,...patch,date};
 try{
   if(window.BigGuysCloud?.saveDailyReport) state=await window.BigGuysCloud.saveDailyReport(date,report); else {state.dailyReports[date]=report;state=await save();}
   cacheState();
   return report;
 }catch(err){console.error(err);alert(`Report cloud save failed: ${err?.code||err?.message||err}`);throw err;}
}
function periodDates(mode,selected){
 const prefix=mode==="yearly"?selected.slice(0,4):selected.slice(0,7);
 return reportDates().filter(date=>date.startsWith(prefix));
}
function periodFinancials(mode,period){
 const dates=reportDates().filter(date=>mode==="yearly"?date.startsWith(period):date.startsWith(period));
 let totalSale=0,cash=0,expenses=0,cashRemitted=0,short=0,over=0,payroll=0,remittedCount=0;
 dates.forEach(date=>{
   const f=dailyFinancials(date);totalSale+=f.totalSale;cash+=f.cash;expenses+=f.expenses;
   if(f.hasRemitted){cashRemitted+=f.cashRemitted;remittedCount++;short+=f.short;over+=f.over;}
   state.employees.forEach(e=>{if(state.attendance.some(a=>a.date===date&&a.employeeId===e.id))payroll+=pay(e,date)});
 });
 return {totalSale,cash,expenses,cashRemitted,short,over,payroll,remittedCount,net:totalSale-expenses-payroll};
}
function reportSalesSet(mode,date){
 if(mode==="daily")return salesForDate(date);
 const prefix=mode==="monthly"?date.slice(0,7):date.slice(0,4);
 return state.sales.filter(s=>String(s.date||"").startsWith(prefix));
}
function reportPeriodLabel(mode,date){return mode==="daily"?date:mode==="monthly"?date.slice(0,7):date.slice(0,4)}
function sumSales(rows){return rows.reduce((t,x)=>t+Number(x.amount||0),0)}
function breakdownHTML(items,emptyText="No records yet."){
 if(!items.length)return `<p class="muted">${emptyText}</p>`;
 const total=items.reduce((t,x)=>t+Number(x.value||0),0)||1;
 return `<div class="breakdown-list">${items.slice(0,8).map(x=>{const pct=(Number(x.value||0)/total*100);return `<div class="breakdown-row"><div><span>${x.label}</span><b>${money(x.value)}</b></div><div class="breakdown-track"><i style="width:${Math.max(2,pct)}%"></i></div><small>${pct.toFixed(0)}%</small></div>`}).join("")}</div>`;
}
function renderReportSummary(f,rows){
 const tx=rows.length, cars=rows.filter(x=>String(x.category||"").toLowerCase()==="carwash"||(!x.category&&/carwash|wash/i.test(x.note||""))).length;
 const commission=rows.reduce((t,s)=>{const e=state.employees.find(x=>String(x.id)===String(s.employeeId));return t+(e?commissionFor(e,s.date):0)},0);
 const cards=[
  ['Total Sales',money(f.totalSale),'blue'],
  ['Cash Sales',money(f.cash||0),'green'],
  ['Expenses',money(f.expenses),'red'],
  ['Cash Remaining',money(f.totalSale-f.expenses),'gold'],
  ['Transactions',tx,'blue'],
  ['Total Payroll',money(f.payroll||0),'purple'],
  ['Total Commission',money(commission),'red'],
  ['Cars Washed',cars,'blue'],
  ['Short',money(f.short||0),'red'],
  ['Over',money(f.over||0),'green']
 ];
 $("reportSummaryCards").innerHTML=cards.map(c=>`<div class="report-summary-card report-${c[2]}"><span>${c[0]}</span><b>${c[1]}</b></div>`).join("");
}
function renderReports(mode){
 currentReportView=mode;const date=$("reportDate")?.value||today();if($("reportDate"))$("reportDate").value=date;
 const rows=reportSalesSet(mode,date);let f;if(mode==='daily')f=dailyFinancials(date);else f=periodFinancials(mode,mode==='monthly'?date.slice(0,7):date.slice(0,4));
 renderReportSummary(f,rows);
 const service={};rows.forEach(s=>{const key=s.category||(/detail/i.test(s.note||'')?'Detailing':/wax/i.test(s.note||'')?'Wax':/interior/i.test(s.note||'')?'Interior':/add/i.test(s.note||'')?'Add-ons':/carwash|wash/i.test(s.note||'')?'Carwash':'Other');service[key]=(service[key]||0)+Number(s.amount||0)});
 const payments={};rows.forEach(s=>{const key='Cash Remitted';payments[key]=(payments[key]||0)+Number(s.remittance||0)});
 $("reportSalesBreakdown").innerHTML=breakdownHTML(Object.entries(service).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value));
 $("reportPaymentBreakdown").innerHTML=breakdownHTML(Object.entries(payments).map(([label,value])=>({label,value})),"No remittance records yet.");
 $("reportTableTitle").textContent=mode==='daily'?'Daily Sales Transactions':mode==='monthly'?'Monthly Sales Transactions':'Yearly Sales Transactions';
 $("reportTableSubtitle").textContent=mode==='daily'?`Selected date: ${date}`:mode==='monthly'?`Selected month: ${date.slice(0,7)}`:`Selected year: ${date.slice(0,4)}`;
 let tableRows;
 if(mode==='daily'){
   tableRows=rows.slice().sort((a,b)=>String(b.time||'').localeCompare(String(a.time||''))).map(s=>{
     const expected=Number(s.amount||0)-Number(s.expense||0),variance=Number(s.remittance||0)-expected;
     return[s.time||'—',state.employees.find(e=>String(e.id)===String(s.employeeId))?.name||s.employeeId,money(s.amount),money(s.expense||0),money(expected),money(s.remittance||0),variance<0?`<span class="cash-short">Short ${money(Math.abs(variance))}</span>`:variance>0?`<span class="cash-over">Over ${money(variance)}</span>`:'—',s.note||'—'];
   });
 } else {
   const prefix=mode==='monthly'?date.slice(0,7):date.slice(0,4);
   const periods=new Set(rows.map(s=>String(s.date||'').slice(0,mode==='monthly'?7:4)));
   tableRows=[...periods].sort().reverse().map(period=>{
     const rr=rows.filter(s=>String(s.date||'').startsWith(prefix)&&String(s.date||'').slice(0,mode==='monthly'?7:4)===period);
     const gross=sumSales(rr),exp=rr.reduce((t,s)=>t+Number(s.expense||0),0),expected=gross-exp,rem=rr.reduce((t,s)=>t+Number(s.remittance||0),0),variance=rem-expected;
     return[period,rr.length,money(gross),money(exp),money(expected),money(rem),variance<0?`<span class="cash-short">Short ${money(Math.abs(variance))}</span>`:variance>0?`<span class="cash-over">Over ${money(variance)}</span>`:'—'];
   });
 }
 $("reportOutput").innerHTML=table(tableRows,mode==='daily'?["Time","Employee","Sales","Expenses","Expected Remittance","Remitted","Over / Short","Note"]:[mode==='monthly'?"Month":"Year","Transactions","Total Sales","Expenses","Expected Remittance","Remitted","Over / Short"]);
 renderMonthlyEmployeeSales(date,mode);
}
function renderMonthlyEmployeeSales(date,mode){
 const month=mode==='monthly'?date.slice(0,7):mode==='yearly'?date.slice(0,4):date.slice(0,7);
 const rows=state.employees.map(e=>{
   const empSales=state.sales.filter(s=>String(s.employeeId)===String(e.id)&&String(s.date||'').startsWith(month));
   const sales=empSales.reduce((t,s)=>t+Number(s.amount||0),0),remitted=empSales.reduce((t,s)=>t+Number(s.remittance||0),0),expenses=empSales.reduce((t,s)=>t+Number(s.expense||0),0);
   const dates=[...new Set(state.attendance.filter(a=>String(a.employeeId)===String(e.id)&&String(a.date||'').startsWith(month)).map(a=>a.date))];
   const commission=dates.reduce((t,d)=>t+state.sales.filter(s=>String(s.employeeId)===String(e.id)&&s.date===d).reduce((z,s)=>{const a=state.attendance.find(x=>String(x.employeeId)===String(e.id)&&x.date===d);return z+(a&&isWorkedAttendance(a)?Number(s.amount||0)*effectiveCommissionRate(e,s.date,a.status):0)},0),0);
   const payroll=dates.reduce((t,d)=>t+pay(e,d),0);
   return[e.name,e.type,money(sales),money(expenses),money(remitted),money(commission),money(payroll)]
 }).filter(r=>Number(String(r[2]).replace(/[^0-9.-]/g,''))>0||Number(String(r[4]).replace(/[^0-9.-]/g,''))>0||Number(String(r[6]).replace(/[^0-9.-]/g,''))>0).sort((a,b)=>Number(String(b[2]).replace(/[^0-9.-]/g,''))-Number(String(a[2]).replace(/[^0-9.-]/g,'')));
 $("reportMonthlyEmployees").innerHTML=rows.length?table(rows,["Employee","Type","Accumulated Sales","Expenses","Total Remitted","Commission","Payroll"]):'<p class="muted">No employee sales for this period.</p>';
}
function renderExpenseList(date){return;}
function renderBusinessSummary(){
 const dates=reportDates();const all=state.sales;const expenses=dates.reduce((t,d)=>t+totalExpensesForDate(d),0);const payroll=dates.reduce((t,d)=>t+state.employees.reduce((z,e)=>z+(state.attendance.some(a=>a.date===d&&a.employeeId===e.id)?pay(e,d):0),0),0);const f={totalSale:sumSales(all),cash:dates.reduce((t,d)=>t+Number(state.dailyReports?.[d]?.cash||0),0),expenses,cashRemitted:dates.reduce((t,d)=>t+Number(state.dailyReports?.[d]?.cashRemitted||0),0),payroll};renderReportSummary(f,all);$("reportSalesBreakdown").innerHTML=breakdownHTML(Object.entries(all.reduce((o,s)=>{const k=s.category||(/detail/i.test(s.note||"")?'Detailing':/wax/i.test(s.note||"")?'Wax':/carwash|wash/i.test(s.note||"")?'Carwash':'Other');o[k]=(o[k]||0)+Number(s.amount||0);return o},{})).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value));$("reportPaymentBreakdown").innerHTML=breakdownHTML(Object.entries(all.reduce((o,s)=>{const k=s.paymentMethod||'Cash';o[k]=(o[k]||0)+Number(s.amount||0);return o},{})).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value));$("reportTableTitle").textContent='Business Summary';$("reportTableSubtitle").textContent='All available business records';$("reportOutput").innerHTML=table(dates.map(d=>{const x=dailyFinancials(d);return[d,money(x.totalSale),money(x.expenses),money(x.cashRemitted),x.hasRemitted&&x.short?money(x.short):'—',x.hasRemitted&&x.over?money(x.over):'—']}),["Date","Sales","Expenses","Remitted","Short","Over"]);renderExpenseList(date);}
function renderEmployeeReport(){
 const rows=state.employees.map(e=>{const sales=sumSales(state.sales.filter(s=>String(s.employeeId)===String(e.id)));const days=state.attendance.filter(a=>String(a.employeeId)===String(e.id)).length;const commission=state.sales.filter(s=>String(s.employeeId)===String(e.id)).reduce((t,s)=>{const a=state.attendance.find(x=>x.employeeId===s.employeeId&&x.date===s.date);return t+(a&&isWorkedAttendance(a)?Number(s.amount||0)*effectiveCommissionRate(e,s.date,a.status):0)},0);return[e.id,e.name,money(sales),days,money(commission)]});$("reportSummaryCards").innerHTML=`<div class="report-summary-card report-blue"><span>Total Employees</span><b>${state.employees.length}</b></div><div class="report-summary-card report-green"><span>Employees With Sales</span><b>${new Set(state.sales.map(s=>String(s.employeeId))).size}</b></div><div class="report-summary-card report-purple"><span>Total Sales</span><b>${money(sumSales(state.sales))}</b></div><div class="report-summary-card report-gold"><span>Total Commission</span><b>${money(rows.reduce((t,r)=>t+Number(String(r[4]).replace(/[^0-9.-]/g,'')),0))}</b></div>`;$("reportSalesBreakdown").innerHTML='<p class="muted">Employee performance is calculated from actual sales and attendance.</p>';$("reportPaymentBreakdown").innerHTML='<p class="muted">Select a date/report period for payment breakdown.</p>';$("reportTableTitle").textContent='Employee Performance';$("reportTableSubtitle").textContent='Sales, attendance and commission';$("reportOutput").innerHTML=table(rows,["ID","Employee","Sales","Attendance Days","Commission"]);renderExpenseList($("reportDate")?.value||today());}
let currentReportView='daily';
function makeReport(mode){if(mode==='business')renderBusinessSummary();else if(mode==='employee')renderEmployeeReport();else renderReports(mode);}

function salesDateRows(mode,date){
 if(mode==='daily')return salesForDate(date);
 const prefix=mode==='monthly'?date.slice(0,7):date.slice(0,4);return state.sales.filter(s=>String(s.date||'').startsWith(prefix));
}
function renderSalesExpenseSummary(date){
 const gross=sumSales(salesForDate(date));
 const expenses=totalExpensesForDate(date);
 const net=gross-expenses;
 const el=$("salesExpenseSummary");
 if(el)el.innerHTML=`<div><span>Gross Sales</span><b>${money(gross)}</b></div><div><span>Expenses</span><b class="expense-value">− ${money(expenses)}</b></div><div><span>Net / Expected Remittance</span><b>${money(net)}</b></div>`;
}
function renderSalesPage(mode='daily'){
 const date=$("salesViewDate")?.value||today();if($("salesViewDate"))$("salesViewDate").value=date;
 const rows=salesForDate(date),total=sumSales(rows),expenses=totalExpensesForDate(date),remitted=totalRemittanceForDate(date),net=total-expenses;
 if($("salesHistoryLabel"))$("salesHistoryLabel").textContent=`${date} • ${rows.length} transaction${rows.length===1?'':'s'}`;
 const variance=remitted-net;
 if($("salesExpenseSummary"))$("salesExpenseSummary").innerHTML=`<div><span>Total Sales</span><b>${money(total)}</b></div><div><span>Other Expenses</span><b class="expense-value">− ${money(expenses)}</b></div><div><span>Expected Remittance</span><b>${money(net)}</b></div><div><span>Total Remitted</span><b>${money(remitted)}</b></div><div><span>Over / Short</span><b class="${variance<0?'cash-short':variance>0?'cash-over':''}">${variance<0?'Short ':variance>0?'Over ':''}${money(Math.abs(variance))}</b></div>`;
 if($("salesTable"))$("salesTable").innerHTML=rows.length?table(rows.slice().reverse().map(s=>{const expected=Number(s.amount||0)-Number(s.expense||0),v=Number(s.remittance||0)-expected;return[s.time||'—',state.employees.find(e=>String(e.id)===String(s.employeeId))?.name||s.employeeId,money(s.amount),money(s.expense||0),money(expected),money(s.remittance||0),v<0?`<span class="cash-short">Short ${money(Math.abs(v))}</span>`:v>0?`<span class="cash-over">Over ${money(v)}</span>`:'—',s.category||'—'];}),["Date/Time","Employee","Sales","Expenses","Expected","Remitted","Over / Short","Service"]):'<p class="muted">No sales logged for this date.</p>';
}
function exportCurrentTable(kind){const source=kind==='sales'?$("salesPeriodTable")||$("salesRecentTransactions"):$("reportOutput");const tableEl=source?.querySelector('table');if(!tableEl){alert('No table data to export.');return;}const csv=[...tableEl.rows].map(r=>[...r.cells].map(c=>'"'+c.textContent.replace(/"/g,'""')+'"').join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`big-guys-${kind}-${today()}.csv`;a.click();URL.revokeObjectURL(url);}
$("dtrEmployeeSelect")?.addEventListener("change",e=>{selectedDtrEmployeeId=e.target.value||"";renderEmployeeDtr(selectedDtrEmployeeId);});
$("payrollMonth")?.addEventListener("change",renderPayroll);
$("salesViewDate")?.addEventListener("change",()=>renderSalesPage("daily"));
$("attendanceDate")?.addEventListener("change",()=>renderAttendanceAdmin(attendanceDateValue()));
$("settingsEmployee")?.addEventListener("change",renderSettings);
$("saveOffDays")?.addEventListener("click",saveEmployeeOffDays);

$("reportDate").value=today();
$("salesViewDate").value=today();
if($("attendanceDate"))$("attendanceDate").value=today();
renderSettings();
ensureAutomaticAbsences();
let salesDayKey=today();setInterval(()=>{const d=today();if(d!==salesDayKey){salesDayKey=d;ensureAutomaticAbsences();if($("salesViewDate"))$("salesViewDate").value=d;if(!$('sales').classList.contains('hidden'))renderSalesPage('daily');}},1000);
$("payrollMonth").value=today().slice(0,7);

function startClock(){
 const tick=()=>{const n=new Date();const time=n.toLocaleTimeString("en-PH",{hour:"numeric",minute:"2-digit",second:"2-digit"});const date=n.toLocaleDateString("en-PH",{weekday:"long",month:"long",day:"numeric",year:"numeric"});const day=n.toLocaleDateString("en-PH",{weekday:"long"});const long=n.toLocaleDateString("en-PH",{month:"long",day:"numeric",year:"numeric"});if($("digitalClock"))$("digitalClock").textContent=time;if($("rightDate"))$("rightDate").textContent=date;if($("headerDay"))$("headerDay").textContent=day;if($("headerDate"))$("headerDate").textContent=long};tick();clearInterval(window.bigGuysClock);window.bigGuysClock=setInterval(tick,1000);
}
function activateTab(tab){
 document.querySelectorAll(".side-nav[data-tab]").forEach(x=>x.classList.toggle("active",x.dataset.tab===tab));
 document.querySelectorAll(".tab-panel").forEach(x=>x.classList.add("hidden"));
 const panel=$(tab);if(panel)panel.classList.remove("hidden");
 if(tab!=="sales")document.getElementById("salesSubnav")?.classList.remove("open");
 if(tab==="attendance")renderAttendanceAdmin(attendanceDateValue());
 if(tab==="settings")renderSettings();
 document.getElementById("adminSidebar")?.classList.remove("open");
}
document.querySelectorAll(".side-nav[data-tab]").forEach(btn=>btn.addEventListener("click",(ev)=>{ev.preventDefault();if(btn.id==="salesNav"){const sub=document.getElementById("salesSubnav");sub?.classList.toggle("open");activateTab("sales");}else activateTab(btn.dataset.tab)}));
document.querySelectorAll("[data-tab-target]").forEach(btn=>btn.addEventListener("click",(ev)=>{ev.preventDefault();activateTab(btn.dataset.tabTarget)}));
document.querySelectorAll("[data-sales-mode]").forEach(btn=>btn.addEventListener("click",(ev)=>{ev.preventDefault();activateTab("sales");renderSalesPage("daily");}));

document.querySelectorAll('[data-report-view]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-report-view]').forEach(b=>b.classList.toggle('active',b===btn));makeReport(btn.dataset.reportView);}));

$("reportDate")?.addEventListener('change',()=>makeReport(currentReportView));
$("salesAddQuick")?.addEventListener('click',()=>document.getElementById('saleAmount')?.focus());
$("salesExportBtn")?.addEventListener('click',()=>exportCurrentTable('sales'));
$("reportExportBtn")?.addEventListener('click',()=>exportCurrentTable('report'));

$("reportPrintBtn")?.addEventListener('click',()=>window.print());$("salesPrintBtn")?.addEventListener('click',()=>window.print());

window.addEventListener("storage",()=>{syncStateFromStorage();if(!document.getElementById("dashboard")?.classList.contains("hidden"))refresh()});
window.addEventListener("bigguys:cloud-state",ev=>{const remote=ev.detail;if(!remote)return;state=remote;cacheState();if(!document.getElementById("dashboard")?.classList.contains("hidden"))refresh();});
async function initCloud(){ if(window.BigGuysCloud){ await window.BigGuysCloud.init(state,remote=>{ state=remote; cacheState(); if(!document.getElementById("dashboard")?.classList.contains("hidden"))refresh(); }); } }
setInterval(()=>{if(!document.getElementById("dashboard")?.classList.contains("hidden")){refresh()}},2000); window.addEventListener("load",initCloud);
$("salesChartPeriod")?.addEventListener("change",refreshDashboardCharts);$("carwashChartPeriod")?.addEventListener("change",refreshDashboardCharts);
$("mobileMenu")?.addEventListener("click",()=>$("adminSidebar")?.classList.toggle("open"));
document.addEventListener("click",ev=>{const side=$("adminSidebar"),btn=$("mobileMenu");if(window.innerWidth<=950&&side?.classList.contains("open")&&!side.contains(ev.target)&&!btn?.contains(ev.target))side.classList.remove("open");});

setInterval(()=>{const el=$("cloudStatus");if(!el)return;const c=window.BIGGUYS_CLOUD||{};if(c.ready&&c.lastSyncError)el.textContent="Cloud sync: ERROR — "+(c.lastSyncError.message||"write/read failed");else if(c.ready)el.textContent="Cloud sync: CONNECTED to Firebase";else if(c.status==="error")el.textContent="Cloud sync: ERROR — "+(c.error?.message||c.lastSyncError?.message||"Firebase connection failed");else if(c.status==="authenticated")el.textContent="Cloud sync: authenticated — starting Firestore…";else el.textContent=window.BigGuysCloud?.configured?"Cloud sync: waiting for Admin login":"Cloud sync: local mode";},1000);
