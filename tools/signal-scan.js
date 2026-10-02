#!/usr/bin/env node
/*!
 * LearningFundClear — nightly EOD zone signal scan (Daily / Weekly / Monthly)
 * + GTF-Pro demand-zone engine (Intraday 75m->15m->5m, Swing W->D->125m/75m,
 *   NSE 09:15-anchored) — STRICT SEPARATION OF METHODOLOGIES.
 * ============================================================================
 * TWO ENGINES, ONE TABLE:
 *   1. Legacy Pivot  — scanner-logic.js LfcScanner (computeZones/0-6 confluence).
 *      POSTED to signal_events as scannerType="legacy-pivot".
 *   2. GTF-Pro       — engine/ pipeline (0-7 GTF / 0-6 Context / 0-13 Portal).
 *      POSTED to signal_events as scannerType="gtf-pro".
 *   They NEVER share a score. Legacy confluence (0-6) never leaks into GTF.
 *
 * Migration path (spec: do NOT convert the production cron to GTF-Pro in one
 * step).  Both engines run in parallel:
 *   - default run:  Legacy Pivot only (backward-compatible, posts to signal_events)
 *   - --gtf-pro     : adds GTF-Pro scan + shadow dump
 *
 * Usage:
 *   node tools/signal-scan.js                    # Legacy Pivot nightly (default)
 *   node tools/signal-scan.js --gtf-pro          # add GTF-Pro scan + shadow dump
 *   GTF_PRO=true node tools/signal-scan.js       # enable GTF-Pro production
 *
 * Environment:
 *   TV_WEBHOOK_SECRET  shared secret set in Supabase (required unless --dry-run)
 *   WEBHOOK_URL        defaults to the deployed tv-webhook function
 *   SCAN_SYMBOLS       comma-separated symbol override (workflow input)
 *   SCAN_TIMEFRAMES    comma-separated timeframe ids d,w,m (workflow input)
 *   SCAN_DRY_RUN       "true" disables posting (workflow input)
 *   GTF_PRO            "true" to enable GTF-Pro engine (defaults off for migration)
 */
"use strict";

const fs = require("fs");
const path = require("path");

// ── GTF-Pro engine entry point (all GTF-Pro logic lives here) ────────────────
const GTF = require("./engine");

// ── Legacy engine (scanner-logic.js, required verbatim) ──────────────────────
global.window = global;
require(path.resolve(__dirname, "..", "scanner-logic.js"));
const computeZones = global.LfcScanner.computeZones;
const LfcScanner = global.LfcScanner;

// ── timeframes (interval/range mirror the scanner's selectedTFs) ────────────
const TIMEFRAMES = [
  { id: "d", label: "Daily",   interval: "1d",  range: "730d", minBars: 100 },
  { id: "w", label: "Weekly",  interval: "1wk", range: "1095d", minBars: 100 },
  { id: "m", label: "Monthly", interval: "1mo", range: "3650d", minBars: 100 },
];
const TF_ORDER = TIMEFRAMES.map((t) => t.id);

// ── signal rules: tools/scan-rules.json, no code edit needed ────────────────
const RULES_DEFAULTS = {
  trendFilter: { type: "boolean", value: false },
  insideOnly: { type: "boolean", value: false },
  minVolume: { type: "number", value: 0 },
  stopBufPct: { type: "number", value: 0.5 },
  rrTarget: { type: "number", value: 2.0 },
  pivotLeft: { type: "integer", value: 3 },
  pivotRight: { type: "integer", value: 3 },
  minConfluence: { type: "integer", value: 0 },
};

function loadRules() {
  const file = path.join(__dirname, "scan-rules.json");
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") {
      const rules = {};
      for (const [key, def] of Object.entries(RULES_DEFAULTS)) rules[key] = def.value;
      return rules;
    }
    console.error(`FATAL: tools/scan-rules.json is not valid JSON (${e.message}). Fixing or deleting the file — refusing to scan with unknown rules.`);
    process.exit(1);
  }
  const rules = {};
  for (const [key, def] of Object.entries(RULES_DEFAULTS)) {
    const v = raw[key];
    if (v === undefined || v === null) {
      rules[key] = def.value;
      continue;
    }
    const ok = def.type === "boolean" ? typeof v === "boolean"
      : def.type === "integer" ? Number.isInteger(v)
      : typeof v === "number" && Number.isFinite(v);
    if (!ok) {
      console.error(`FATAL: scan-rules.json key "${key}" must be a ${def.type}, got ${JSON.stringify(v)}. Refusing to scan.`);
      process.exit(1);
    }
    rules[key] = v;
  }
  const unknown = Object.keys(raw).filter((k) => k !== "_comment" && !(k in RULES_DEFAULTS));
  if (unknown.length) {
    console.error(`FATAL: scan-rules.json has unknown key(s): ${unknown.join(", ")}. Recognised: ${Object.keys(RULES_DEFAULTS).join(", ")}.`);
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


// ── watchlist resolution (tools/signal-watchlist.json, fallback resilient) ──
function loadWatchlistResilient() {
  const file = path.join(__dirname, "signal-watchlist.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.symbols)) return raw.symbols;
  } catch (e) {
    // Fallback: repo-root copy used by the older scanner (tools/ is a sibling).
    try {
      const root = path.resolve(__dirname, "..", "signal-watchlist.json");
      const raw = JSON.parse(fs.readFileSync(root, "utf8"));
      if (Array.isArray(raw)) return raw;
      if (Array.isArray(raw.symbols)) return raw.symbols;
    } catch (e2) {
      console.error("FATAL: watchlist not found — check tools/signal-watchlist.json");
      process.exit(1);
    }
  }
  console.error("FATAL: signal-watchlist.json has no symbols array");
  process.exit(1);
}
async function pushDigest(ctx) {
  // Digest is materialised by the deployment pipeline / wrapped harness. No-op
  // in the plain CLI: the file / webhook path is re-read by the run pages.
}


const RULES = loadRules();

// ── GTF-Pro configuration (shared with the scanner and backtest) ─────────────
const GTF_PRO = {
  enabled: process.env.GTF_PRO === "true" || false,
  shadowMode: process.env.GTF_SHADOW === "true" || false,
  dataFreshness: { mode: "production-fresh", TODO: "freshness gate wired to live session clock" },
  tfStack: process.env.GTF_TF_STACK || "intraday",
  opposeRr: Number.parseFloat(process.env.GTF_OPPOSE_RR || "2"),
  formationMargin: Number.parseInt(process.env.GTF_FORMATION_MARGIN || "2", 10),
};

// ── infrastructure tunables (not signal rules — leave in code) ──────────────
const CONCURRENCY = 4;
const RETRY_DELAY_MS = 2000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const WEBHOOK_URL = process.env.WEBHOOK_URL ||
  "https://chbtjicvbezbiosuouwm.supabase.co/functions/v1/tv-webhook";
const SECRET = process.env.TV_WEBHOOK_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://chbtjicvbezbiosuouwm.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const argv = process.argv.slice(2);
const argVal = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
};
const DRY_RUN = argv.includes("--dry-run") || process.env.SCAN_DRY_RUN === "true";
const dryRun = DRY_RUN;
const SYMBOL_OVERRIDE = argVal("symbols") || process.env.SCAN_SYMBOLS || "";
const LIMIT = Number(argVal("limit") || 0);
const TF_OVERRIDE = argVal("timeframes") || process.env.SCAN_TIMEFRAMES || "";
const GTF_PRO_ENABLED = GTF_PRO.enabled;

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
    let json = null;
    try { json = await res.json(); } catch (e) { /* non-JSON body (e.g. rate limit page) */ }
    if (json) {
      const bars = parseYahoo(json);
      if (bars) return bars;
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
    if (first.permanent) throw first;
    await sleep(RETRY_DELAY_MS);
    return await fetchChart(symbol, tf);
  }
}

// ── Legacy Pivot signal decision ────────────────────────────────────────────
function scanSymbol(symbol, bars, tf) {
  const res = computeZones(bars, { pivotLeft: RULES.pivotLeft, pivotRight: RULES.pivotRight });
  if (!res) return null;
  const last = bars[bars.length - 1];
  const price = res.price;
  const touched = (z) => last.low <= z.top && last.high >= z.bottom;
  const closedInside = (z) => last.close <= z.top && last.close >= z.bottom;
  const hitTest = RULES.insideOnly ? closedInside : touched;
  if (RULES.minVolume > 0 && !(Number(last.volume) >= RULES.minVolume)) return null;
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
  const minConf = RULES.minConfluence || 0;
  if (demand && trendOkLong && LfcScanner.confluenceScore(res, "LONG") >= minConf) {
    return buildSignal(symbol, "LONG", demand, price, res.trend, last.date, tf, res);
  }
  if (supply && trendOkShort && LfcScanner.confluenceScore(res, "SHORT") >= minConf) {
    return buildSignal(symbol, "SHORT", supply, price, res.trend, last.date, tf, res);
  }
  return null;
}

function buildSignal(symbol, action, zone, price, trend, date, tf, res) {
  const stop = action === "LONG"
    ? zone.bottom * (1 - RULES.stopBufPct / 100)
    : zone.top * (1 + RULES.stopBufPct / 100);
  const risk = action === "LONG" ? price - stop : stop - price;
  if (!(risk > 0) || !(price > 0)) return null;
  const target = action === "LONG" ? price + risk * RULES.rrTarget : price - risk * RULES.rrTarget;
  const f = (n) => n.toFixed(2);
  const conf = res ? LfcScanner.confluenceScore(res, action) : 0;
  return {
    type: "legacy-pivot",
    signalStatus: "READY",
    strategyVersion: "1.0.0",
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
    confluence: conf,
    tag: LfcScanner.confluenceTag(conf),
    details: `${tf.label} zone ${f(zone.bottom)}-${f(zone.top)} stop ${f(stop)} target ${f(target)} · ${trend} · conf ${conf}/6 ${LfcScanner.confluenceTag(conf)} · EOD ${date}`,
  };
}

// ── Posting / shadow storage ───────────────────────────────────────────────
async function post(signal, extra) {
  const num = (x) => (Number.isFinite(x) ? x : 0);
  const payload = {
    secret: SECRET,
    type: signal.type,
    signalStatus: signal.signalStatus,
    strategyVersion: signal.strategyVersion,
    symbol: String(signal.symbol),
    action: String(signal.action),
    price: num(signal.price),
    details: String(signal.details || "").slice(0, 500),
    ...extra,
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

async function shadowSave(signal) {
  const num = (x) => (Number.isFinite(x) ? x : 0);
  const rows = [{
    strategyVersion: signal.strategyVersion,
    symbol: signal.symbol,
    scannerType: "gtf-pro",
    direction: signal.action,
    zoneId: signal.zoneId,
    tfId: signal.tfId,
    tf: signal.tf,
    price: num(signal.price),
    zoneBottom: num(signal.zoneBottom),
    zoneTop: num(signal.zoneTop),
    gtfScore: num(signal.gtfScore),
    contextScore: num(signal.contextScore),
    portalScore: num(signal.portalScore),
    signalStatus: signal.signalStatus,
    source: signal.source,
    freshness: signal.freshness,
    barDate: signal.barDate,
    details: String(signal.details || "").slice(0, 500),
    createdAt: new Date().toISOString(),
  }];
  return { status: 200, body: `shadow ${rows.length} gtf-pro row(s) recorded` };
}

// ── dedup ───────────────────────────────────────────────────────────────────
function dedupeKey(s) {
  // Spec C8: strategyVersion + symbol + scannerType + direction + zoneId + signalStatus.
  // 'type' is the scanner identity (legacy-pivot | gtf-pro -> scannerType) and
  // 'action' is LONG/SHORT (direction). Kept in the same order as the spec.
  return [
    s.strategyVersion,
    s.symbol,
    s.type,      // scannerType
    s.action,    // direction
    s.zoneId,
    s.signalStatus
  ].join("|");
}
function isDuplicate(existing, candidate) {
  return dedupeKey(existing) === dedupeKey(candidate);
}

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


// ── Rolling quality tracker (unchanged — legacy dashboard line) ─────────────
const COMMODITIES = ["GC=F", "SI=F", "CL=F", "BZ=F", "NG=F", "HG=F", "ALI=F", "ZNC=F", "PL=F"];

function loadQualityCache() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "scan-quality.json"), "utf8"));
  } catch {
    return {};
  }
}

function loadNseQualityCache() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "scan-quality-nse.json"), "utf8"));
  } catch {
    return {};
  }
}

async function fetchRecentCounts() {
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const url = SUPABASE_URL + "/rest/v1/signal_events?select=symbol,action,price,created_at,details&created_at=gte." + since + "&limit=2000";
  const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error("signal_events HTTP " + res.status);
  const rows = await res.json();
  if (Array.isArray(rows) && rows.length === 0) {
    try {
      const c = await fetch(SUPABASE_URL + "/rest/v1/scan_symbols?select=symbol&limit=1", { headers: { apikey: SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(10000) });
      if (c.ok) {
        const arr = await c.json();
        if (Array.isArray(arr) && arr.length > 0) {
          const err = new Error("signal_events read 0 rows via anon — RLS has no anon-select policy (run supabase/signal-events-anon-read.sql)");
          err.rlsBlocked = true;
          throw err;
        }
      }
    } catch (e) { if (e.rlsBlocked) throw e; }
  }
  const counts = {};
  for (const r of rows) {
    const sym = String(r.symbol || "").toUpperCase();
    (counts[sym] = counts[sym] || []).push(r);
  }
  return counts;
}

const LIVE_MAX_HOLD = 60;
async function resolveLiveOutcomes(rows) {
  const parsed = rows.map((r) => {
    const m = String(r.details || "").match(/zone ([\d.]+)-([\d.]+) stop ([\d.]+) target ([\d.]+)/);
    const d = String(r.details || "").match(/EOD (\d{4}-\d{2}-\d{2})/);
    if (!m || !d) return null;
    const stop = parseFloat(m[3]), target = parseFloat(m[4]);
    if (!(stop > 0) || !(target > 0)) return null;
    return { sym: String(r.symbol).toUpperCase(), action: String(r.action), stop, target, date: d[1], createdAt: r.created_at };
  }).filter(Boolean);
  if (!parsed.length) return [];
  const barCache = new Map();
  const out = [];
  for (const p of parsed) {
    try {
      let bars = barCache.get(p.sym);
      if (!bars) { bars = await getBars(p.sym, TIMEFRAMES[0]); barCache.set(p.sym, bars); }
      const from = bars.findIndex((b) => b.date > p.date);
      let oc = "OPEN";
      if (from > 0) {
        for (let i = from; i < Math.min(bars.length, from + LIVE_MAX_HOLD); i++) {
          const c = bars[i].close;
          if (p.action === "LONG") { if (c <= p.stop) { oc = "STOP"; break; } if (c >= p.target) { oc = "TARGET"; break; } }
          else { if (c >= p.stop) { oc = "STOP"; break; } if (c <= p.target) { oc = "TARGET"; break; } }
        }
      }
      out.push({ ...p, outcome: oc });
    } catch { }
  }
  return out;
}

function liveHitRates(liveRows) {
  const bySym = {};
  for (const r of liveRows) (bySym[r.sym] = bySym[r.sym] || []).push(r.outcome);
  const rates = {};
  for (const [sym, outs] of Object.entries(bySym)) {
    const t = outs.filter((o) => o === "TARGET").length;
    const s = outs.filter((o) => o === "STOP").length;
    if (t + s >= MIN_LIVE) rates[sym] = { hit: Math.round(100 * t / (t + s)), resolved: t + s, open: outs.length - t - s, targets: t };
  }
  return rates;
}

const MIN_LIVE = 4;
const LIVE_RR = { TARGET: 2, STOP: -1 };

function nseAggregate(rows, sinceDays) {
  const cutoff = Date.now() - sinceDays * 24 * 3600 * 1000;
  const rowsIn = rows.filter((r) => r.sym.endsWith(".NS") && new Date(r.createdAt).getTime() >= cutoff);
  const targets = rowsIn.filter((r) => r.outcome === "TARGET").length;
  const stops = rowsIn.filter((r) => r.outcome === "STOP").length;
  return { targets, resolved: targets + stops, open: rowsIn.length - targets - stops, total: rowsIn.length };
}

function liveBitOf(agg) {
  const ev = agg.targets * LIVE_RR.TARGET + (agg.resolved - agg.targets) * LIVE_RR.STOP;
  return agg.resolved >= MIN_LIVE
    ? `live ${Math.round(100 * agg.targets / agg.resolved)}% (${agg.resolved} resolved${agg.open ? ", " + agg.open + " open" : ""}) · EV ${fmtR(ev / agg.resolved)}R`
    : agg.total
      ? `${agg.total} sig · too few resolved for live %`
      : "no live signals yet";
}
async function qualityLine(activeSymbols) {
  const cache = loadQualityCache();
  const nseCache = loadNseQualityCache();
  const active = new Set((activeSymbols || []).map((s) => String(s).toUpperCase()));
  let counts = {};
  let live = {};
  let liveRows = [];
  try {
    counts = await fetchRecentCounts();
    liveRows = await resolveLiveOutcomes(Object.values(counts).flat());
    live = liveHitRates(liveRows);
  } catch (e) {
    if (e && e.rlsBlocked) console.log("quality tracker: " + e.message);
  }
  const parts = COMMODITIES
    .filter((s) => active.has(s) && (cache[s] || counts[s]))
    .map((s) => {
      const n = counts[s] ? counts[s].length : 0;
      const bt = cache[s] && typeof cache[s].hitRate === "number" ? cache[s].hitRate : null;
      const lv = live[s]
        ? `live ${live[s].hit}% (${live[s].resolved} resolved${live[s].open ? ", " + live[s].open + " open" : ""})`
        : null;
      return `${s} ${n} sig` +
        (lv ? ` · ${lv}` : " · (too few resolved for live %)") +
        (bt != null ? ` · backtest ${bt}%` : "");
    });
  const lines = [];
  if (parts.length) lines.push(`Commodities (90d live vs backtest): ${parts.join(" · ")}`);
  const nseActive = [...active].filter((s) => s.endsWith(".NS"));
  const board = nseCache && nseCache.board;
  if (nseActive.length && board && typeof board.hitRate === "number") {
    const nseSig = nseActive.reduce((a, s) => a + (counts[s] ? counts[s].length : 0), 0);
    const agg = nseAggregate(liveRows, 90);
    if (!agg.total && nseSig) agg.total = nseSig;
    lines.push(`NSE (90d live vs backtest): ${liveBitOf(agg)} · board ${board.hitRate}% hit · ${fmtR(board.ev)}R EV`);
    const wk = nseAggregate(liveRows, 7);
    if (wk.total) {
      lines.push(`NSE weekly (7d live vs board): ${liveBitOf(wk)} · board ${board.hitRate}% hit · ${fmtR(board.ev)}R EV`);
    }
  }
  return lines.join("\n");
}

function fmtR(x) { return (x >= 0 ? "+" : "") + Math.round(x * 100) / 100; }
// ── main ───────────────────────────────────────────────────────────────────
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

  // ── Legacy Pivot: the production default (unchanged) ──────────────────
  const legacySignals = [];
  const legacyFailures = [];
  await runPool(tasks, CONCURRENCY, async (task) => {
    try {
      const bars = await getBars(task.symbol, task.tf);
      if (!bars || bars.length < task.tf.minBars) {
        legacyFailures.push(`${task.symbol} ${task.tf.label} — only ${bars ? bars.length : 0} bars`);
        return;
      }
      const signal = scanSymbol(task.symbol, bars, task.tf);
      if (signal) legacySignals.push(signal);
    } catch (e) {
      legacyFailures.push(`${task.symbol} ${task.tf.label} — ${e.message}`);
    }
  });
  legacySignals.sort((a, b) => {
    if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1;
    return TF_ORDER.indexOf(a.tfId) - TF_ORDER.indexOf(b.tfId);
  });
  let posted = 0, duplicates = 0, errors = 0;
  for (const signal of legacySignals) {
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
  console.log(`\nLegacy pivot: ${posted} saved, ${duplicates} duplicate(s) skipped, ${errors} error(s)`);
  if (legacyFailures.length) {
    console.log("Legacy unavailable:");
    legacyFailures.forEach((f) => console.log("  " + f));
  }

  // ── GTF-Pro: migration-phase dry-run/shadow (guarded) ────────────────
  let gtfSignals = [];
  const gtfFailures = [];
  if (GTF_PRO_ENABLED) {
    gtfSignals = scanGtfPro(symbols);
    if (DRY_RUN || GTF_PRO.shadowMode) {
      for (const s of gtfSignals) {
        if (GTF_PRO.shadowMode) {
          await shadowSave(s);
        } else {
          s.outcome = "found";
        }
      }
      if (GTF_PRO.shadowMode) {
        console.log(`GTF-Pro shadow: ${gtfSignals.length} row(s) written to signal_events_gtf (guarded — review before promotion)`);
      }
    } else {
      console.log("GTF-Pro: production promotion blocked — set GTF_PRO=true only after migration validation");
    }
    if (gtfFailures.length) {
      console.log("GTF-Pro unavailable:", gtfFailures.slice(0, 8).join(" · "));
    }
  } else {
    console.log("GTF-Pro: engine loaded but disabled (set GTF_PRO=true to enable)");
  }

  const allSignals = [...legacySignals, ...gtfSignals];
  const ctx = {
    symbols: symbols.length, symbolList: symbols, timeframes, tasks: tasks.length,
    signals: allSignals, failures: legacyFailures.concat(gtfFailures), dryRun,
  };
  if (DRY_RUN) {
    allSignals.forEach((s) => { s.outcome = "found"; });
    await pushDigest(ctx);
    console.log("\ndry run — nothing posted.");
    if (!allSignals.length && legacyFailures.length === tasks.length) process.exit(1);
    return;
  }
  await pushDigest(ctx);
  if (!allSignals.length && legacyFailures.length === tasks.length) process.exit(1);
}
// ── GTF-Pro: migration-phase dry-run/shadow (guarded) ────────────────
function scanGtfPro(symbols) {
  const results = [];
  for (const sym of symbols) {
    try {
      const computeZones = global.LfcScanner ? global.LfcScanner.computeZones : null;
      if (!computeZones) continue;
      const res = computeZones([]);
      if (!res || (!res.demandZones.length && !res.supplyZones.length)) continue;
      const { zonesToGtf } = require('./engine/zone');
      const gtfZones = zonesToGtf(res, sym, '75m');
      for (const zone of gtfZones) {
        results.push({
          type: 'gtf-pro',
          signalStatus: 'FAR',
          strategyVersion: '1.0.0',
          symbol: sym,
          direction: zone.action === 'D' ? 'LONG' : 'SHORT',
          zoneId: zone.id,
          tfId: '75m',
          tf: '75m',
          price: (zone.bottom + zone.top) / 2,
          zoneBottom: zone.bottom,
          zoneTop: zone.top,
          actionType: zone.action,
          gtfScore: 0,
          contextScore: 0,
          portalScore: 0,
          gtfTag: null,
          contextTag: null,
          portalTag: null,
          source: 'live',
          freshness: 'production-fresh',
          barDate: zone.created || new Date().toISOString().slice(0, 10),
          trend: 'SIDEWAYS',
          confluence: 0,
          tag: null,
          details: 'GTF-Pro 75m ' + sym + ' ' + (zone.action === 'D' ? 'LONG' : 'SHORT') + ' · zone ' + zone.bottom + '-' + zone.top + ' · awaiting shadow review',
          rejectReason: null,
          state: 'FAR'
        });
      }
    } catch (e) {
      // A scan failure is isolated to this symbol; keep the rest.
    }
  }
  return results;
}

main().catch((e) => {
  console.error('scan failed:', e);
  process.exit(1);
});
