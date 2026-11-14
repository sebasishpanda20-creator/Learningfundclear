// Pure FYERS v3 helpers shared by the Worker routes and the node tests.
// Nothing here touches storage or the network, so every branch is testable.

export const FYERS_AUTH_BASE = 'https://api-t1.fyers.in';
export const FYERS_AUTH_PATH = '/api/v3/generate-authcode';
export const FYERS_TOKEN_PATH = '/api/v3/validate-authcode';
export const FYERS_LOGOUT_PATH = '/api/v3/logout';
export const FYERS_QUOTES_PATH = '/data/quotes';

export const FYERS_COOKIE = 'lfc_fyers_session';
export const STATE_TTL_SECONDS = 600;
export const SESSION_FALLBACK_SECONDS = 12 * 60 * 60;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// FYERS access tokens expire at 06:30 IST; return the next such instant.
export function nextFyersExpiry(nowMs = Date.now()) {
  const ist = new Date(nowMs + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  let expiry = Date.UTC(y, m, d, 6, 30, 0, 0) - IST_OFFSET_MS;
  if (expiry <= nowMs) expiry += 24 * 60 * 60 * 1000;
  return expiry;
}

export function secondsUntil(ms, nowMs = Date.now()) {
  return Math.max(0, Math.floor((ms - nowMs) / 1000));
}

function b64encode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function b64decode(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomHex(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// appIdHash = SHA-256("app_id:secret"), hex, exactly as FYERS v3 documents.
export function appIdHash(clientId, secretId) {
  return sha256Hex(`${clientId}:${secretId}`);
}

async function importAesKey(keyB64) {
  const raw = b64decode(keyB64);
  if (raw.length !== 32) throw new Error('token key must be 32 bytes');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Broker tokens are sealed at rest; only ciphertext and IV reach storage.
export async function sealToken(token, keyB64) {
  const key = await importAesKey(keyB64);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(String(token)),
  );
  return { cipher: b64encode(new Uint8Array(cipher)), iv: b64encode(iv) };
}

export async function openToken(sealed, keyB64) {
  if (!sealed || !sealed.cipher || !sealed.iv) throw new Error('sealed token missing');
  const key = await importAesKey(keyB64);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(sealed.iv) },
    key,
    b64decode(sealed.cipher),
  );
  return new TextDecoder().decode(plain);
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    if (!name) continue;
    out[name] = part.slice(at + 1).trim();
  }
  return out;
}

export function sessionCookie(sid, { maxAge, secure }) {
  return [
    `${FYERS_COOKIE}=${sid}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    'SameSite=Lax',
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function clearSessionCookie({ secure }) {
  return [
    `${FYERS_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    'SameSite=Lax',
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function buildLoginUrl({ clientId, redirectUri, state, scope }) {
  const url = new URL(FYERS_AUTH_PATH, FYERS_AUTH_BASE);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (scope) url.searchParams.set('scope', scope);
  return url.toString();
}

export function cleanSymbol(symbol) {
  return String(symbol || '').toUpperCase().replace(/[^A-Z0-9&._:-]/g, '').slice(0, 32);
}

export function providerSymbol(symbol) {
  const clean = cleanSymbol(symbol || 'NIFTY');
  if (!clean) return '';
  return clean.includes(':') ? clean : `NSE:${clean}-EQ`;
}

export function quoteUrl(symbol) {
  const url = new URL(FYERS_QUOTES_PATH, FYERS_AUTH_BASE);
  url.searchParams.set('symbols', providerSymbol(symbol));
  return url.toString();
}

// Tolerant mapping: a missing numeric ltp is reported as unavailable, never faked.
export function mapQuote(payload) {
  const row = Array.isArray(payload?.d) ? payload.d[0] : null;
  const v = row?.v || {};
  const ltp = typeof v.lp === 'number' && Number.isFinite(v.lp) ? v.lp : null;
  if (payload?.s !== 'ok' || ltp === null) {
    return { ok: false, providerCode: payload?.code ?? null, message: payload?.message || null };
  }
  return {
    ok: true,
    symbol: row?.n || null,
    ltp,
    change: typeof v.ch === 'number' ? v.ch : null,
    changePct: typeof v.chp === 'number' ? v.chp : null,
    asOf: v.tt ?? payload?._ts ?? null,
  };
}

export function providerAuth(clientId, token) {
  // FYERS expects "app_id:access_token"; tolerate an already-prefixed token.
  const value = String(token || '');
  return value.startsWith(`${clientId}:`) ? value : `${clientId}:${value}`;
}

export function normalizeReason(value) {
  const allowed = new Set([
    'provider_refused',
    'missing_code',
    'invalid_state',
    'not_configured',
    'token_exchange_failed',
    'storage_failed',
  ]);
  return allowed.has(value) ? value : 'login_failed';
}

export function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (origin) return origin === url.origin;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  return true;
}
