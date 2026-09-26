const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// CUSTOM PISO WIFI PASSWORD RESET MAILER
// Generates the Firebase reset action code server-side and sends the reset
// message through the Google Apps Script HTML mailer. This deliberately
// replaces the browser's default Firebase reset-email renderer.
const APPS_SCRIPT_MAILER_URL = "https://script.google.com/macros/s/AKfycbzcBLoOP6LoXwTE8rhUUxd1q68ykDgVj-f4o-TD7YGPYmtXrepvhJ8dbPWdeCqQt9fM/exec";
const APPS_SCRIPT_MAILER_SECRET = "-P4NqUwISia-WpONGB2WipjobxXOC0Jnh9bdnyQMF2zNsOrWo-ERoChulEGfY14D";
const CLIENT_RESET_PAGE = "https://piso-wifi.pages.dev/reset-password.html";

function normalizeEmail(value){ return String(value || "").trim().toLowerCase(); }
function firstNameFromCustomer(unit){
  return String(unit?.firstName || String(unit?.name || "Customer").trim().split(/\s+/)[0] || "Customer").trim() || "Customer";
}

async function findCustomerByClientCodeForReset(clientCode){
  const code = String(clientCode || "").trim().toUpperCase();
  const snap = await db.collection("units").where("clientCode", "==", code).limit(1).get();
  if(!snap.empty){
    const doc=snap.docs[0];
    return { ref: doc.ref, data: doc.data() };
  }
  const dirSnap = await db.doc(`customerLoginDirectory/${code}`).get();
  if(dirSnap.exists){
    const d=dirSnap.data() || {};
    const unitDocId=String(d.unitDocId || d.unitId || d.clientUnitId || "").trim();
    if(unitDocId){
      const unitSnap=await db.doc(`units/${unitDocId}`).get();
      if(unitSnap.exists) return { ref: unitSnap.ref, data: unitSnap.data() };
    }
  }
  return null;
}

async function sendCustomPasswordResetCallable(request){
  let stage="input_validation";
  let clientCode="";
  try{
    clientCode=String(request.data?.clientCode || "").trim().toUpperCase();
    const email=normalizeEmail(request.data?.email);
    if(!/^CID-\d{3,}$/.test(clientCode) || !email){
      throw new HttpsError("invalid-argument","Please enter a valid Client ID and registered Gmail.");
    }

    stage="customer_lookup";
    const customer=await findCustomerByClientCodeForReset(clientCode);
    if(!customer) throw new HttpsError("not-found",`Client ID ${clientCode} was not found.`);

    stage="customer_validation";
    const unit=customer.data || {};
    if(unit.active===false){
      throw new HttpsError("permission-denied",`Client ID ${clientCode} is inactive. Please contact PISO WIFI Admin.`);
    }
    const registeredEmail=normalizeEmail(unit.email || unit.authEmail);
    if(!registeredEmail){
      throw new HttpsError("failed-precondition",`Client ID ${clientCode} does not have a registered Gmail address.`);
    }
    if(registeredEmail!==email){
      throw new HttpsError("permission-denied",`The registered Gmail does not match ${clientCode}. Please use the Gmail registered for this Client ID.`);
    }

    stage="firebase_auth_lookup";
    const authUserId=String(unit.authUserId || "").trim();
    if(!authUserId){
      throw new HttpsError("failed-precondition",`${clientCode} is not linked to a Firebase Authentication account.`);
    }
    const authUser=await admin.auth().getUser(authUserId);
    if(normalizeEmail(authUser.email)!==registeredEmail){
      throw new HttpsError("failed-precondition",`The Firebase Authentication email does not match the registered Gmail for ${clientCode}.`);
    }

    stage="generate_reset_link";
    const firebaseActionLink=await admin.auth().generatePasswordResetLink(registeredEmail);
    const parsed=new URL(firebaseActionLink);
    const oobCode=parsed.searchParams.get("oobCode");
    const apiKey=parsed.searchParams.get("apiKey");
    if(!oobCode) throw new Error("Firebase did not return a password-reset action code.");

    stage="build_reset_url";
    const resetUrl=new URL(CLIENT_RESET_PAGE);
    resetUrl.searchParams.set("mode","resetPassword");
    resetUrl.searchParams.set("oobCode",oobCode);
    if(apiKey) resetUrl.searchParams.set("apiKey",apiKey);

    stage="apps_script_fetch";
    let response;
    let responseText="";
    let responseData={};
    try{
      response=await fetch(APPS_SCRIPT_MAILER_URL,{
        method:"POST",
        redirect:"follow",
        headers:{"content-type":"application/json","accept":"application/json"},
        body:JSON.stringify({
          secret:APPS_SCRIPT_MAILER_SECRET,
          email:registeredEmail,
          clientId:clientCode,
          firstName:firstNameFromCustomer(unit),
          resetLink:resetUrl.toString()
        })
      });
      responseText=await response.text();
      try{ responseData=responseText ? JSON.parse(responseText) : {}; }catch{}
    }catch(error){
      throw new HttpsError("failed-precondition",`CUSTOM EMAIL SERVICE CONNECTION FAILED [${stage}]: ${error?.message || "Unable to reach the Apps Script mailer."}`,{stage,clientCode});
    }

    stage="apps_script_response";
    if(!response.ok){
      throw new HttpsError("failed-precondition",`CUSTOM EMAIL SERVICE HTTP ERROR ${response.status}: ${responseData.error || responseText.slice(0,300) || "No response body."}`,{stage,httpStatus:response.status,clientCode});
    }
    if(responseData.ok!==true){
      throw new HttpsError("failed-precondition",`CUSTOM EMAIL SERVICE REJECTED THE REQUEST: ${responseData.error || responseText.slice(0,300) || "No JSON success response."}`,{stage,clientCode});
    }

    stage="firestore_write";
    await db.collection("passwordResetRequests").add({
      clientCode,
      email:registeredEmail,
      status:"email_sent",
      adminRead:false,
      emailSent:true,
      emailSentAt:admin.firestore.FieldValue.serverTimestamp(),
      createdAt:admin.firestore.FieldValue.serverTimestamp(),
      resetEmailSentTo:registeredEmail,
      resetEmailStatus:"sent"
    });

    return {ok:true,emailSent:true};
  }catch(error){
    console.error("[CUSTOM PASSWORD RESET]",{stage,clientCode,errorName:error?.name || "Error",errorCode:error?.code || "",errorMessage:error?.message || String(error),errorDetails:error?.details || null});
    if(error instanceof HttpsError && String(error.code || "")!=="internal") return error;
    throw new HttpsError("internal",`PASSWORD RESET FAILED [${stage}]: ${error?.message || "Unknown server error."}`,{stage,clientCode});
  }
}

exports.sendCustomPasswordReset=onCall({region:"us-central1"},sendCustomPasswordResetCallable);



// This is the public Firebase Web API key from the client configuration.
// It is not a service-account credential.
const FIREBASE_WEB_API_KEY = "AIzaSyAfX3sSDkJwX9u9dxEDBhG8RU3iP_k6EdI";

function clean(value) {
  return String(value || "").trim();
}

async function findCustomer(identifier) {
  const value = clean(identifier);
  if (!value) return null;

  const upper = value.toUpperCase();
  const lower = value.toLowerCase();

  // Registered Gmail can be used directly.
  if (lower.includes("@")) {
    const emailSnap = await db.collection("units")
      .where("email", "==", lower)
      .limit(1)
      .get();
    if (!emailSnap.empty) {
      const doc = emailSnap.docs[0];
      return { id: doc.id, ...doc.data() };
    }
    return { email: lower };
  }

  // Username login: e.g. CliffCID-023 / JuanCID-0001.
  const usernameSnap = await db.collection("units")
    .where("username", "==", value)
    .limit(1)
    .get();
  if (!usernameSnap.empty) {
    const doc = usernameSnap.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  // Client ID login: e.g. CID-023 / CID-0001.
  const codeSnap = await db.collection("units")
    .where("clientCode", "==", upper)
    .limit(1)
    .get();
  if (!codeSnap.empty) {
    const doc = codeSnap.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  return null;
}

exports.clientLogin = onCall({ region: "us-central1" }, async (request) => {
  const identifier = clean(request.data?.identifier);
  const password = String(request.data?.password || "");

  if (!identifier || !password) {
    throw new HttpsError("invalid-argument", "Username, Client ID, or registered Gmail and password are required.");
  }

  let customer;
  try {
    customer = await findCustomer(identifier);
  } catch (error) {
    console.error("[CLIENT LOGIN] Customer lookup failed", error);
    throw new HttpsError("internal", "CLIENT LOGIN FAILED [customer_lookup]");
  }

  if (!customer) {
    throw new HttpsError("unauthenticated", "Invalid customer login credentials.");
  }

  if (customer.active === false) {
    throw new HttpsError("permission-denied", "This customer account is inactive.");
  }

  const authEmail = clean(customer.authEmail || customer.email).toLowerCase();
  if (!authEmail || !authEmail.includes("@")) {
    console.error("[CLIENT LOGIN] Missing auth email", { identifier, unitId: customer.id });
    throw new HttpsError("failed-precondition", "CLIENT LOGIN FAILED [auth_email_missing]");
  }

  let authResponse;
  try {
    authResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, password, returnSecureToken: true })
      }
    );
  } catch (error) {
    console.error("[CLIENT LOGIN] Firebase Identity Toolkit request failed", error);
    throw new HttpsError("internal", "CLIENT LOGIN FAILED [firebase_auth_request]");
  }

  let authPayload = {};
  try {
    authPayload = await authResponse.json();
  } catch (error) {
    console.error("[CLIENT LOGIN] Firebase Identity Toolkit response was not JSON", error);
    throw new HttpsError("internal", "CLIENT LOGIN FAILED [firebase_auth_response]");
  }

  if (!authResponse.ok) {
    const authError = authPayload?.error?.message || "AUTHENTICATION_FAILED";
    console.warn("[CLIENT LOGIN] Authentication rejected", { authError, identifier });

    if (["INVALID_PASSWORD", "EMAIL_NOT_FOUND", "INVALID_LOGIN_CREDENTIALS"].includes(authError)) {
      throw new HttpsError("unauthenticated", "Invalid customer login credentials.");
    }
    if (authError === "USER_DISABLED") {
      throw new HttpsError("permission-denied", "This customer account is disabled.");
    }
    throw new HttpsError("internal", `CLIENT LOGIN FAILED [firebase_auth_response]: ${authError}`);
  }

  const localId = clean(authPayload.localId);
  if (!localId) {
    throw new HttpsError("internal", "CLIENT LOGIN FAILED [firebase_auth_response]: missing localId");
  }

  let profile;
  try {
    const profileSnap = await db.doc(`users/${localId}`).get();
    profile = profileSnap.exists ? profileSnap.data() : null;
  } catch (error) {
    console.error("[CLIENT LOGIN] Role lookup failed", error);
    throw new HttpsError("internal", "CLIENT LOGIN FAILED [role_lookup]");
  }

  if (!profile || profile.role !== "client" || profile.active === false) {
    throw new HttpsError("permission-denied", "This account is not authorized for the Customer Account.");
  }

  let customToken;
  try {
    customToken = await admin.auth().createCustomToken(localId);
  } catch (error) {
    console.error("[CLIENT LOGIN] Custom token creation failed", error);
    throw new HttpsError("internal", "CLIENT LOGIN FAILED [custom_token]");
  }

  return {
    customToken,
    username: profile.username || customer.username || "",
    clientCode: profile.clientCode || customer.clientCode || "",
    forcePasswordChange: customer.forcePasswordChange === true,
  };
});
