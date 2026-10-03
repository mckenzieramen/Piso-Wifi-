const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw0V3j5VPpFq2Ui0Y28CAC9owTXLawEsjEllq12W9wtzpFjFgXLgI5VCRDHzc26raWJ/exec";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    if (!["requestCode", "verifyCode", "resetPassword"].includes(action)) {
      return json({ ok: false, error: "Invalid password recovery action." }, 400);
    }

    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "follow"
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch { data = { ok: false, error: "Password recovery service returned an invalid response." }; }

    return json(data, response.ok ? 200 : response.status);
  } catch (error) {
    console.error("[PISO WIFI PASSWORD RECOVERY PROXY]", error);
    return json({ ok: false, error: "Unable to connect to the password recovery service." }, 502);
  }
}
