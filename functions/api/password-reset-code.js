const APPS_SCRIPT_URL = String(globalThis?.process?.env?.APPS_SCRIPT_PASSWORD_RESET_URL || "").trim();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function getAppsScriptUrl(env) {
  const url = String(env?.APPS_SCRIPT_PASSWORD_RESET_URL || APPS_SCRIPT_URL || "").trim();
  if (!url || !/^https:\/\//i.test(url)) {
    throw new Error("APPS_SCRIPT_PASSWORD_RESET_URL is not configured.");
  }
  return url;
}

function getBridgeSecret(env) {
  const secret = String(env?.PASSWORD_RESET_MAILER_SECRET || "").trim();
  if (!secret) throw new Error("PASSWORD_RESET_MAILER_SECRET is not configured.");
  return secret;
}

function cleanClientId(value) {
  return String(value || "").trim().toUpperCase();
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function callAppsScript(env, payload) {
  const url = getAppsScriptUrl(env);
  const secret = getBridgeSecret(env);

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...payload,
      secret
    }),
    redirect: "follow"
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    throw new Error("Password recovery server returned an invalid response.");
  }

  if (!response.ok || data?.ok !== true) {
    throw new Error(data?.error || "Password recovery request failed.");
  }

  return data;
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const action = String(body.action || "").trim();

    const clientId = cleanClientId(body.clientId);
    const email = cleanEmail(body.email);

    if (!/^CID-\d{3,}$/.test(clientId)) {
      return json({ ok: false, error: "Enter a valid Client ID." }, 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "Enter a valid registered Gmail address." }, 400);
    }

    if (action === "requestCode") {
      const result = await callAppsScript(context.env, {
        action: "requestCode",
        clientId,
        email
      });

      return json(result);
    }

    if (action === "verifyCode") {
      const code = String(body.code || "").replace(/\D/g, "");

      if (!/^\d{6}$/.test(code)) {
        return json({ ok: false, error: "Enter the 6-digit verification code." }, 400);
      }

      const result = await callAppsScript(context.env, {
        action: "verifyCode",
        clientId,
        email,
        code
      });

      return json(result);
    }

    if (action === "resetPassword") {
      const resetToken = String(body.resetToken || "").trim();
      const newPassword = String(body.newPassword || "");

      if (!resetToken) {
        return json({ ok: false, error: "Your verification session has expired. Please request a new OTP." }, 400);
      }

      if (newPassword.length < 8) {
        return json({ ok: false, error: "Your new password must be at least 8 characters." }, 400);
      }

      const result = await callAppsScript(context.env, {
        action: "resetPassword",
        clientId,
        email,
        resetToken,
        newPassword
      });

      return json(result);
    }

    return json({ ok: false, error: "Invalid password recovery action." }, 400);

  } catch (error) {
    console.error("[PISO WIFI PASSWORD RESET BRIDGE]", error);

    const message = error?.message || "Unable to process the password recovery request.";

    if (/not configured/i.test(message)) {
      return json({ ok: false, error: "Password recovery service is not configured on the website server." }, 500);
    }

    return json({ ok: false, error: message }, 400);
  }
}
