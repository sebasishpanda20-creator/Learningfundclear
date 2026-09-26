#!/usr/bin/env node
/*!
 * LearningFundClear — nightly EOD zone signal scan (Daily / Weekly / Monthly)
 * ===========================================================================
 * Runs the SAME zone math as the portal scanner (scanner-logic.js is required
 * verbatim below — no second implementation to drift), then posts every fresh
 * demand/supply touch to the tv-webhook edge function, which stores it in
 * signal_events. The Setups page reads that table, so signals appear there with
 * stop/target already parsed from the details text.
 *
 * Every signal carries its timeframe in the details text, e.g.
 *   "Weekly zone 1180.00-1240.00 stop 1174.10 target 1331.80 · UPTREND · EOD 2026-09-25"
 * so daily, weekly and monthly setups are told apart on the Setups page.
 *
 * Usage:
 *   node tools/signal-scan.js                      # all timeframes, post
 *   node tools/signal-scan.js --dry-run            # find signals, post nothing
 *   node tools/signal-scan.js --timeframes=w,m     # weekly + monthly only
 *   node tools/signal-scan.js --symbols=RELIANCE.NS,GC=F --limit=2
 *
 * Environment:
 *   TV_WEBHOOK_SECRET  shared secret set in Supabase (required unless --dry-run)
 *   WEBHOOK_URL        defaults to the deployed tv-webhook function
 *   SCAN_SYMBOLS       comma-separated symbol override (workflow input)
 *   SCAN_TIMEFRAMES    comma-separated timeframe ids d,w,m (workflow input)
 *   SCAN_DRY_RUN       "true" disables posting (workflow input)
 */
"use strict";

const fs = require("fs");
const path = require("path");

// The scanner logic is a browser IIFE that attaches itself to `window`.
// Giving Node a `window` that points at the global object loads it unchanged.
global.window = global;
require(path.join(__dirname, "..", "scanner-logic.js"));
const computeZones = global.LfcScanner.computeZones;

// ── timeframes (interval/range mirror the scanner's selectedTFs) ───────────
// minBars is 100 for every timeframe: computeZones() itself refuses fewer than
// 100 bars, so there is no point caching or posting anything sparser.
const TIMEFRAMES = [
  { id: "d", label: "Daily",   interval: "1d",  range: "730d",  minBars: 100 },
  { id: "w", label: "Weekly",  interval: "1wk", range: "1095d", minBars: 100 },
  { id: "m", label: "Monthly", interval: "1mo", range: "3650d", minBars: 100 },
];
const TF_ORDER = TIMEFRAMES.map((t) => t.id);

// ── tunables (mirror the scanner's defaults so portal and cron agree) ───────
const PIVOT_LEFT = 3;
const PIVOT_RIGHT = 3;
const STOP_BUF_PCT = 0.5;      // stop sits this % beyond the zone edge
const RR_TARGET = 2.0;         // target = entry ± risk × R:R
const TREND_FILTER = false;    // true = only zones aligned with the EMA10/20/50 stack
const CONCURRENCY = 4;
const RETRY_DELAY_MS = 2000;   // one spaced retry: three timeframes triples the request count
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
const TF_OVERRIDE = argVal("timeframes") || process.env.SCAN_TIMEFRAMES || "";

function selectedTimeframes() {
  if (!TF_OVERRIDE) return TIMEFRAMES;
  const wanted = TF_OVERRIDE.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const picked = TIMEFRAMES.filter((t) => wanted.indexOf(t.id) >= 0);
  if (!picked.length) {
    console.error(`No valid timeframes in "${TF_OVERRIDE}" — use any of: ${TF_ORDER.join(", ")}`);
    process.exit(1);
  }
  return picked;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── data: Yahoo bars, browser UA, text-proxy fallback ─────────────────────
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

function chartUrl(symbol, tf) {
  return "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) + "?range=" + tf.range + "&interval=" + tf.interval;
}

async function fetchChart(symbol, tf) {
  const url = chartUrl(symbol, tf);
  let unknownSymbol = false;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    // Yahoo answers 200 for a good symbol and 404 with a JSON error body for a
    // delisted one, so the body is worth reading either way.
    let json = null;
    try { json = await res.json(); } catch (e) { /* non-JSON body (e.g. rate limit page) */ }
    if (json) {
      const bars = parseYahoo(json);
      if (bars) return bars;
      // "Not Found / delisted" is permanent (renamed or merged listing): retrying, or
      // asking the proxy, only produces a confusing 403, so say what is actually wrong.
      const err = (json.chart && json.chart.error) || null;
      const text = `${err && err.code} ${err && err.description}`;
      if (/not found|delisted/i.test(text)) unknownSymbol = true;
    }
  } catch (e) { /* network hiccup: try the proxy below */ }

  if (unknownSymbol) {
    const err = new Error("no data on Yahoo — symbol delisted or renamed?");
    err.permanent = true;
    throw err;
  }

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

async function getBars(symbol, tf) {
  try {
    return await fetchChart(symbol, tf);
  } catch (first) {
    if (first.permanent) throw first;      // delisted symbol: retrying cannot help
    await sleep(RETRY_DELAY_MS);           // transient Yahoo/proxy hiccups are common at this volume
    return await fetchChart(symbol, tf);
  }
}

// ── signal decision (same rules as the scanner's touch filter) ─────────────
function scanSymbol(symbol, bars, tf) {
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

  if (demand && trendOkLong) return buildSignal(symbol, "LONG", demand, price, res.trend, last.date, tf);
  if (supply && trendOkShort) return buildSignal(symbol, "SHORT", supply, price, res.trend, last.date, tf);
  return null;
}

function buildSignal(symbol, action, zone, price, trend, date, tf) {
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
    tfId: tf.id,
    tf: tf.label,
    price: Number(f(price)),
    details: `${tf.label} zone ${f(zone.bottom)}-${f(zone.top)} stop ${f(stop)} target ${f(target)} · ${trend} · EOD ${date}`,
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

  const timeframes = selectedTimeframes();

  if (!symbols.length) {
    console.error("No symbols to scan — check tools/signal-watchlist.json");
    process.exit(1);
  }
  if (!DRY_RUN && !SECRET) {
    console.error("TV_WEBHOOK_SECRET is not set. Add it as a repository secret (Settings → Secrets and variables → Actions) or pass --dry-run.");
    process.exit(1);
  }

  const tasks = [];
  for (const symbol of symbols) {
    for (const tf of timeframes) tasks.push({ symbol, tf });
  }

  console.log(`zone scan · ${symbols.length} symbols × ${timeframes.length} timeframe(s) [${timeframes.map((t) => t.label).join(", ")}] = ${tasks.length} tasks · dry-run=${DRY_RUN}`);

  const signals = [];
  const failures = [];
  await runPool(tasks, CONCURRENCY, async (task) => {
    try {
      const bars = await getBars(task.symbol, task.tf);
      if (!bars || bars.length < task.tf.minBars) {
        failures.push(`${task.symbol} ${task.tf.label} — only ${bars ? bars.length : 0} bars`);
        return;
      }
      const signal = scanSymbol(task.symbol, bars, task.tf);
      if (signal) signals.push(signal);
    } catch (e) {
      failures.push(`${task.symbol} ${task.tf.label} — ${e.message}`);
    }
  });

  signals.sort((a, b) => {
    if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1;
    return TF_ORDER.indexOf(a.tfId) - TF_ORDER.indexOf(b.tfId);
  });

  const perTf = timeframes.map((t) => `${t.label} ${signals.filter((s) => s.tfId === t.id).length}`).join(" · ");
  console.log(`\nfound ${signals.length} signal(s) (${perTf}), ${failures.length} task(s) unavailable`);
  for (const s of signals) {
    console.log(`  ${s.symbol.padEnd(14)} ${s.tf.padEnd(7)} ${s.action.padEnd(5)} ${String(s.price).padStart(9)}  ${s.details}`);
  }
  if (failures.length) {
    console.log("\nunavailable:");
    failures.forEach((f) => console.log("  " + f));
  }

  if (DRY_RUN) {
    console.log("\ndry run — nothing posted.");
    if (!signals.length && failures.length === tasks.length) process.exit(1);
    return;
  }

  let posted = 0, duplicates = 0, errors = 0;
  for (const signal of signals) {
    try {
      const r = await post(signal);
      if (r.status === 200 && r.body.includes('"skipped":"duplicate"')) {
        duplicates++;
        console.log(`  skip  ${signal.symbol} ${signal.tf} (already recorded)`);
      } else if (r.status === 200) {
        posted++;
        console.log(`  saved ${signal.symbol} ${signal.tf} ${signal.action}`);
      } else {
        errors++;
        console.log(`  FAIL  ${signal.symbol} ${signal.tf} HTTP ${r.status} ${r.body}`);
      }
    } catch (e) {
      errors++;
      console.log(`  FAIL  ${signal.symbol} ${signal.tf} ${e.message}`);
    }
  }
  console.log(`\ndone — ${posted} saved, ${duplicates} duplicate(s) skipped, ${errors} error(s)`);

  // a total data outage is worth a red run so it gets noticed
  if (!signals.length && failures.length === tasks.length) process.exit(1);
}

main().catch((e) => {
  console.error("scan failed:", e);
  process.exit(1);
});
