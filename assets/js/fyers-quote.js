/* Shared FYERS quote client.
 *
 * Calls the worker's same-origin /api/fyers/quote route. The browser never sees
 * an FYERS token. Every response is checked for a numeric price and a usable
 * exchange timestamp before it can be labelled fresh.
 */
(function (root) {
  'use strict';

  const MAX_AGE_MS = 2 * 60 * 1000;
  const INDEX_SYMBOLS = Object.freeze({
    NIFTY: { symbol: 'NSE:NIFTY50-INDEX', label: 'NIFTY 50' },
    NIFTY50: { symbol: 'NSE:NIFTY50-INDEX', label: 'NIFTY 50' },
    '^NSEI': { symbol: 'NSE:NIFTY50-INDEX', label: 'NIFTY 50' },
    BANKNIFTY: { symbol: 'NSE:NIFTYBANK-INDEX', label: 'BANK NIFTY' },
    NIFTYBANK: { symbol: 'NSE:NIFTYBANK-INDEX', label: 'BANK NIFTY' },
    '^NSEBANK': { symbol: 'NSE:NIFTYBANK-INDEX', label: 'BANK NIFTY' },
    FINNIFTY: { symbol: 'NSE:FINNIFTY-INDEX', label: 'FINNIFTY' },
    MIDCPNIFTY: { symbol: 'NSE:MIDCPNIFTY-INDEX', label: 'MIDCPNIFTY' },
  });

  function unsupported(message) {
    return { ok: false, code: 'UNSUPPORTED_SYMBOL', message };
  }

  function nse(base) {
    const clean = String(base || '').replace(/-EQ$/i, '').toUpperCase();
    if (!/^[A-Z0-9&._-]+$/.test(clean)) return unsupported('Only NSE/BSE equity or index symbols are supported.');
    return { ok: true, symbol: `NSE:${clean}-EQ`, label: clean, kind: 'NSE' };
  }

  function bse(base) {
    const clean = String(base || '').trim().toUpperCase();
    if (!/^[A-Z0-9&._-]+$/.test(clean)) return unsupported('Only NSE/BSE equity or index symbols are supported.');
    return { ok: true, symbol: `BSE:${clean}`, label: clean, kind: 'BSE' };
  }

  /* Maps portal/Yahoo-style symbols to the FYERS v3 symbol needed by the route. */
  function mapSymbol(input) {
    const raw = String(input ?? '').trim().toUpperCase();
    if (!raw) return { ok: false, code: 'SYMBOL_REQUIRED', message: 'Enter an NSE or BSE symbol.' };
    if (INDEX_SYMBOLS[raw]) return { ok: true, ...INDEX_SYMBOLS[raw], kind: 'INDEX' };
    if (/^(NSE|BSE):[A-Z0-9&._-]+$/.test(raw)) {
      return { ok: true, symbol: raw, label: raw.slice(4), kind: raw.slice(0, 3) };
    }
    if (raw.endsWith('.NS')) return nse(raw.slice(0, -3));
    if (raw.endsWith('.BO')) return bse(raw.slice(0, -3));
    if (/^\d+$/.test(raw)) return bse(raw);
    if (/^[A-Z0-9&._-]+$/.test(raw)) return nse(raw);
    return unsupported('Use an NSE/BSE equity symbol (RELIANCE, RELIANCE.NS) or index (NIFTY, BANKNIFTY).');
  }

  /* FYERS timestamps are epoch seconds in the current provider response. Accept
   * milliseconds too, but never turn a missing timestamp into "now". */
  function normalizeAsOf(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e11 ? n * 1000 : n;
  }

  function numeric(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function unavailable(code, message, extra) {
    return { status: 'unavailable', code, message, ...(extra || {}) };
  }

  function httpFailure(status, payload) {
    if (status === 401) {
      return unavailable('NOT_CONNECTED', 'FYERS is not connected. Open Quant desk and connect FYERS first.', { httpStatus: status });
    }
    if (status === 403) {
      return unavailable('OWNER_ONLY', 'This portal account is not the configured FYERS owner.', { httpStatus: status });
    }
    if (status === 503) {
      return unavailable('NOT_CONFIGURED', 'FYERS credentials or storage are not configured on the server.', { httpStatus: status });
    }
    if (status === 502) {
      return unavailable('PROVIDER_UNAVAILABLE', 'FYERS did not return a usable quote. Try again while the market is open.', { httpStatus: status });
    }
    if (status === 404) {
      return unavailable('NOT_DEPLOYED', 'The FYERS routes are unavailable on this host. Use the deployed portal.', { httpStatus: status });
    }
    return unavailable(
      'QUOTE_UNAVAILABLE',
      (payload && payload.message) || `Broker quote failed (HTTP ${status || 'unknown'}).`,
      { httpStatus: status },
    );
  }

  function evaluate(payload, { httpStatus = 200, now = Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
    if (httpStatus !== 200) return httpFailure(httpStatus, payload);
    if (!payload || typeof payload !== 'object' || payload.error) {
      return unavailable('PROVIDER_UNAVAILABLE', 'The broker route returned no usable quote.');
    }
    const ltp = numeric(payload.ltp);
    if (!(Number.isFinite(ltp) && ltp > 0)) {
      return unavailable('NO_PRICE', 'FYERS returned no positive last-traded price.');
    }
    const base = {
      symbol: payload.symbol || null,
      ltp,
      change: numeric(payload.change),
      changePct: numeric(payload.change_pct),
      fetchedAt: Number.isFinite(Date.parse(payload.fetched_at)) ? Date.parse(payload.fetched_at) : null,
      source: 'fyers',
    };
    const asOf = normalizeAsOf(payload.as_of);
    if (!asOf) {
      return {
        ...base,
        status: 'unverified',
        code: 'TIMESTAMP_UNAVAILABLE',
        message: 'FYERS supplied a price but no exchange timestamp; it is not counted as fresh.',
        asOf: null,
        ageMs: null,
      };
    }
    const ageMs = now - asOf;
    if (ageMs < -60000) {
      return { ...base, status: 'stale', code: 'CLOCK_SKEW', message: 'The broker timestamp is in the future.', asOf, ageMs };
    }
    if (ageMs > maxAgeMs) {
      return {
        ...base,
        status: 'stale',
        code: 'STALE_QUOTE',
        message: `The last FYERS quote is ${Math.floor(ageMs / 60000)} minute(s) old.`,
        asOf,
        ageMs,
      };
    }
    return { ...base, status: 'fresh', code: 'FRESH', message: 'Fresh FYERS quote.', asOf, ageMs };
  }

  async function fetchQuote(input, options = {}) {
    const mapped = mapSymbol(input);
    if (!mapped.ok) return unavailable(mapped.code, mapped.message);
    const fetchImpl = options.fetch || root.fetch;
    if (typeof fetchImpl !== 'function') return unavailable('NETWORK', 'This browser cannot request broker quotes.');
    const signal = options.signal || (root.AbortSignal && root.AbortSignal.timeout
      ? root.AbortSignal.timeout(options.timeoutMs || 12000)
      : undefined);
    let response;
    try {
      response = await fetchImpl('/api/fyers/quote?symbol=' + encodeURIComponent(mapped.symbol), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal,
      });
    } catch (error) {
      return unavailable(
        error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
        error && error.name === 'AbortError' ? 'The broker quote timed out.' : 'Could not reach the broker quote route.',
      );
    }
    const httpStatus = response.status;
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (httpStatus === 200 && !payload) {
      return unavailable('INVALID_RESPONSE', 'The broker route returned invalid JSON.');
    }
    return evaluate(payload, {
      httpStatus,
      now: options.now,
      maxAgeMs: options.maxAgeMs,
    });
  }

  const api = { MAX_AGE_MS, mapSymbol, normalizeAsOf, evaluate, fetchQuote };
  root.LfcFyersQuote = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
