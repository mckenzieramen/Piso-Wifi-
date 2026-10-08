/**
 * PISO WIFI — canonical Customer Login route.
 * Serves the existing login page at /client-login without a redirect to
 * client-login.html, avoiding Cloudflare Pages clean-URL redirect loops.
 */
export async function onRequest(context) {
  const assetUrl = new URL('/client-login.html', context.request.url);
  let response;

  if (context.env?.ASSETS?.fetch) {
    response = await context.env.ASSETS.fetch(new Request(assetUrl, context.request));
  } else {
    response = await fetch(assetUrl.toString(), {
      method: context.request.method,
      headers: context.request.headers,
    });
  }

  if (!response || !response.ok) {
    return new Response('Customer Login page unavailable.', { status: 503 });
  }

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  headers.set('Pragma', 'no-cache');

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
