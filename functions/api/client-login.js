const PROJECT_ID = "piso-wifi-f2b5c";
const FIREBASE_API_KEY = "AIzaSyAfX3sSDkJwX9u9dxEDBhG8RU3iP_k6EdI";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function b64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64(s) {
  const clean = String(s || "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function sv(fields, name, fallback = "") {
  const f = fields?.[name];
  if (!f) return fallback;
  if (Object.prototype.hasOwnProperty.call(f, "stringValue")) return String(f.stringValue || "");
  if (Object.prototype.hasOwnProperty.call(f, "booleanValue")) return Boolean(f.booleanValue);
  if (Object.prototype.hasOwnProperty.call(f, "integerValue")) return Number(f.integerValue);
  return fallback;
}

async function googleAccessToken(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  }
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!sa.client_email || !sa.private_key) {
    throw new Error("Firebase service-account secret is incomplete.");
  }

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
  const key = await crypto.subtle.importKey(
    "pkcs8",
    fromB64(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );

  const assertion = `${unsigned}.${b64url(signature)}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Unable to obtain Google access token.");
  }
  return { token: data.access_token, serviceAccount: sa };
}

async function firestoreGet(token, path) {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  const data = await r.json();
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(data.error?.message || `Unable to read Firestore document ${path}.`);
  return data;
}

async function firestoreListDirectory(token) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/customerLoginDirectory?pageSize=1000`;
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || "Unable to read the customer login directory.");
  return Array.isArray(data.documents) ? data.documents : [];
}

async function verifyPassword(email, password) {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );
  const data = await r.json();
  if (!r.ok || !data.localId) {
    const code = String(data?.error?.message || "");
    const e = new Error(code || "INVALID_LOGIN_CREDENTIALS");
    e.code = code;
    throw e;
  }
  return data;
}

async function makeCustomToken(serviceAccount, uid) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: serviceAccount.client_email,
    sub: uid,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid
  }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    fromB64(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  return `${unsigned}.${b64url(signature)}`;
}

function normalizeIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesDirectory(identifier, fields, docName) {
  const id = normalizeIdentifier(identifier);
  const clientCode = String(sv(fields, "clientCode", "")).trim().toLowerCase();
  const username = String(sv(fields, "username", "")).trim().toLowerCase();
  const email = String(sv(fields, "email", "")).trim().toLowerCase();
  const unitCode = String(sv(fields, "unitCode", "")).trim().toLowerCase();
  const docId = String(docName || "").split("/").pop().toLowerCase();
  const normalizedUnit = unitCode.replace(/^c-/, "");
  const normalizedInputUnit = id.replace(/^c-/, "");
  return id === clientCode || id === username || id === email ||
    (normalizedInputUnit && normalizedInputUnit === normalizedUnit && /^\d{1,3}$/.test(normalizedInputUnit)) ||
    id === docId;
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const identifier = String(body.identifier || "").trim();
    const password = String(body.password || "");
    if (!identifier || !password) return json({ error: "Login credentials are required." }, 400);
    if (password.length < 6) return json({ error: "Invalid login credentials." }, 401);

    const { token, serviceAccount } = await googleAccessToken(context.env);
    const directoryDocs = await firestoreListDirectory(token);
    const match = directoryDocs.find(doc => matchesDirectory(identifier, doc.fields || {}, doc.name));
    if (!match) return json({ error: "CLIENT_ACCOUNT_NOT_FOUND" }, 401);

    const fields = match.fields || {};
    const active = sv(fields, "active", true);
    const email = String(sv(fields, "email", "")).trim().toLowerCase();
    const authUserId = String(sv(fields, "authUserId", "")).trim();
    if (active === false || !email || !authUserId) return json({ error: "CLIENT_ACCOUNT_NOT_AVAILABLE" }, 403);

    const authResult = await verifyPassword(email, password);
    if (authResult.localId !== authUserId) return json({ error: "CLIENT_ACCOUNT_MISMATCH" }, 403);

    const userProfile = await firestoreGet(token, `users/${authUserId}`);
    const role = String(sv(userProfile?.fields, "role", ""));
    const profileActive = sv(userProfile?.fields, "active", true);
    if (role !== "client" || profileActive === false) return json({ error: "CLIENT_ACCOUNT_NOT_AVAILABLE" }, 403);

    const customToken = await makeCustomToken(serviceAccount, authUserId);
    return json({ ok: true, customToken });
  } catch (error) {
    console.error("[PISO WIFI CLIENT LOGIN]", error);
    const code = String(error?.code || error?.message || "");
    if (/INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS|INVALID_LOGIN|EMAIL_NOT_FOUND|INVALID_PASSWORD/i.test(code)) {
      return json({ error: "INVALID_LOGIN_CREDENTIALS" }, 401);
    }
    return json({ error: "CLIENT_LOGIN_SERVER_ERROR" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Content-Type"
    }
  });
}
