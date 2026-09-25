const PROJECT_ID = "piso-wifi-f2b5c";
const FIREBASE_API_KEY = "AIzaSyAfX3sSDkJwX9u9dxEDBhG8RU3iP_k6EdI";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function b64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64(s) {
  const clean = s.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function googleAccessToken(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!sa.client_email || !sa.private_key) throw new Error("Firebase service-account secret is incomplete.");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey("pkcs8", fromB64(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64url(signature)}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error(data.error_description || data.error || "Unable to obtain Google access token.");
  return data.access_token;
}

async function authLookup(idToken) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  const data = await r.json();
  if (!r.ok || !data.users?.[0]?.localId) throw new Error("Authentication token is invalid or expired.");
  return data.users[0];
}

async function firestoreGet(token, path) {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const data = await r.json();
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(data.error?.message || `Unable to read Firestore document ${path}.`);
  return data;
}

function fieldValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number" && Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === "number") return { doubleValue: v };
  return { stringValue: String(v) };
}

async function firestorePatch(token, path, fields) {
  const qs = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}?${qs}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fieldValue(v)])) })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || `Unable to update Firestore document ${path}.`);
  return data;
}

async function setAuthPassword(token, uid, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ localId: uid, password, returnSecureToken: false })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || "Unable to set the temporary password.");
  return data;
}

export async function onRequestPost(context) {
  try {
    const authHeader = context.request.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Authentication required." }, 401);
    const idToken = authHeader.slice(7).trim();
    const body = await context.request.json().catch(() => ({}));
    const requestId = String(body.requestId || "").trim();
    const temporaryPassword = String(body.temporaryPassword || "");
    if (!requestId) return json({ error: "Recovery request ID is required." }, 400);
    if (temporaryPassword.length < 8) return json({ error: "Temporary password must be at least 8 characters." }, 400);

    const firebaseUser = await authLookup(idToken);
    const googleToken = await googleAccessToken(context.env);
    const adminProfile = await firestoreGet(googleToken, `users/${firebaseUser.localId}`);
    const adminFields = adminProfile?.fields || {};
    if (adminFields.role?.stringValue !== "admin" || adminFields.active?.booleanValue === false) {
      return json({ error: "Admin authorization required." }, 403);
    }

    const request = await firestoreGet(googleToken, `passwordResetRequests/${requestId}`);
    if (!request) return json({ error: "Recovery request not found." }, 404);
    const rf = request.fields || {};
    if (rf.status?.stringValue !== "pending") return json({ error: "This recovery request has already been reviewed." }, 409);
    const clientCode = String(rf.clientCode?.stringValue || "").trim().toUpperCase();
    const requestedEmail = String(rf.email?.stringValue || "").trim().toLowerCase();
    if (!/^CID-\d{3,}$/.test(clientCode)) return json({ error: "Invalid Client ID in the recovery request." }, 400);

    const directory = await firestoreGet(googleToken, `customerLoginDirectory/${clientCode}`);
    if (!directory) return json({ error: "Customer account directory entry was not found." }, 404);
    const df = directory.fields || {};
    const directoryEmail = String(df.email?.stringValue || "").trim().toLowerCase();
    const authUserId = String(df.authUserId?.stringValue || "").trim();
    const unitDocId = String(df.unitDocId?.stringValue || "").trim();
    if (!authUserId || !unitDocId) return json({ error: "Customer account is not fully linked to Firebase Authentication." }, 400);
    if (directoryEmail !== requestedEmail) return json({ error: "Recovery request details do not match the registered account." }, 403);

    await setAuthPassword(googleToken, authUserId, temporaryPassword);
    const now = new Date().toISOString();
    await firestorePatch(googleToken, `passwordResetRequests/${requestId}`, {
      status: "approved",
      adminRead: true,
      reviewedAt: now,
      reviewedBy: firebaseUser.email || firebaseUser.localId,
      temporaryPasswordSetAt: now
    });
    await firestorePatch(googleToken, `units/${unitDocId}`, {
      forcePasswordChange: true,
      passwordChangedAt: null,
      updatedAt: now
    });

    return json({ ok: true });
  } catch (error) {
    console.error("[PISO WIFI RECOVERY]", error);
    return json({ error: error?.message || "Unable to set the temporary password." }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "Content-Type, Authorization" } });
}
