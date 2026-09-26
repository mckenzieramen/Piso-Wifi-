const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

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
