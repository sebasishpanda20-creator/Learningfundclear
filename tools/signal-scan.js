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

// ── signal rules: tools/scan-rules.json, no code edit needed ───────────────
// Defaults mirror the scanner so portal and cron agree. The file may override
// any subset; anything missing keeps its default. Fail-closed on purpose: an
// unknown key or wrong type aborts the run rather than silently scanning with
// different rules than the file's author believed (a typo like "trendFiter"
// would otherwise just be ignored, and the trend filter would be off while the
// commit message claimed it was on).
const RULES_DEFAULTS = {
  trendFilter: { type: "boolean", value: false },   // only EMA-aligned zones
  insideOnly: { type: "boolean", value: false },    // close inside, not just touch
  minVolume: { type: "number", value: 0 },          // min volume on the signal bar
  stopBufPct: { type: "number", value: 0.5 },       // stop beyond zone edge, %
  rrTarget: { type: "number", value: 2.0 },         // target R:R
  pivotLeft: { type: "integer", value: 3 },         // pivot strength left
  pivotRight: { type: "integer", value: 3 },        // pivot strength right
};

function loadRules() {
  const file = path.join(__dirname, "scan-rules.json");
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") {
      // fresh clone before the file is restored: scan with documented defaults
      console.log("scan-rules.json not found — using built-in defaults (trendFilter off, touch mode, no volume gate)");
      const rules = {};
      for (const [key, def] of Object.entries(RULES_DEFAULTS)) rules[key] = def.value;
      return rules;
    }
    console.error(`FATAL: tools/scan-rules.json is not valid JSON (${e.message}). Fix or delete the file — refusing to scan with unknown rules.`);
    process.exit(1);
  }
  const rules = {};
  for (const [key, def] of Object.entries(RULES_DEFAULTS)) {
    const v = raw[key];
    if (v === undefined || v === null) {
      rules[key] = def.value;                       // absent → default
      continue;
    }
    const ok = def.type === "boolean" ? typeof v === "boolean"
      : def.type === "integer" ? Number.isInteger(v)
      : typeof v === "number" && Number.isFinite(v);
    if (!ok) {
      console.error(`FATAL: scan-rules.json key "${key}" must be a ${def.type}, got ${JSON.stringify(v)}. Refusing to scan.`);
    }
    rules[key] = v;
  }
  const unknown = Object.keys(raw).filter((k) => k !== "_comment" && !(k in RULES_DEFAULTS));
  if (unknown.length) {
    console.error(`FATAL: scan-rules.json has unknown key(s): ${unknown.join(", ")}. Recognised: ${Object.keys(RULES_DEFAULTS).join(", ")}. (A typo here would silently disable a filter.)`);
    process.exit(1);
  }
  if (rules.pivotLeft < 1 || rules.pivotLeft > 10 || rules.pivotRight < 1 || rules.pivotRight > 10) {
    console.error("FATAL: pivotLeft/pivotRight must be between 1 and 10.");
    process.exit(1);
  }
  if (rules.stopBufPct < 0 || rules.stopBufPct > 5) {
    console.error("FATAL: stopBufPct must be between 0 and 5 (%).");
    process.exit(1);
  }
  if (rules.rrTarget < 0.5 || rules.rrTarget > 10) {
    console.error("FATAL: rrTarget must be between 0.5 and 10.");
    process.exit(1);
  }
  if (rules.minVolume < 0) {
    console.error("FATAL: minVolume must be >= 0.");
    process.exit(1);
  }
  return rules;
}

const RULES = loadRules();

// ── infrastructure tunables (not signal rules — leave in code) ──────────────
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
    // sheet-derived guard: reject bars with non-finite, non-positive, or
    // internally inconsistent OHLC before they can poison zone math
    const v = [o, h, l, c];
    if (!v.every((x) => Number.isFinite(x) && x > 0)) continue;
    if (h < Math.max(o, c, l) || l > Math.min(o, c, h)) continue;
    const vol = q.volume && q.volume[i];
    bars.push({
      date: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10),
      open: o, high: h, low: l, close: c,
      volume: Number.isFinite(vol) && vol >= 0 ? vol : 0,
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

// ── signal decision (same rules as the scanner's touch filter, tuned by RULES) ─
function scanSymbol(symbol, bars, tf) {
  const res = computeZones(bars, { pivotLeft: RULES.pivotLeft, pivotRight: RULES.pivotRight });
  if (!res) return null;
  const last = bars[bars.length - 1];
  const price = res.price;

  // touch = the bar's range overlaps the zone; inside = the bar CLOSED in it.
  // insideOnly promotes the stricter of the two; RULES decides which applies.
  const touched = (z) => last.low <= z.top && last.high >= z.bottom;
  const closedInside = (z) => last.close <= z.top && last.close >= z.bottom;
  const hitTest = RULES.insideOnly ? closedInside : touched;

  // volume gate on the signal bar only (see scan-rules.json for the caveat)
  if (RULES.minVolume > 0 && !(Number(last.volume) >= RULES.minVolume)) return null;

  // among the zones this bar hit, take the one nearest to price
  const nearestHit = (zones) => {
    let best = null, bestDist = Infinity;
    for (const z of (zones || [])) {
      if (!hitTest(z)) continue;
      const dist = Math.abs(price - (z.top + z.bottom) / 2);
      if (dist < bestDist) { bestDist = dist; best = z; }
    }
    return best;
  };

  const demand = nearestHit(res.demandZones);
  const supply = nearestHit(res.supplyZones);
  const trendOkLong = !RULES.trendFilter || res.trend === "UPTREND";
  const trendOkShort = !RULES.trendFilter || res.trend === "DOWNTREND";

  if (demand && trendOkLong) return buildSignal(symbol, "LONG", demand, price, res.trend, last.date, tf);
  if (supply && trendOkShort) return buildSignal(symbol, "SHORT", supply, price, res.trend, last.date, tf);
  return null;
}

function buildSignal(symbol, action, zone, price, trend, date, tf) {
  const stop = action === "LONG"
    ? zone.bottom * (1 - RULES.stopBufPct / 100)
    : zone.top * (1 + RULES.stopBufPct / 100);
  const risk = action === "LONG" ? price - stop : stop - price;
  if (!(risk > 0) || !(price > 0)) return null;
  const target = action === "LONG" ? price + risk * RULES.rrTarget : price - risk * RULES.rrTarget;
  const f = (n) => n.toFixed(2);
  return {
    symbol,
    action,
    tfId: tf.id,
    tf: tf.label,
    price: Number(f(price)),
    zoneBottom: Number(f(zone.bottom)),
    zoneTop: Number(f(zone.top)),
    stop: Number(f(stop)),
    target: Number(f(target)),
    trend,
    date,
    details: `${tf.label} zone ${f(zone.bottom)}-${f(zone.top)} stop ${f(stop)} target ${f(target)} · ${trend} · EOD ${date}`,
  };
}

// ── posting ───────────────────────────────────────────────────────────────
async function post(signal) {
  // sheet-derived guard: never let NaN/Infinity into the JSON body — JSON.stringify
  // silently converts them to null, which would poison the webhook's dedup keys
  // (null ranges would compare equal) and store unparseable prices.
  const num = (x) => (Number.isFinite(x) ? x : 0);
  const payload = {
    secret: SECRET,
    symbol: String(signal.symbol),
    action: String(signal.action),
    price: num(signal.price),
    details: String(signal.details || "").slice(0, 500),
  };
  if (!payload.symbol || !/^(LONG|SHORT)$/.test(payload.action) || payload.price <= 0) {
    return { status: 0, body: "invalid signal payload — not posted" };
  }
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

// ── watchlist source: Supabase first, JSON file as fallback ────────────────
// The editable list lives in the scan_symbols table and is changed from the
// Setups page. Reads use the public anon key on purpose: the symbol list is
// not secret and the Actions runner has no Supabase session. If the table or
// network is unavailable, the committed JSON keeps the nightly run alive.
const SUPABASE_URL = "https://chbtjicvbezbiosuouwm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNoYnRqaWN2YmV6Ymlvc3VvdXdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzODc2NjAsImV4cCI6MjEwNDk2MzY2MH0.jlTyYWnf1TnvmwCa4NCc-hJ4wZgjWTuSc94DqvMTdNQ";

async function loadWatchlistFromSupabase() {
  const url = SUPABASE_URL + "/rest/v1/scan_symbols?select=symbol&enabled=eq.true&order=position.asc&limit=500";
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error("scan_symbols HTTP " + res.status);
  const rows = await res.json();
  const symbols = [...new Set(rows.map((r) => String(r.symbol || "").trim()).filter(Boolean))];
  if (!symbols.length) throw new Error("scan_symbols is empty");
  return symbols;
}

async function loadWatchlistResilient() {
  try {
    const symbols = await loadWatchlistFromSupabase();
    console.log(`watchlist: ${symbols.length} enabled symbol(s) from Supabase scan_symbols`);
    return symbols;
  } catch (e) {
    const fallback = loadWatchlist();
    console.log(`watchlist: Supabase unavailable (${e.message}) — using the committed JSON (${fallback.length} symbols)`);
    return fallback;
  }
}

// ── job summary ───────────────────────────────────────────────────────────
// GitHub renders this markdown on the workflow run page. Locally the env var
// is absent, so the same content simply stays in the console output.
const TOP_SIGNALS = 5;
const TREND_FOR = { LONG: "UPTREND", SHORT: "DOWNTREND" };

function writeSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    fs.appendFileSync(file, markdown + "\n");
  } catch (e) {
    console.log("could not write the job summary:", e.message);
  }
}

// The run page already prints a UTC timestamp; every reader of this portal is on
// IST, so the digest repeats it in the timezone the signals were acted on.
function istStamp(d) {
  const t = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return t.toISOString().slice(0, 16).replace("T", " ") + " IST";
}

// Freshly recorded signals first, then trend-aligned ones, then the tightest stop
// relative to price: on a quiet night a zone logged last week must not push
// today's new setups off the digest.
function rankSignals(signals, freshKey) {
  return signals.slice().sort((a, b) => {
    const an = a.outcome === freshKey ? 0 : 1;
    const bn = b.outcome === freshKey ? 0 : 1;
    if (an !== bn) return an - bn;
    const at = a.trend === TREND_FOR[a.action] ? 0 : 1;
    const bt = b.trend === TREND_FOR[b.action] ? 0 : 1;
    if (at !== bt) return at - bt;
    const ar = Math.abs(a.price - a.stop) / a.price;
    const br = Math.abs(b.price - b.stop) / b.price;
    if (ar !== br) return ar - br;
    return a.symbol < b.symbol ? -1 : 1;
  });
}

function buildDigest(ctx) {
  const symbols = ctx.symbols, timeframes = ctx.timeframes, tasks = ctx.tasks;
  const signals = ctx.signals, failures = ctx.failures, dryRun = ctx.dryRun;
  const outcomeLabel = { found: "Found", saved: "Saved", duplicate: "Already recorded", error: "Failed to save" };
  const outcomes = dryRun ? ["found"] : ["saved", "duplicate", "error"];

  const L = [];
  L.push(`## ${dryRun ? "Dry run — nightly" : "Nightly"} zone scan`);
  L.push("");
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  L.push(`**${plural(symbols, "symbol")} × ${plural(timeframes.length, "timeframe")} = ${plural(tasks, "task")}** · scanned ${timeframes.map((t) => t.label).join(", ")}`);
  L.push("");
  L.push(signals.length
    ? `_Run ${istStamp(new Date())} · bars to ${signals[0].date}_`
    : `_Run ${istStamp(new Date())}_`);
  L.push("");

  if (!signals.length) {
    L.push("No zone touches today.");
    L.push("");
  } else {
    L.push(`| Result | ${timeframes.map((t) => t.label).join(" | ")} | Total |`);
    L.push(`|---|---|${timeframes.map(() => "---").join("|")}|---|`);
    for (const key of outcomes) {
      const cells = timeframes.map((t) => signals.filter((s) => s.tfId === t.id && s.outcome === key).length);
      L.push(`| ${outcomeLabel[key]} | ${cells.join(" | ")} | ${cells.reduce((a, b) => a + b, 0)} |`);
    }
    L.push("");

    const freshKey = dryRun ? "found" : "saved";
    const fresh = signals.filter((s) => s.outcome === freshKey).length;
    const top = rankSignals(signals, freshKey).slice(0, TOP_SIGNALS);
    L.push(fresh
      ? `### ${dryRun ? "Found" : "New"} this run — ${plural(fresh, "setup")}`
      : `### No new setups — top ${top.length} of ${plural(signals.length, "signal")}, all already recorded`);
    L.push("");
    L.push("Newest first, then trend-aligned, then the tightest stop. The full list is on the Setups page.");
    L.push("");
    L.push("| # | Symbol | TF | Side | Price | Zone | Stop | Target | Trend |");
    L.push("|---|---|---|---|---|---|---|---|---|");
    top.forEach((s, i) => {
      const side = s.action === "LONG" ? "🟢 LONG" : "🔴 SHORT";
      const aligned = s.trend === TREND_FOR[s.action] ? "✅ " : "";
      L.push(`| ${i + 1} | **${s.symbol}** | ${s.tf} | ${side} | ${s.price} | ${s.zoneBottom}-${s.zoneTop} | ${s.stop} | ${s.target} | ${aligned}${s.trend} |`);
    });
    L.push("");
  }

  if (failures.length) {
    L.push(`<details><summary>${failures.length} symbol/timeframe pair(s) had no usable data</summary>`);
    L.push("");
    failures.slice(0, 40).forEach((f) => L.push(`- \`${f}\``));
    if (failures.length > 40) L.push(`- …and ${failures.length - 40} more`);
    L.push("");
    L.push("</details>");
    L.push("");
  }

  L.push(dryRun
    ? "_Dry run — nothing was posted to the portal._"
    : "Signals are on the [Setups page](https://sebasishpanda20-creator.github.io/Learningfundclear/setups.html) — open it and hit Refresh.");
  L.push("");
  L.push("_Zone levels are research heuristics from EOD bars — no fees, slippage, taxes or gaps are modelled, and nothing is backtested. Verify every level on your broker platform before acting._");
  return L.join("\n");
}

async function main() {
  let symbols = SYMBOL_OVERRIDE
    ? SYMBOL_OVERRIDE.split(",").map((s) => s.trim()).filter(Boolean)
    : await loadWatchlistResilient();
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
    signals.forEach((s) => { s.outcome = "found"; });
    writeSummary(buildDigest({
      symbols: symbols.length, timeframes, tasks: tasks.length, signals, failures, dryRun: true,
    }));
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
        signal.outcome = "duplicate";
        console.log(`  skip  ${signal.symbol} ${signal.tf} (already recorded)`);
      } else if (r.status === 200) {
        posted++;
        signal.outcome = "saved";
        console.log(`  saved ${signal.symbol} ${signal.tf} ${signal.action}`);
      } else {
        errors++;
        signal.outcome = "error";
        console.log(`  FAIL  ${signal.symbol} ${signal.tf} HTTP ${r.status} ${r.body}`);
      }
    } catch (e) {
      errors++;
      signal.outcome = "error";
      console.log(`  FAIL  ${signal.symbol} ${signal.tf} ${e.message}`);
    }
  }
  console.log(`\ndone — ${posted} saved, ${duplicates} duplicate(s) skipped, ${errors} error(s)`);

  writeSummary(buildDigest({
    symbols: symbols.length, timeframes, tasks: tasks.length, signals, failures, dryRun: false,
  }));

  // a total data outage is worth a red run so it gets noticed
  if (!signals.length && failures.length === tasks.length) process.exit(1);
}

main().catch((e) => {
  console.error("scan failed:", e);
  process.exit(1);
});
