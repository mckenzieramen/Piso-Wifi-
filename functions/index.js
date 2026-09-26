const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const FIREBASE_WEB_API_KEY = "AIzaSyAfX3sSDkJwX9u9dxEDBhG8RU3iP_k6EdI";
const APPS_SCRIPT_MAILER_URL = "https://script.google.com/macros/s/AKfycbzcBLoOP6LoXwTE8rhUUxd1q68ykDgVj-f4o-TD7YGPYmtXrepvhJ8dbPWdeCqQt9fM/exec";
const APPS_SCRIPT_MAILER_SECRET = "-P4NqUwISia-WpONGB2WipjobxXOC0Jnh9bdnyQMF2zNsOrWo-ERoChulEGfY14D";
const CLIENT_RESET_PAGE = "https://piso-wifi.pages.dev/reset-password.html";

function clean(value) {
  return String(value ?? "").trim();
}
function normalizeEmail(value) {
  return clean(value).toLowerCase();
}
function normalizeClientCode(value) {
  return clean(value).toUpperCase();
}
function sanitizeUsernamePart(value) {
  return (clean(value).split(/\s+/)[0] || "Client").replace(/[^A-Za-z0-9]/g, "") || "Client";
}
function fullName(firstName, lastName) {
  return `${clean(firstName)} ${clean(lastName)}`.trim();
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validClientCode(value) {
  return /^CID-\d{3,}$/.test(value);
}
function validUnitCode(value) {
  return /^([1-9]|[1-4]\d|50)$/.test(value);
}

async function requireAdmin(request) {
  const uid = clean(request.auth?.uid);
  if (!uid) throw new HttpsError("unauthenticated", "Admin authentication is required.");
  const snap = await db.doc(`users/${uid}`).get();
  const profile = snap.exists ? snap.data() : null;
  if (!profile || profile.role !== "admin" || profile.active === false) {
    throw new HttpsError("permission-denied", "This account is not authorized for Admin actions.");
  }
  return { uid, profile };
}

async function getUnitById(unitId) {
  const id = clean(unitId);
  if (!id) return null;
  const ref = db.doc(`units/${id}`);
  const snap = await ref.get();
  return snap.exists ? { ref, id, data: snap.data() } : null;
}

async function assertUniqueEmail(email, exceptUnitId = "") {
  const q = await db.collection("units").where("email", "==", email).limit(10).get();
  const duplicate = q.docs.find(doc => doc.id !== exceptUnitId);
  if (duplicate) {
    throw new HttpsError("already-exists", "This registered Gmail is already assigned to another customer account.");
  }

  try {
    const authUser = await admin.auth().getUserByEmail(email);
    if (authUser.uid !== clean(exceptUnitId)) {
      const linked = await db.collection("units").where("authUserId", "==", authUser.uid).limit(1).get();
      const linkedUnitId = linked.empty ? "" : linked.docs[0].id;
      if (linkedUnitId !== exceptUnitId) {
        throw new HttpsError("already-exists", "This Gmail is already registered in Firebase Authentication.");
      }
    }
    return authUser;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error?.code !== "auth/user-not-found") throw error;
    return null;
  }
}

async function nextClientCode() {
  const unitsSnap = await db.collection("units").select("clientCode").get();
  let maxExisting = 0;
  unitsSnap.forEach(doc => {
    const match = normalizeClientCode(doc.data()?.clientCode).match(/^CID-(\d+)$/);
    if (match) maxExisting = Math.max(maxExisting, Number(match[1]));
  });

  const sequenceRef = db.doc("settings/clientSequence");
  return db.runTransaction(async tx => {
    const sequenceSnap = await tx.get(sequenceRef);
    let next = Number(sequenceSnap.exists ? sequenceSnap.data()?.next : maxExisting + 1);
    if (!Number.isInteger(next) || next < maxExisting + 1) next = maxExisting + 1;
    const code = `CID-${String(next).padStart(3, "0")}`;
    tx.set(sequenceRef, { next: next + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return code;
  });
}

async function assertUnitCodeAvailable(unitCode, exceptUnitId = "") {
  const q = await db.collection("units").where("unitCode", "==", unitCode).limit(50).get();
  const activeConflict = q.docs.find(doc => doc.id !== exceptUnitId && doc.data()?.active !== false);
  if (activeConflict) {
    throw new HttpsError("already-exists", `Unit Code ${unitCode} is already assigned to an active customer.`);
  }
}

exports.createClientAccount = onCall({ region: "us-central1" }, async request => {
  await requireAdmin(request);
  const data = request.data || {};
  const firstName = clean(data.firstName);
  const lastName = clean(data.lastName);
  const email = normalizeEmail(data.email);
  const unitCode = clean(data.unitCode);

  if (!firstName || !lastName || !email || !unitCode) {
    throw new HttpsError("invalid-argument", "First Name, Last Name, registered Gmail, and Unit Code are required.");
  }
  if (!validEmail(email)) throw new HttpsError("invalid-argument", "Enter a valid registered Gmail address.");
  if (!validUnitCode(unitCode)) throw new HttpsError("invalid-argument", "Unit Code must be between 1 and 50.");

  await assertUniqueEmail(email);
  await assertUnitCodeAvailable(unitCode);

  const clientCode = await nextClientCode();
  const username = `${sanitizeUsernamePart(firstName)}${clientCode}`;
  const temporaryPassword = clientCode;
  const name = fullName(firstName, lastName);

  let authUser = null;
  try {
    authUser = await admin.auth().createUser({
      email,
      password: temporaryPassword,
      displayName: name,
      disabled: false
    });

    const unitRef = db.collection("units").doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const unitData = {
      clientCode,
      unitCode,
      firstName,
      lastName,
      name,
      email,
      authEmail: email,
      authUserId: authUser.uid,
      username,
      loginId: username,
      forcePasswordChange: true,
      location: clean(data.location),
      address: clean(data.address),
      contact: clean(data.contact),
      dateJoined: clean(data.dateJoined) || new Date().toISOString().slice(0, 10),
      notes: clean(data.notes),
      active: true,
      createdAt: now,
      updatedAt: now
    };

    const batch = db.batch();
    batch.set(unitRef, unitData);
    batch.set(db.doc(`users/${authUser.uid}`), {
      role: "client",
      active: true,
      clientUnitId: unitRef.id,
      unitId: unitRef.id,
      clientCode,
      username,
      email,
      createdAt: now,
      updatedAt: now
    });
    batch.set(db.doc(`customerLoginDirectory/${clientCode}`), {
      clientCode,
      unitCode,
      email,
      username,
      unitDocId: unitRef.id,
      authUserId: authUser.uid,
      active: true,
      updatedAt: now
    });
    await batch.commit();

    return {
      ok: true,
      clientCode,
      username,
      temporaryPassword,
      unitId: unitRef.id,
      email
    };
  } catch (error) {
    if (authUser?.uid) {
      try { await admin.auth().deleteUser(authUser.uid); } catch (cleanupError) {
        console.error("[CREATE CLIENT] Auth cleanup failed", cleanupError);
      }
    }
    if (error instanceof HttpsError) throw error;
    console.error("[CREATE CLIENT] Failed", error);
    throw new HttpsError("internal", `CLIENT ACCOUNT CREATION FAILED: ${error?.message || "Unknown error."}`);
  }
});

exports.updateClientAccount = onCall({ region: "us-central1" }, async request => {
  await requireAdmin(request);
  const data = request.data || {};
  const unitId = clean(data.unitId);
  const firstName = clean(data.firstName);
  const lastName = clean(data.lastName);
  const email = normalizeEmail(data.email);
  const unitCode = clean(data.unitCode);
  const active = data.active !== false;

  const unit = await getUnitById(unitId);
  if (!unit) throw new HttpsError("not-found", "Customer account was not found.");
  if (!firstName || !lastName || !email || !unitCode) throw new HttpsError("invalid-argument", "Required customer fields are missing.");
  if (!validEmail(email)) throw new HttpsError("invalid-argument", "Enter a valid registered Gmail address.");
  if (!validUnitCode(unitCode)) throw new HttpsError("invalid-argument", "Unit Code must be between 1 and 50.");

  await assertUnitCodeAvailable(unitCode, unitId);

  const oldEmail = normalizeEmail(unit.data.email || unit.data.authEmail);
  const authUserId = clean(unit.data.authUserId);
  let authUser = authUserId ? await admin.auth().getUser(authUserId) : null;

  if (email !== oldEmail) {
    const existingAuth = await assertUniqueEmail(email, unitId);
    if (existingAuth && existingAuth.uid !== authUserId) {
      throw new HttpsError("already-exists", "This Gmail is already registered to another account.");
    }
    if (authUserId) {
      authUser = await admin.auth().updateUser(authUserId, { email, disabled: !active, displayName: fullName(firstName, lastName) });
    }
  } else if (authUserId) {
    authUser = await admin.auth().updateUser(authUserId, { disabled: !active, displayName: fullName(firstName, lastName) });
  }

  const username = `${sanitizeUsernamePart(firstName)}${normalizeClientCode(unit.data.clientCode)}`;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const patch = {
    unitCode,
    firstName,
    lastName,
    name: fullName(firstName, lastName),
    email,
    authEmail: email,
    username,
    loginId: username,
    active,
    location: clean(data.location),
    address: clean(data.address),
    contact: clean(data.contact),
    dateJoined: clean(data.dateJoined) || unit.data.dateJoined || new Date().toISOString().slice(0, 10),
    notes: clean(data.notes),
    updatedAt: now
  };

  const batch = db.batch();
  batch.update(unit.ref, patch);
  if (authUserId) {
    batch.set(db.doc(`users/${authUserId}`), {
      role: "client",
      active,
      clientUnitId: unit.id,
      unitId: unit.id,
      clientCode: normalizeClientCode(unit.data.clientCode),
      username,
      email,
      updatedAt: now
    }, { merge: true });
    batch.set(db.doc(`customerLoginDirectory/${normalizeClientCode(unit.data.clientCode)}`), {
      clientCode: normalizeClientCode(unit.data.clientCode),
      unitCode,
      email,
      username,
      unitDocId: unit.id,
      authUserId,
      active,
      updatedAt: now
    }, { merge: true });
  }
  await batch.commit();

  return { ok: true, username, email, active };
});

async function findCustomer(identifier) {
  const value = clean(identifier);
  if (!value) return null;
  const lower = value.toLowerCase();
  const upper = value.toUpperCase();

  if (lower.includes("@")) {
    const snap = await db.collection("units").where("email", "==", lower).limit(1).get();
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
    return null;
  }

  const usernameSnap = await db.collection("units").where("username", "==", value).limit(1).get();
  if (!usernameSnap.empty) return { id: usernameSnap.docs[0].id, ...usernameSnap.docs[0].data() };

  const code = normalizeClientCode(value);
  if (validClientCode(code)) {
    const codeSnap = await db.collection("units").where("clientCode", "==", code).limit(1).get();
    if (!codeSnap.empty) return { id: codeSnap.docs[0].id, ...codeSnap.docs[0].data() };
  }
  return null;
}

exports.clientLogin = onCall({ region: "us-central1" }, async request => {
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
  if (!customer) throw new HttpsError("unauthenticated", "Invalid customer login credentials.");
  if (customer.active === false) throw new HttpsError("permission-denied", "This customer account is inactive.");

  const authEmail = normalizeEmail(customer.authEmail || customer.email);
  if (!authEmail || !validEmail(authEmail)) {
    throw new HttpsError("failed-precondition", "CLIENT LOGIN FAILED [auth_email_missing]");
  }

  // First-login accounts use Client ID as the temporary password. If an older
  // account was created before the current provisioning flow and its Firebase
  // password became out of sync, re-establish the temporary password before
  // authentication. This applies only while forcePasswordChange is true.
  const clientCode = normalizeClientCode(customer.clientCode);
  if (customer.forcePasswordChange === true && validClientCode(clientCode) && password === clientCode) {
    const authUserId = clean(customer.authUserId);
    if (!authUserId) throw new HttpsError("failed-precondition", "CLIENT LOGIN FAILED [auth_user_missing]");
    try {
      await admin.auth().updateUser(authUserId, { password: clientCode, disabled: false });
    } catch (error) {
      console.error("[CLIENT LOGIN] Temporary password synchronization failed", error);
      throw new HttpsError("internal", "CLIENT LOGIN FAILED [temporary_password_sync]");
    }
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
    console.error("[CLIENT LOGIN] Firebase Auth request failed", error);
    throw new HttpsError("internal", "CLIENT LOGIN FAILED [firebase_auth_request]");
  }

  let authPayload = {};
  try { authPayload = await authResponse.json(); }
  catch (error) { throw new HttpsError("internal", "CLIENT LOGIN FAILED [firebase_auth_response]"); }

  if (!authResponse.ok) {
    const authError = authPayload?.error?.message || "AUTHENTICATION_FAILED";
    console.warn("[CLIENT LOGIN] Authentication rejected", { authError, identifier });
    if (["INVALID_PASSWORD", "EMAIL_NOT_FOUND", "INVALID_LOGIN_CREDENTIALS"].includes(authError)) {
      throw new HttpsError("unauthenticated", "Invalid customer login credentials.");
    }
    if (authError === "USER_DISABLED") {
      throw new HttpsError("permission-denied", "This customer account is inactive.");
    }
    throw new HttpsError("internal", `CLIENT LOGIN FAILED [firebase_auth_response]: ${authError}`);
  }

  const localId = clean(authPayload.localId);
  if (!localId) throw new HttpsError("internal", "CLIENT LOGIN FAILED [firebase_auth_response]: missing localId");

  const profileSnap = await db.doc(`users/${localId}`).get();
  const profile = profileSnap.exists ? profileSnap.data() : null;
  if (!profile || profile.role !== "client" || profile.active === false) {
    throw new HttpsError("permission-denied", "This account is not authorized for the Customer Account.");
  }

  const customToken = await admin.auth().createCustomToken(localId);
  return {
    customToken,
    username: profile.username || customer.username || "",
    clientCode: profile.clientCode || customer.clientCode || "",
    forcePasswordChange: customer.forcePasswordChange === true
  };
});

async function findCustomerByClientCode(code) {
  const clientCode = normalizeClientCode(code);
  const snap = await db.collection("units").where("clientCode", "==", clientCode).limit(1).get();
  if (!snap.empty) return { ref: snap.docs[0].ref, data: snap.docs[0].data() };
  return null;
}

async function sendCustomPasswordResetCallable(request) {
  let stage = "input_validation";
  let clientCode = "";
  try {
    clientCode = normalizeClientCode(request.data?.clientCode);
    const email = normalizeEmail(request.data?.email);
    if (!validClientCode(clientCode) || !validEmail(email)) {
      throw new HttpsError("invalid-argument", "Please enter a valid Client ID and registered Gmail.");
    }

    stage = "customer_lookup";
    const customer = await findCustomerByClientCode(clientCode);
    if (!customer) throw new HttpsError("not-found", `Client ID ${clientCode} was not found.`);

    stage = "customer_validation";
    const unit = customer.data || {};
    if (unit.active === false) throw new HttpsError("permission-denied", `Client ID ${clientCode} is inactive. Please contact PISO WIFI Admin.`);
    const registeredEmail = normalizeEmail(unit.email || unit.authEmail);
    if (!registeredEmail) throw new HttpsError("failed-precondition", `${clientCode} does not have a registered Gmail address.`);
    if (registeredEmail !== email) {
      throw new HttpsError("permission-denied", "The Client ID and registered Gmail do not match our records.");
    }

    stage = "firebase_auth_lookup";
    const authUserId = clean(unit.authUserId);
    if (!authUserId) throw new HttpsError("failed-precondition", `${clientCode} is not linked to Firebase Authentication.`);
    const authUser = await admin.auth().getUser(authUserId);
    if (normalizeEmail(authUser.email) !== registeredEmail) {
      throw new HttpsError("failed-precondition", "The registered Gmail does not match the Firebase Authentication account.");
    }
    if (authUser.disabled) throw new HttpsError("permission-denied", "This customer account is inactive.");

    stage = "generate_reset_link";
    const firebaseActionLink = await admin.auth().generatePasswordResetLink(registeredEmail);
    const parsed = new URL(firebaseActionLink);
    const oobCode = parsed.searchParams.get("oobCode");
    const apiKey = parsed.searchParams.get("apiKey");
    if (!oobCode) throw new Error("Firebase did not return a password-reset action code.");

    stage = "build_reset_url";
    const resetUrl = new URL(CLIENT_RESET_PAGE);
    resetUrl.searchParams.set("mode", "resetPassword");
    resetUrl.searchParams.set("oobCode", oobCode);
    if (apiKey) resetUrl.searchParams.set("apiKey", apiKey);

    stage = "apps_script_fetch";
    let response;
    let responseText = "";
    let responseData = {};
    try {
      response = await fetch(APPS_SCRIPT_MAILER_URL, {
        method: "POST",
        redirect: "follow",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          secret: APPS_SCRIPT_MAILER_SECRET,
          email: registeredEmail,
          clientId: clientCode,
          firstName: clean(unit.firstName) || "Customer",
          resetLink: resetUrl.toString()
        })
      });
      responseText = await response.text();
      try { responseData = responseText ? JSON.parse(responseText) : {}; } catch (_) {}
    } catch (error) {
      throw new HttpsError("failed-precondition", `CUSTOM EMAIL SERVICE CONNECTION FAILED [${stage}]: ${error?.message || "Unable to reach the Apps Script mailer."}`, { stage, clientCode });
    }

    stage = "apps_script_response";
    if (!response.ok) {
      throw new HttpsError("failed-precondition", `CUSTOM EMAIL SERVICE HTTP ERROR ${response.status}: ${responseData.error || responseText.slice(0, 300) || "No response body."}`, { stage, clientCode });
    }
    if (responseData.ok !== true) {
      throw new HttpsError("failed-precondition", `CUSTOM EMAIL SERVICE REJECTED THE REQUEST: ${responseData.error || responseText.slice(0, 300) || "No JSON success response."}`, { stage, clientCode });
    }

    stage = "firestore_write";
    await db.collection("passwordResetRequests").add({
      clientCode,
      email: registeredEmail,
      status: "email_sent",
      adminRead: false,
      emailSent: true,
      emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      resetEmailSentTo: registeredEmail,
      resetEmailStatus: "sent"
    });

    return { ok: true, emailSent: true };
  } catch (error) {
    console.error("[PASSWORD RESET]", { stage, clientCode, errorName: error?.name, errorCode: error?.code, errorMessage: error?.message, details: error?.details });
    if (error instanceof HttpsError && error.code !== "internal") throw error;
    throw new HttpsError("internal", `PASSWORD RESET FAILED [${stage}]: ${error?.message || "Unknown server error."}`, { stage, clientCode });
  }
}

exports.sendCustomPasswordReset = onCall({ region: "us-central1" }, sendCustomPasswordResetCallable);
