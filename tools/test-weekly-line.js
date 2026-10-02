// Synthetic harness for the NSE weekly digest line in signal-scan.js.
// Stubs fetch so qualityLine sees fake signal_events rows + fake bars, then
// asserts the 90d and 7d lines carry the right hit % and EV.
// Run: node tools/test-weekly-line.js  (exit 0 = pass)
"use strict";
const fs = require("fs");
const path = require("path");

const NOW = Date.now();
const DAY = 24 * 3600 * 1000;

// loadQualityCache / loadNseQualityCache read from __dirname — give the test
// its own copy of signal-scan logic by chdir-free injection: we can't easily
// point __dirname elsewhere, so instead copy the real caches aside? Simpler:
// the real scan-quality-nse.json exists with board {hitRate:40, ev:0.2}; we
// keep it. scan-quality.json (commodities) we leave to whatever is on disk —
// the harness uses RELIANCE.NS only, so commodity lines print nothing.

// ── stub fetch before loading the module ─────────────────────────────────
const ROWS = [
  // weekly window: 2 TARGET + 1 STOP resolved (3d old), 1 open (1d old)
  { symbol: "RELIANCE.NS", action: "LONG", created_at: new Date(NOW - 3 * DAY).toISOString(),
    details: "zone 100-110 stop 95 target 120 · EOD " + new Date(NOW - 4 * DAY).toISOString().slice(0, 10) },
  { symbol: "TCS.NS", action: "LONG", created_at: new Date(NOW - 3 * DAY).toISOString(),
    details: "zone 100-110 stop 95 target 120 · EOD " + new Date(NOW - 4 * DAY).toISOString().slice(0, 10) },
  { symbol: "INFY.NS", action: "LONG", created_at: new Date(NOW - 2 * DAY).toISOString(),
    details: "zone 100-110 stop 95 target 120 · EOD " + new Date(NOW - 5 * DAY).toISOString().slice(0, 10) },
  { symbol: "HDFCBANK.NS", action: "LONG", created_at: new Date(NOW - 1 * DAY).toISOString(),
    details: "zone 100-110 stop 95 target 120 · EOD " + new Date(NOW - 1 * DAY).toISOString().slice(0, 10) },
  // older than 7d, inside 90d: 1 STOP (20d old)
  { symbol: "SBIN.NS", action: "SHORT", created_at: new Date(NOW - 20 * DAY).toISOString(),
    details: "zone 100-110 stop 95 target 120 · EOD " + new Date(NOW - 21 * DAY).toISOString().slice(0, 10) },
];

let fetchCalls = 0;
global.fetch = async (url) => {
  fetchCalls++;
  url = String(url);
  if (url.includes("/rest/v1/signal_events")) {
    return { ok: true, status: 200, json: async () => ROWS };
  }
  if (url.includes("query1.finance.yahoo.com") || url.includes("chart")) {
    // 46 daily OHLC rows ending TODAY. Rising closes → LONG walks hit target;
    // INFY.NS / SBIN.NS crash below the stop after day 40 → STOP for any walk
    // starting after their EOD dates (which must sit INSIDE the bar range —
    // walks only look at bars strictly after the signal's EOD date).
    const sym = String(url).match(/chart\/([^?]+)/);
    const crash = sym && /INFY|SBIN/.test(decodeURIComponent(sym[1]));
    const start = Date.now() - 45 * DAY;
    const ts = [], o = [], h = [], l = [], c = [];
    for (let i = 0; i < 46; i++) {
      ts.push(Math.floor((start + i * DAY) / 1000));
      const base = crash && i >= 40 ? 90 : 100 + i;
      o.push(base); h.push(base + 2); l.push(base - 2); c.push(base + 1);
    }
    const json = {
      chart: { result: [{ timestamp: ts,
        indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: ts.map(() => 1000) }] } }] },
    };
    return { ok: true, status: 200, json: async () => json };
  }
  throw new Error("unexpected fetch " + url);
};

// Neutralise the auto-run main() at the bottom and keep the temp copy inside
// tools/ so the relative require("../scanner-logic.js") still resolves.
const src = fs.readFileSync(path.join(__dirname, "signal-scan.js"), "utf8");
const mod = src.replace(/main\(\)\.catch[\s\S]*$/, "module.exports = {};");
const tmp = path.join(__dirname, ".signal-scan-harness-" + process.pid + ".js");
fs.writeFileSync(tmp, mod);
const M = require(tmp);
fs.unlinkSync(tmp);

// Pull the internal helpers out via a second, instrumented copy? They aren't
// exported — so exercise qualityLine end-to-end through a stubbed digest path
// instead: replicate the exact call main() makes.
(async () => {
  // qualityLine is module-private; re-require with an eval bridge that
  // exports it after definitions run.
  const bridged = mod.replace("module.exports = {};", "module.exports = { qualityLine: (a) => qualityLine(a) };");
  fs.writeFileSync(tmp, bridged);
  delete require.cache[require.resolve(tmp)];
  const Q = require(tmp);
  fs.unlinkSync(tmp);

  const out = await Q.qualityLine(["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "SBIN.NS"]);
  const lines = out.split("\n");
  console.log("---- qualityLine output ----");
  console.log(out);
  console.log("----------------------------");

  const nse = lines.find((l) => l.startsWith("NSE (90d"));
  const wk = lines.find((l) => l.startsWith("NSE weekly"));
  const fails = [];
  const expect = (cond, msg) => { if (!cond) fails.push(msg); };

  // 90d: 3 TARGET + 2 STOP resolved of 5 rows → 60% hit, EV (3*2-2*1)/5 = +0.8R
  expect(nse, "missing NSE 90d line");
  if (nse) {
    expect(nse.includes("live 60% (5 resolved"), "90d line should read live 60% (5 resolved), got: " + nse);
    expect(nse.includes("EV +0.8R"), "90d EV should be +0.8R, got: " + nse);
    expect(nse.includes("board 45% hit · +0.35R EV"), "90d line should quote board baseline, got: " + nse);
  }
  // weekly: 3 TARGET + 1 STOP of the 4 rows stored in-window → 75% hit,
  // EV (3*2-1*1)/4 = +1.25R — different from the 90d numbers, proving the split
  expect(wk, "missing NSE weekly line");
  if (wk) {
    expect(wk.includes("live 75% (4 resolved"), "weekly should read live 75% (4 resolved), got: " + wk);
    expect(wk.includes("EV +1.25R"), "weekly EV should be +1.25R, got: " + wk);
    expect(wk.includes("board 45% hit · +0.35R EV"), "weekly line should quote board baseline, got: " + wk);
  }
  // no commodities line (no commodity symbols active)
  expect(!lines.some((l) => l.startsWith("Commodities")), "commodity line should be absent");

  if (fails.length) { console.error("FAIL:\n" + fails.join("\n")); process.exit(1); }
  console.log("PASS weekly-line harness (90d + 7d math, board baseline, window split)");
})();
