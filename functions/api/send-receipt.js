// Cloudflare Pages Function: forwards receipt email requests to the existing Google Apps Script.
// Required Cloudflare Pages variables:
// APPS_SCRIPT_OTP_URL (optional; defaults to the project's existing Apps Script web app URL)
// APPS_SCRIPT_RECEIPT_SECRET (preferred existing Cloudflare secret; value must match Script Property PISO_WIFI_RECEIPT_SECRET in Apps Script)
export async function onRequestPost({ request, env }) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  try {
    const bearer = request.headers.get("Authorization") || "";
    const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
    const apiKey = env.FIREBASE_WEB_API_KEY || env.FIREBASE_API_KEY;
    if (!token || !apiKey) {
      return new Response(JSON.stringify({ ok: false, error: "Authenticated cashier session required. Verify FIREBASE_API_KEY in Cloudflare Pages." }), { status: 401, headers });
    }

    const identityResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token })
    });
    const identity = await identityResponse.json().catch(() => ({}));
    const authenticatedEmail = String(identity?.users?.[0]?.email || "").toLowerCase();
    if (!identityResponse.ok || !authenticatedEmail) {
      return new Response(JSON.stringify({ ok: false, error: "Cashier session is invalid or expired. Sign in again." }), { status: 401, headers });
    }

    const body = await request.json();
    const to = String(body?.to || "").trim();
    const subject = String(body?.subject || "PISO WIFI Payment Receipt").slice(0, 180);
    const html = String(body?.html || "");
    const transactionId = String(body?.transactionId || "").trim();
    const receiptId = String(body?.receiptId || "").trim();
    if (!to.includes("@") || !html.toLowerCase().includes("<html") || html.length > 50000 || !transactionId || !receiptId) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid receipt email payload. Check the customer email and receipt details." }), { status: 400, headers });
    }

    const scriptUrl = String(env.APPS_SCRIPT_OTP_URL || "https://script.google.com/macros/s/AKfycbziRdnywiBqCJoBqJwXElHEGWdgyljApiYAhOvDJEyKJ_rzLWPP_GgYSmsfR1IE3_Fe/exec").trim();
    const secret = String(env.APPS_SCRIPT_RECEIPT_SECRET || env.PISO_WIFI_RECEIPT_SECRET || "").trim();
    if (!secret) {
      return new Response(JSON.stringify({ ok: false, error: "Google Apps Script receipt connection is missing APPS_SCRIPT_RECEIPT_SECRET in Cloudflare Pages variables/secrets. It must match the Apps Script project property PISO_WIFI_RECEIPT_SECRET." }), { status: 503, headers });
    }

    const upstream = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "sendReceipt",
        secret,
        to,
        subject,
        html,
        transactionId,
        receiptId
      })
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok || result?.ok !== true) {
      const message = String(result?.error || result?.message || `Google Apps Script returned HTTP ${upstream.status}.`);
      return new Response(JSON.stringify({ ok: false, error: message }), { status: 502, headers });
    }
    return new Response(JSON.stringify({ ok: true, id: result.id || receiptId }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: "Could not process the receipt email request. Check the Google Apps Script deployment and its execution logs." }), { status: 400, headers });
  }
}
