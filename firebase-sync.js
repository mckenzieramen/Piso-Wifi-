/* Big Guy's Carwash — scalable Firestore central source of truth.
   Large/repeating data is stored one record per Firestore document so the app
   does not hit the 1 MiB limit of a single aggregate document. localStorage
   is only a small offline cache; Firebase is authoritative. */
(function(){
  const cfg=window.BIGGUYS_FIREBASE_CONFIG||{};
  const configured=!!(cfg.apiKey&&cfg.authDomain&&cfg.projectId&&cfg.appId);
  let db=null,auth=null,readyPromise=null,unsubscribers=[],refreshTimer=null;
  const C={employees:'bigguys_employees',faces:'bigguys_faces',attendance:'bigguys_attendance',sales:'bigguys_sales',reports:'bigguys_reports'};
  const normalizeFaceRecord=value=>{
    if(!Array.isArray(value))return [];
    if(value.length&&value.every(x=>x&&typeof x==='object'&&!Array.isArray(x)&&Array.isArray(x.values)))return value.map(x=>x.values.map(Number));
    if(value.length&&value.every(x=>Array.isArray(x)))return value.map(x=>x.map(Number));
    if(value.length===128&&value.every(x=>Number.isFinite(Number(x))))return [value.map(Number)];
    return [];
  };
  const clean=s=>({
    employees:Array.isArray(s?.employees)?s.employees:[],
    attendance:Array.isArray(s?.attendance)?s.attendance:[],
    sales:Array.isArray(s?.sales)?s.sales:[],
    faces:s?.faces&&typeof s.faces==='object'&&!Array.isArray(s.faces)?s.faces:{},
    faceUpdatedAt:s?.faceUpdatedAt&&typeof s.faceUpdatedAt==='object'?s.faceUpdatedAt:{},
    dailyReports:s?.dailyReports&&typeof s.dailyReports==='object'?s.dailyReports:{},
    lastFaceCapture:s?.lastFaceCapture||null
  });
  const isAdmin=()=>!!(auth?.currentUser&&!auth.currentUser.isAnonymous);
  function status(extra){window.BIGGUYS_CLOUD=Object.assign({configured,ready:!!db,status:db?'connected':'waiting'},extra||{});}
  async function initFirebase(){
    if(!configured)throw new Error('Firebase configuration is missing.');
    if(!window.firebase)throw new Error('Firebase SDK did not load.');
    if(!firebase.apps.length)firebase.initializeApp(cfg);
    db=db||firebase.firestore(); auth=auth||firebase.auth();
  }
  async function ensureAuth(mode){
    if(!auth)auth=firebase.auth();
    if(auth.currentUser)return auth.currentUser;
    if(mode==='admin')throw new Error('Admin authentication required. Please log in first.');
    try{
      const result=await auth.signInAnonymously();
      if(!result?.user)throw new Error('anonymous-auth-failed: Firebase did not return an anonymous user.');
      return result.user;
    }catch(err){
      const code=err?.code||'unknown';
      const msg=err?.message||String(err);
      throw new Error(`DTR Firebase authentication failed (${code}). ${msg}`);
    }
  }
  async function getAll(col){const snap=await db.collection(col).get();return snap.docs.map(d=>({id:d.id,...(d.data()||{})}));}
  async function getDocSafe(path){const s=await db.doc(path).get();return s.exists?(s.data()||{}):{};}
  function objectFromDocs(rows){const o={};rows.forEach(r=>{if(r.id)o[r.id]=r;});return o;}
  async function readCloud(){
    if(!db)throw new Error('Firebase Firestore is not initialized.');
    const [employees,faces,attendance]=await Promise.all([getAll(C.employees),getAll(C.faces),getAll(C.attendance)]);
    let sales=[],reports=[];
    if(isAdmin()) [sales,reports]=await Promise.all([getAll(C.sales),getAll(C.reports)]);
    const faceMap={},faceTimes={};
    // Resolve each face document to the REAL employee ID. Some older records can
    // contain an employeeId field that is stale/mismatched while the Firestore
    // document ID is still the correct employee ID. Prefer whichever candidate
    // actually exists in the current employee collection. This keeps every face
    // enrollment unique to its employee and prevents DTR from saying
    // "employee not registered" when the face record itself exists.
    const employeeIdSet=new Set(employees.map(e=>String(e?.id||e?.employeeId||'').trim()).filter(Boolean));
    faces.forEach(r=>{
      const candidates=[r.employeeId,r.id].map(v=>String(v||'').trim()).filter(Boolean);
      const id=candidates.find(v=>employeeIdSet.has(v));
      if(!id)return;
      const samples=normalizeFaceRecord(r.samples);
      if(samples.length){faceMap[id]=samples;faceTimes[id]=r.updatedAtISO||r.faceUpdatedAt||null;}
    });
    const attendanceRows=attendance.map(r=>{const x={...r};delete x.id;return x;});
    const salesRows=sales.map(r=>{const x={...r};delete x.id;return x;});
    const reportMap={};reports.forEach(r=>{if(r.id){const x={...r};delete x.id;delete x.date;reportMap[r.date||r.id]=x;}});
    let lastFaceCapture=null;
    // Lightweight latest capture is optional and deliberately kept separate from history.
    try{const latest=await db.doc('bigguys_meta/attendance').get();if(latest.exists)lastFaceCapture=latest.data()?.lastFaceCapture||null;}catch(e){}
    return clean({employees:employees.map(x=>{const y={...x};if(!y.id)y.id=x.id;const enrolled=faceMap[String(y.id)]?.length>=5||y.faceEnrolled===true;y.faceEnrolled=!!enrolled;if(enrolled)y.faceSampleCount=faceMap[String(y.id)]?.length||Number(y.faceSampleCount||5);return y;}),attendance:attendanceRows,sales:salesRows,faces:faceMap,faceUpdatedAt:faceTimes,dailyReports:reportMap,lastFaceCapture});
  }
  async function migrateLegacyIfNeeded(initial){
    if(!isAdmin())return readCloud();
    const current=await readCloud();
    let migrationDone=false;
    try{const marker=await db.doc('bigguys_meta/migration').get();migrationDone=marker.exists&&marker.data()?.legacyMigrated===true;}catch(e){}
    const hasNew=current.employees.length||current.attendance.length||current.sales.length||Object.keys(current.faces).length||Object.keys(current.dailyReports).length;
    if(hasNew||migrationDone)return current;
    const [p,a,b]=await Promise.all([getDocSafe('bigguys/public'),getDocSafe('bigguys/attendance'),getDocSafe('bigguys/business')]);
    const legacy=clean({employees:p.employees,faces:p.faces,faceUpdatedAt:p.faceUpdatedAt,attendance:a.attendance,sales:b.sales,dailyReports:b.dailyReports,lastFaceCapture:a.lastFaceCapture});
    const source=legacy.employees.length||legacy.attendance.length||legacy.sales.length||Object.keys(legacy.faces).length||Object.keys(legacy.dailyReports).length?legacy:clean(initial);
    if(!source.employees.length&&!source.attendance.length&&!source.sales.length&&!Object.keys(source.faces).length&&!Object.keys(source.dailyReports).length)return current;
    await writeStateRecords(source);
    await db.doc('bigguys_meta/migration').set({legacyMigrated:true,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    return readCloud();
  }
  async function writeStateRecords(s){
    const batch=db.batch(),stamp=firebase.firestore.FieldValue.serverTimestamp();
    for(const e of s.employees||[]){if(!e?.id)continue;batch.set(db.doc(`${C.employees}/${e.id}`),{...e,updatedAt:stamp},{merge:true});}
    for(const a of s.attendance||[]){if(!a?.id)continue;batch.set(db.doc(`${C.attendance}/${a.id}`),{...a,updatedAt:stamp},{merge:true});}
    for(const sale of s.sales||[]){if(!sale?.id)continue;batch.set(db.doc(`${C.sales}/${sale.id}`),{...sale,updatedAt:stamp},{merge:true});}
    for(const [date,r] of Object.entries(s.dailyReports||{})){batch.set(db.doc(`${C.reports}/${date}`),{...r,date,updatedAt:stamp},{merge:true});}
    for(const [id,vals] of Object.entries(s.faces||{})){const samples=normalizeFaceRecord(vals);if(samples.length)batch.set(db.doc(`${C.faces}/${id}`),{employeeId:id,samples:samples.map(values=>({values})),updatedAtISO:s.faceUpdatedAt?.[id]||new Date().toISOString(),updatedAt:stamp},{merge:true});}
    await batch.commit();
    if(s.lastFaceCapture)await db.doc('bigguys_meta/attendance').set({lastFaceCapture:s.lastFaceCapture,updatedAt:stamp},{merge:true});
  }
  async function pushState(local){await initFirebase();if(!isAdmin())throw new Error('Admin authentication required.');await writeStateRecords(clean(local));const fresh=await readCloud();status({ready:true,status:'connected',lastSyncAt:new Date().toISOString(),lastSyncError:null});return fresh;}
  async function reserveEmployeeId(hireDate){
    await initFirebase();
    if(!isAdmin())throw new Error('Admin authentication required.');
    const m=/^(\d{4})-(\d{2})-\d{2}$/.exec(hireDate||'');
    if(!m)throw new Error('invalid-argument: valid hire date is required.');
    const prefix=m[1]+m[2];
    const seqRef=db.doc('bigguys_meta/employee_sequences');
    const employees=await getAll(C.employees);
    let cloudMax=0;
    employees.forEach(e=>{const id=String(e?.id||'');if(id.startsWith(prefix)){const n=Number(id.slice(prefix.length));if(Number.isFinite(n)&&n>cloudMax)cloudMax=n;}});
    const reserved=await db.runTransaction(async tx=>{
      const snap=await tx.get(seqRef);
      const data=snap.exists?(snap.data()||{}):{};
      const stored=Number(data[prefix]||0);
      const next=Math.max(stored,cloudMax)+1;
      tx.set(seqRef,{[prefix]:next,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
      return next;
    });
    return prefix+String(reserved).padStart(2,'0');
  }
  async function deleteEmployee(employeeId){
    await initFirebase();
    if(!isAdmin())throw new Error('Admin authentication required.');
    if(!employeeId)throw new Error('invalid-argument: employee ID is missing.');
    const batch=db.batch();
    batch.delete(db.doc(`${C.employees}/${employeeId}`));
    batch.delete(db.doc(`${C.faces}/${employeeId}`));
    const [attendance,sales]=await Promise.all([getAll(C.attendance),getAll(C.sales)]);
    attendance.filter(r=>String(r.employeeId)===String(employeeId)).forEach(r=>batch.delete(db.doc(`${C.attendance}/${r.id}`)));
    sales.filter(r=>String(r.employeeId)===String(employeeId)).forEach(r=>batch.delete(db.doc(`${C.sales}/${r.id}`)));
    await batch.commit();
    return readCloud();
  }
  async function saveEmployee(employee){await initFirebase();if(!isAdmin())throw new Error('Admin authentication required.');if(!employee?.id)throw new Error('invalid-argument: employee ID is missing.');await db.doc(`${C.employees}/${employee.id}`).set({...employee,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});return readCloud();}
  function serializeFaceSamples(samples){if(!Array.isArray(samples)||samples.length<5)throw new Error('invalid-argument: at least 5 face samples are required.');return samples.map((sample,i)=>{const a=Array.from(sample||[]);if(a.length!==128)throw new Error(`invalid-argument: face sample ${i+1} must contain 128 values.`);return a.map((n,j)=>{const v=Number(n);if(!Number.isFinite(v))throw new Error(`invalid-argument: face sample ${i+1}, value ${j+1} is not a finite number.`);return v;});});}
  async function saveFaceEnrollment(employeeId,samples){
    await initFirebase();if(!isAdmin())throw new Error('unauthenticated: Admin authentication required.');if(!employeeId)throw new Error('invalid-argument: employee ID is missing.');
    const serialized=serializeFaceSamples(samples);const ref=db.doc(`${C.faces}/${employeeId}`);const now=new Date().toISOString();
    const batch=db.batch();
    batch.set(ref,{employeeId:String(employeeId),samples:serialized.map(values=>({values})),updatedAtISO:now,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    const employeeRef=db.doc(`${C.employees}/${employeeId}`);
    batch.set(employeeRef,{faceEnrolled:true,faceSampleCount:serialized.length,faceUpdatedAt:now,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    await batch.commit();
    const [verify,employeeVerify]=await Promise.all([ref.get(),employeeRef.get()]);
    const saved=verify.exists?(verify.data()||{}):{};const emp=employeeVerify.exists?(employeeVerify.data()||{}):{};
    const ok=Array.isArray(saved.samples)&&saved.samples.length>=5&&saved.samples.every(x=>x&&Array.isArray(x.values)&&x.values.length===128)&&emp.faceEnrolled===true;
    if(!ok)throw new Error('failed-precondition: Firestore did not confirm the saved face enrollment.');
    return readCloud();
  }
  async function saveSale(sale){await initFirebase();if(!isAdmin())throw new Error('Admin authentication required.');if(!sale?.id)throw new Error('invalid-argument: sale ID is missing.');await db.doc(`${C.sales}/${sale.id}`).set({...sale,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});return readCloud();}
  async function saveAttendance(record,snapshot){
    await initFirebase();
    if(!record?.employeeId)throw new Error('invalid-argument: employee ID is missing.');
    if(!record.id)record={...record,id:`attendance_${String(record.employeeId).replace(/[^a-zA-Z0-9_-]/g,"_")}_${record.date||new Date().toISOString().slice(0,10)}`};
    const ref=db.doc(`${C.attendance}/${record.id}`);
    if(record.punchType==="in") {
      await db.runTransaction(async tx=>{
        const snap=await tx.get(ref);
        if(snap.exists)throw new Error(`already-recorded: Time In already exists for ${record.employeeId} on ${record.date}.`);
        const data={...record,updatedAt:firebase.firestore.FieldValue.serverTimestamp()};
        tx.set(ref,data,{merge:false});
      });
    } else if(record.punchType==="out") {
      await db.runTransaction(async tx=>{
        const snap=await tx.get(ref);
        if(!snap.exists)throw new Error(`invalid-state: No Time In record exists for ${record.employeeId} on ${record.date}.`);
        const existing=snap.data()||{};
        if(existing.clockOut)throw new Error(`already-recorded: Time Out already exists for ${record.employeeId} on ${record.date}.`);
        tx.set(ref,{clockOut:record.clockOut,clockOutAt:record.clockOutAt,punchType:"out",updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
      });
    } else {
      await ref.set({...record,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    }
    if(snapshot)await db.doc('bigguys_meta/attendance').set({lastFaceCapture:snapshot,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    return readCloud();
  }
  async function saveAttendanceSnapshot(snapshot){await initFirebase();if(!snapshot?.employeeId)throw new Error('invalid-argument: employee ID is missing.');await db.doc('bigguys_meta/attendance').set({lastFaceCapture:snapshot,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});return readCloud();}
  async function saveDailyReport(date,report){await initFirebase();if(!isAdmin())throw new Error('Admin authentication required.');await db.doc(`${C.reports}/${date}`).set({...report,date,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});return readCloud();}
  function startListeners(onRemote){
    const refs=[db.collection(C.employees),db.collection(C.faces),db.collection(C.attendance)];if(isAdmin()){refs.push(db.collection(C.sales),db.collection(C.reports));}
    let remoteTimer=null,remoteRun=0;
    const apply=()=>{
      clearTimeout(remoteTimer);
      remoteTimer=setTimeout(async()=>{
        const run=++remoteRun;
        try{
          const next=await readCloud();
          // Multiple collection listeners can fire together (for example after a face save).
          // Coalesce them and only apply the newest read so an older snapshot cannot overwrite
          // a freshly confirmed face enrollment with stale state.
          if(run!==remoteRun)return;
          window.__BIGGUYS_CURRENT_STATE=next;if(onRemote)onRemote(next);
          status({ready:true,status:'connected',lastSyncAt:new Date().toISOString(),lastSyncError:null});
        }catch(e){status({ready:true,status:'error',lastSyncError:e,error:e});}
      },80);
    };
    refs.forEach(ref=>unsubscribers.push(ref.onSnapshot(apply,e=>status({ready:true,status:'error',lastSyncError:e,error:e}))));
    unsubscribers.push(db.doc('bigguys_meta/attendance').onSnapshot(apply,e=>{}));
  }
  function startCentralRefresh(onRemote){if(refreshTimer||!isAdmin())return;const refresh=async()=>{try{const next=await readCloud();window.__BIGGUYS_CURRENT_STATE=next;if(onRemote)onRemote(next);status({ready:true,status:'connected',lastSyncAt:new Date().toISOString(),lastSyncError:null});}catch(e){status({ready:true,status:'error',lastSyncError:e,error:e});}};refreshTimer=setInterval(refresh,10000);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});}
  async function init(initial,onRemote,mode='dtr'){
    if(!configured){status({ready:false,status:'not-configured'});return false;}if(readyPromise)return readyPromise;
    readyPromise=(async()=>{try{await initFirebase();await ensureAuth(mode);let next=await migrateLegacyIfNeeded(initial);window.__BIGGUYS_CURRENT_STATE=next;if(onRemote)onRemote(next);startListeners(onRemote);startCentralRefresh(onRemote);status({ready:true,status:'connected',lastSyncAt:new Date().toISOString(),lastSyncError:null});return true;}catch(e){status({ready:false,status:'error',error:e,lastSyncError:e});console.error('Firebase initialization failed:',e);return false;}})();return readyPromise;
  }
  async function getAdminProfile(user){await initFirebase();const u=user||auth?.currentUser;if(!u||u.isAnonymous)throw new Error('Admin authentication required.');const s=await db.doc(`admins/${u.uid}`).get();if(!s.exists)throw new Error('Admin profile not found in Firestore.');const p=s.data()||{};if(p.role!=='admin'||p.active!==true)throw new Error('This Firebase account is not an active administrator.');return {uid:u.uid,...p};}
  async function adminLogin(email,password){await initFirebase();const user=(await auth.signInWithEmailAndPassword(email,password)).user;if(user.isAnonymous)throw new Error('Anonymous accounts cannot access the Admin Dashboard.');await getAdminProfile(user);readyPromise=null;unsubscribers.forEach(fn=>fn&&fn());unsubscribers=[];return user;}
  async function adminLogout(){if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null;}unsubscribers.forEach(fn=>fn&&fn());unsubscribers=[];if(auth)await auth.signOut();readyPromise=null;window.__BIGGUYS_CURRENT_STATE=null;}
  async function getAdminProfilePublic(){return getAdminProfile();}
  async function refreshCloud(){await initFirebase();await ensureAuth(isAdmin()?'admin':'dtr');const next=await readCloud();window.__BIGGUYS_CURRENT_STATE=next;status({ready:true,status:'connected',lastSyncAt:new Date().toISOString(),lastSyncError:null});return next;}
  window.BigGuysCloud={configured,isAdmin,ensureAuth,init,refresh:refreshCloud,adminLogin,adminLogout,getAdminProfile:getAdminProfilePublic,push:pushState,reserveEmployeeId,saveEmployee,deleteEmployee,saveFaceEnrollment,saveSale,saveAttendance,saveDailyReport,getStatus:()=>window.BIGGUYS_CLOUD||{configured,ready:false,status:'waiting'}};
})();
