const UPSTREAM_URL = "https://us-central1-piso-wifi-f2b5c.cloudfunctions.net/sendCustomPasswordReset";

function jsonHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "content-type": contentType,
    "cache-control": "no-store"
  };
}

export async function onRequestPost(context) {
  try {
    const request = context.request;
    const body = await request.text();
    const upstream = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });

    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: jsonHeaders(upstream.headers.get("content-type") || "application/json; charset=utf-8")
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: error?.message || "Unable to reach the password-reset service.",
      errorCode: error?.code || "PASSWORD_RESET_PROXY_ERROR"
    }), {
      status: 502,
      headers: jsonHeaders()
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      "allow": "POST, OPTIONS"
    }
  });
}
