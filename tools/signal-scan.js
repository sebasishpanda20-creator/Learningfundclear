#!/usr/bin/env node
/*!
 * LearningFundClear — nightly EOD zone signal scan
 * ===============================================
 * Runs the SAME zone math as the portal scanner (scanner-logic.js is required
 * verbatim below — no second implementation to drift), then posts every fresh
 * demand/supply touch to the tv-webhook edge function, which stores it in
 * signal_events. The Setups page reads that table, so signals appear there with
 * stop/target already parsed from the details text.
 *
 * This is the no-TradingView-plan path: TradingView webhooks need a paid plan,
 * but this runs on the repository's GitHub Actions cron for free.
 *
 * Usage:
 *   node tools/signal-scan.js                 # scan the watchlist and post
 *   node tools/signal-scan.js --dry-run       # find signals, post nothing
 *   node tools/signal-scan.js --symbols=RELIANCE.NS,GC=F --limit=2
 *
 * Environment:
 *   TV_WEBHOOK_SECRET  shared secret set in Supabase (required unless --dry-run)
 *   WEBHOOK_URL        defaults to the deployed tv-webhook function
 *   SCAN_SYMBOLS       comma-separated override (used by the workflow inputs)
 *   SCAN_DRY_RUN       "true" disables posting (used by the workflow inputs)
 */
"use strict";

const fs = require("fs");
const path = require("path");

// The scanner logic is a browser IIFE that attaches itself to `window`.
// Giving Node a `window` that points at the global object loads it unchanged.
global.window = global;
require(path.join(__dirname, "..", "scanner-logic.js"));
const computeZones = global.LfcScanner.computeZones;

// ── tunables (mirror the scanner's defaults so portal and cron agree) ───────
const PIVOT_LEFT = 3;
const PIVOT_RIGHT = 3;
const RANGE = "730d";          // 2 years of daily bars, the scanner's default
const MIN_BARS = 100;          // computeZones needs at least this many
const STOP_BUF_PCT = 0.5;      // stop sits this % beyond the zone edge
const RR_TARGET = 2.0;         // target = entry ± risk × R:R
const TREND_FILTER = false;    // true = only zones aligned with the EMA10/20/50 stack
const CONCURRENCY = 3;         // gentle: Yahoo rate-limits bursts
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const WEBHOOK_URL = process.env.WEBHOOK_URL ||
  "https://chbtjicvbezbiosuouwm.supabase.co/functions/v1/tv-webhook";
const SECRET = process.env.TV_WEBHOOK_SECRET || "";

const argv = process.argv.slice(2);
const argVal = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
};
const DRY_RUN = argv.includes("--dry-run") || process.env.SCAN_DRY_RUN === "true";
const SYMBOL_OVERRIDE = argVal("symbols") || process.env.SCAN_SYMBOLS || "";
const LIMIT = Number(argVal("limit") || 0);

// ── data: Yahoo daily bars, browser UA, text-proxy fallback ────────────────
function parseYahoo(json) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !r.timestamp) return null;
  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const bars = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open && q.open[i], h = q.high && q.high[i];
    const l = q.low && q.low[i], c = q.close && q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    bars.push({
      date: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10),
      open: o, high: h, low: l, close: c,
      volume: (q.volume && q.volume[i]) || 0,
    });
  }
  return bars.length ? bars : null;
}

function chartUrl(symbol) {
  return "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) + "?range=" + RANGE + "&interval=1d";
}

async function getBars(symbol) {
  const url = chartUrl(symbol);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const bars = parseYahoo(await res.json());
      if (bars) return bars;
    }
  } catch (e) { /* fall through to the proxy */ }
  const res = await fetch("https://r.jina.ai/" + url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error("proxy HTTP " + res.status);
  const text = await res.text();
  const start = text.indexOf('{"chart"');
  if (start < 0) throw new Error("proxy returned no chart JSON");
  return parseYahoo(JSON.parse(text.slice(start)));
}

// ── signal decision (same rules as the scanner's touch filter) ─────────────
function scanSymbol(symbol, bars) {
  const res = computeZones(bars, { pivotLeft: PIVOT_LEFT, pivotRight: PIVOT_RIGHT });
  if (!res) return null;
  const last = bars[bars.length - 1];
  const price = res.price;
  const touched = (z) => last.low <= z.top && last.high >= z.bottom;

  // among the zones this bar actually touched, take the one nearest to price
  const nearestTouched = (zones) => {
    let best = null, bestDist = Infinity;
    for (const z of (zones || [])) {
      if (!touched(z)) continue;
      const dist = Math.abs(price - (z.top + z.bottom) / 2);
      if (dist < bestDist) { bestDist = dist; best = z; }
    }
    return best;
  };

  const demand = nearestTouched(res.demandZones);
  const supply = nearestTouched(res.supplyZones);
  const trendOkLong = !TREND_FILTER || res.trend === "UPTREND";
  const trendOkShort = !TREND_FILTER || res.trend === "DOWNTREND";

  if (demand && trendOkLong) return buildSignal(symbol, "LONG", demand, price, res.trend, last.date);
  if (supply && trendOkShort) return buildSignal(symbol, "SHORT", supply, price, res.trend, last.date);
  return null;
}

function buildSignal(symbol, action, zone, price, trend, date) {
  const stop = action === "LONG"
    ? zone.bottom * (1 - STOP_BUF_PCT / 100)
    : zone.top * (1 + STOP_BUF_PCT / 100);
  const risk = action === "LONG" ? price - stop : stop - price;
  if (!(risk > 0) || !(price > 0)) return null;
  const target = action === "LONG" ? price + risk * RR_TARGET : price - risk * RR_TARGET;
  const f = (n) => n.toFixed(2);
  return {
    symbol,
    action,
    price: Number(f(price)),
    details: `Daily zone ${f(zone.bottom)}-${f(zone.top)} stop ${f(stop)} target ${f(target)} · ${trend} · EOD ${date}`,
  };
}

// ── posting ───────────────────────────────────────────────────────────────
async function post(signal) {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: SECRET,
      symbol: signal.symbol,
      action: signal.action,
      price: signal.price,
      details: signal.details,
    }),
    signal: AbortSignal.timeout(20000),
  });
  return { status: res.status, body: (await res.text()).slice(0, 200) };
}

// ── tiny worker pool (same shape as the scanner's) ─────────────────────────
function runPool(items, limit, worker) {
  let next = 0;
  const launch = () => {
    if (next >= items.length) return Promise.resolve();
    const item = items[next++];
    return Promise.resolve().then(() => worker(item)).then(launch);
  };
  const pool = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) pool.push(launch());
  return Promise.all(pool);
}

// ── main ──────────────────────────────────────────────────────────────────
function loadWatchlist() {
  const file = path.join(__dirname, "signal-watchlist.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return (parsed.symbols || []).filter(Boolean);
}

async function main() {
  let symbols = SYMBOL_OVERRIDE
    ? SYMBOL_OVERRIDE.split(",").map((s) => s.trim()).filter(Boolean)
    : loadWatchlist();
  if (LIMIT > 0) symbols = symbols.slice(0, LIMIT);

  if (!symbols.length) {
    console.error("No symbols to scan — check tools/signal-watchlist.json");
    process.exit(1);
  }
  if (!DRY_RUN && !SECRET) {
    console.error("TV_WEBHOOK_SECRET is not set. Add it as a repository secret (Settings → Secrets and variables → Actions) or pass --dry-run.");
    process.exit(1);
  }

  console.log(`zone scan · ${symbols.length} symbols · range ${RANGE} · pivots ${PIVOT_LEFT}/${PIVOT_RIGHT} · dry-run=${DRY_RUN}`);

  const signals = [];
  const failures = [];
  await runPool(symbols, CONCURRENCY, async (symbol) => {
    try {
      const bars = await getBars(symbol);
      if (!bars || bars.length < MIN_BARS) {
        failures.push(`${symbol} — only ${bars ? bars.length : 0} bars`);
        return;
      }
      const signal = scanSymbol(symbol, bars);
      if (signal) signals.push(signal);
    } catch (e) {
      failures.push(`${symbol} — ${e.message}`);
    }
  });

  signals.sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
  console.log(`\nfound ${signals.length} signal(s), ${failures.length} symbol(s) unavailable`);
  for (const s of signals) {
    console.log(`  ${s.symbol.padEnd(16)} ${s.action.padEnd(5)} ${String(s.price).padStart(10)}  ${s.details}`);
  }
  if (failures.length) {
    console.log("\nunavailable:");
    failures.forEach((f) => console.log("  " + f));
  }

  if (DRY_RUN) {
    console.log("\ndry run — nothing posted.");
    if (!signals.length && failures.length === symbols.length) process.exit(1);
    return;
  }

  let posted = 0, duplicates = 0, errors = 0;
  for (const signal of signals) {
    try {
      const r = await post(signal);
      if (r.status === 200 && r.body.includes('"skipped":"duplicate"')) { duplicates++; console.log(`  skip  ${signal.symbol} (already recorded)`); }
      else if (r.status === 200) { posted++; console.log(`  saved ${signal.symbol} ${signal.action}`); }
      else { errors++; console.log(`  FAIL  ${signal.symbol} HTTP ${r.status} ${r.body}`); }
    } catch (e) {
      errors++;
      console.log(`  FAIL  ${signal.symbol} ${e.message}`);
    }
  }
  console.log(`\ndone — ${posted} saved, ${duplicates} duplicate(s) skipped, ${errors} error(s)`);

  // a total data outage is worth a red run so it gets noticed
  if (!signals.length && failures.length === symbols.length) process.exit(1);
}

main().catch((e) => {
  console.error("scan failed:", e);
  process.exit(1);
});
