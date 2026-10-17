const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });

function encodePart(value) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function getGoogleAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3500
  };
  const unsigned = `${encodePart({alg:"RS256",typ:"JWT"})}.${encodePart(claims)}`;
  const pem = String(sa.private_key || "").replace("-----BEGIN PRIVATE KEY-----","").replace("-----END PRIVATE KEY-----","").replace(/\s/g,"");
  if (!pem) throw new Error("Service account private key is missing.");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),
    {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"}, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(unsigned)));
  const assertion = `${unsigned}.${btoa(String.fromCharCode(...sig)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;
  const resp = await fetch(claims.aud,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
  const data = await resp.json().catch(()=>({}));
  if (!resp.ok || !data.access_token) throw new Error("Could not obtain a Firebase server access token.");
  return data.access_token;
}
async function firebaseIdentity(idToken, apiKey) {
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken})});
  const d=await r.json().catch(()=>({}));
  return r.ok ? d.users?.[0] || null : null;
}
function field(doc,key) {
  const f=doc?.fields?.[key];
  if (!f) return undefined;
  if ("stringValue" in f) return f.stringValue;
  if ("integerValue" in f) return Number(f.integerValue);
  if ("doubleValue" in f) return Number(f.doubleValue);
  if ("booleanValue" in f) return f.booleanValue;
  if ("arrayValue" in f) return (f.arrayValue.values||[]).map(v=>v.stringValue ?? v.integerValue ?? v.doubleValue ?? null);
  if ("mapValue" in f) return Object.fromEntries(Object.entries(f.mapValue.fields||{}).map(([k,v])=>[k,field({fields:{[k]:v}},k)]));
  return undefined;
}
const str = v => ({stringValue:String(v ?? "")});
const num = v => ({doubleValue:Number(v || 0)});
const stamp = v => ({timestampValue:new Date(v).toISOString()});
function docFields(doc) { return Object.fromEntries(Object.keys(doc?.fields||{}).map(k=>[k,field(doc,k)])); }
function base(project) { return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents`; }
function resourceName(project, path) { return `projects/${project}/databases/(default)/documents/${path}`; }
async function getDoc(access, project, path) {
  const r=await fetch(`${base(project)}/${path}`,{headers:{authorization:`Bearer ${access}`}});
  if(r.status===404)return null;
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(`Could not read Firestore record (${r.status}).`);
  return d;
}
async function patchDoc(access, project, path, fields, masks) {
  const qs=masks.map(k=>`updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const r=await fetch(`${base(project)}/${path}?${qs}`,{method:"PATCH",headers:{authorization:`Bearer ${access}`,"content-type":"application/json"},body:JSON.stringify({fields})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(`Could not update Firestore record (${r.status}).`);
  return d;
}
async function runQuery(access, project, collectionId, filters, transaction) {
  const where={compositeFilter:{op:"AND",filters:filters.map(([fieldPath,value])=>({fieldFilter:{field:{fieldPath},op:"EQUAL",value:{stringValue:value}}}))}};
  const body={structuredQuery:{from:[{collectionId}],where}};
  if(transaction)body.transaction=transaction;
  const r=await fetch(`${base(project)}:runQuery`,{method:"POST",headers:{authorization:`Bearer ${access}`,"content-type":"application/json"},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>[]);
  if(!r.ok)throw new Error(`Could not query Firestore (${r.status}).`);
  return d.map(x=>x.document).filter(Boolean);
}
async function commit(access,project,writes,transaction) {
  const body={writes};
  if(transaction)body.transaction=transaction;
  const r=await fetch(`${base(project)}:commit`,{method:"POST",headers:{authorization:`Bearer ${access}`,"content-type":"application/json"},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(`Could not commit dashboard sync (${r.status}).`);
  return d;
}
async function beginTransaction(access,project) {
  const r=await fetch(`${base(project)}:beginTransaction`,{method:"POST",headers:{authorization:`Bearer ${access}`,"content-type":"application/json"},body:JSON.stringify({options:{readWrite:{}}})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.transaction)throw new Error("Could not start the Firestore sync transaction.");
  return d.transaction;
}
async function setSyncStatus(access,project,transactionDocId,fieldName) {
  try {
    await patchDoc(access,project,`cashierTransactions/${encodeURIComponent(transactionDocId)}`,
      {[fieldName]:str("SYNCED"),[fieldName.replace("Status","At")]:stamp(new Date())},
      [fieldName,fieldName.replace("Status","At")]);
  } catch(e) { console.warn("Sync completed but status badge update failed",e); }
}
async function syncSale(access,project,transactionDocId,callerUid) {
  const tx=await getDoc(access,project,`cashierTransactions/${encodeURIComponent(transactionDocId)}`);
  if(!tx)throw new Error("Cashier sale record was not found.");
  const sale=docFields(tx);
  if(sale.cashierId!==callerUid)throw new Error("You can only sync sales you entered.");
  if(!sale.unitId || !sale.saleDate || !(Number(sale.grossSales)>0))throw new Error("Sale is missing a customer, date, or valid gross sales.");
  const month=String(sale.saleDate).slice(0,7);
  if(!/^\d{4}-\d{2}$/.test(month))throw new Error("Sale date is invalid.");
  const unit=await getDoc(access,project,`units/${encodeURIComponent(sale.unitId)}`);
  if(!unit)throw new Error("The selected Admin customer/unit no longer exists.");
  const unitData=docFields(unit);
  if(unitData.active===false)throw new Error("The selected customer account is inactive.");
  if(unitData.clientCode && String(unitData.clientCode).toLowerCase()!==String(sale.customerId||"").toLowerCase())
    throw new Error("The sale Customer ID does not match the registered Admin customer record.");

  const transaction=await beginTransaction(access,project);
  const docs=await runQuery(access,project,"monthlyRecords",[["unitId",String(sale.unitId)],["month",month]],transaction);
  const prior=docs[0];
  const priorFields=docFields(prior);
  const already=Array.isArray(priorFields.cashierTransactionIds)?priorFields.cashierTransactionIds:[];
  if(prior && already.includes(transactionDocId)) {
    await setSyncStatus(access,project,transactionDocId,"dashboardSalesSyncStatus");
    return {ok:true,alreadySynced:true,month};
  }
  const ids=[...already,transactionDocId];
  const now=new Date().toISOString();
  if(prior) {
    const gross=Number(priorFields.grossSales||0)+Number(sale.grossSales||0);
    await commit(access,project,[{update:{name:prior.name,fields:{
      grossSales:num(gross),cashierTransactionIds:{arrayValue:{values:ids.map(str)}},updatedAt:stamp(now)
    }},updateMask:{fieldPaths:["grossSales","cashierTransactionIds","updatedAt"]}}],transaction);
  } else {
    const id=`cashier_${String(sale.unitId).replace(/[^A-Za-z0-9_-]/g,"_")}_${month}`;
    const name=resourceName(project,`monthlyRecords/${id}`);
    await commit(access,project,[{update:{name,fields:{
      unitId:str(sale.unitId),month:str(month),grossSales:num(sale.grossSales),miscellaneousFee:num(0),
      cashierTransactionIds:{arrayValue:{values:[str(transactionDocId)]}},createdAt:stamp(now),updatedAt:stamp(now)
    }},currentDocument:{exists:false}}],transaction);
  }
  await setSyncStatus(access,project,transactionDocId,"dashboardSalesSyncStatus");
  return {ok:true,month,unitId:sale.unitId,grossSales:Number(sale.grossSales)};
}
async function syncPayment(access,project,transactionDocId,callerUid) {
  const tx=await getDoc(access,project,`cashierTransactions/${encodeURIComponent(transactionDocId)}`);
  if(!tx)throw new Error("Cashier sale record was not found.");
  const sale=docFields(tx);
  if(sale.cashierId!==callerUid)throw new Error("You can only sync payments for sales you entered.");
  if(sale.status!=="CUSTOMER EARNINGS PAID" || sale.customerEarningsPaid!==true)
    throw new Error("The customer earnings payment has not been recorded yet.");
  if(!sale.unitId || !sale.saleDate)throw new Error("Sale is missing its customer or date.");
  const month=String(sale.saleDate).slice(0,7);
  const paymentId=`cashier_${String(transactionDocId).replace(/[^A-Za-z0-9_-]/g,"_")}`;
  const paymentPath=`payments/${paymentId}`;
  const existing=await getDoc(access,project,paymentPath);
  if(existing) {
    await setSyncStatus(access,project,transactionDocId,"dashboardPaymentSyncStatus");
    return {ok:true,alreadySynced:true,month};
  }
  const amount=Number(sale.totalCustomerEarnings||0);
  if(!(amount>0))throw new Error("Customer earnings amount is invalid.");
  const now=new Date().toISOString();
  const write={update:{name:resourceName(project,paymentPath),fields:{
    unitId:str(sale.unitId),month:str(month),amount:num(amount),paymentDate:str(now.slice(0,10)),
    method:str("Cashier customer earnings payment"),reference:str(sale.receiptId||sale.transactionId||transactionDocId),
    sourceTransactionId:str(transactionDocId),createdAt:stamp(now)
  }},currentDocument:{exists:false}};
  try { await commit(access,project,[write]); }
  catch(e) {
    const after=await getDoc(access,project,paymentPath);
    if(!after)throw e;
  }
  await setSyncStatus(access,project,transactionDocId,"dashboardPaymentSyncStatus");
  return {ok:true,month,amount};
}

export async function onRequestPost({request,env}) {
  try {
    if(!env.FIREBASE_PROJECT_ID || !env.FIREBASE_API_KEY || !env.FIREBASE_SERVICE_ACCOUNT_JSON)
      return json({ok:false,error:"Cashier dashboard sync is not configured. Verify Firebase Cloudflare secrets."},503);
    const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
    if(!token)return json({ok:false,error:"Sign in as Cashier before syncing."},401);
    const identity=await firebaseIdentity(token,env.FIREBASE_API_KEY);
    if(!identity?.localId)return json({ok:false,error:"Your session expired. Sign in again."},401);
    const serviceAccount=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if(serviceAccount.project_id!==env.FIREBASE_PROJECT_ID) return json({ok:false,error:"Firebase project and service account do not match."},500);
    const access=await getGoogleAccessToken(serviceAccount);
    const userDoc=await getDoc(access,env.FIREBASE_PROJECT_ID,`users/${encodeURIComponent(identity.localId)}`);
    const userData=docFields(userDoc);
    if(String(userData.role||"").toLowerCase()!=="cashier" || userData.active===false)
      return json({ok:false,error:"Only an active Cashier account can sync its own sales."},403);
    const body=await request.json().catch(()=>({}));
    const action=String(body.action||"");
    const transactionDocId=String(body.transactionDocId||"").trim();
    if(!transactionDocId || transactionDocId.includes("/") || transactionDocId.length>180)
      return json({ok:false,error:"A valid sale record ID is required."},400);
    let result;
    if(action==="sale") result=await syncSale(access,env.FIREBASE_PROJECT_ID,transactionDocId,identity.localId);
    else if(action==="payment") result=await syncPayment(access,env.FIREBASE_PROJECT_ID,transactionDocId,identity.localId);
    else return json({ok:false,error:"Unsupported sync action."},400);
    return json(result,200);
  } catch(error) {
    console.error("[cashier-sync]",error);
    return json({ok:false,error:error?.message||"Cashier dashboard sync failed."},500);
  }
}
