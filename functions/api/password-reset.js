const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzcBLoOP6LoXwTE8rhUUxd1q68ykDgVj-f4o-TD7YGPYmtXrepvhJ8dbPWdeCqQt9fM/exec";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));

    const clientId = String(body.clientId || "").trim().toUpperCase();
    const email = String(body.email || "").trim().toLowerCase();

    if (!/^CID-\d{3,}$/.test(clientId) || !email.includes("@")) {
      return Response.json(
        { ok: false, error: "Invalid password-reset request." },
        { status: 400 }
      );
    }

    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "customerPasswordReset",
        clientId,
        email
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      return Response.json(
        {
          ok: false,
          error: "We could not send the reset email right now."
        },
        { status: 400 }
      );
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("[PISO WIFI PASSWORD RESET]", error);
    return Response.json(
      {
        ok: false,
        error: "We could not send the reset email right now."
      },
      { status: 500 }
    );
  }
}
