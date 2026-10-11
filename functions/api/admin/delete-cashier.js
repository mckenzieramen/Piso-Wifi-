const corsHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function decodeJwtPart(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return JSON.parse(atob(padded));
}

async function getGoogleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/datastore",
    aud: serviceAccount.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3500
  };
  const enc = (obj) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = `${enc(header)}.${enc(claims)}`;
  const pem = serviceAccount.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)
  ));
  const sig = btoa(String.fromCharCode(...signature))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const assertion = `${unsigned}.${sig}`;
  const tokenResponse = await fetch(claims.aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error("Could not obtain a server access token. Check Cloudflare service-account configuration.");
  }
  return tokenBody.access_token;
}

async function lookupFirebaseUser(idToken, apiKey) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  const body = await response.json();
  if (!response.ok || !body.users?.[0]) return null;
  return body.users[0];
}

async function getFirestoreDoc(accessToken, projectId, path) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${path}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (response.status === 404) return null;
  const body = await response.json();
  if (!response.ok) throw new Error("Could not read account profiles from Firestore.");
  return body;
}

function firestoreString(doc, field) {
  const value = doc?.fields?.[field];
  if (!value) return "";
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.booleanValue === "boolean") return String(value.booleanValue);
  return "";
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_API_KEY || !env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return json({ error: "Permanent deletion endpoint is not configured yet. Set the required Cloudflare secrets first." }, 503);
    }
    const authHeader = request.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!idToken) return json({ error: "Admin sign-in is required." }, 401);

    const body = await request.json().catch(() => ({}));
    const targetUid = String(body.cashierUid || "").trim();
    if (!targetUid || targetUid.length > 128) return json({ error: "A valid Cashier UID is required." }, 400);

    const caller = await lookupFirebaseUser(idToken, env.FIREBASE_API_KEY);
    if (!caller) return json({ error: "Admin session is invalid or expired. Sign in again." }, 401);
    if (caller.localId === targetUid) return json({ error: "You cannot delete your own account." }, 400);

    const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (serviceAccount.project_id !== env.FIREBASE_PROJECT_ID) {
      return json({ error: "Firebase project ID does not match the configured service account." }, 500);
    }
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const adminDoc = await getFirestoreDoc(accessToken, env.FIREBASE_PROJECT_ID, `users/${encodeURIComponent(caller.localId)}`);
    if (String(firestoreString(adminDoc, "role")).toLowerCase() !== "admin" ||
        firestoreString(adminDoc, "active").toLowerCase() === "false") {
      return json({ error: "Only an active Admin account can permanently delete Cashiers." }, 403);
    }

    const cashierDoc = await getFirestoreDoc(accessToken, env.FIREBASE_PROJECT_ID, `users/${encodeURIComponent(targetUid)}`);
    if (!cashierDoc || String(firestoreString(cashierDoc, "role")).toLowerCase() !== "cashier") {
      return json({ error: "Target account is not a registered Cashier." }, 404);
    }

    const deleteAuth = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts:delete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ localId: targetUid })
      }
    );
    const deleteAuthBody = await deleteAuth.json().catch(() => ({}));
    if (!deleteAuth.ok) {
      return json({ error: deleteAuthBody.error?.message || "Firebase Authentication could not delete this Cashier." }, 502);
    }

    // Remove the Firestore profile only after Firebase Authentication deletion succeeds.
    const profileUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/users/${encodeURIComponent(targetUid)}`;
    const deleteProfile = await fetch(profileUrl, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!deleteProfile.ok && deleteProfile.status !== 404) {
      return json({
        error: "The login was permanently deleted, but the Firestore profile cleanup failed. Remove users/" + targetUid + " using the Admin console."
      }, 502);
    }

    return json({ ok: true, deletedUid: targetUid, salesHistoryPreserved: true });
  } catch (error) {
    console.error("Permanent cashier deletion failed:", error);
    return json({ error: error?.message || "Permanent deletion failed." }, 500);
  }
}
