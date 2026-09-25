const {onRequest,onCall,HttpsError}=require("firebase-functions/v2/https");
const admin=require("firebase-admin");

admin.initializeApp();
const db=admin.firestore();

const APPS_SCRIPT_MAILER_URL="https://script.google.com/macros/s/AKfycbzcBLoOP6LoXwTE8rhUUxd1q68ykDgVj-f4o-TD7YGPYmtXrepvhJ8dbPWdeCqQt9fM/exec";
const APPS_SCRIPT_MAILER_SECRET="-P4NqUwISia-WpONGB2WipjobxXOC0Jnh9bdnyQMF2zNsOrWo-ERoChulEGfY14D";
const CLIENT_RESET_PAGE="https://piso-wifi.pages.dev/reset-password.html";

function json(res,data,status=200){
  return res.status(status).json(data);
}

function firstNameFromUnit(unit){
  return String(unit?.firstName||String(unit?.name||"Customer").trim().split(/\s+/)[0]||"Customer").trim()||"Customer";
}

function normalizeEmail(value){
  return String(value||"").trim().toLowerCase();
}

async function findCustomerByClientCode(code){
  const q=await db.collection("units").where("clientCode","==",code).limit(1).get();
  if(!q.empty)return {ref:q.docs[0].ref,data:q.docs[0].data()};

  const directoryRef=db.doc(`customerLoginDirectory/${code}`);
  const directorySnap=await directoryRef.get();
  if(directorySnap.exists){
    const directory=directorySnap.data()||{};
    const unitId=String(directory.unitDocId||directory.unitId||directory.clientUnitId||"").trim();
    if(unitId){
      const unitSnap=await db.doc(`units/${unitId}`).get();
      if(unitSnap.exists)return {ref:unitSnap.ref,data:unitSnap.data()};
    }
  }

  return null;
}

async function sendCustomPasswordResetCallable(request){
  const body=request.data||{};
  let stage="input_validation";
  let suppliedClientCode="";
  try{
    const requestId=String(body.requestId||"").trim();
    suppliedClientCode=String(body.clientCode||"").trim().toUpperCase();
    const suppliedEmail=normalizeEmail(body.email);

    if(!/^CID-\d{3,}$/.test(suppliedClientCode)||!suppliedEmail){
      throw new HttpsError("invalid-argument", "Please enter a valid Client ID and registered Gmail.");
    }

    stage="customer_lookup";
    const customer=await findCustomerByClientCode(suppliedClientCode);
    if(!customer){
      throw new HttpsError("not-found", `Client ID ${suppliedClientCode} was not found. Please check the Client ID and try again.`);
    }

    stage="customer_validation";
    const unit=customer.data||{};
    if(unit.active===false){
      throw new HttpsError("permission-denied", `Client ID ${suppliedClientCode} is inactive. Please contact PISO WIFI Admin.`);
    }

    const registeredEmail=normalizeEmail(unit.email);
    if(!registeredEmail){
      throw new HttpsError("failed-precondition", `Client ID ${suppliedClientCode} does not have a registered Gmail address.`);
    }
    if(registeredEmail!==suppliedEmail){
      throw new HttpsError("permission-denied", `The registered Gmail does not match ${suppliedClientCode}. Please use the Gmail registered for this Client ID.`);
    }

    stage="firebase_auth_lookup";
    const authUserId=String(unit.authUserId||"").trim();
    if(!authUserId){
      throw new HttpsError("invalid-argument", `${suppliedClientCode} is not linked to a Firebase Authentication account.`);
    }

    const authUser=await admin.auth().getUser(authUserId);
    if(normalizeEmail(authUser.email)!==registeredEmail){
      throw new HttpsError("failed-precondition", `The Firebase Authentication email does not match the registered Gmail for ${suppliedClientCode}.`);
    }

    stage="recovery_request_lookup";
    let requestRef=null;
    if(requestId){
      requestRef=db.doc(`passwordResetRequests/${requestId}`);
      const existing=await requestRef.get();
      if(existing.exists){
        const recovery=existing.data()||{};
        if(recovery.status!=="pending")throw new HttpsError("failed-precondition", "This recovery request is no longer available.");
        if(recovery.emailSent===true)return {ok:true,alreadySent:true};
      }
    }
    if(!requestRef)requestRef=db.collection("passwordResetRequests").doc();

    stage="generate_reset_link";
    const firebaseActionLink=await admin.auth().generatePasswordResetLink(registeredEmail);
    const parsed=new URL(firebaseActionLink);
    const oobCode=parsed.searchParams.get("oobCode");
    const apiKey=parsed.searchParams.get("apiKey");
    if(!oobCode)throw new Error("Firebase did not return a password-reset action code.");

    stage="build_reset_url";
    const resetUrl=new URL(CLIENT_RESET_PAGE);
    resetUrl.searchParams.set("mode","resetPassword");
    resetUrl.searchParams.set("oobCode",oobCode);
    if(apiKey)resetUrl.searchParams.set("apiKey",apiKey);

    stage="apps_script_fetch";
    let mailerResponse;
    let mailerText="";
    let mailerData={};
    try{
      mailerResponse=await fetch(APPS_SCRIPT_MAILER_URL,{
        method:"POST",
        redirect:"follow",
        headers:{"content-type":"application/json","accept":"application/json"},
        body:JSON.stringify({
          secret:APPS_SCRIPT_MAILER_SECRET,
          email:registeredEmail,
          clientId:suppliedClientCode,
          firstName:firstNameFromUnit(unit),
          resetLink:resetUrl.toString()
        })
      });
      mailerText=await mailerResponse.text();
      try{ mailerData=mailerText?JSON.parse(mailerText):{}; }catch{}
    }catch(mailErr){
      throw new HttpsError("failed-precondition",
        `CUSTOM EMAIL SERVICE CONNECTION FAILED [${stage}]: ${mailErr?.message||"Unable to reach the Apps Script mailer."}`,
        {stage,clientCode:suppliedClientCode,errorName:mailErr?.name||"Error"});
    }

    stage="apps_script_response";
    if(!mailerResponse.ok){
      throw new HttpsError("failed-precondition",
        `CUSTOM EMAIL SERVICE HTTP ERROR ${mailerResponse.status}: ${mailerData.error||mailerText.slice(0,300)||"No response body."}`,
        {stage,httpStatus:mailerResponse.status,clientCode:suppliedClientCode});
    }
    if(mailerData.ok!==true){
      const bodyHint=mailerData.error||mailerText.slice(0,300)||"The mailer returned no JSON success response.";
      throw new HttpsError("failed-precondition",
        `CUSTOM EMAIL SERVICE REJECTED THE REQUEST: ${bodyHint}`,
        {stage,clientCode:suppliedClientCode});
    }

    stage="firestore_write";
    const now=admin.firestore.FieldValue.serverTimestamp();
    if(!requestId){
      await requestRef.set({
        clientCode:suppliedClientCode,
        email:registeredEmail,
        status:"pending",
        adminRead:false,
        emailSent:false,
        createdAt:now
      });
    }
    await requestRef.update({
      emailSent:true,
      emailSentAt:now,
      resetEmailSentTo:registeredEmail,
      resetEmailStatus:"sent",
      adminRead:false
    });

    return {ok:true,emailSent:true};
  }catch(err){
    console.error("sendCustomPasswordReset",{
      stage,
      clientCode:suppliedClientCode,
      errorName:err?.name||"Error",
      errorCode:err?.code||"",
      errorMessage:err?.message||String(err),
      errorDetails:err?.details||null,
      stack:err?.stack||""
    });

    const canonicalCodes=new Set(["cancelled","unknown","invalid-argument","deadline-exceeded","not-found","already-exists","permission-denied","resource-exhausted","failed-precondition","aborted","out-of-range","unimplemented","internal","unavailable","data-loss","unauthenticated"]);
    if(err instanceof HttpsError || canonicalCodes.has(String(err?.code||""))){
      if(err instanceof HttpsError)return err;
      throw new HttpsError(String(err.code), `PASSWORD RESET FAILED [${stage}]: ${err.message||"Unknown error."}`, {stage,clientCode:suppliedClientCode});
    }

    throw new HttpsError("internal",
      `PASSWORD RESET FAILED [${stage}]: ${err?.message||"Unknown server error."}`,
      {stage,clientCode:suppliedClientCode,errorName:err?.name||"Error"});
  }
}
exports.sendCustomPasswordReset=onCall({region:"us-central1"},sendCustomPasswordResetCallable);

async function sendCustomPasswordResetHttp(req,res){
  if(req.method!=="POST")return json(res,{error:"Method not allowed."},405);
  try{
    const result=await sendCustomPasswordResetCallable({data:req.body||{}});
    return json(res,result,200);
  }catch(err){
    console.error("sendCustomPasswordResetHttp",err);
    const status=Number(err?.httpErrorCode?.status||500);
    return json(res,{error:err?.message||"Unable to send the password-reset email.",errorCode:err?.code||"internal"},status);
  }
}
exports.sendCustomPasswordResetHttp=onRequest({region:"us-central1",cors:true},sendCustomPasswordResetHttp);

exports.setClientTemporaryPassword=onRequest({region:"us-central1",cors:true},async(req,res)=>{
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed."});
  try{
    const h=String(req.headers.authorization||"");
    if(!h.startsWith("Bearer ")) return res.status(401).json({error:"Authentication required."});
    const decoded=await admin.auth().verifyIdToken(h.slice(7));
    const adminProfile=await db.doc(`users/${decoded.uid}`).get();
    if(!adminProfile.exists||adminProfile.data().role!=="admin"||adminProfile.data().active===false)return res.status(403).json({error:"Admin authorization required."});
    const {requestId,temporaryPassword}=req.body||{};
    if(!requestId||typeof temporaryPassword!=="string"||temporaryPassword.length<8)return res.status(400).json({error:"Temporary password must be at least 8 characters."});
    const requestRef=db.doc(`passwordResetRequests/${requestId}`), requestSnap=await requestRef.get();
    if(!requestSnap.exists)return res.status(404).json({error:"Recovery request not found."});
    const recovery=requestSnap.data();
    if(recovery.status!=="pending")return res.status(409).json({error:"This recovery request has already been reviewed."});
    const code=String(recovery.clientCode||"").trim().toUpperCase();
    if(!/^CID-\d{3,}$/.test(code))return res.status(400).json({error:"Invalid Client ID in the recovery request."});

    let unitRef=null, unit=null;
    const q=await db.collection("units").where("clientCode","==",code).limit(1).get();
    if(!q.empty){ unitRef=q.docs[0].ref; unit=q.docs[0].data(); }
    if(!unitRef){
      const dirSnap=await db.doc(`customerLoginDirectory/${code}`).get();
      if(dirSnap.exists){
        const directory=dirSnap.data()||{};
        const unitId=String(directory.unitId||directory.clientUnitId||directory.unitDocId||"").trim();
        if(unitId){
          const candidate=await db.doc(`units/${unitId}`).get();
          if(candidate.exists){ unitRef=candidate.ref; unit=candidate.data(); }
        }
      }
    }
    if(!unitRef||!unit)return res.status(404).json({error:"Customer account was not found for this Client ID."});

    const authUserId=String(unit.authUserId||"");
    if(!authUserId)return res.status(400).json({error:"Customer account is not linked to Firebase Authentication."});

    await admin.auth().updateUser(authUserId,{password:temporaryPassword});

    const ts=admin.firestore.FieldValue.serverTimestamp(), batch=db.batch();
    batch.update(requestRef,{status:"approved",adminRead:true,reviewedAt:ts,reviewedBy:decoded.email||decoded.uid,temporaryPasswordSetAt:ts});
    batch.update(unitRef,{forcePasswordChange:true,passwordChangedAt:null,updatedAt:ts});
    await batch.commit();
    return res.json({ok:true});
  }catch(err){console.error("setClientTemporaryPassword",err);return res.status(500).json({error:err?.message||"Unable to set the temporary password."});}
});
