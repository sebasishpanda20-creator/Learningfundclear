/**
 * Terminal access gate (server/terminal-gate.mjs).
 *
 * The dashboard embeds the daemon-hosted terminal in an iframe, and an iframe
 * navigation cannot carry an Authorization header. So the signed-in shell
 * exchanges its Supabase access token for a short-lived, HttpOnly cookie scoped
 * to /quant-terminal (POST /api/terminal-ticket), and every terminal request is
 * then checked against Supabase before it reaches the daemon.
 *
 * Design notes:
 *   - The cookie holds the Supabase access token itself: no new signing secret
 *     to provision, and revocation follows Supabase's own token lifetime.
 *   - `Path=/quant-terminal` keeps the credential off every other route, and the
 *     proxy strips `cookie` before forwarding so the daemon never sees it.
 *   - Verification is cached per isolate for VALIDATION_TTL_MS so a page load's
 *     asset requests do not each call Supabase.
 *   - Max-Age is deliberately short: the embed re-mints on every dashboard load.
 */

const COOKIE_NAME = 'lfc_term';
// Path is the whole origin because the framed terminal calls the daemon API on
// /api/v1, and those calls need the same session cookie to carry the role.
const COOKIE_PATH = '/';
const COOKIE_MAX_AGE_SECONDS = 600;
const VALIDATION_TTL_MS = 60_000;
const CACHE_LIMIT = 200;

/** token → epoch ms until which it stays validated (per isolate, best effort) */
const validated = new Map();
/** token → { role, until }: the portal role the daemon may trust for that token */
const roleCache = new Map();

function json(status, body, extraHeaders) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(extraHeaders || {}),
  };
  return new Response(JSON.stringify(body), { status, headers });
}

function cookieValue(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

function ticketCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_SECONDS}`;
}

function expiredTicketCookie() {
  return `${COOKIE_NAME}=; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/** A browser mutation must come from this origin; no Origin and no Referer is refused. */
function isSameOriginRequest(request) {
  const origin = new URL(request.url).origin;
  let seen = false;
  for (const header of ['origin', 'referer']) {
    const raw = request.headers.get(header);
    if (!raw) continue;
    seen = true;
    try {
      if (new URL(raw).origin !== origin) return false;
    } catch {
      return false;
    }
  }
  return seen;
}

function remember(token) {
  if (validated.size >= CACHE_LIMIT) validated.clear();
  validated.set(token, Date.now() + VALIDATION_TTL_MS);
}

/**
 * true  → Supabase confirmed the session
 * false → Supabase rejected it
 * null  → Supabase could not be reached (unknown, not a verdict)
 */
async function sessionIsValid(token, cfg) {
  const until = validated.get(token);
  if (until && until > Date.now()) return true;

  const base = String((cfg && cfg.url) || '').trim().replace(/\/+$/, '');
  const anonKey = String((cfg && cfg.anonKey) || '').trim();
  if (!base || !anonKey) return null;

  let response;
  try {
    response = await fetch(base + '/auth/v1/user', {
      headers: {
        apikey: anonKey,
        authorization: 'Bearer ' + token,
        'cache-control': 'no-store',
      },
    });
  } catch {
    return null;
  }
  if (!response.ok) return false;
  remember(token);
  return true;
}

function denyTerminal(request) {
  const dest = (request.headers.get('sec-fetch-dest') || '').toLowerCase();
  if (dest === 'iframe' || dest === 'frame') {
    return new Response('<p>Sign in to open the terminal.</p>', {
      status: 401,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  const accept = (request.headers.get('accept') || '').toLowerCase();
  if (accept.includes('text/html')) {
    return new Response(null, {
      status: 302,
      headers: { location: '/signin?next=%2Findex.html', 'cache-control': 'no-store' },
    });
  }
  return json(401, {
    status: 'TERMINAL_REQUIRES_SIGN_IN',
    detail: 'Open the terminal from the signed-in dashboard.',
  });
}

/** POST /api/terminal-ticket — exchange a Supabase session for the terminal cookie. */
export async function issueTicket(request, env, config) {
  const method = request.method.toUpperCase();
  if (method === 'DELETE') {
    return json(200, { ok: true, cleared: true }, { 'set-cookie': expiredTicketCookie() });
  }
  if (method !== 'POST') {
    return json(405, { status: 'METHOD_NOT_ALLOWED', detail: 'Use POST or DELETE.' });
  }
  if (!isSameOriginRequest(request)) {
    return json(403, { status: 'CROSS_ORIGIN', detail: 'Ticket requests must come from this origin.' });
  }

  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match ? match[1] : '';
  if (token.length < 20) {
    return json(401, { status: 'NO_SESSION', detail: 'A signed-in session is required.' });
  }

  const verdict = await sessionIsValid(token, config);
  if (verdict === false) {
    return json(401, { status: 'INVALID_SESSION', detail: 'That session is not valid any more.' });
  }
  if (verdict === null) {
    return json(503, { status: 'AUTH_UNREACHABLE', detail: 'Could not verify the session with Supabase.' });
  }

  return json(200, { ok: true, path: COOKIE_PATH, maxAge: COOKIE_MAX_AGE_SECONDS }, {
    'set-cookie': ticketCookie(token),
  });
}

/**
 * The role this request's portal session holds — 'admin', 'viewer', or null when
 * there is no usable session. The Worker is the only place the Supabase session
 * is checked, so the daemon accepts this assertion instead of asking the admin
 * for its own secret key a second time. is_admin comes from app_users read with
 * the user's own token, so RLS still applies.
 */
export async function portalRole(request, cfg) {
  const token = cookieValue(request, COOKIE_NAME);
  if (token.length < 20) return null;

  const cached = roleCache.get(token);
  if (cached && cached.until > Date.now()) return cached.role;

  const base = String((cfg && cfg.url) || '').trim().replace(/\/+$/, '');
  const anonKey = String((cfg && cfg.anonKey) || '').trim();
  if (!base || !anonKey) return null;
  const headers = {
    apikey: anonKey,
    authorization: 'Bearer ' + token,
    'cache-control': 'no-store',
  };

  try {
    const userResponse = await fetch(base + '/auth/v1/user', { headers });
    if (!userResponse.ok) return null;
    const user = await userResponse.json();
    if (!user || !user.id) return null;

    const profileResponse = await fetch(
      base +
        '/rest/v1/app_users?id=eq.' +
        encodeURIComponent(user.id) +
        '&select=is_admin,is_active',
      { headers },
    );
    if (!profileResponse.ok) return 'viewer';
    const rows = await profileResponse.json();
    const profile = Array.isArray(rows) ? rows[0] : null;
    if (!profile || profile.is_active === false) return 'viewer';

    const role = profile.is_admin === true ? 'admin' : 'viewer';
    if (roleCache.size >= CACHE_LIMIT) roleCache.clear();
    roleCache.set(token, { role, until: Date.now() + VALIDATION_TTL_MS });
    return role;
  } catch {
    // Unreachable Supabase is not a verdict: the caller keeps its old behaviour.
    return null;
  }
}

/**
 * OPEN_TERMINAL=1|true|yes|on serves /quant-terminal to anonymous visitors too.
 *
 * The dashboard frame normally needs a Supabase session, but the daemon behind
 * this Worker can run with its own keyless admin switch (ALLOW_UNAUTHENTICATED_ADMIN).
 * When it does, gating the embed on a portal sign-in only adds a second login the
 * owner cannot get past. Reversible: unset the variable and redeploy.
 */
export function terminalGateOpen(env) {
  return /^(1|true|yes|on)$/i.test(String((env && env.OPEN_TERMINAL) || '').trim());
}

/** Returns a Response to send instead of proxying, or null when the request may pass. */
export async function guardTerminal(request, env, config) {
  if (terminalGateOpen(env)) return null;
  const token = cookieValue(request, COOKIE_NAME);
  if (!token) return denyTerminal(request);

  const verdict = await sessionIsValid(token, config);
  if (verdict === false) return denyTerminal(request);
  if (verdict === null) {
    return json(503, {
      status: 'AUTH_UNREACHABLE',
      detail: 'Terminal access could not be verified — try again in a moment.',
    });
  }
  return null;
}
