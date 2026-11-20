// Same-origin proxies for public research feeds whose browser calls are blocked
// by CORS (Yahoo chart API) or fail on larger payloads (mfapi full NAV history).
// Both routes require an active portal session so they cannot be used as an open
// relay, and both cache successful responses at the edge to stay inside free
// provider limits.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const YAHOO_HOSTS = [
  'https://query1.finance.yahoo.com',
  'https://query2.finance.yahoo.com',
];

function reply(data, status = 200, ttl = 0) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': ttl ? `public, max-age=${ttl}` : 'private, no-store',
      // Cloudflare's Cache API refuses to store a response that carries Vary,
      // and a throw inside cache.put() turned every cacheable proxy hit into a
      // platform 502. The payload is public market data, so it does not vary by
      // caller; only the uncached replies need the Authorization distinction.
      ...(ttl ? {} : { Vary: 'Authorization' }),
    },
  });
}

export async function activeUser(request, env, config, fetcher) {
  const auth = request.headers.get('Authorization') || '';
  if (!/^Bearer [\w.-]+$/.test(auth)) return { error: reply({ error: 'Sign in to view market data' }, 401) };
  try {
    const h = { apikey: config.anonKey, Authorization: auth };
    const u = await fetcher(config.url + '/auth/v1/user', { headers: h, signal: AbortSignal.timeout(10000) });
    if (!u.ok) return { error: reply({ error: 'Session expired' }, 401) };
    const user = await u.json();
    if (!user.id) return { error: reply({ error: 'Invalid session' }, 401) };
    const p = await fetcher(
      config.url + '/rest/v1/app_users?id=eq.' + encodeURIComponent(user.id) + '&select=is_active',
      { headers: h, signal: AbortSignal.timeout(10000) },
    );
    if (!p.ok || !(await p.json()).some((x) => x.is_active === true))
      return { error: reply({ error: 'Active portal account required' }, 403) };
    return { user };
  } catch {
    return { error: reply({ error: 'Session check unavailable' }, 503) };
  }
}

function edgeCache() {
  try {
    return typeof caches !== 'undefined' && caches.default ? caches.default : null;
  } catch {
    return null;
  }
}

export async function serveMarketYahoo(request, env, config, fetcher = fetch) {
  if (request.method !== 'GET') return reply({ error: 'Method not allowed' }, 405);
  const gate = await activeUser(request, env, config, fetcher);
  if (gate.error) return gate.error;

  const params = new URL(request.url).searchParams;
  const symbol = (params.get('symbol') || '').trim();
  const interval = params.get('interval') || '1d';
  const range = params.get('range') || '5d';
  // NSE tickers can contain & and ^ (M&M.NS), so allow those without opening a path traversal.
  if (!/^[A-Za-z0-9^.=_%&$-]{1,24}$/.test(symbol)) return reply({ error: 'Invalid symbol' }, 400);
  if (!['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo'].includes(interval))
    return reply({ error: 'Invalid interval' }, 400);
  if (!['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max', '730d'].includes(range))
    return reply({ error: 'Invalid range' }, 400);

  const qs = `?interval=${interval}&range=${range}&includePrePost=false`;
  const cache = edgeCache();
  const key = new Request(
    'https://cache.internal/market/yahoo/' + encodeURIComponent(symbol) + qs,
  );
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return hit;
    } catch {} // a cache miss must never fail the request
  }

  let payload = null,
    lastError = '';
  for (const host of YAHOO_HOSTS) {
    try {
      const r = await fetcher(host + '/v8/finance/chart/' + encodeURIComponent(symbol) + qs, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
        signal: AbortSignal.timeout(12000),
      });
      if (r.ok) {
        payload = await r.json();
        break;
      }
      lastError = 'HTTP ' + r.status;
      if (r.status >= 400 && r.status < 500) break;
    } catch (e) {
      lastError = e?.message || 'network error';
    }
  }
  if (!payload) return reply({ error: 'Yahoo feed unavailable' + (lastError ? ' (' + lastError + ')' : '') }, 502);

  const ttl = interval === '15m' || interval === '1h' ? 60 : 300;
  const out = reply(payload, 200, ttl);
  if (cache) {
    try {
      await cache.put(key, out.clone());
    } catch {} // caching is best-effort
  }
  return out;
}

export async function serveMarketMfapi(request, env, config, fetcher = fetch) {
  if (request.method !== 'GET') return reply({ error: 'Method not allowed' }, 405);
  const gate = await activeUser(request, env, config, fetcher);
  if (gate.error) return gate.error;

  const code = (new URL(request.url).searchParams.get('code') || '').trim();
  if (!/^\d{1,8}$/.test(code)) return reply({ error: 'Invalid scheme code' }, 400);

  const cache = edgeCache();
  const key = new Request('https://cache.internal/market/mfapi/' + code);
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return hit;
    } catch {} // a cache miss must never fail the request
  }

  // mfapi occasionally resets a connection under load; one retry (not for a
  // definitive 4xx) keeps a burst of 23 scheme histories from losing rows.
  let data,
    lastError = '';
  for (let attempt = 0; attempt < 2 && !data; attempt++) {
    let retryable = true;
    try {
      const r = await fetcher('https://api.mfapi.in/mf/' + code, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) data = await r.json();
      else {
        lastError = 'HTTP ' + r.status;
        retryable = r.status >= 500 || r.status === 429;
      }
    } catch (e) {
      lastError = e?.message || 'network error';
    }
    if (!data && retryable && attempt === 0)
      await new Promise((resolve) => setTimeout(resolve, 350));
    if (!retryable) break;
  }
  if (!data)
    return reply(
      { error: 'NAV source unavailable' + (lastError ? ' (' + lastError + ')' : '') },
      502,
    );
  if (!Array.isArray(data.data) || !data.data.length)
    return reply({ error: 'NAV source returned no history' }, 502);

  const out = reply(data, 200, 1800);
  if (cache) {
    try {
      await cache.put(key, out.clone());
    } catch {} // caching is best-effort
  }
  return out;
}
