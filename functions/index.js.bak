const {onRequest}=require("firebase-functions/v2/https");
const admin=require("firebase-admin");
admin.initializeApp();
const db=admin.firestore();
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
    const code=String(recovery.clientCode||"").toUpperCase();
    const q=await db.collection("units").where("clientCode","==",code).limit(1).get();
    if(q.empty)return res.status(404).json({error:"Customer account was not found."});
    const unit=q.docs[0].data(), authUserId=String(unit.authUserId||"");
    if(!authUserId)return res.status(400).json({error:"Customer account is not linked to Firebase Authentication."});
    await admin.auth().updateUser(authUserId,{password:temporaryPassword});
    const ts=admin.firestore.FieldValue.serverTimestamp(), batch=db.batch();
    batch.update(requestRef,{status:"approved",adminRead:true,reviewedAt:ts,reviewedBy:decoded.email||decoded.uid,temporaryPasswordSetAt:ts});
    batch.update(q.docs[0].ref,{forcePasswordChange:true,passwordChangedAt:null,updatedAt:ts});
    await batch.commit();
    return res.json({ok:true});
  }catch(err){console.error("setClientTemporaryPassword",err);return res.status(500).json({error:err?.message||"Unable to set the temporary password."});}
});
