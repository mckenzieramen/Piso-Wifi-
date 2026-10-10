// Cloudflare Pages Function. Configure RESEND_API_KEY and RECEIPT_FROM_EMAIL
// as server-side environment variables in Cloudflare Pages before enabling email.
// Also configure FIREBASE_WEB_API_KEY to validate the signed-in Firebase session.
export async function onRequestPost({ request, env }) {
  const cors = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  try {
    const bearer = request.headers.get("Authorization") || "";
    const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
    if (!token || !env.FIREBASE_WEB_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Authenticated cashier session required. Configure FIREBASE_WEB_API_KEY." }), { status: 401, headers: cors });
    }
    const identityResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token })
    });
    const identity = await identityResponse.json().catch(() => ({}));
    const authenticatedEmail = String(identity?.users?.[0]?.email || "").toLowerCase();
    if (!identityResponse.ok || !authenticatedEmail) {
      return new Response(JSON.stringify({ ok: false, error: "Cashier session is invalid or expired. Sign in again." }), { status: 401, headers: cors });
    }
    const body = await request.json();
    const to = String(body?.to || "").trim();
    const subject = String(body?.subject || "PISO WIFI Payment Receipt").slice(0, 180);
    const html = String(body?.html || "");
    if (!to.includes("@") || !html.includes("<html") || html.length > 50000 || !String(body?.transactionId || "")) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid receipt email payload." }), { status: 400, headers: cors });
    }
    if (!env.RESEND_API_KEY || !env.RECEIPT_FROM_EMAIL) {
      return new Response(JSON.stringify({ ok: false, error: "Email service is not configured yet. Add RESEND_API_KEY and RECEIPT_FROM_EMAIL in Cloudflare Pages environment variables." }), { status: 503, headers: cors });
    }
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.RECEIPT_FROM_EMAIL, to: [to], subject, html })
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) return new Response(JSON.stringify({ ok: false, error: result?.message || "Email provider rejected the receipt." }), { status: 502, headers: cors });
    return new Response(JSON.stringify({ ok: true, id: result.id || null }), { status: 200, headers: cors });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Could not process the receipt email request." }), { status: 400, headers: cors });
  }
}
