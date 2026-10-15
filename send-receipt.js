// Cloudflare Pages Function: POST /api/send-receipt
// Replace the contents of functions/api/send-receipt.js with this file.
// Uses the dedicated Apps Script receipt URL below; it does NOT use the password-reset URL.

const APPS_SCRIPT_RECEIPT_URL = "https://script.google.com/macros/s/AKfycbw0V3j5VPpFq2Ui0Y28CAC9owTXLawEsjEllq12W9wtzpFjFgXLgI5VCRDHzc26raWJ/exec";

export async function onRequestPost({ request, env }) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  const reply = (status, payload) => new Response(JSON.stringify(payload), { status, headers });

  try {
    const authorization = request.headers.get("Authorization") || "";
    const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    const apiKey = String(env.FIREBASE_API_KEY || env.FIREBASE_WEB_API_KEY || "").trim();
    if (!idToken || !apiKey) {
      return reply(401, { ok: false, error: "Cashier sign-in is required. Check the Firebase API key setting." });
    }

    // Verify the cashier's Firebase ID token before allowing an email request.
    const verifyResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    });
    const verified = await verifyResponse.json().catch(() => ({}));
    if (!verifyResponse.ok || !verified?.users?.[0]?.localId) {
      return reply(401, { ok: false, error: "Cashier session expired. Sign out and sign in again." });
    }

    const input = await request.json();
    const to = String(input?.to || "").trim();
    const subject = String(input?.subject || "PISO WIFI Payment Receipt").trim().slice(0, 180);
    const html = String(input?.html || "");
    const transactionId = String(input?.transactionId || "").trim();
    const receiptId = String(input?.receiptId || "").trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return reply(400, { ok: false, error: "The customer email address is missing or invalid." });
    }
    if (!/<html[\s>]/i.test(html) || html.length > 50000 || !transactionId || !receiptId) {
      return reply(400, { ok: false, error: "Receipt content, receipt number, or transaction ID is missing." });
    }

    // Existing Cloudflare secret must exactly match Apps Script Script Property PISO_WIFI_RECEIPT_SECRET.
    const secret = String(env.APPS_SCRIPT_RECEIPT_SECRET || env.PISO_WIFI_RECEIPT_SECRET || "").trim();
    if (!secret) {
      return reply(503, { ok: false, error: "Missing Cloudflare secret APPS_SCRIPT_RECEIPT_SECRET. Its value must match the PISO_WIFI_RECEIPT_SECRET Script Property in Google Apps Script." });
    }

    const upstreamResponse = await fetch(APPS_SCRIPT_RECEIPT_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "sendReceipt", secret, to, subject, html, transactionId, receiptId })
    });

    const responseText = await upstreamResponse.text();
    let result;
    try { result = JSON.parse(responseText); } catch { result = null; }

    if (!upstreamResponse.ok) {
      return reply(502, {
        ok: false,
        error: `Google Apps Script returned HTTP ${upstreamResponse.status}. Confirm this exact Web App URL is deployed as a Web app with the latest version and that access settings allow the request.`
      });
    }
    if (!result || result.ok !== true) {
      const detail = result && (result.error || result.message);
      return reply(502, {
        ok: false,
        error: detail ? `Google Apps Script: ${String(detail).slice(0, 350)}` : "Google Apps Script did not return the expected JSON receipt confirmation. Check Apps Script Executions for the sendReceipt request."
      });
    }

    return reply(200, { ok: true, id: result.receiptId || receiptId, receiptId, transactionId });
  } catch (error) {
    return reply(502, { ok: false, error: "Receipt request failed before confirmation. Check the deployed Cloudflare Function and Google Apps Script execution log." });
  }
}
