// Same-origin FYERS routes for the Worker.
//
// Flow: POST-free GET /api/fyers/login (called with the portal Bearer token,
// returns a provider URL) -> provider redirect -> /api/fyers/callback with the
// HttpOnly sid cookie and the one-time state -> sealed token stored in the
// Durable Object vault. Quote, status and disconnect all require the portal
// session; only the callback is unauthenticated because it is a top-level
// provider redirect, and it is protected by state + cookie + single use.

import { activeUser } from './market-proxy.mjs';
import {
  FYERS_COOKIE,
  STATE_TTL_SECONDS,
  appIdHash,
  buildLoginUrl,
  clearSessionCookie,
  mapQuote,
  nextFyersExpiry,
  normalizeReason,
  openToken,
  parseCookies,
  readReturnCookie,
  returnCookie,
  clearReturnCookie,
  safeReturnPath,
  providerAuth,
  providerSymbol,
  quoteUrl,
  randomHex,
  sameOrigin,
  sealToken,
  sessionCookie,
  sha256Hex,
} from './fyers-core.mjs';
import { stateExpiry } from './fyers-vault.mjs';

const VAULT_NAME = 'fyers-owner';

function headers(extra = {}) {
  return {
    'cache-control': 'no-store',
    pragma: 'no-cache',
    vary: 'Cookie, Authorization',
    ...extra,
  };
}

function json(data, status = 200, extra = {}) {
  return Response.json(data, { status, headers: headers(extra) });
}

function redirect(location, extra = {}) {
  return new Response(null, { status: 302, headers: headers({ location, ...extra }) });
}

function withFyersOutcome(path, outcome, reason) {
  const url = new URL(path, 'https://portal.invalid');
  url.searchParams.set('fyers', outcome);
  if (reason) url.searchParams.set('reason', reason);
  return url.pathname + url.search + url.hash;
}

export function fyersConfig(env) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const redirectUri = str(env.FYERS_REDIRECT_URI);
  let redirectSecure = false;
  try {
    redirectSecure = new URL(redirectUri).protocol === 'https:';
  } catch {
    redirectSecure = false;
  }
  return {
    clientId: str(env.FYERS_CLIENT_ID),
    secretId: str(env.FYERS_SECRET_ID),
    redirectUri,
    redirectSecure,
    tokenKey: str(env.FYERS_TOKEN_KEY),
    ownerEmails: str(env.FYERS_OWNER_EMAILS)
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  };
}

function vaultFrom(env) {
  if (!env.FYERS_VAULT) return null;
  const stub = env.FYERS_VAULT.get(env.FYERS_VAULT.idFromName(VAULT_NAME));
  return {
    async request(op, args) {
      const res = await stub.fetch('https://vault.internal/', {
        method: 'POST',
        body: JSON.stringify({ op, args }),
      });
      const body = await res.json();
      if (!body?.ok) throw new Error('vault unavailable');
      return body.result;
    },
  };
}

async function exchangeCode({ fetchImpl, cfg, code }) {
  const res = await fetchImpl('https://api-t1.fyers.in/api/v3/validate-authcode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      appIdHash: await appIdHash(cfg.clientId, cfg.secretId),
      code,
    }),
    signal: AbortSignal.timeout(10000),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const token = body?.access_token;
  if (res.status !== 200 || body?.s !== 'ok' || typeof token !== 'string' || !token) {
    return { ok: false };
  }
  return { ok: true, token };
}

export async function handleFyers(request, env, config, deps = {}) {
  const url = new URL(request.url);
  const now = deps.now || (() => Date.now());
  const fetchImpl = deps.fetchImpl || fetch;
  const authenticate =
    deps.authenticate || ((req, e, c) => activeUser(req, e, c, fetchImpl));
  const vault = deps.vault || vaultFrom(env);
  const cfg = fyersConfig(env);
  const secure = url.protocol === 'https:';
  const cookies = parseCookies(request.headers.get('cookie'));
  const sid = cookies[FYERS_COOKIE] || '';
  const configured = !!(cfg.clientId && cfg.secretId && cfg.redirectUri && cfg.redirectSecure);

  const path = url.pathname.replace(/\/+$/, '') || '/';

  const requireVault = () => {
    if (!vault) return json({ error: 'FYERS_STORAGE_UNAVAILABLE' }, 503);
    return null;
  };

  // The provider redirect is authenticated by the one-time state, not by the
  // portal Bearer token, because a navigation cannot carry that header.
  if (path === '/api/fyers/callback') {
    let returnTo = readReturnCookie(request.headers.get('cookie'));
    const clearReturn = clearReturnCookie({ secure });
    const fail = (reason) =>
      redirect(
        withFyersOutcome(returnTo, 'error', normalizeReason(reason)),
        { 'set-cookie': clearReturn },
      );
    const params = url.searchParams;
    if (params.get('error')) return fail('provider_refused');
    const code = params.get('auth_code') || params.get('code');
    const state = params.get('state') || '';
    if (!code) return fail('missing_code');
    if (!state || !sid) return fail('invalid_state');
    const vaultError = requireVault();
    if (vaultError) return fail('storage_failed');
    if (!configured) return fail('not_configured');

    let record;
    try {
      record = await vault.request('consumeState', [await sha256Hex(state), sid]);
    } catch {
      return fail('storage_failed');
    }
    if (!record) return fail('invalid_state');
    returnTo = safeReturnPath(record.returnTo || returnTo);

    let exchange;
    try {
      exchange = await exchangeCode({ fetchImpl, cfg, code });
    } catch {
      exchange = { ok: false };
    }
    if (!exchange.ok) return fail('token_exchange_failed');
    if (!cfg.tokenKey) return fail('storage_failed');

    try {
      const sealed = await sealToken(exchange.token, cfg.tokenKey);
      const expiresAt = nextFyersExpiry(now());
      await vault.request('saveSession', [
        {
          sid,
          userId: record.userId,
          sealed,
          expiresAt,
          connectedAt: now(),
          clientId: cfg.clientId,
        },
      ]);
    } catch {
      return fail('storage_failed');
    }
    return redirect(withFyersOutcome(returnTo, 'connected'), {
      'set-cookie': clearReturn,
    });
  }

  const gate = await authenticate(request, env, config);
  if (gate.error) return gate.error;
  const user = gate.user;
  if (!cfg.ownerEmails.length) {
    return json(
      {
        error: 'FYERS_OWNER_NOT_CONFIGURED',
        message: 'Set FYERS_OWNER_EMAILS to the portal account that may connect FYERS.',
      },
      503,
    );
  }
  const email = String(user.email || '').toLowerCase();
  if (!email || !cfg.ownerEmails.includes(email)) {
    return json({ error: 'FYERS_OWNER_ONLY' }, 403);
  }

  if (path === '/api/fyers/config-status') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    let session = null;
    if (vault && sid) {
      try {
        session = await vault.request('getSession', [sid, user.id]);
      } catch {
        session = null;
      }
    }
    return json({
      provider: 'fyers',
      configured,
      connected: !!session,
      status: session ? 'connected' : configured ? 'signed_out' : 'unavailable',
      redirect_uri: cfg.redirectUri || null,
      expires_at: session ? Math.floor(session.expiresAt / 1000) : null,
      expires_at_iso: session ? new Date(session.expiresAt).toISOString() : null,
      owner_only: true,
      storage: 'durable_object_sqlite',
      revocation: 'provider_logout',
      refresh: 'not_implemented',
      state_ttl_seconds: STATE_TTL_SECONDS,
    });
  }

  if (path === '/api/fyers/login') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!sameOrigin(request, url)) return json({ error: 'Cross-origin login refused' }, 403);
    if (!configured) return json({ error: 'FYERS_NOT_CONFIGURED' }, 503);
    const vaultError = requireVault();
    if (vaultError) return vaultError;
    const nextSid = sid || randomHex(32);
    const state = randomHex(32);
    const returnTo = safeReturnPath(
      url.searchParams.get('return') || readReturnCookie(request.headers.get('cookie')),
    );
    try {
      await vault.request('createState', [
        {
          stateHash: await sha256Hex(state),
          sid: nextSid,
          userId: user.id,
          expiresAt: stateExpiry(now()),
          returnTo,
        },
      ]);
    } catch {
      return json({ error: 'FYERS_STORAGE_UNAVAILABLE' }, 503);
    }
    const response = json(
      {
        login_url: buildLoginUrl({
          clientId: cfg.clientId,
          redirectUri: cfg.redirectUri,
          state,
        }),
        redirect_uri: cfg.redirectUri,
        expires_in: STATE_TTL_SECONDS,
        return_to: returnTo,
      },
      200,
    );
    response.headers.append(
      'set-cookie',
      sessionCookie(nextSid, { maxAge: STATE_TTL_SECONDS, secure }),
    );
    response.headers.append(
      'set-cookie',
      returnCookie(returnTo, { maxAge: STATE_TTL_SECONDS, secure }),
    );
    return response;
  }

  if (path === '/api/fyers/quote') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!configured) return json({ error: 'FYERS_NOT_CONFIGURED' }, 503);
    const vaultError = requireVault();
    if (vaultError) return vaultError;
    let session = null;
    try {
      session = sid ? await vault.request('getSession', [sid, user.id]) : null;
    } catch {
      session = null;
    }
    if (!session) return json({ error: 'NOT_AUTHENTICATED', message: 'Sign in with FYERS first.' }, 401);
    if (!cfg.tokenKey) return json({ error: 'FYERS_TOKEN_KEY missing' }, 503);
    const symbol = url.searchParams.get('symbol') || 'NIFTY';
    let token;
    try {
      token = await openToken(session.sealed, cfg.tokenKey);
    } catch {
      return json({ error: 'NOT_AUTHENTICATED', message: 'Stored session cannot be read.' }, 401);
    }
    let res;
    let payload = null;
    try {
      res = await fetchImpl(quoteUrl(symbol), {
        headers: { Authorization: providerAuth(cfg.clientId, token) },
        signal: AbortSignal.timeout(10000),
      });
      payload = await res.json();
    } catch {
      return json({ error: 'PROVIDER_UNREACHABLE' }, 502);
    }
    const mapped = mapQuote(payload);
    if (!mapped.ok) {
      return json(
        {
          error: 'PROVIDER_DATA_UNAVAILABLE',
          provider_code: mapped.providerCode,
          http_status: res.status,
          message: 'No usable quote in the provider response.',
        },
        502,
      );
    }
    return json({
      symbol: mapped.symbol || providerSymbol(symbol),
      ltp: mapped.ltp,
      change: mapped.change,
      change_pct: mapped.changePct,
      as_of: mapped.asOf,
      fetched_at: new Date(now()).toISOString(),
      source: 'fyers',
      auth: 'connected',
    });
  }

  if (path === '/api/fyers/disconnect') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!sameOrigin(request, url)) return json({ error: 'Cross-origin disconnect refused' }, 403);
    const vaultError = requireVault();
    if (vaultError) return vaultError;
    let session = null;
    try {
      session = sid ? await vault.request('getSession', [sid, user.id]) : null;
    } catch {
      session = null;
    }
    let providerRevoked = false;
    if (session && cfg.tokenKey) {
      try {
        const token = await openToken(session.sealed, cfg.tokenKey);
        const res = await fetchImpl('https://api-t1.fyers.in/api/v3/logout', {
          method: 'POST',
          headers: { Authorization: providerAuth(cfg.clientId, token) },
          signal: AbortSignal.timeout(10000),
        });
        const body = await res.json().catch(() => null);
        providerRevoked = res.status === 200 && body?.s === 'ok';
      } catch {
        providerRevoked = false;
      }
    }
    try {
      if (sid) await vault.request('deleteSession', [sid]);
    } catch {
      return json({ error: 'FYERS_STORAGE_UNAVAILABLE' }, 503);
    }
    return json(
      {
        status: 'disconnected',
        provider_revoked: providerRevoked,
        note: 'Local session cleared. Provider logout revokes this app token only; refresh is not implemented.',
      },
      200,
      { 'set-cookie': clearSessionCookie({ secure }) },
    );
  }

  return json({ error: 'Not found' }, 404);
}
