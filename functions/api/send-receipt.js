// Cloudflare Pages Function: authenticate the cashier, then relay the receipt
// to the existing Google Apps Script email service. Configure
// APPS_SCRIPT_RECEIPT_SECRET as a Cloudflare Secret and set the same value in
// Apps Script Project Settings > Script properties as PISO_WIFI_RECEIPT_SECRET.
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzJcIf9rpdunJ8-1kDvgePWTT1L-cQOFzZLQHFQMaqBYTlviovyxjz4JOX-FpvUrjFu/exec";

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
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token })
    });
    const identity = await identityResponse.json().catch(() => ({}));
    const authenticatedEmail = String(identity?.users?.[0]?.email || "").toLowerCase();
    if (!identityResponse.ok || !authenticatedEmail) {
      return new Response(JSON.stringify({ ok: false, error: "Cashier session is invalid or expired. Sign in again." }), { status: 401, headers });
    }
    if (!env.APPS_SCRIPT_RECEIPT_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: "Google Apps Script receipt integration is not configured. Add APPS_SCRIPT_RECEIPT_SECRET in Cloudflare Pages and the matching PISO_WIFI_RECEIPT_SECRET in Apps Script Script properties." }), { status: 503, headers });
    }
    const body = await request.json();
    const to = String(body?.to || "").trim();
    const subject = String(body?.subject || "PISO WIFI Payment Receipt").slice(0, 180);
    const html = String(body?.html || "");
    const transactionId = String(body?.transactionId || "").trim();
    const receiptId = String(body?.receiptId || "").trim();
    if (!to.includes("@") || !html.includes("<html") || html.length > 50000 || !transactionId || !receiptId) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid receipt email payload." }), { status: 400, headers });
    }
    const upstream = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "sendReceipt", secret: env.APPS_SCRIPT_RECEIPT_SECRET, to, subject, html, transactionId, receiptId })
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok || result?.ok !== true) {
      return new Response(JSON.stringify({ ok: false, error: result?.error || `Google Apps Script receipt service failed (HTTP ${upstream.status}). Check the Apps Script deployment and execution log.` }), { status: 502, headers });
    }
    return new Response(JSON.stringify({ ok: true, provider: "Google Apps Script", receiptId, transactionId }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error?.message || "Could not process the receipt email request." }), { status: 400, headers });
  }
}
