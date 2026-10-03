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
  const clean = String(s || "").replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s+/g, "");
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
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` })
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error(data.error_description || data.error || "Unable to obtain Google access token.");
  return { token: data.access_token, serviceAccount: sa };
}

async function firestoreListDirectory(token) {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/customerLoginDirectory?pageSize=1000`, { headers: { authorization: `Bearer ${token}` } });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || "Unable to read the customer login directory.");
  return Array.isArray(data.documents) ? data.documents : [];
}

async function firestorePatch(token, path, fields) {
  const names = Object.keys(fields);
  const params = names.map(name => `updateMask.fieldPaths=${encodeURIComponent(name)}`).join("&");
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}?${params}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ fields })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || `Unable to update ${path}.`);
  return data;
}

function textField(value) { return { stringValue: String(value ?? "") }; }
function boolField(value) { return { booleanValue: Boolean(value) }; }
function timestampField(date = new Date()) { return { timestampValue: date.toISOString() }; }

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
  const key = await crypto.subtle.importKey("pkcs8", fromB64(serviceAccount.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(signature)}`;
}

async function exchangeCustomToken(customToken) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const data = await r.json();
  if (!r.ok || !data.idToken || !data.localId) throw new Error(data?.error?.message || "Unable to establish the temporary recovery session.");
  return data;
}

async function updatePasswordWithAdminToken(idToken, newPassword) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken, password: newPassword, returnSecureToken: false })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || "Unable to update the customer password.");
  return data;
}

function findMatch(docs, clientId, email) {
  const cid = String(clientId || "").trim().toUpperCase();
  const mail = String(email || "").trim().toLowerCase();
  return docs.find(doc => {
    const f = doc.fields || {};
    return String(sv(f, "clientCode", "")).trim().toUpperCase() === cid && String(sv(f, "email", "")).trim().toLowerCase() === mail;
  }) || null;
}

async function callAppsScript(env, payload) {
  const url = String(env.APPS_SCRIPT_PASSWORD_RESET_URL || "").trim();
  if (!url) throw new Error("APPS_SCRIPT_PASSWORD_RESET_URL is not configured.");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "follow"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Apps Script returned HTTP ${response.status}.`);
  return data;
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    const clientId = String(body.clientId || "").trim().toUpperCase();
    const email = String(body.email || "").trim().toLowerCase();

    if (!/^CID-\d{3,}$/i.test(clientId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "Enter a valid Client ID and registered Gmail." }, 400);
    }

    // Browser-visible recovery actions are proxied through this same-origin function.
    // Apps Script remains the mailer/code store; its bridge secret never reaches the browser.
    if (action === "requestCode") {
      const result = await callAppsScript(context.env, { action: "requestCode", clientId, email });
      return json(result, result.ok ? 200 : 400);
    }

    if (action === "verifyCode") {
      const code = String(body.code || "").trim();
      if (!/^\d{6}$/.test(code)) return json({ ok: false, error: "Enter the 6-digit verification code." }, 400);
      const result = await callAppsScript(context.env, { action: "verifyCode", clientId, email, code });
      return json(result, result.ok ? 200 : 400);
    }

    // These two actions are private bridge operations called only by the Apps Script.
    const bridgeSecret = String(body.bridgeSecret || "");
    if (!context.env.PASSWORD_RESET_MAILER_SECRET || bridgeSecret !== context.env.PASSWORD_RESET_MAILER_SECRET) {
      return json({ ok: false, error: "Unauthorized password recovery request." }, 401);
    }

    const { token, serviceAccount } = await googleAccessToken(context.env);
    const docs = await firestoreListDirectory(token);
    const match = findMatch(docs, clientId, email);
    if (!match) return json({ ok: false, error: "The Client ID and registered Gmail do not match." }, 404);

    const fields = match.fields || {};
    const active = sv(fields, "active", true);
    const uid = String(sv(fields, "authUserId", "")).trim();
    if (active === false || !uid) return json({ ok: false, error: "This customer account is not available." }, 403);

    if (action === "verifyAccount") return json({ ok: true });

    if (action !== "resetPassword") return json({ ok: false, error: "Invalid recovery action." }, 400);

    const newPassword = String(body.newPassword || "");
    if (!/^\d{6}$/.test(newPassword)) return json({ ok: false, error: "The temporary password must be exactly 6 digits." }, 400);

    const customToken = await makeCustomToken(serviceAccount, uid);
    const authSession = await exchangeCustomToken(customToken);
    if (authSession.localId !== uid) return json({ ok: false, error: "Customer account verification failed." }, 403);
    await updatePasswordWithAdminToken(authSession.idToken, newPassword);

    const now = new Date();
    const matchPath = String(match.name).replace(`projects/${PROJECT_ID}/databases/(default)/documents/`, "");
    await firestorePatch(token, matchPath, {
      forcePasswordChange: boolField(true),
      passwordChangedAt: timestampField(now),
      updatedAt: timestampField(now)
    });

    const unitDocId = String(sv(fields, "unitDocId", "")).trim();
    if (unitDocId) {
      await firestorePatch(token, `units/${unitDocId}`, {
        forcePasswordChange: boolField(true),
        passwordChangedAt: timestampField(now),
        updatedAt: timestampField(now)
      });
    }

    return json({ ok: true, temporaryPasswordSet: true });
  } catch (error) {
    console.error("[PISO WIFI PASSWORD RESET CODE]", error);
    return json({ ok: false, error: error?.message || "PASSWORD_RESET_SERVER_ERROR" }, 500);
  }
}
