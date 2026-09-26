const RESET_MAILER_URL = "https://script.google.com/macros/s/AKfycbzcBLoOP6LoXwTE8rhUUxd1q68ykDgVj-f4o-TD7YGPYmtXrepvhJ8dbPWdeCqQt9fM/exec";
const RESET_MAILER_SECRET = "-P4NqUwISia-WpONGB2WipjobxXOC0Jnh9bdnyQMF2zNsOrWo-ERoChulEGfY14D";

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

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const clientId = String(body.clientId || "").trim().toUpperCase();
    const email = String(body.email || "").trim().toLowerCase();

    if (!/^CID-\d{3,}$/.test(clientId) || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email)) {
      return json({
        ok: false,
        error: "Enter a valid Client ID and registered Gmail address."
      }, 400);
    }

    // The Google Apps Script backend is the single source of truth for:
    // 1) Client ID + registered Gmail verification
    // 2) Firebase password-reset link generation
    // 3) Custom PISO WIFI HTML email delivery
    // This avoids Firebase Cloud Functions and requires no Blaze billing.
    const response = await fetch(RESET_MAILER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        action: "PASSWORD_RESET",
        secret: RESET_MAILER_SECRET,
        clientId,
        email
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      return json({
        ok: false,
        error: String(data.error || "We could not send the password-reset email right now.")
      }, response.status >= 400 && response.status < 600 ? response.status : 502);
    }

    return json({
      ok: true,
      emailSent: true,
      clientId
    });
  } catch (error) {
    console.error("[PISO WIFI PASSWORD RESET]", error);
    return json({
      ok: false,
      error: "The password-reset service is temporarily unavailable. Please try again shortly."
    }, 500);
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
