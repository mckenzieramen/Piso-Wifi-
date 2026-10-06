/**
 * PISO WIFI — Password Recovery Proxy
 *
 * Browser -> Cloudflare Pages Function -> Google Apps Script
 *
 * This avoids browser CORS/preflight problems with Google Apps Script.
 */

const APPS_SCRIPT_OTP_URL = 'https://script.google.com/macros/s/AKfycbziRdnywiBqCJoBqJwXElHEGWdgyljApiYAhOvDJEyKJ_rzLWPP_GgYSmsfR1IE3_Fe/exec';

export async function onRequestPost(context) {
  try {
    const body = await context.request.text();

    if (!body) {
      return json({ ok: false, error: 'Empty password recovery request.' }, 400);
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch (_) {
      return json({ ok: false, error: 'Invalid password recovery request.' }, 400);
    }

    const upstream = await fetch(APPS_SCRIPT_OTP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload)
    });

    const responseText = await upstream.text();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (_) {
      data = {
        ok: false,
        error: 'The password recovery service returned an invalid response.'
      };
    }

    return json(data, upstream.ok ? 200 : 502);
  } catch (error) {
    return json({
      ok: false,
      error: 'Unable to connect to the password recovery service.'
    }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
