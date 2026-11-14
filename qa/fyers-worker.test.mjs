// Unit tests for the hosted FYERS port. These use a fake portal session, a fake
// provider and an in-memory vault: they prove the Worker's own logic, not that
// FYERS accepted a real login. Real login/quote is exercised only after a
// deployment approval and credential configuration.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appIdHash,
  buildLoginUrl,
  clearSessionCookie,
  mapQuote,
  nextFyersExpiry,
  openToken,
  parseCookies,
  providerAuth,
  providerSymbol,
  quoteUrl,
  sameOrigin,
  sealToken,
  sessionCookie,
  sha256Hex,
} from '../server/fyers-core.mjs';
import { MemoryStorage, SqlStorage, VaultCore } from '../server/fyers-vault.mjs';
import { handleFyers } from '../server/fyers-routes.mjs';

const KEY = Buffer.alloc(32, 7).toString('base64');
const ORIGIN = 'https://lfc-fyers-pilot.example.workers.dev';
const OWNER = { id: 'user-owner', email: 'owner@example.com' };
const OTHER = { id: 'user-other', email: 'other@example.com' };
const CONFIG = { url: 'https://supabase.example', anonKey: 'anon' };

function baseEnv(overrides = {}) {
  return {
    FYERS_CLIENT_ID: 'TESTAPP-100',
    FYERS_SECRET_ID: 'secret-value',
    FYERS_REDIRECT_URI: `${ORIGIN}/api/fyers/callback`,
    FYERS_OWNER_EMAILS: 'owner@example.com',
    FYERS_TOKEN_KEY: KEY,
    ...overrides,
  };
}

function fakeVault(now) {
  const storage = new MemoryStorage();
  const core = new VaultCore(storage, now);
  return {
    storage,
    core,
    request: (op, args) => core[op](...args),
  };
}

function provider({ token = 'ACCESS-TOKEN', validate, quote, logout } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('validate-authcode')) {
      if (validate) return validate();
      return Response.json({ s: 'ok', access_token: token });
    }
    if (String(url).includes('/data/quotes')) {
      if (quote) return quote();
      return Response.json({
        s: 'ok',
        d: [{ n: 'NSE:NIFTY-EQ', v: { lp: 24850.5, ch: 42.1, chp: 0.17, tt: 1763200000 } }],
      });
    }
    if (String(url).includes('/logout')) {
      if (logout) return logout();
      return Response.json({ s: 'ok' });
    }
    throw new Error('unexpected provider call ' + url);
  };
  return { fetchImpl, calls };
}

function sessionFor(user) {
  return async () => ({ user });
}

function request(path, { method = 'GET', cookie, headers = {} } = {}) {
  return new Request(ORIGIN + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });
}

async function startLogin({ user = OWNER, env = baseEnv(), deps = {} } = {}) {
  const vault = deps.vault || fakeVault(deps.now);
  const p = provider();
  const res = await handleFyers(request('/api/fyers/login'), env, CONFIG, {
    authenticate: sessionFor(user),
    vault,
    fetchImpl: deps.fetchImpl || p.fetchImpl,
    now: deps.now,
  });
  const body = await res.json();
  const setCookie = res.headers.get('set-cookie') || '';
  const sid = parseCookies(setCookie).lfc_fyers_session;
  const state = new URL(body.login_url).searchParams.get('state');
  return { res, body, sid, state, vault, providerCalls: p.calls };
}

async function callback({ sid, state, env = baseEnv(), vault, fetchImpl, query = '' }) {
  return handleFyers(
    request(`/api/fyers/callback?state=${encodeURIComponent(state)}&auth_code=CODE123${query}`, {
      cookie: `lfc_fyers_session=${sid}`,
    }),
    env,
    CONFIG,
    { authenticate: sessionFor(OWNER), vault, fetchImpl },
  );
}

test('FYERS expiry is the next 06:30 IST', () => {
  const before = Date.parse('2026-11-14T00:30:00Z'); // 06:00 IST
  assert.equal(nextFyersExpiry(before), Date.parse('2026-11-14T01:00:00Z'));
  const after = Date.parse('2026-11-14T02:00:00Z'); // 07:30 IST
  assert.equal(nextFyersExpiry(after), Date.parse('2026-11-15T01:00:00Z'));
});

test('appIdHash is sha256(app_id:secret)', async () => {
  assert.equal(
    await appIdHash('TESTAPP-100', 'secret-value'),
    await sha256Hex('TESTAPP-100:secret-value'),
  );
  assert.match(await appIdHash('TESTAPP-100', 'secret-value'), /^[0-9a-f]{64}$/);
});

test('tokens are sealed with AES-GCM and wrong keys fail', async () => {
  const sealed = await sealToken('TESTAPP-100:ACCESS-TOKEN', KEY);
  assert.notEqual(sealed.cipher, 'TESTAPP-100:ACCESS-TOKEN');
  assert.equal(await openToken(sealed, KEY), 'TESTAPP-100:ACCESS-TOKEN');
  const otherKey = Buffer.alloc(32, 9).toString('base64');
  await assert.rejects(() => openToken(sealed, otherKey));
});

test('login URL carries the exact redirect and state', () => {
  const url = new URL(
    buildLoginUrl({
      clientId: 'TESTAPP-100',
      redirectUri: `${ORIGIN}/api/fyers/callback`,
      state: 'STATE123',
    }),
  );
  assert.equal(url.origin, 'https://api-t1.fyers.in');
  assert.equal(url.pathname, '/api/v3/generate-authcode');
  assert.equal(url.searchParams.get('redirect_uri'), `${ORIGIN}/api/fyers/callback`);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'STATE123');
});

test('quote symbol mapping mirrors the existing proxy', () => {
  assert.equal(providerSymbol('NIFTY'), 'NSE:NIFTY-EQ');
  assert.equal(providerSymbol('nse:nifty50-index'), 'NSE:NIFTY50-INDEX');
  assert.match(quoteUrl('NIFTY'), /symbols=NSE%3ANIFTY-EQ/);
  assert.equal(providerAuth('TESTAPP-100', 'ACCESS'), 'TESTAPP-100:ACCESS');
  assert.equal(providerAuth('TESTAPP-100', 'TESTAPP-100:ACCESS'), 'TESTAPP-100:ACCESS');
});

test('quote mapping never fabricates a price', () => {
  assert.equal(mapQuote({ s: 'error', code: -8 }).ok, false);
  assert.equal(mapQuote({ s: 'ok', d: [{ v: {} }] }).ok, false);
  const mapped = mapQuote({ s: 'ok', d: [{ n: 'NSE:NIFTY-EQ', v: { lp: 100, tt: 42 } }] });
  assert.equal(mapped.ok, true);
  assert.equal(mapped.ltp, 100);
  assert.equal(mapped.asOf, 42);
});

test('cookies are HttpOnly, SameSite=Lax and Secure on HTTPS', () => {
  const cookie = sessionCookie('abc', { maxAge: 600, secure: true });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(clearSessionCookie({ secure: true }), /Max-Age=0/);
  assert.deepEqual(parseCookies('a=1; lfc_fyers_session=xyz'), { a: '1', lfc_fyers_session: 'xyz' });
});

test('same-origin refuses a foreign Origin', () => {
  const url = new URL(ORIGIN + '/api/fyers/login');
  assert.equal(sameOrigin(new Request(url, { headers: { origin: ORIGIN } }), url), true);
  assert.equal(sameOrigin(new Request(url, { headers: { origin: 'https://evil.example' } }), url), false);
});

test('state is consumed exactly once, and a wrong sid burns it', async () => {
  const vault = fakeVault();
  await vault.request('createState', [{ stateHash: 'h1', sid: 's1', userId: 'u1', expiresAt: Date.now() + 10000 }]);
  assert.equal(await vault.request('consumeState', ['h1', 'wrong']), null);
  assert.equal(await vault.request('consumeState', ['h1', 's1']), null);
});

test('expired state and expired sessions are rejected', async () => {
  let now = 1000;
  const vault = fakeVault(() => now);
  await vault.request('createState', [{ stateHash: 'h', sid: 's', userId: 'u', expiresAt: 2000 }]);
  now = 3000;
  assert.equal(await vault.request('consumeState', ['h', 's']), null);

  await vault.request('saveSession', [
    { sid: 's1', userId: 'u1', sealed: { cipher: 'c', iv: 'i' }, expiresAt: 5000, clientId: 'x' },
  ]);
  assert.ok(await vault.request('getSession', ['s1', 'u1']));
  assert.equal(await vault.request('getSession', ['s1', 'u2']), null);
  now = 6000;
  assert.equal(await vault.request('getSession', ['s1', 'u1']), null);
});

test('purge removes expired state and sessions only', async () => {
  const vault = fakeVault(() => 100);
  await vault.request('createState', [{ stateHash: 'a', sid: 's', userId: 'u', expiresAt: 50 }]);
  await vault.request('createState', [{ stateHash: 'b', sid: 's', userId: 'u', expiresAt: 500 }]);
  await vault.request('saveSession', [
    { sid: 's1', userId: 'u', sealed: { cipher: 'c', iv: 'i' }, expiresAt: 10 },
  ]);
  assert.equal(await vault.request('purgeExpired', []), 2);
  assert.equal(await vault.request('consumeState', ['b', 's']) !== null, true);
});

test('anonymous and non-owner callers are refused before any provider call', async () => {
  const vault = fakeVault();
  const anon = await handleFyers(request('/api/fyers/config-status'), baseEnv(), CONFIG, {
    authenticate: async () => ({ error: Response.json({ error: 'Sign in' }, { status: 401 }) }),
    vault,
    fetchImpl: async () => assert.fail('provider must not be called'),
  });
  assert.equal(anon.status, 401);

  const other = await handleFyers(request('/api/fyers/config-status'), baseEnv(), CONFIG, {
    authenticate: sessionFor(OTHER),
    vault,
    fetchImpl: async () => assert.fail('provider must not be called'),
  });
  assert.equal(other.status, 403);

  const noOwner = await handleFyers(
    request('/api/fyers/config-status'),
    baseEnv({ FYERS_OWNER_EMAILS: '' }),
    CONFIG,
    { authenticate: sessionFor(OWNER), vault, fetchImpl: async () => assert.fail('no call') },
  );
  assert.equal(noOwner.status, 503);
});

test('status is owner-only, no-store and reports not configured without secrets', async () => {
  const res = await handleFyers(
    request('/api/fyers/config-status'),
    baseEnv({ FYERS_CLIENT_ID: '', FYERS_SECRET_ID: '' }),
    CONFIG,
    { authenticate: sessionFor(OWNER), vault: fakeVault() },
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(body.configured, false);
  assert.equal(body.connected, false);
  assert.equal(body.storage, 'durable_object_sqlite');
});

test('login stores a hashed state and returns a provider URL with a cookie', async () => {
  const { res, body, sid, state, vault } = await startLogin();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /HttpOnly/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok(sid && state);
  assert.equal(body.redirect_uri, `${ORIGIN}/api/fyers/callback`);
  const keys = [...vault.storage.map.keys()];
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^state:[0-9a-f]{64}$/);
  assert.equal(keys.some((k) => k.includes(state)), false);
  assert.equal(await vault.request('consumeState', ['0'.repeat(64), sid]), null);
});

test('login refuses a cross-origin caller', async () => {
  const res = await handleFyers(
    request('/api/fyers/login', { headers: { origin: 'https://evil.example' } }),
    baseEnv(),
    CONFIG,
    { authenticate: sessionFor(OWNER), vault: fakeVault() },
  );
  assert.equal(res.status, 403);
});

test('login is 503 when FYERS is not configured', async () => {
  const res = await handleFyers(
    request('/api/fyers/login'),
    baseEnv({ FYERS_CLIENT_ID: '' }),
    CONFIG,
    { authenticate: sessionFor(OWNER), vault: fakeVault() },
  );
  assert.equal(res.status, 503);
});

test('callback exchanges once, stores only sealed text and redirects connected', async () => {
  const { sid, state, vault } = await startLogin();
  const p = provider();
  const res = await callback({ sid, state, vault, fetchImpl: p.fetchImpl });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /fyers=connected/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(p.calls.length, 1);
  const exchange = JSON.parse(p.calls[0].init.body);
  assert.equal(exchange.grant_type, 'authorization_code');
  assert.equal(exchange.code, 'CODE123');
  assert.equal(exchange.appIdHash, await appIdHash('TESTAPP-100', 'secret-value'));
  const record = await vault.request('getSession', [sid, OWNER.id]);
  assert.ok(record);
  assert.equal(JSON.stringify(record).includes('ACCESS-TOKEN'), false);
});

test('callback replay, invalid state and missing cookie are refused', async () => {
  const { sid, state, vault } = await startLogin();
  const p = provider();
  assert.equal((await callback({ sid, state, vault, fetchImpl: p.fetchImpl })).status, 302);
  const replay = await callback({ sid, state, vault, fetchImpl: p.fetchImpl });
  assert.match(replay.headers.get('location'), /reason=invalid_state/);
  assert.equal(p.calls.length, 1);

  const wrong = await callback({ sid: 'nope', state: 'nope', vault, fetchImpl: p.fetchImpl });
  assert.match(wrong.headers.get('location'), /reason=invalid_state/);
});

test('SQLite take consumes state in one DELETE ... RETURNING statement', async () => {
  const statements = [];
  const fakeSql = {
    exec(query, ...args) {
      statements.push({ query, args });
      if (/^DELETE/.test(query)) return { toArray: () => [{ value: JSON.stringify({ sid: 's', userId: 'u', expiresAt: Date.now() + 1000 }) }], rowsWritten: 1 };
      return { toArray: () => [], rowsWritten: 0 };
    },
  };
  const storage = new SqlStorage(fakeSql);
  const record = await storage.take('state:abc');
  assert.equal(record.sid, 's');
  assert.match(statements.at(-1).query, /^DELETE FROM vault .*RETURNING value$/);
  assert.equal(statements.at(-1).args[0], 'state:abc');
});

test('concurrent callbacks with the same state produce exactly one session', async () => {
  const { sid, state, vault } = await startLogin();
  let exchanges = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('validate-authcode')) {
      exchanges += 1;
      await new Promise((r) => setTimeout(r, 20));
      return Response.json({ s: 'ok', access_token: 'ACCESS-TOKEN' });
    }
    throw new Error('unexpected ' + url);
  };
  const [a, b] = await Promise.all([
    callback({ sid, state, vault, fetchImpl }),
    callback({ sid, state, vault, fetchImpl }),
  ]);
  const locations = [a.headers.get('location'), b.headers.get('location')];
  assert.equal(locations.filter((l) => l.includes('fyers=connected')).length, 1);
  assert.equal(locations.filter((l) => l.includes('invalid_state')).length, 1);
  assert.equal(exchanges, 1);
});

test('malformed provider responses fail closed without storing a token', async () => {
  for (const validate of [
    () => Response.json({ s: 'error', code: -16 }),
    () => new Response('not json', { status: 200 }),
    () => Response.json({ s: 'ok' }),
    () => Response.json({ s: 'ok', access_token: '' }),
  ]) {
    const { sid, state, vault } = await startLogin();
    const res = await callback({ sid, state, vault, fetchImpl: provider({ validate }).fetchImpl });
    assert.match(res.headers.get('location'), /reason=token_exchange_failed/);
    assert.equal(await vault.request('getSession', [sid, OWNER.id]), null);
  }
});

test('quote requires a stored session and reports expiry as 401', async () => {
  const vault = fakeVault();
  const res = await handleFyers(request('/api/fyers/quote?symbol=NIFTY'), baseEnv(), CONFIG, {
    authenticate: sessionFor(OWNER),
    vault,
    fetchImpl: async () => assert.fail('provider must not be called'),
  });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('quote returns provider price and timestamp, never the token', async () => {
  const { sid, state, vault } = await startLogin();
  const p = provider({ token: 'ACCESS-TOKEN' });
  await callback({ sid, state, vault, fetchImpl: p.fetchImpl });
  const res = await handleFyers(
    request('/api/fyers/quote?symbol=NIFTY', { cookie: `lfc_fyers_session=${sid}` }),
    baseEnv(),
    CONFIG,
    { authenticate: sessionFor(OWNER), vault, fetchImpl: p.fetchImpl },
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ltp, 24850.5);
  assert.equal(body.as_of, 1763200000);
  assert.equal(body.source, 'fyers');
  assert.equal(JSON.stringify(body).includes('ACCESS-TOKEN'), false);
  const quoteCall = p.calls.find((c) => c.url.includes('/data/quotes'));
  assert.equal(quoteCall.init.headers.Authorization, 'TESTAPP-100:ACCESS-TOKEN');
});

test('provider quote failures are 502 and carry no token', async () => {
  const { sid, state, vault } = await startLogin();
  const p = provider({ quote: () => Response.json({ s: 'error', code: -8, message: 'expired' }) });
  await callback({ sid, state, vault, fetchImpl: p.fetchImpl });
  const res = await handleFyers(
    request('/api/fyers/quote?symbol=NIFTY', { cookie: `lfc_fyers_session=${sid}` }),
    baseEnv(),
    CONFIG,
    { authenticate: sessionFor(OWNER), vault, fetchImpl: p.fetchImpl },
  );
  const text = await res.text();
  assert.equal(res.status, 502);
  assert.equal(text.includes('ACCESS-TOKEN'), false);
});

test('a second portal user cannot use the owner session cookie', async () => {
  const { sid, state, vault } = await startLogin();
  const p = provider();
  await callback({ sid, state, vault, fetchImpl: p.fetchImpl });
  const res = await handleFyers(
    request('/api/fyers/quote?symbol=NIFTY', { cookie: `lfc_fyers_session=${sid}` }),
    baseEnv({ FYERS_OWNER_EMAILS: 'owner@example.com,other@example.com' }),
    CONFIG,
    { authenticate: sessionFor(OTHER), vault, fetchImpl: p.fetchImpl },
  );
  assert.equal(res.status, 401);
});

test('disconnect revokes, deletes and clears the cookie; later quote is 401', async () => {
  const { sid, state, vault } = await startLogin();
  const p = provider();
  await callback({ sid, state, vault, fetchImpl: p.fetchImpl });
  const res = await handleFyers(
    request('/api/fyers/disconnect', {
      method: 'POST',
      cookie: `lfc_fyers_session=${sid}`,
      headers: { origin: ORIGIN },
    }),
    baseEnv(),
    CONFIG,
    { authenticate: sessionFor(OWNER), vault, fetchImpl: p.fetchImpl },
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.provider_revoked, true);
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(await vault.request('getSession', [sid, OWNER.id]), null);
  const after = await handleFyers(
    request('/api/fyers/quote?symbol=NIFTY', { cookie: `lfc_fyers_session=${sid}` }),
    baseEnv(),
    CONFIG,
    { authenticate: sessionFor(OWNER), vault, fetchImpl: p.fetchImpl },
  );
  assert.equal(after.status, 401);
});

test('disconnect refuses a cross-origin POST', async () => {
  const res = await handleFyers(
    request('/api/fyers/disconnect', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    }),
    baseEnv(),
    CONFIG,
    { authenticate: sessionFor(OWNER), vault: fakeVault() },
  );
  assert.equal(res.status, 403);
});

test('configured status never returns secrets', async () => {
  const res = await handleFyers(request('/api/fyers/config-status'), baseEnv(), CONFIG, {
    authenticate: sessionFor(OWNER),
    vault: fakeVault(),
  });
  const text = await res.text();
  assert.equal(text.includes('secret-value'), false);
  assert.equal(text.includes(KEY), false);
});
