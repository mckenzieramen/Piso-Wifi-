const PROJECT_ID = "piso-wifi-f2b5c";
const FIREBASE_API_KEY = "AIzaSyAfX3sSDkJwX9u9dxEDBhG8RU3iP_k6EdI";
const RESET_MAILER_URL = "https://script.google.com/macros/s/AKfycbzcBLoOP6LoXwTE8rhUUxd1q68ykDgVj-f4o-TD7YGPYmtXrepvhJ8dbPWdeCqQt9fM/exec";
const RESET_MAILER_SECRET = "-P4NqUwISia-WpONGB2WipjobxXOC0Jnh9bdnyQMF2zNsOrWo-ERoChulEGfY14D";
const CLIENT_RESET_PAGE = "https://piso-wifi.pages.dev/reset-password.html";

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
    scope: "https://www.googleapis.com/auth/cloud-platform",
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
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Unable to obtain Google access token.");
  }
  return data.access_token;
}

async function generateResetLink(env, email) {
  const token = await googleAccessToken(env);
  const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(FIREBASE_API_KEY)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${token}`,
      "x-goog-user-project": PROJECT_ID
    },
    body: JSON.stringify({
      requestType: "PASSWORD_RESET",
      email,
      returnOobLink: true,
      continueUrl: CLIENT_RESET_PAGE,
      canHandleCodeInApp: true
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.oobLink) {
    const apiError = String(data?.error?.message || data?.error?.status || "Unable to generate password-reset link.");
    throw new Error(`FIREBASE_RESET_LINK_ERROR: ${apiError}`);
  }

  // Firebase returns a hosted action link. The custom PISO WIFI reset page
  // needs the one-time oobCode directly, so extract it and build our own
  // branded reset-page URL. The code itself is never stored.
  const link = new URL(data.oobLink);
  const oobCode = link.searchParams.get("oobCode");
  if (!oobCode) throw new Error("FIREBASE_RESET_LINK_ERROR: Reset code was not returned.");

  return `${CLIENT_RESET_PAGE}?mode=resetPassword&oobCode=${encodeURIComponent(oobCode)}&apiKey=${encodeURIComponent(FIREBASE_API_KEY)}`;
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const clientId = String(body.clientId || "").trim().toUpperCase();
    const email = String(body.email || "").trim().toLowerCase();

    if (!/^CID-\d{3,}$/.test(clientId) || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email)) {
      return json({ ok: false, error: "Enter a valid Client ID and registered Gmail address." }, 400);
    }

    // Generate the one-time Firebase reset code here. This is done server-side
    // with the existing Cloudflare secret; Firebase Cloud Functions/Blaze is
    // not required.
    const resetLink = await generateResetLink(context.env, email);

    // Google Apps Script is responsible only for the customer-specific
    // verification and branded HTML email delivery.
    const mailResponse = await fetch(RESET_MAILER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "PASSWORD_RESET",
        secret: RESET_MAILER_SECRET,
        clientId,
        email,
        resetLink
      })
    });

    const mailData = await mailResponse.json().catch(() => ({}));
    if (!mailResponse.ok || !mailData.ok) {
      return json({
        ok: false,
        error: String(mailData.error || "We could not send the password-reset email right now.")
      }, mailResponse.status >= 400 && mailResponse.status < 600 ? mailResponse.status : 502);
    }

    return json({ ok: true, emailSent: true, clientId });
  } catch (error) {
    console.error("[PISO WIFI PASSWORD RESET]", error);
    const raw = String(error?.message || error || "");
    let safe = "The password-reset service is temporarily unavailable. Please try again shortly.";
    if (/FIREBASE_SERVICE_ACCOUNT_JSON|service-account secret/i.test(raw)) {
      safe = "Password-reset service configuration is incomplete. Please contact the administrator.";
    } else if (/INVALID_PASSWORD|EMAIL_NOT_FOUND|USER_NOT_FOUND|INVALID_EMAIL/i.test(raw)) {
      safe = "We could not verify the customer account details. Please check the Client ID and registered Gmail.";
    } else if (/FIREBASE_RESET_LINK_ERROR/i.test(raw)) {
      safe = "We could not create a secure password-reset link. Please try again shortly.";
    }
    return json({ ok: false, error: safe }, 500);
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
