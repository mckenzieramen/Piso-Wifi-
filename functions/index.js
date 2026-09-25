const {onRequest}=require("firebase-functions/v2/https");
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

async function sendCustomPasswordReset(req,res){
  if(req.method!=="POST")return json(res,{error:"Method not allowed."},405);

  try{
    const body=req.body||{};
    const requestId=String(body.requestId||"").trim();
    const suppliedClientCode=String(body.clientCode||"").trim().toUpperCase();
    const suppliedEmail=normalizeEmail(body.email);

    if(!/^CID-\d{3,}$/.test(suppliedClientCode)||!suppliedEmail){
      return json(res,{error:"Please enter a valid Client ID and registered Gmail."},400);
    }

    // The customer portal no longer writes directly to passwordResetRequests.
    // This keeps validation server-side and prevents Firestore Security Rules
    // from exposing a generic "Missing or insufficient permissions" message.
    const customer=await findCustomerByClientCode(suppliedClientCode);
    if(!customer){
      return json(res,{error:`Client ID ${suppliedClientCode} was not found. Please check the Client ID and try again.`},404);
    }

    const unit=customer.data||{};
    if(unit.active===false){
      return json(res,{error:`Client ID ${suppliedClientCode} is inactive. Please contact PISO WIFI Admin.`},403);
    }

    const registeredEmail=normalizeEmail(unit.email);
    if(!registeredEmail){
      return json(res,{error:`Client ID ${suppliedClientCode} does not have a registered Gmail address.`},409);
    }
    if(registeredEmail!==suppliedEmail){
      return json(res,{error:`The registered Gmail does not match ${suppliedClientCode}. Please use the Gmail registered for this Client ID.`},403);
    }

    const authUserId=String(unit.authUserId||"").trim();
    if(!authUserId){
      return json(res,{error:`${suppliedClientCode} is not linked to a Firebase Authentication account.`},400);
    }

    const authUser=await admin.auth().getUser(authUserId);
    if(normalizeEmail(authUser.email)!==registeredEmail){
      return json(res,{error:`The Firebase Authentication email does not match the registered Gmail for ${suppliedClientCode}.`},409);
    }

    // Reuse the request only when the caller supplied an existing request ID.
    // Normally the customer portal lets this function create the request after
    // the server-side identity checks above have passed.
    let requestRef=null;
    if(requestId){
      requestRef=db.doc(`passwordResetRequests/${requestId}`);
      const existing=await requestRef.get();
      if(existing.exists){
        const recovery=existing.data()||{};
        if(recovery.status!=="pending")return json(res,{error:"This recovery request is no longer available."},409);
        if(recovery.emailSent===true)return json(res,{ok:true,alreadySent:true});
      }
    }
    if(!requestRef)requestRef=db.collection("passwordResetRequests").doc();

    // Firebase Admin SDK creates the one-time action link without sending
    // Firebase's default email. We then extract the OOB code and point the
    // customer's email directly to our PISO WIFI reset page.
    const firebaseActionLink=await admin.auth().generatePasswordResetLink(registeredEmail);
    const parsed=new URL(firebaseActionLink);
    const oobCode=parsed.searchParams.get("oobCode");
    const apiKey=parsed.searchParams.get("apiKey");
    if(!oobCode)throw new Error("Firebase did not return a password-reset action code.");

    const resetUrl=new URL(CLIENT_RESET_PAGE);
    resetUrl.searchParams.set("mode","resetPassword");
    resetUrl.searchParams.set("oobCode",oobCode);
    if(apiKey)resetUrl.searchParams.set("apiKey",apiKey);

    const mailerResponse=await fetch(APPS_SCRIPT_MAILER_URL,{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        secret:APPS_SCRIPT_MAILER_SECRET,
        email:registeredEmail,
        clientId:suppliedClientCode,
        firstName:firstNameFromUnit(unit),
        resetLink:resetUrl.toString()
      })
    });

    const mailerData=await mailerResponse.json().catch(()=>({}));
    if(!mailerResponse.ok||mailerData.ok!==true){
      throw new Error(mailerData.error||"The PISO WIFI mail service could not send the reset email.");
    }

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

    return json(res,{ok:true,emailSent:true});
  }catch(err){
    console.error("sendCustomPasswordReset",err);
    return json(res,{error:err?.message||"Unable to send the password-reset email."},500);
  }
}
exports.sendCustomPasswordReset=onRequest({region:"us-central1",cors:true},sendCustomPasswordReset);

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
