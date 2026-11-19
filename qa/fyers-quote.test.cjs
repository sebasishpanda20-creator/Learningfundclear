"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../assets/js/fyers-quote.js");

const now = Date.UTC(2026, 10, 19, 12);

test("maps indices and NSE/BSE symbols to FYERS v3 symbols", () => {
  assert.deepEqual(Q.mapSymbol("NIFTY"), {
    ok: true,
    symbol: "NSE:NIFTY50-INDEX",
    label: "NIFTY 50",
    kind: "INDEX",
  });
  assert.equal(Q.mapSymbol("BANKNIFTY").symbol, "NSE:NIFTYBANK-INDEX");
  assert.equal(Q.mapSymbol("NIFTYBANK").symbol, "NSE:NIFTYBANK-INDEX");
  assert.equal(Q.mapSymbol("RELIANCE").symbol, "NSE:RELIANCE-EQ");
  assert.equal(Q.mapSymbol("reliance.ns").symbol, "NSE:RELIANCE-EQ");
  assert.equal(Q.mapSymbol("500325.BO").symbol, "BSE:500325");
  assert.equal(Q.mapSymbol("500325").symbol, "BSE:500325");
  assert.equal(Q.mapSymbol("NSE:INFY-EQ").symbol, "NSE:INFY-EQ");
  assert.equal(Q.mapSymbol("RELIANCE-EQ").symbol, "NSE:RELIANCE-EQ");
  assert.equal(Q.mapSymbol("GC=F").ok, false);
  assert.equal(Q.mapSymbol("").code, "SYMBOL_REQUIRED");
});

test("normalizes FYERS epoch seconds and milliseconds", () => {
  assert.equal(Q.normalizeAsOf(1763200000), 1763200000000);
  assert.equal(Q.normalizeAsOf(1763200000000), 1763200000000);
  assert.equal(Q.normalizeAsOf(null), null);
  assert.equal(Q.normalizeAsOf("not-a-time"), null);
});

test("fresh, stale and timestamp-unavailable quotes are distinct", () => {
  const fresh = Q.evaluate(
    { ltp: 24850.5, change: 42.1, change_pct: 0.17, as_of: now / 1000, fetched_at: new Date(now).toISOString() },
    { now },
  );
  assert.equal(fresh.status, "fresh");
  assert.equal(fresh.ltp, 24850.5);
  assert.equal(fresh.ageMs, 0);

  const stale = Q.evaluate({ ltp: 100, as_of: (now - 3 * 60000) / 1000 }, { now });
  assert.equal(stale.status, "stale");
  assert.equal(stale.code, "STALE_QUOTE");

  const unverified = Q.evaluate({ ltp: 100 }, { now });
  assert.equal(unverified.status, "unverified");
  assert.equal(unverified.code, "TIMESTAMP_UNAVAILABLE");
  assert.equal(unverified.asOf, null);

  const noPrice = Q.evaluate({ ltp: null, as_of: now / 1000 }, { now });
  assert.equal(noPrice.status, "unavailable");
  assert.equal(noPrice.code, "NO_PRICE");
});

test("broker failures produce clear unavailable codes", () => {
  assert.equal(Q.evaluate({}, { httpStatus: 401 }).code, "NOT_CONNECTED");
  assert.equal(Q.evaluate({}, { httpStatus: 403 }).code, "OWNER_ONLY");
  assert.equal(Q.evaluate({}, { httpStatus: 503 }).code, "NOT_CONFIGURED");
  assert.equal(Q.evaluate({}, { httpStatus: 502 }).code, "PROVIDER_UNAVAILABLE");
  assert.equal(Q.evaluate({}, { httpStatus: 404 }).code, "NOT_DEPLOYED");
});

test("fetchQuote sends the mapped symbol with cookies and no token", async () => {
  const calls = [];
  const result = await Q.fetchQuote("NIFTY", {
    now,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return {
        status: 200,
        json: async () => ({
          symbol: "NSE:NIFTY50-INDEX",
          ltp: 24850.5,
          change: 42.1,
          change_pct: 0.17,
          as_of: now / 1000,
          fetched_at: new Date(now).toISOString(),
          source: "fyers",
        }),
      };
    },
  });
  assert.equal(result.status, "fresh");
  assert.equal(result.ltp, 24850.5);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/fyers\/quote\?symbol=NSE%3ANIFTY50-INDEX$/);
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test("fetchQuote fails closed on network and invalid payloads", async () => {
  const network = await Q.fetchQuote("NIFTY", {
    fetch: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(network.status, "unavailable");
  assert.equal(network.code, "NETWORK");

  const invalid = await Q.fetchQuote("NIFTY", {
    fetch: async () => ({
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    }),
  });
  assert.equal(invalid.code, "INVALID_RESPONSE");
});

test("a 404 route reports NOT_DEPLOYED even when the body is HTML", async () => {
  const result = await Q.fetchQuote("NIFTY", {
    fetch: async () => ({
      status: 404,
      json: async () => {
        throw new Error("not json");
      },
    }),
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.code, "NOT_DEPLOYED");
});
