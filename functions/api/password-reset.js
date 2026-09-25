const PROJECT_ID = "piso-wifi-f2b5c";
const RESET_MAILER_URL = "https://script.google.com/macros/s/AKfycbzcBLoOP6LoXwTE8rhUUxd1q68ykDgVj-f4o-TD7YGPYmtXrepvhJ8dbPWdeCqQt9fM/exec";
const RESET_MAILER_SECRET = "-P4NqUwISia-WpONGB2WipjobxXOC0Jnh9bdnyQMF2zNsOrWo-ERoChulEGfY14D";
const RESET_HANDLER_URL = "https://piso-wifi.pages.dev/reset-password.html";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Content-Type"
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

function firestoreString(value) {
  return { stringValue: String(value ?? "") };
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
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "Unable to obtain Google access token.");
  }

  return tokenData.access_token;
}

async function firestoreGet(token, path) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        "x-goog-user-project": PROJECT_ID
      }
    }
  );

  const data = await response.json();
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(data.error?.message || `Unable to read Firestore document ${path}.`);
  }
  return data;
}

async function firestoreCreate(token, collectionName, fields) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionName}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-goog-user-project": PROJECT_ID,
        "content-type": "application/json"
      },
      body: JSON.stringify({ fields })
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Unable to create Firestore document in ${collectionName}.`);
  }
  return data;
}

async function generateResetLink(token, email, userIp) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:sendOobCode`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-goog-user-project": PROJECT_ID,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email,
        returnOobLink: true,
        targetProjectId: PROJECT_ID,
        continueUrl: RESET_HANDLER_URL,
        userIp: userIp || "0.0.0.0"
      })
    }
  );

  const data = await response.json();
  if (!response.ok || !data.oobLink) {
    console.error("[PISO WIFI RESET LINK]", data);
    throw new Error(data.error?.message || "Unable to generate the secure password-reset link.");
  }

  return data.oobLink;
}

async function sendCustomResetEmail({ email, clientId, firstName, resetLink }) {
  if (!RESET_MAILER_URL || RESET_MAILER_URL.includes("PASTE_YOUR_")) {
    throw new Error("The Apps Script reset-mailer URL has not been configured yet.");
  }

  const response = await fetch(RESET_MAILER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-piso-reset-secret": RESET_MAILER_SECRET
    },
    body: JSON.stringify({
      secret: RESET_MAILER_SECRET,
      email,
      clientId,
      firstName: firstName || "Customer",
      resetLink
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "The custom password-reset email could not be sent.");
  }

  return data;
}

function getClientIp(request) {
  const forwarded = request.headers.get("CF-Connecting-IP")
    || request.headers.get("X-Forwarded-For")
    || "";
  return String(forwarded).split(",")[0].trim() || "0.0.0.0";
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const clientId = String(body.clientId || "").trim().toUpperCase();
    const email = String(body.email || "").trim().toLowerCase();

    if (!/^CID-\d{3,}$/.test(clientId) || !email || !email.includes("@")) {
      return json({ ok: false, error: "Enter a valid Client ID and registered Gmail address." }, 400);
    }

    const googleToken = await googleAccessToken(context.env);
    const directory = await firestoreGet(googleToken, `customerLoginDirectory/${clientId}`);

    // Do not reveal whether the Client ID or email exists independently.
    // Both values must match the same Admin-created customer record.
    if (!directory) {
      return json({ ok: false, error: "We could not verify those account details." }, 400);
    }

    const fields = directory.fields || {};
    const registeredEmail = String(fields.email?.stringValue || "").trim().toLowerCase();
    const firstName = String(fields.firstName?.stringValue || "").trim();
    const active = fields.active?.booleanValue;
    const authUserId = String(fields.authUserId?.stringValue || "").trim();

    if (!registeredEmail || registeredEmail !== email || !authUserId || active === false) {
      return json({ ok: false, error: "We could not verify those account details." }, 400);
    }

    const resetLink = await generateResetLink(
      googleToken,
      registeredEmail,
      getClientIp(context.request)
    );

    await sendCustomResetEmail({
      email: registeredEmail,
      clientId,
      firstName,
      resetLink
    });

    // Best-effort audit/notification records. The email is already sent
    // before these writes, so a Firestore rule issue will not cause a
    // false failure after the customer receives the message.
    try {
      await firestoreCreate(googleToken, "passwordResetRequests", {
        clientCode: firestoreString(clientId),
        email: firestoreString(registeredEmail),
        status: firestoreString("email_sent"),
        adminRead: { booleanValue: false },
        createdAt: { timestampValue: new Date().toISOString() }
      });

      await firestoreCreate(googleToken, "notifications", {
        type: firestoreString("password-reset"),
        title: firestoreString("Customer password reset requested"),
        message: firestoreString(`Password reset email sent to ${clientId} (${registeredEmail}).`),
        relatedId: firestoreString(""),
        clientCode: firestoreString(clientId),
        email: firestoreString(registeredEmail),
        read: { booleanValue: false },
        createdAt: { timestampValue: new Date().toISOString() }
      });
    } catch (recordError) {
      console.warn("[PISO WIFI PASSWORD RESET] Email sent, but audit notification could not be recorded.", recordError);
    }

    return json({ ok: true });
  } catch (error) {
    console.error("[PISO WIFI PASSWORD RESET]", error);
    return json({
      ok: false,
      error: error?.message || "We could not send the password-reset email right now."
    }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Content-Type, X-Piso-Reset-Secret"
    }
  });
}
