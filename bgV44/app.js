const KEY="bigguys_dtr_v2";
const MODEL_URLS=["https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights","https://justadudewhohacks.github.io/face-api.js/models"];
let state=JSON.parse(localStorage.getItem(KEY)||'{"employees":[],"attendance":[],"sales":[],"faces":{}}');
let stream=null, modelsReady=false, recognizedEmployee=null, scanning=false, validSince=0, captureBusy=false, recordBusy=false, recognitionToastTimer=null, nextRecognitionAt=0;
const $=id=>document.getElementById(id);
const cacheState=()=>{const c={...state,faces:{},lastFaceCapture:null};try{localStorage.setItem(KEY,JSON.stringify(c));}catch(e){console.warn("Local cache skipped:",e);}};
const save=()=>{cacheState(); if(window.BIGGUYS_CLOUD?.ready) window.BigGuysCloud.push(state).catch(console.warn);};
const LAST_CAPTURE_KEY="bigguys_last_face_capture";
const CAPTURE_HOLD_MS=500;
let attendanceCooldownUntil=0;
const today=()=>{const n=new Date();const y=n.getFullYear(),m=String(n.getMonth()+1).padStart(2,"0"),d=String(n.getDate()).padStart(2,"0");return `${y}-${m}-${d}`};
const timeNow=()=>new Date().toTimeString().slice(0,8);
const minutes=t=>{const [h,m]=t.split(":").map(Number);return h*60+m};
function findTodayAttendance(employeeId,date=today()){
 const rows=(state.attendance||[]).filter(a=>String(a.employeeId)===String(employeeId)&&a.date===date&&(a.clockIn||a.clockOut));
 return rows.sort((a,b)=>String(a.clockInAt||a.clockIn||"").localeCompare(String(b.clockInAt||b.clockIn||"")))[0]||null;
}
function tick(){const n=new Date();$("liveTime").textContent=n.toLocaleTimeString("en-PH",{hour12:true});$("liveDate").textContent=n.toLocaleDateString("en-PH",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}
setInterval(tick,1000);tick();
function setOval(status){const oval=$("ovalFrame");oval.classList.remove("oval-red","oval-green");oval.classList.add(status==="good"?"oval-green":"oval-red")}
function resetRecognition(message="Place your face inside the oval."){recognizedEmployee=null;validSince=0;captureBusy=false;if(recognitionToastTimer){clearTimeout(recognitionToastTimer);recognitionToastTimer=null;}$("cameraStatus").textContent=message;$("recognized").classList.add("hidden");$("timeIn").disabled=true;$("timeOut").disabled=true}
async function loadModels(){
 if(modelsReady)return true;
 if(typeof faceapi==="undefined"){$("cameraStatus").textContent="Face recognition library did not load. Refresh the page.";setOval("bad");return false}
 $("cameraStatus").textContent="Loading face recognition…";
 for(const url of MODEL_URLS){try{await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(url),faceapi.nets.faceLandmark68TinyNet.loadFromUri(url),faceapi.nets.faceRecognitionNet.loadFromUri(url)]);modelsReady=true;return true}catch(err){console.warn("Face model source failed:",url,err)}}
 $("cameraStatus").textContent="Face recognition model could not load. Check your internet connection and refresh.";setOval("bad");return false;
}
async function startCamera(){
 if(!await loadModels())return;
 try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:720},height:{ideal:720}},audio:false});$("camera").srcObject=stream;$("cameraStatus").textContent="Scanning live — place one face inside the red oval.";setOval("bad");scanLoop()}catch(err){console.error(err);$("cameraStatus").textContent="Camera permission is required.";setOval("bad")}
}
function normalizeFaceRecords(value){
 if(!value)return [];
 if(Array.isArray(value)&&value.length&&Array.isArray(value[0]))return value;
 if(Array.isArray(value)&&value.length&&value.every(x=>x&&typeof x==="object"&&Array.isArray(x.values)))return value.map(x=>x.values);
 if(Array.isArray(value))return [value];
 return [];
}
function faceDistance(a,b){let sum=0;for(let i=0;i<a.length;i++){const d=a[i]-b[i];sum+=d*d}return Math.sqrt(sum)}
function faceIsInsideOval(d){
 const video=$("camera"),w=video.videoWidth||720,h=video.videoHeight||720,box=d.detection.box;
 const cx=(box.x+box.width/2)/w,cy=(box.y+box.height/2)/h;
 const rx=.23,ry=.40,ellipse=((cx-.5)**2)/(rx**2)+((cy-.50)**2)/(ry**2);
 const faceHeight=box.height/h,faceWidth=box.width/w;
 return ellipse<=1&&faceHeight>=.22&&faceHeight<=.82&&faceWidth>=.14&&faceWidth<=.72;
}
function bestEmployee(descriptor){
 let best=null,bestDistance=Infinity;
 const employeesById=new Map();
 (state.employees||[]).forEach(e=>{
   const id=String(e?.id||e?.employeeId||'').trim();
   if(id)employeesById.set(id,e);
 });
 const faceEntries=Object.entries(state.faces||{});
 for(const [faceEmployeeId,rawRecords] of faceEntries){
   const key=String(faceEmployeeId||'').trim();
   // Firebase face records are keyed by the employee ID. Keep the lookup strict
   // so one employee's face can never be assigned to another employee.
   const employee=employeesById.get(key);
   if(!employee)continue;
   const records=normalizeFaceRecords(rawRecords);
   for(const stored of records){
     if(!Array.isArray(stored)||stored.length!==128)continue;
     const d=faceDistance(Array.from(descriptor),stored);
     if(d<bestDistance){bestDistance=d;best=employee;}
   }
 }
 return {employee:best,distance:bestDistance};
}
function saveFaceSnapshot(employee,detection){
 try{
  const video=$("camera"),oval=$("ovalFrame");
  const vr=video.getBoundingClientRect(),or=oval.getBoundingClientRect();
  const vw=video.videoWidth||720,vh=video.videoHeight||720,dw=vr.width||video.clientWidth||720,dh=vr.height||video.clientHeight||430;
  const scale=Math.max(dw/vw,dh/vh),rw=vw*scale,rh=vh*scale,ox=(dw-rw)/2,oy=(dh-rh)/2;
  const x=or.left-vr.left,y=or.top-vr.top,w=or.width,h=or.height;
  const sx=Math.max(0,(x-ox)/scale),sy=Math.max(0,(y-oy)/scale),ex=Math.min(vw,(x+w-ox)/scale),ey=Math.min(vh,(y+h-oy)/scale);
  const sw=Math.max(1,ex-sx),sh=Math.max(1,ey-sy),canvas=document.createElement("canvas");
  canvas.width=360;canvas.height=Math.max(420,Math.round(360*sh/sw));
  const ctx=canvas.getContext("2d");ctx.save();ctx.translate(canvas.width,0);ctx.scale(-1,1);ctx.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height);ctx.restore();
  const snap={employeeId:employee.id,name:employee.name,dataUrl:canvas.toDataURL("image/jpeg",.88),capturedAt:new Date().toISOString()}; localStorage.setItem(LAST_CAPTURE_KEY,JSON.stringify(snap)); state.lastFaceCapture=snap; if(window.BigGuysCloud?.saveAttendanceSnapshot){ window.BigGuysCloud.saveAttendanceSnapshot(snap).catch(console.warn); }
 }catch(err){console.warn("Could not save face snapshot",err)}
}
function updateAttendanceControls(employee){
 const date=today();
 const attendance=findTodayAttendance(employee.id,date);
 const statusEl=$("attendanceStatus");
 const timeInBtn=$("timeIn"),timeOutBtn=$("timeOut");
 if(!attendance){
  statusEl.textContent="● NOT SIGNED IN — TIME IN AVAILABLE";
  statusEl.className="attendance-status not-signed";
  timeInBtn.disabled=false; timeOutBtn.disabled=true;
  return null;
 }
 if(attendance.clockOut){
  statusEl.textContent=`✓ SIGNED OUT — TIME IN ${attendance.clockIn||"—"} • TIME OUT ${attendance.clockOut}`;
  statusEl.className="attendance-status signed-out";
  timeInBtn.disabled=true; timeOutBtn.disabled=true;
  return attendance;
 }
 statusEl.textContent=`✓ SIGNED IN — TIME IN ${attendance.clockIn||"—"} • TIME OUT AVAILABLE`;
 statusEl.className="attendance-status signed-in";
 timeInBtn.disabled=true; timeOutBtn.disabled=false;
 return attendance;
}

async function verifyFace(detection){
 const match=bestEmployee(detection.descriptor);
 if(match.employee&&match.distance<=.60){
  recognizedEmployee=match.employee;
  nextRecognitionAt=performance.now()+2000;
  saveFaceSnapshot(match.employee,detection);
  $("employeeName").textContent=match.employee.name;
  $("employeeId").textContent=match.employee.id;
  $("recognized").classList.remove("hidden");
  if(recognitionToastTimer) clearTimeout(recognitionToastTimer);
  recognitionToastTimer=setTimeout(()=>{
    $("recognized").classList.add("hidden");
    recognitionToastTimer=null;
  },2000);
  const current=updateAttendanceControls(match.employee);
  $("cameraStatus").textContent=current?.clockOut?`✓ ${match.employee.name} already completed TIME IN and TIME OUT today.`:current?.clockIn?`✓ ${match.employee.name} is already SIGNED IN — TIME OUT is available.`:`✓ ${match.employee.name} recognized — TIME IN is available.`;
  setOval("good");
 }else{resetRecognition(match.employee?`Face detected, but match is not strong enough (${match.distance.toFixed(2)}). Look straight at the camera.`:"Face captured, but this employee is not enrolled.");setOval("bad")}
}
async function scanLoop(){
 if(scanning||!modelsReady)return;scanning=true;
 try{
  const video=$("camera");
  if(video.readyState<2){$("cameraStatus").textContent="Starting live face scan…";return}
  if(performance.now()<attendanceCooldownUntil){
    setOval("bad");
    $("cameraStatus").textContent="🔴 Ready — place the next face inside the oval.";
    return;
  }
  const detection=await faceapi.detectSingleFace(video,new faceapi.TinyFaceDetectorOptions({inputSize:416,scoreThreshold:.45})).withFaceLandmarks(true).withFaceDescriptor();
  if(detection){
   if(faceIsInsideOval(detection)){
    setOval("good");
    if(performance.now()>=nextRecognitionAt){
      if(!validSince)validSince=performance.now();
      const held=performance.now()-validSince;
      if(held>=CAPTURE_HOLD_MS&&!captureBusy){
        captureBusy=true;
        $("cameraStatus").textContent="✓ Face position correct — capturing and verifying…";
        await verifyFace(detection);
      }else if(!captureBusy){
        $("cameraStatus").textContent=`✓ Face position correct — automatic capture in ${Math.max(0,(CAPTURE_HOLD_MS-held)/1000).toFixed(1)}s`;
      }
    }
   }else{
    validSince=0;captureBusy=false;
    if(performance.now()>=nextRecognitionAt){setOval("bad");$("cameraStatus").textContent="🔴 Keep your face centered inside the red oval."}
   }
  }else{
   if(performance.now()>=nextRecognitionAt){validSince=0;captureBusy=false;setOval("bad");$("cameraStatus").textContent="🔴 No clear face detected — place your face inside the oval."}
  }
 }catch(err){
  console.error("Face scan error:",err);
  if(performance.now()>=nextRecognitionAt){setOval("bad");$("cameraStatus").textContent="Face scan is retrying…"}
 }finally{scanning=false;setTimeout(scanLoop,120)}
}
function clearAfterAttendance(message){
 recognizedEmployee=null;
 validSince=0;
 captureBusy=false;
 if(recognitionToastTimer){clearTimeout(recognitionToastTimer);recognitionToastTimer=null;}
 attendanceCooldownUntil=performance.now()+300;
 nextRecognitionAt=performance.now()+300;
 $("recognized").classList.add("hidden");
 $("timeIn").disabled=true;
 $("timeOut").disabled=true;
 setOval("bad");
 $("cameraStatus").textContent=message||"🔴 Ready — place the next face inside the oval.";
}
function speakAttendance(message){
 try{
  if("speechSynthesis" in window){window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(message);u.lang="en-US";u.rate=.92;u.pitch=1;window.speechSynthesis.speak(u);}
 }catch(e){console.warn("Voice confirmation unavailable:",e)}
}
async function record(type){
 if(recordBusy)return;
 if(!recognizedEmployee){$("result").innerHTML='<div class="result late-result">Face not recognized.</div>';return}
 const employee=recognizedEmployee;
 const date=today(), nowDate=new Date(), now=timeNow(), iso=nowDate.toISOString();
 let attendance=findTodayAttendance(employee.id,date);
 recordBusy=true;
 $("timeIn").disabled=true; $("timeOut").disabled=true;
 try{
  if(type==="in"){
   if(attendance){
    updateAttendanceControls(employee);
    $("result").innerHTML=`<div class="result late-result">ALREADY SIGNED IN<br><br>${employee.name}<br>TIME IN: ${attendance.clockIn||"—"}</div>`;
    clearAfterAttendance("🔴 Already signed in — scan again for another employee.");
    recordBusy=false;
    return;
   }
   const diff=minutes(now)-minutes(employee.start),status=diff>0?"late":diff<0?"early":"ontime";
   attendance={id:`attendance_${String(employee.id).replace(/[^a-zA-Z0-9_-]/g,"_")}_${date}`,date,employeeId:employee.id,clockIn:now,clockInAt:iso,clockOut:null,clockOutAt:null,status,punchType:"in"};
   if(window.BigGuysCloud?.saveAttendance){ state=await window.BigGuysCloud.saveAttendance(attendance); cacheState(); } else { state.attendance=state.attendance||[]; state.attendance.push(attendance); save(); }
   const statusText=status==="late"?`🔴 LATE — ${diff} minutes late`:status==="early"?`🔵 EARLY — ${Math.abs(diff)} minutes early`:"ON TIME";
   $("result").innerHTML=`<div class="result ${status==="late"?"late-result":"success"}>✓ TIME IN RECORDED<br><br>${employee.name}<br>${now}<br><br>${statusText}</div>`;
   speakAttendance("Time in recorded.");
  }else{
   if(!attendance){
    $("result").innerHTML='<div class="result late-result">NOT SIGNED IN — TIME IN must be recorded first.</div>';
    clearAfterAttendance("🔴 Not signed in — scan again and choose TIME IN first.");
    recordBusy=false;
    return;
   }
   if(attendance.clockOut){
    $("result").innerHTML=`<div class="result late-result">ALREADY SIGNED OUT<br><br>${employee.name}<br>TIME OUT: ${attendance.clockOut}</div>`;
    clearAfterAttendance("🔴 Already signed out — scanning for the next employee…");
    recordBusy=false;
    return;
   }
   attendance.clockOut=now;
   attendance.clockOutAt=iso;
   attendance.punchType="out";
   if(window.BigGuysCloud?.saveAttendance){ state=await window.BigGuysCloud.saveAttendance(attendance); cacheState(); } else save();
   $("result").innerHTML=`<div class="result success">✓ TIME OUT RECORDED<br><br>${employee.name}<br>${now}</div>`;
   speakAttendance("Time out recorded.");
  }
 }catch(err){
  console.error("Attendance save failed:",err);
  $("result").innerHTML=`<div class="result late-result">ATTENDANCE WAS NOT SAVED<br><br>${err?.code||err?.message||err}</div>`;
  updateAttendanceControls(employee);
  recordBusy=false;
  return;
 }
 recordBusy=false;
 clearAfterAttendance("🔴 Attendance saved — scanning for the next employee…");
}
$("timeIn").onclick=()=>record("in");$("timeOut").onclick=()=>record("out");async function initCloud(){
 if(!window.BigGuysCloud)return false;
 const ok=await window.BigGuysCloud.init(state,remote=>{ state=remote; cacheState(); });
 if(!ok){
   const cloudErr=window.BIGGUYS_CLOUD?.lastSyncError;
   const code=cloudErr?.code||cloudErr?.message||"unknown Firebase error";
   console.error("DTR Firebase initialization failed:",cloudErr);
   $("cameraStatus").textContent=`Firebase could not load enrolled faces: ${code}`;
   setOval("bad");
   return false;
 }
 try{
   // Always fetch a fresh cloud state immediately before starting the scanner.
   // This prevents an empty/stale local cache from making an enrolled employee
   // appear as "not enrolled" on another device.
   if(window.BigGuysCloud.refresh){ state=await window.BigGuysCloud.refresh(); cacheState(); }
 }catch(err){
   console.error("Fresh face-record sync failed:",err);
   $("cameraStatus").textContent=`Firebase face records could not be loaded: ${err?.code||err?.message||err}`;
   setOval("bad");
   return false;
 }
 return true;
}
window.addEventListener("beforeunload",()=>stream?.getTracks().forEach(t=>t.stop()));
async function bootDTR(){
 if(!window.__DTR_ACCESS_UNLOCKED__)return;
 if(await initCloud())startCamera();
}
window.addEventListener("dtr-access-unlocked",bootDTR);
window.addEventListener("load",bootDTR);
