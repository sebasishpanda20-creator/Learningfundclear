/**
 * Strategy/data regression cases, run against the shipped modules.
 * Module level only: no browser, no network, no broker.
 */
const assert = require("node:assert/strict");
global.window = global;
require("../scanner-logic.js");
require("../assets/js/market-data.js");
require("../assets/js/csv-history.js");
require("../assets/js/option-signals.js");
const S = LfcScanner;
const M = LfcMarketData;
const CSV = LfcCsvHistory;
const OPT = LfcOptionSignals;

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
  }
}

// 1. unsupported timeframe ---------------------------------------------------
check("CSV history rejects a non-daily timeframe", () => {
  const map = new Map([["X.NS", []]]);
  assert.throws(() => CSV.history(map, "X.NS", "1h"), /daily candles only/i);
});
check("parseYahoo rejects an unsupported interval", () => {
  assert.throws(() => M.parseYahoo({ chart: { result: [{}] } }, "X.NS", "2h"), /Unsupported candle interval/);
});

// 2. invalid OHLC ------------------------------------------------------------
check("CSV import rejects high below low", () => {
  const csv = [
    "symbol,date,open,high,low,close,volume",
    "X.NS,2026-01-02,100,99,101,100,1000",
  ].join("\n");
  assert.throws(() => CSV.parse(csv), /invalid OHLC or volume/i);
});
check("parseYahoo discards a bar whose high is below low", () => {
  const t = Math.floor(Date.now() / 1000) - 5 * 86400;
  const json = { chart: { result: [{ meta: { gmtoffset: 0 }, timestamp: [t], indicators: { quote: [{ open: [100], high: [99], low: [101], close: [100], volume: [1000] }] } }] } };
  let threw = null;
  try { M.parseYahoo(json, "X.NS", "1d"); } catch (e) { threw = e.message; }
  const ok = threw ? /No valid completed candles/.test(threw) : false;
  assert.ok(ok, "expected the only bar to be discarded, got " + threw);
});

// 3. stale / future ----------------------------------------------------------
check("stale daily history is flagged", () => {
  const old = Math.floor(Date.now() / 1000) - 12 * 86400;
  const bars = [{ timestamp: old }];
  assert.equal(M.stale(bars, "1d", "X.NS", Date.now()), true);
});
check("future CSV date is rejected", () => {
  const future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const csv = ["symbol,date,open,high,low,close,volume", "X.NS," + future + ",100,101,99,100,1000"].join("\n");
  assert.throws(() => CSV.parse(csv), /invalid or future date/i);
});
check("future Yahoo bar counts as incomplete, not valid", () => {
  const t = Math.floor(Date.now() / 1000) - 5 * 86400;
  const json = { chart: { result: [{ meta: { gmtoffset: 0 }, timestamp: [t, t + 30 * 86400], indicators: { quote: [{ open: [100, 100], high: [101, 101], low: [99, 99], close: [100, 100], volume: [1000, 1000] }] } }] } };
  const parsed = M.parseYahoo(json, "X.NS", "1d");
  assert.equal(parsed.bars.length, 1);
  assert.equal(parsed.incomplete, 1);
});

// 4. missing required option chain ------------------------------------------
const inSession = (() => {
  // next Wednesday 11:00 IST
  const d = new Date();
  d.setUTCHours(5, 30, 0, 0);
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
})();
const bars15 = Array.from({ length: 60 }, (_, i) => ({
  timestamp: (inSession - (60 - i) * 900000) / 1000,
  open: 100 + i, high: 100.4 + i, low: 99.6 + i, close: 100 + i,
}));
check("missing chain returns Wait, never a plan", () => {
  const r = OPT.evaluate({ chain: null, bars: bars15, symbol: "NIFTY", expiry: "2026-12-31", now: inSession });
  assert.equal(r.action, "Wait");
  assert.match(r.reason, /No verified chain/i);
  assert.equal(r.entry, undefined);
  assert.equal(r.strike, undefined);
});
check("chain for another symbol/expiry is refused", () => {
  const r = OPT.evaluate({ chain: { symbol: "BANKNIFTY", expiry: "2026-12-31" }, bars: bars15, symbol: "NIFTY", expiry: "2026-12-31", now: inSession });
  assert.equal(r.action, "Wait");
  assert.match(r.reason, /No verified chain/i);
});

// 5. zero sizing -------------------------------------------------------------
const Desk = require("../assets/js/crypto-desk-engine.js");
const Adv = require("../assets/js/crypto-advanced-engine.js");
check("zero quantity is refused by the cost model", () => {
  const legs = [
    { side: "buy", price: 100, qty: 1, cv: 1 },
    { side: "sell", price: 110, qty: 1, cv: 1 },
  ];
  assert.equal(Desk.roundTripCosts(legs, 100, 0.1, 0), null);
});
check("zero capital yields no crypto credit candidate", () => {
  const now = Date.UTC(2026, 9, 26, 14, 0);
  const tickers = {
    BTC: { spot: 60000, contracts: [{ strike: 60000, bid: 200, ask: 210, oi: 5000, mark: 205, cv: 0.001, expiry: now + 86400000 }] },
  };
  const trend = { direction: "RANGE", current: 60000, strength: 0 };
  const r = Adv.evaluateCredit(tickers, trend, "BTC", 0, now, 4);
  assert.ok(!r || !r.candidate, "zero capital must not produce a sized candidate");
});

// 6. arbitrary probability ---------------------------------------------------
check("scanner result exposes no probability/win-rate field", () => {
  const bars = Array.from({ length: 120 }, (_, i) => ({ date: String(i), open: 100, high: 104, low: 96, close: 101, volume: 100 }));
  const r = S.computeZones(bars);
  assert.ok(r);
  for (const key of Object.keys(r)) assert.ok(!/probability|winrate|odds|chance/i.test(key), "unexpected field " + key);
  const g = S.gtfSetup(bars);
  if (g) for (const key of Object.keys(g)) assert.ok(!/probability|winrate|odds|chance/i.test(key));
});
check("option signal output carries no fabricated probability", () => {
  const r = OPT.evaluate({ chain: null, bars: bars15, symbol: "NIFTY", expiry: "2026-12-31", now: inSession });
  assert.equal(Object.keys(r).filter((k) => /probab|winrate|chance/i.test(k)).length, 0);
});

const failed = results.filter((r) => !r.pass);
console.log(JSON.stringify({ checks: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
