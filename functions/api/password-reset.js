const PROJECT_ID = "piso-wifi-f2b5c";
const FIREBASE_API_KEY = "AIzaSyAfX3sSDkJwX9u9dxEDBhG8RU3iP_k6EdI";
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzcBLoOP6LoXwTE8rhUUxd1q68ykDgVj-f4o-TD7YGPYmtXrepvhJ8dbPWdeCqQt9fM/exec";
const PASSWORD_RESET_MAILER_SECRET = "-P4NqUwISia-WpONGB2WipjobxXOC0Jnh9bdnyQMF2zNsOrWo-ERoChulEGfY14D";
const RESET_PAGE = "https://piso-wifi.pages.dev/reset-password.html";

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function b64url(input){const bytes=typeof input==="string"?new TextEncoder().encode(input):new Uint8Array(input);let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
function fromB64(s){const clean=String(s||"").replace(/-----BEGIN PRIVATE KEY-----/g,"").replace(/-----END PRIVATE KEY-----/g,"").replace(/\s+/g,"");const bin=atob(clean);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out.buffer;}
function sv(fields,name,fallback=""){const f=fields?.[name];if(!f)return fallback;if(Object.prototype.hasOwnProperty.call(f,"stringValue"))return String(f.stringValue||"");if(Object.prototype.hasOwnProperty.call(f,"booleanValue"))return Boolean(f.booleanValue);if(Object.prototype.hasOwnProperty.call(f,"integerValue"))return Number(f.integerValue);return fallback;}
async function googleAccessToken(env){if(!env.FIREBASE_SERVICE_ACCOUNT_JSON)throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");const sa=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);if(!sa.client_email||!sa.private_key)throw new Error("Firebase service-account secret is incomplete.");const now=Math.floor(Date.now()/1000);const header=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));const claim=b64url(JSON.stringify({iss:sa.client_email,scope:"https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/datastore",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}));const unsigned=`${header}.${claim}`;const key=await crypto.subtle.importKey("pkcs8",fromB64(sa.private_key),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);const signature=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(unsigned));const assertion=`${unsigned}.${b64url(signature)}`;const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});const data=await r.json();if(!r.ok||!data.access_token)throw new Error(data.error_description||data.error||"Unable to obtain Google access token.");return {token:data.access_token,serviceAccount:sa};}
async function firestoreGet(token,path){const r=await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,{headers:{authorization:`Bearer ${token}`}});const data=await r.json();if(r.status===404)return null;if(!r.ok)throw new Error(data.error?.message||`Unable to read Firestore document ${path}.`);return data;}
function timestampField(){return {timestampValue:new Date().toISOString()};}
function stringField(v){return {stringValue:String(v??"")};}
function boolField(v){return {booleanValue:Boolean(v)};}
async function firestoreCreate(token,path,fields){const r=await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({fields})});const data=await r.json();if(!r.ok)throw new Error(data.error?.message||"Unable to record password-reset request.");return data;}
async function generateResetLink(token,email){const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(FIREBASE_API_KEY)}`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json","x-goog-user-project":PROJECT_ID},body:JSON.stringify({requestType:"PASSWORD_RESET",email,returnOobLink:true,continueUrl:RESET_PAGE})});const data=await r.json();if(!r.ok||!data.oobLink)throw new Error(data.error?.message||"Unable to create password-reset link.");return data.oobLink;}
async function sendMailer(firstName,email,clientId,resetLink){const r=await fetch(APPS_SCRIPT_URL,{method:"POST",redirect:"follow",headers:{"content-type":"application/json"},body:JSON.stringify({secret:PASSWORD_RESET_MAILER_SECRET,email,clientId,firstName,resetLink})});const text=await r.text();let data={};try{data=JSON.parse(text);}catch{}if(!r.ok||data.ok!==true)throw new Error(data.error||`Password-reset mailer returned HTTP ${r.status}.`);return data;}

export async function onRequestPost(context){
  try{
    const body=await context.request.json().catch(()=>({}));
    const clientId=String(body.clientId||"").trim().toUpperCase();
    const email=String(body.email||"").trim().toLowerCase();
    if(!/^CID-\d{3,}$/.test(clientId)||!email.includes("@"))return json({ok:false,error:"INVALID_RECOVERY_DETAILS"},400);

    const {token}=await googleAccessToken(context.env);
    const directory=await firestoreGet(token,`customerLoginDirectory/${clientId}`);
    if(!directory)return json({ok:false,error:"CLIENT_ACCOUNT_NOT_FOUND"},404);
    const fields=directory.fields||{};
    const registeredEmail=String(sv(fields,"email","")).trim().toLowerCase();
    const active=sv(fields,"active",true);
    if(!registeredEmail||registeredEmail!==email)return json({ok:false,error:"CLIENT_ACCOUNT_EMAIL_MISMATCH"},403);
    if(active===false)return json({ok:false,error:"CLIENT_ACCOUNT_NOT_AVAILABLE"},403);
    const firstName=String(sv(fields,"firstName",sv(fields,"name","Customer"))).trim()||"Customer";

    const resetLink=await generateResetLink(token,email);
    await sendMailer(firstName,email,clientId,resetLink);

    await firestoreCreate(token,"passwordResetRequests",{
      clientCode:stringField(clientId),
      email:stringField(email),
      status:stringField("email_sent"),
      adminRead:boolField(false),
      createdAt:timestampField()
    });

    return json({ok:true});
  }catch(error){
    console.error("[PISO WIFI PASSWORD RESET]",error);
    return json({ok:false,error:"PASSWORD_RESET_SERVER_ERROR",details:String(error?.message||error)},500);
  }
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:{"access-control-allow-origin":"*","access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"Content-Type"}});}
