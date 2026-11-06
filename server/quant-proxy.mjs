/**
 * Quant daemon reverse proxy (server/quant-proxy.mjs).
 *
 * Forwards a request to <QUANT_API_ORIGIN> with:
 *   - hop-by-hop / Cloudflare edge headers stripped,
 *   - `ngrok-skip-browser-warning` injected when the daemon sits behind a
 *     free ngrok endpoint (a browser cannot set that header itself, and
 *     ngrok free otherwise answers its splash page instead of the API),
 *   - auth headers forwarded verbatim — the daemon still enforces them.
 *
 * Used for two worker routes:
 *   /api/v1/*          → daemon JSON API (dashboard fetches, same-origin)
 *   /quant-terminal/*  → daemon-hosted portal for the inline iframe
 */

const DROP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'cf-worker',
  'x-forwarded-proto',
  'x-real-ip',
  'cdn-loop',
]);

const DROP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

function isNgrokFree(origin) {
  return origin.endsWith('.ngrok-free.dev') || origin.endsWith('.ngrok-free.app');
}

export async function proxyToDaemon(request, env, pathSuffix, search) {
  const raw = String((env && env.QUANT_API_ORIGIN) || '').trim().replace(/\/+$/, '');
  if (!raw) {
    return new Response(JSON.stringify({
      status: 'CONFIG_ERROR',
      detail: 'QUANT_API_ORIGIN is not configured — set it in wrangler.jsonc vars or the service environment.',
    }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const target = raw + '/' + String(pathSuffix || '').replace(/^\/+/, '') + String(search || '');

  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (DROP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    headers.set(key, value);
  }
  if (isNgrokFree(raw)) headers.set('ngrok-skip-browser-warning', 'learningfundclear-portal');

  const init = { method: request.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    init.body = await request.arrayBuffer();
  }

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    return new Response(JSON.stringify({
      status: 'DAEMON_UNREACHABLE',
      detail: 'Proxy could not reach quant daemon: ' + String(err && err.message ? err.message : err),
      target,
    }, null, 2), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    if (DROP_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    responseHeaders.set(key, value);
  }
  if (String(search).indexOf('t=' ) >= 0 || String(target).includes('/api/')) {
    responseHeaders.set('cache-control', 'no-store');
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
