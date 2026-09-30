#!/usr/bin/env node
/*!
 * One-off research: would the thin commodities (ZNC=F, ALI=F, PL=F) have
 * produced daily zone signals in the last 6 months, and did those signals
 * hit their 2R target before their stop?
 *
 * Method — mirrors tools/signal-scan.js exactly:
 *   - same bar source (Yahoo 1d), same bar sanity guards
 *   - same zone math (scanner-logic.js computeZones, pivot 3/3)
 *   - same rules (scan-rules.json: trendFilter on, touch mode, 0.5% stop
 *     buffer, 2R target)
 * with one addition: after a signal bar, the position is walked FORWARD
 * bar by bar (stop = zone edge ± buffer, target = entry ± 2R, both static)
 * until close crosses stop or target, max 60 bars, else "timeout".
 *
 * Signals are evaluated ONLY where the pipeline could have seen them:
 * to avoid look-ahead, the scan for day i uses bars [0..i] (the same view
 * signal-scan.js has at run time), and a signal fires on day i only if none
 * fired for the same zone in the previous 7 days (mirroring webhook dedup).
 *
 * Usage: node tools/research-thin-commodities.js [symbols...] [--save] [--stop=X] [--htf] [--regime=30] [--regime-min=3] [--conf=N]
 *   --save  writes each symbol's hit rate (only if >= 5 signals) into
 *           tools/scan-quality.json, which the nightly digest reads for its
 *           "Commodities (90d signals · backtest hit %)" line.
 *   --stop=X  override the stop buffer % (default 0.5) — e.g. --stop=1.0 to
 *           test whether a wider stop rescues a marginal market's expectancy.
 *   --htf   higher-timeframe trend gate (Major-vs-Minor): a Daily LONG needs
 *           the WEEKLY EMA stack up, a Daily SHORT needs it down. Only fully
 *           completed weekly bars are used (no look-ahead); the weekly 50-EMA
 *           needs ~60 weekly bars of history before the gate engages.
 *   --regime=X  trailing-regime gate: pause a symbol's NEW signals while its
 *           own trailing hit rate (default 90-day window, --regime-window=N to
 *           widen) sits below X%. The trailing window
 *           holds only signals this gate already let through (a paused signal
 *           is never stored, so it never feeds the trailer — same as live),
 *           and only counts an outcome once it is resolved BEFORE the new
 *           signal's date (still-open trades are ignored, as in the digest
 *           line). Activates only with >= --regime-min resolved trades in the
 *           window (default 3) — below that it fails open and lets the signal
 *           through. Reports what it paused and whether those were winners.
 * Output always includes a per-year breakdown so you can see whether an edge
 * is stable across regimes or concentrated in one year.
 *   --conf=N  keep only signals scoring >= N on the measured 0-6 confluence
 *           scale (scanner-logic.js) — mirrors scan-rules.json minConfluence
 *           live. Bucket/component/month tables still use ALL signals so the
 *           evidence stays full-sample; kept/no-gate stat lines show the gate's
 *           effect. Board summary prints gated vs ungated EV.
 *   --save-nse (with --conf=N) rebuilds tools/scan-quality-nse.json from the
 *           CONF-GATED NSE signals so the digest board baseline matches a
 *           minConfluence-gated live scanner. Without --conf it would overwrite
 *           the gated baseline with ungated numbers, so it requires --conf.
 *
 * MEASURED VERDICT for --regime (Sep 2026, 6 commodities GC=F CL=F HG=F BZ=F
 * SI=F NG=F, 312 baseline signals, board 42% hit / +0.27R EV). No setting
 * beats taking every signal; board EV after the gate, paused-signal quality:
 *   baseline         312 sig · 42% · +0.27R
 *   30% min1 90d     162 sig · 40% · +0.19R  (-0.08R) · 150 paused, 44% would-be hit
 *   30% min2 90d     227 sig · 43% · +0.28R  (+0.01R) ·  85 paused, 40%
 *   30% min3 90d     245 sig · 38% · +0.14R  (-0.14R) ·  67 paused, 57%
 *   30% min5 90d     290 sig · 41% · +0.22R  (-0.05R) ·  22 paused, 64%
 *   20% min3 90d     270 sig · 41% · +0.24R  (-0.03R) ·  42 paused, 48%
 *   50% min3 90d     237 sig · 40% · +0.21R  (-0.07R) ·  75 paused, 48%
 *   30% min3 180d    224 sig · 43% · +0.28R  (+0.00R) ·  88 paused, 40%
 * Two reasons it fails. (1) Sample: the trailing window holds a median of
 * 2-5 resolved trades, so the "hit rate" it reacts to is mostly noise. (2) The
 * premise is inverted here: the more confident the sample (min5, median 5),
 * the BETTER the paused signals did (64% would-be hit vs 42% board) — losing
 * streaks cluster in the choppy stretches that precede this system's recovery
 * runs, so pausing after them removes winners. Same failure mode as the
 * weekly HTF gate (--htf), which also hurt by blocking the 2026 recovery.
 * Kept as a research knob; deliberately NOT wired into the live scanner.
 * Read-only on market data: fetches Yahoo, posts nothing.
 */
"use strict";

const path = require("path");
global.window = global;
require(path.join(__dirname, "..", "scanner-logic.js"));
const computeZones = global.LfcScanner.computeZones;
const LfcScanner = global.LfcScanner;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const PIVOT = 3, RR = 2.0, MAX_HOLD = 60, DEDUP_DAYS = 7;
// args: [symbols...] [--save] [--stop=X] [--htf]  — X in % (default 0.5)
const stopArg = process.argv.find((a) => a.startsWith("--stop="));
const STOP_BUF = stopArg ? parseFloat(stopArg.slice(7)) : 0.5;
const HTF = process.argv.includes("--htf"); // weekly trend gate (Major-vs-Minor)
const regimeArg = process.argv.find((a) => a.startsWith("--regime="));
const REGIME_THRESHOLD = regimeArg ? parseFloat(regimeArg.slice(9)) : null; // null = off
const regimeMinArg = process.argv.find((a) => a.startsWith("--regime-min="));
const REGIME_MIN = regimeMinArg ? parseInt(regimeMinArg.slice(13), 10) : 3;
const regimeWinArg = process.argv.find((a) => a.startsWith("--regime-window="));
const REGIME_WINDOW_DAYS = regimeWinArg ? parseInt(regimeWinArg.slice(16), 10) : 90;
// --conf=N: keep only signals scoring >= N on the measured 0-6 confluence
// scale (scanner-logic.js) — exactly what the live scanner stores when
// scan-rules.json sets minConfluence=N. allSignals keeps EVERY signal so the
// bucket/component tables stay full-sample; only the kept/gated stat lines
// and the conf board reflect the gate.
const confArg = process.argv.find((a) => a.startsWith("--conf="));
const CONF_THRESHOLD = confArg ? parseInt(confArg.slice(7), 10) : null;
if (confArg && (!Number.isInteger(CONF_THRESHOLD) || CONF_THRESHOLD < 1 || CONF_THRESHOLD > 6)) {
  console.error(`--conf expects a whole number 1-6, e.g. --conf=3 (got "${confArg.slice(7)}")`);
  process.exit(2);
}
if (process.argv.includes("--save-nse") && CONF_THRESHOLD == null) {
  console.error("--save-nse needs --conf=N: without the conf gate it would overwrite the gated NSE baseline with ungated numbers. Rebuild the UNGATED baseline with --save on a plain run instead.");
  process.exit(2);
}
if (regimeArg && !Number.isFinite(REGIME_THRESHOLD)) {
  console.error(`--regime expects a percentage, e.g. --regime=30 (got "${regimeArg.slice(9)}")`);
  process.exit(2);
}
if (regimeMinArg && !Number.isFinite(REGIME_MIN)) {
  console.error(`--regime-min expects a whole number, e.g. --regime-min=3 (got "${regimeMinArg.slice(13)}")`);
  process.exit(2);
}

// ISO date N days before dateStr — the trailing window's left edge.
function isoDaysBefore(dateStr, days) {
  return new Date(new Date(dateStr + "T00:00:00Z").getTime() - days * 86400000).toISOString().slice(0, 10);
}

function fmtEv(ev) { return ev == null ? " — " : (ev > 0 ? "+" : "") + ev.toFixed(2) + "R"; }
const SYMBOLS = process.argv.slice(2).filter((a) => !a.startsWith("--"));

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
    bars.push({
      date: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10),
      open: o, high: h, low: l, close: c,
      volume: Number.isFinite(q.volume && q.volume[i]) && q.volume[i] >= 0 ? q.volume[i] : 0,
    });
  }
  return bars.length ? bars : null;
}

async function getBars(symbol, interval = "1d", range = "1095d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  // Yahoo rate-limits long symbol bursts with transient "fetch failed"/429s.
  // Small backoff + retry turns a 487-failures board run into a clean one;
  // sleeps happen BETWEEN retries (not before the first attempt), so short
  // runs are no slower than before.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, signal: AbortSignal.timeout(20000) });
      const json = await res.json().catch(() => null);
      const bars = json && parseYahoo(json);
      if (bars) return bars;
      lastErr = new Error("no bars");
      if (json && json.chart && json.chart.error && /not found|delisted/i.test(JSON.stringify(json.chart.error))) break; // dead ticker — don't retry
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("no bars");
}

// Full EMA series (index i = EMA as of bar i, seeded from the first close —
// same warm-up behavior as the daily ema() proxy below).
function emaSeries(bars, n) {
  const k = 2 / (n + 1), out = [];
  let e = bars[0].close;
  out.push(e);
  for (let j = 1; j < bars.length; j++) { e = bars[j].close * k + e * (1 - k); out.push(e); }
  return out;
}

// Walk forward from the bar AFTER the signal bar. First close beyond stop or
// target decides. (EOD approximation: intrabar touch order unknowable here.)
function outcomeDetailed(bars, from, side, entry, stop, target) {
  for (let i = from; i < Math.min(bars.length, from + MAX_HOLD); i++) {
    const c = bars[i].close;
    if (side === "LONG") {
      if (c <= stop) return { oc: "STOP", i };
      if (c >= target) return { oc: "TARGET", i };
    } else {
      if (c >= stop) return { oc: "STOP", i };
      if (c <= target) return { oc: "TARGET", i };
    }
  }
  // TIMEOUT resolves on the last bar we could see — clamp so a signal on the
  // final bar (from === bars.length) still maps to a real bar, not undefined.
  const lastIdx = bars.length - 1;
  return { oc: "TIMEOUT", i: Math.max(0, Math.min(lastIdx, from + MAX_HOLD - 1)) };
}

function outcome(bars, from, side, entry, stop, target) {
  return outcomeDetailed(bars, from, side, entry, stop, target).oc;
}

async function runSymbol(symbol) {
  const bars = await getBars(symbol);
  // HTF gate data: 5y of weekly bars so the daily window (3y) starts with
  // >100 completed weekly bars behind it — the weekly 50-EMA is meaningful
  // from the first daily signal onward.
  let wb = null, wE10 = null, wE20 = null, wE50 = null;
  if (HTF) {
    try {
      wb = await getBars(symbol, "1wk", "1825d");
      if (wb.length < 60) { console.log(`  (${symbol}: only ${wb.length} weekly bars — HTF gate cannot engage, running ungated)`); wb = null; }
      else { wE10 = emaSeries(wb, 10); wE20 = emaSeries(wb, 20); wE50 = emaSeries(wb, 50); }
    } catch { console.log(`  (${symbol}: weekly fetch failed — running ungated)`); }
  }
  // Need >=100 bars before computeZones works, so scanning starts there.
  const signals = [];    // signals the gate let through (all of them when the gate is off)
  const allSignals = []; // pre-gate baseline, kept only for the side-by-side report
  const paused = [];     // signals the regime gate blocked (with their would-be outcome)
  const trades = [];     // kept signals that resolved — the trailing window's memory
  let gateEngaged = 0;   // signals where the trailer had enough sample to judge
  const windowSizes = []; // trailing-window sample size at each engagement
  let lastZoneFire = new Map(); // zoneKey -> bar index of last fire
  let wIdx = -1;                // last weekly bar fully closed before the daily date
  let confPaused = 0;           // signals the --conf gate removed

  for (let i = 100; i < bars.length; i++) {
    const view = bars.slice(0, i + 1);          // no look-ahead
    const res = computeZones(view, { pivotLeft: PIVOT, pivotRight: PIVOT });
    const last = view[view.length - 1];
    const price = last.close;
    const hit = (z) => last.low <= z.top && last.high >= z.bottom;
    const ema = (n) => {
      let sum = 0; // simple MA proxy over the tail is close enough for trend gating here,
      // but use real EMA for fidelity
      const k = 2 / (n + 1);
      let e = view[0].close;
      for (let j = 1; j < view.length; j++) e = view[j].close * k + e * (1 - k);
      return e;
    };
    const up = ema(10) > ema(20) && ema(20) > ema(50);
    const down = ema(10) < ema(20) && ema(20) < ema(50);

    // advance the weekly pointer: a weekly bar stamped w covers ~w..w+4,
    // so it is fully closed once the daily date d > w+4 (no look-ahead)
    if (wb) {
      const d = new Date(last.date + "T00:00:00Z").getTime();
      while (wIdx + 1 < wb.length && new Date(wb[wIdx + 1].date + "T00:00:00Z").getTime() + 4 * 86400000 < d) wIdx++;
    }
    const wUp = !!wb && wIdx >= 0 && wE10[wIdx] > wE20[wIdx] && wE20[wIdx] > wE50[wIdx];
    const wDn = !!wb && wIdx >= 0 && wE10[wIdx] < wE20[wIdx] && wE20[wIdx] < wE50[wIdx];

    const consider = (zones, side, trendOk) => {
      if (!trendOk) return;
      let best = null, bd = Infinity;
      for (const z of zones || []) {
        if (!hit(z)) continue;
        const d = Math.abs(price - (z.top + z.bottom) / 2);
        if (d < bd) { bd = d; best = z; }
      }
      if (!best) return;
      const key = `${side}|${best.bottom.toFixed(2)}-${best.top.toFixed(2)}`;
      const lastI = lastZoneFire.get(key);
      if (lastI !== undefined && i - lastI < DEDUP_DAYS) return;
      lastZoneFire.set(key, i);
      const stop = side === "LONG" ? best.bottom * (1 - STOP_BUF / 100) : best.top * (1 + STOP_BUF / 100);
      const target = side === "LONG" ? price + (price - stop) * RR : price - (stop - price) * RR;
      if (!(target > 0)) return;
      const oc = outcomeDetailed(bars, i + 1, side, price, stop, target);
      // Carry the live confluence score (scanner-logic.js) so the report can
      // ask the only question that matters about it: do high-confluence signals
      // actually beat low-confluence ones, or is the score decoration?
      const conf = LfcScanner.confluenceScore(res, side);
      // Every scoring contributor, recorded individually so the report can
      // measure each one on its own evidence instead of trusting the sum.
      const zoneUsed = side === "LONG" ? res.nearestDemand : res.nearestSupply;
      const rec = { date: last.date, side, price: price.toFixed(2), zone: `${best.bottom.toFixed(2)}-${best.top.toFixed(2)}`, stop: stop.toFixed(2), target: target.toFixed(2), outcome: oc.oc, conf, components: {
        fresh: !!(zoneUsed && zoneUsed.fresh),
        emaConfluence: !!(zoneUsed && zoneUsed.emaConfluence),
        rejectWick: (side === "LONG" ? res.rejectionWick.lower : res.rejectionWick.upper) >= 0.30,
        trendAlign: side === "LONG" ? res.trend === "UPTREND" : res.trend === "DOWNTREND",
        bos: res.structureEvent === "BoS",
        choch: res.structureEvent === "CHoCH",
        fvg: !!(res.fvg && ((side === "LONG" && res.fvg.dir === "BULL") || (side === "SHORT" && res.fvg.dir === "BEAR"))),
        rightRangeHalf: side === "LONG" ? res.rangeZone === "DISCOUNT" : res.rangeZone === "PREMIUM",
        bias: side === "LONG" ? res.candleBias === "BULLISH" : res.candleBias === "BEARISH",
        twoSidedWick: res.twoSidedWick,
        above200: side === "LONG" ? (res.above200 && res.sma200Rising) : (!res.above200 && !res.sma200Rising),
        volume: res.volumeConfirm,
        crossback: res.emaCrossback,
        squareOf9: res.squareOf9,
        circleEighths: res.circleEighths,
        gann1x1: side === "LONG" ? res.gann1x1Up : res.gann1x1Down,
        timeSquare: side === "LONG" ? res.timeSquareLow : res.timeSquareHigh,
        narrowRange: side === "LONG" ? res.narrowRangeLong : res.narrowRangeShort,
        baseNBreak: res.baseNBreak,
      }, barsHeld: oc.oc === "TIMEOUT" ? MAX_HOLD : undefined };
      allSignals.push(rec);

      // Confluence gate (--conf=N): mirrors scan-rules.json minConfluence —
      // the live scanner never stores below the bar, so this gate sits before
      // the regime trailer too (a blocked signal feeds no trailing window).
      if (CONF_THRESHOLD != null && conf < CONF_THRESHOLD) { confPaused++; return; }

      // Trailing-regime gate. The window sees exactly what the live digest
      // line sees: signals THIS gate stored in the last 90 days whose outcome
      // was already decided before today's signal (open trades are ignored).
      if (REGIME_THRESHOLD != null) {
        const cutoff = isoDaysBefore(last.date, REGIME_WINDOW_DAYS);
        const win = trades.filter((t) => t.date >= cutoff && t.resolvedDate <= last.date);
        if (win.length >= REGIME_MIN) {
          gateEngaged++;
          windowSizes.push(win.length);
          const hits = win.filter((t) => t.oc === "TARGET").length;
          if (100 * hits / win.length < REGIME_THRESHOLD) { paused.push(rec); return; }
        }
      }

      trades.push({ date: last.date, resolvedDate: bars[oc.i].date, oc: oc.oc });
      signals.push(rec);
    };

    consider(res.demandZones, "LONG", up && (!HTF || !wb || wUp));
    consider(res.supplyZones, "SHORT", down && (!HTF || !wb || wDn));
  }

  // yearly segmentation: regime-stability view (resolved outcomes only —
  // a TIMEOUT at year end may resolve in the next year, so it is excluded
  // from per-year hit rates and EV but noted)
  return {
    symbol, bars: bars.length, lastDate: bars[bars.length - 1].date,
    signals, allSignals, paused, gateEngaged, windowSizes, confPaused,
    statsGated: statsOf(allSignals.filter((s) => CONF_THRESHOLD == null || s.conf >= CONF_THRESHOLD)),
    stats: statsOf(signals), baseStats: statsOf(allSignals),
    years: yearsOf(signals), baseYears: yearsOf(allSignals),
  };
}

function statsOf(sigs) {
  const t = sigs.filter((s) => s.outcome === "TARGET").length;
  const s = sigs.filter((x) => x.outcome === "STOP").length;
  const to = sigs.filter((x) => x.outcome === "TIMEOUT").length;
  const resolved = t + s;
  return {
    n: sigs.length, t, s, to, resolved,
    hit: resolved ? Math.round(100 * t / resolved) : null,
    ev: resolved ? (t * RR - s) / resolved : null,
  };
}

// statsOf reads {outcome} records; the per-year views are {t,s,to} counters.
function decorate(counts) {
  return [
    ...Array(counts.t).fill({ outcome: "TARGET" }),
    ...Array(counts.s).fill({ outcome: "STOP" }),
    ...Array(counts.to).fill({ outcome: "TIMEOUT" }),
  ];
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function yearsOf(sigs) {
  const years = {};
  for (const sig of sigs) {
    const y = sig.date.slice(0, 4);
    years[y] = years[y] || { t: 0, s: 0, to: 0 };
    years[y][sig.outcome === "TARGET" ? "t" : sig.outcome === "STOP" ? "s" : "to"]++;
  }
  return years;
}

(async () => {
  const SAVE = process.argv.includes("--save");
  const SAVE_NSE = process.argv.includes("--save-nse");
  const cachePath = path.join(__dirname, "scan-quality.json");
  const nseCachePath = path.join(__dirname, "scan-quality-nse.json");
  const cache = SAVE
    ? (() => { try { return JSON.parse(require("fs").readFileSync(cachePath, "utf8")); } catch { return {}; } })()
    : null;
  const GATE = REGIME_THRESHOLD != null;
  const gateLabel = GATE ? ` + trailing-90d regime gate <${REGIME_THRESHOLD}% (min ${REGIME_MIN} resolved)` : "";
  const rows = [];
  const statLine = (st, label = "") =>
    `${label}${String(st.n).padStart(3)} signals (${String(st.t).padStart(2)}T/${String(st.s).padStart(2)}S/${st.to}TO)` +
    `  hit ${st.hit == null ? "  —" : String(st.hit).padStart(3) + "%"}  EV ${fmtEv(st.ev)}`;

  for (const sym of SYMBOLS) {
    try {
      const r = await runSymbol(sym);
      rows.push(r);
      console.log(`\n=== ${sym} — ${r.bars} bars to ${r.lastDate} ===`);
      console.log(`${GATE ? "kept    " : "signals "}(deduped, trend-filtered${HTF ? " + weekly HTF gate" : ""}${CONF_THRESHOLD != null ? ` + conf>=${CONF_THRESHOLD}` : ""}${gateLabel}): ${statLine(r.stats)}`);
      if (CONF_THRESHOLD != null && r.statsGated.n) console.log(`  no-conf-gate: ${statLine(r.statsGated)}`);
      if (GATE) {
        console.log(`  no-gate: ${statLine(r.baseStats)}`);
        const pt = r.paused.filter((p) => p.outcome === "TARGET").length;
        const ps = r.paused.filter((p) => p.outcome === "STOP").length;
        const pto = r.paused.length - pt - ps;
        const med = median(r.windowSizes);
        console.log(`  gate paused ${r.paused.length} signal(s) (${pt}T/${ps}S/${pto}TO would-be) · engaged on ${r.gateEngaged}/${r.baseStats.n} signals` +
          (med ? ` · trailing sample at engagement: median ${med}, max ${Math.max(...r.windowSizes)} resolved` : ""));
      }
      const ys = [...new Set([...Object.keys(r.years), ...Object.keys(r.baseYears)])].sort();
      for (const y of ys) {
        const kept = r.years[y] || { t: 0, s: 0, to: 0 };
        console.log(`  ${y}: ` + statLine(statsOf(decorate(kept)), GATE ? "kept    " : ""));
        if (GATE && r.baseYears[y]) console.log(`        ` + statLine(statsOf(decorate(r.baseYears[y])), "no-gate "));
      }
      r.signals.forEach((x) => console.log(
        `  ${x.date}  ${x.side.padEnd(5)} @${x.price.padStart(9)}  zone ${x.zone.padStart(14)}  stop ${x.stop.padStart(9)}  tgt ${x.target.padStart(9)}  → ${x.outcome}`));
      if (GATE && r.paused.length) {
        console.log(`  -- paused --`);
        r.paused.forEach((x) => console.log(
          `  ${x.date}  ${x.side.padEnd(5)} @${x.price.padStart(9)}  zone ${x.zone.padStart(14)}  stop ${x.stop.padStart(9)}  tgt ${x.target.padStart(9)}  → ${x.outcome}`));
      }
      if (SAVE && r.signals.length >= 5) {
        cache[sym] = {
          hitRate: r.stats.hit,
          signals: r.stats.n,
          target: r.stats.t, stop: r.stats.s, timeout: r.stats.to,
          lastDate: r.lastDate,
          measuredAt: new Date().toISOString().slice(0, 10),
        };
      }
    } catch (e) {
      console.log(`\n=== ${sym} — FAILED: ${e.message} ===`);
    }
  }

  // Board view: the honest bottom line for the gate — did pausing low-regime
  // stretches leave a better board than taking every signal?
  if (GATE && rows.length) {
    const sum = (key) => rows.map((r) => r[key]).reduce((a, st) => ({
      n: a.n + st.n, t: a.t + st.t, s: a.s + st.s, to: a.to + st.to,
      resolved: a.resolved + st.resolved,
    }), { n: 0, t: 0, s: 0, to: 0, resolved: 0 });
    const board = (st) => ({
      ...st, hit: st.resolved ? Math.round(100 * st.t / st.resolved) : null,
      ev: st.resolved ? (st.t * RR - st.s) / st.resolved : null,
    });
    const kept = board(sum("stats")), base = board(sum("baseStats"));
    const pt = rows.reduce((a, r) => a + r.paused.filter((p) => p.outcome === "TARGET").length, 0);
    const ps = rows.reduce((a, r) => a + r.paused.filter((p) => p.outcome === "STOP").length, 0);
    console.log(`\n=== BOARD (${rows.length} symbols, 90d trailing regime gate <${REGIME_THRESHOLD}%, min ${REGIME_MIN}) ===`);
    console.log(`  no-gate: ${statLine(base)}`);
    console.log(`  gated  : ${statLine(kept)}   → EV ${(kept.ev - base.ev >= 0 ? "+" : "")}${(kept.ev - base.ev).toFixed(2)}R vs baseline`);
    console.log(`  gate paused ${base.n - kept.n} signal(s) — of those ${pt} hit TARGET / ${ps} stopped (${base.n - kept.n ? Math.round(100 * pt / (base.n - kept.n)) + "% would-be hit rate" : "n/a"})`);
    const med = median(rows.flatMap((r) => r.windowSizes));
    console.log(`  trailing-window sample when the gate engaged: median ${med} resolved trades (every window < ${REGIME_MIN} fails open)`);
  }

  // Confluence bucketing: the falsification test for the rulebook score. If the
  // score is real, EV should rise monotonically with it. If buckets are flat or
  // inverted, the score is decoration and minConfluence should stay 0.
  const allSigs = rows.flatMap((r) => r.allSignals.filter((s) => s.conf !== undefined));
  if (allSigs.length >= 50) {
    const bands = [[0, 1], [2, 2], [3, 4], [5, 6]];
    console.log(`\n=== CONFLUENCE BUCKETS (${allSigs.length} signals, all symbols) ===`);
    console.log("  conf   n     hit%    EV      vs board");
    const boardSt = statsOf(allSigs);
    for (const [lo, hi] of bands) {
      const st = statsOf(allSigs.filter((s) => s.conf >= lo && s.conf <= hi));
      if (!st.n) continue;
      const d = st.ev == null || boardSt.ev == null ? null : st.ev - boardSt.ev;
      console.log(`  ${String(lo + "-" + hi).padEnd(6)} ${String(st.n).padStart(4)}  ${String(st.hit == null ? "—" : st.hit).padStart(4)}%  ${fmtEv(st.ev)}  ${d == null ? "—" : (d >= 0 ? "+" : "") + d.toFixed(2) + "R"}`);
    }
    console.log(`  board  ${String(boardSt.n).padStart(4)}  ${String(boardSt.hit).padStart(4)}%  ${fmtEv(boardSt.ev)}`);
    // Per-component read: which single detector carries the edge, and which is
    // dead weight or actively harmful? Both sides pooled (each component is
    // evaluated in its own trade direction), so n is the full signal set.
    const comps = [
      ["fresh zone", (s) => s.components.fresh],
      ["ema20 slope", (s) => s.components.emaConfluence],
      ["rejection wick", (s) => s.components.rejectWick],
      ["trend align", (s) => s.components.trendAlign],
      ["BoS structure", (s) => s.components.bos],
      ["CHoCH", (s) => s.components.choch],
      ["FVG direction", (s) => s.components.fvg],
      ["discount/premium", (s) => s.components.rightRangeHalf],
      ["candle bias", (s) => s.components.bias],
      ["above 200-SMA", (s) => s.components.above200],
      ["volume confirm", (s) => s.components.volume],
      ["EMA crossback", (s) => s.components.crossback],
      ["base n' break", (s) => s.components.baseNBreak],
      ["Square of 9", (s) => s.components.squareOf9],
      ["circle eighths", (s) => s.components.circleEighths],
      ["Gann 1x1", (s) => s.components.gann1x1],
      ["time square", (s) => s.components.timeSquare],
      ["narrow-range rev", (s) => s.components.narrowRange],
    ];
    console.log("\n  -- single components (fires vs does not, direction-aware) --");
    for (const [name, pred] of comps) {
      const withIt = statsOf(allSigs.filter(pred));
      const without = statsOf(allSigs.filter((s) => !pred(s)));
      if (!withIt.n) { console.log(`  ${name.padEnd(16)} — never fired`); continue; }
      const d = withIt.ev == null || without.ev == null ? null : withIt.ev - without.ev;
      const verdict = d == null ? "" : d >= 0.10 ? "  ← HELPED" : d <= -0.10 ? "  ← HURT" : "  ← noise";
      console.log(`  ${name.padEnd(16)} with ${String(withIt.n).padStart(4)} (${String(withIt.hit).padStart(3)}% ${fmtEv(withIt.ev)})  without ${String(without.n).padStart(4)} (${String(without.hit == null ? "—" : without.hit).padStart(3)}% ${fmtEv(without.ev)})  Δ ${d == null ? "—" : (d >= 0 ? "+" : "") + d.toFixed(2) + "R"}${verdict}`);
    }
  }

  // Rule 39 seasonal overlay: "Years 5 & 9 peak in spring/summer; expect decline
  // Sep-Nov" and "Years 1-4 tend bottoming in Feb-Mar". Bucketing every signal
  // by calendar month tests that claim on real data (3 calendar years × 12
  // months, so each cell is a year-slice rather than a single event).
  if (allSigs.length >= 50) {
    const boardSt = statsOf(allSigs);
    console.log(`\n=== MONTH BUCKETS (Rule 39 seasonal overlay: "exit before Sep-Nov") ===`);
    console.log("  month  n     hit%    EV      vs board");
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (let m = 0; m < 12; m++) {
      const st = statsOf(allSigs.filter((s) => Number(s.date.slice(5, 7)) === m + 1));
      if (!st.n) continue;
      const d = st.ev == null || boardSt.ev == null ? null : st.ev - boardSt.ev;
      console.log(`  ${names[m].padEnd(5)} ${String(st.n).padStart(4)}  ${String(st.hit == null ? "—" : st.hit).padStart(4)}%  ${fmtEv(st.ev)}  ${d == null ? "—" : (d >= 0 ? "+" : "") + d.toFixed(2) + "R"}`);
    }
  }

  if (SAVE) {
    if (GATE) {
      console.log("\n--save skipped: the regime gate changes which signals exist, so saving would overwrite the ungated digest baseline. Re-run without --regime to refresh it.");
    } else {
      require("fs").writeFileSync(cachePath, JSON.stringify(cache, null, 2) + "\n");
      console.log(`\nsaved ${Object.keys(cache).length} entr(ies) → tools/scan-quality.json`);
    }
  }

  // --dump: write every signal (conf, year, outcome) to $LFC_DUMP for
  // out-of-sample studies: tune a gate on one slice, validate on another.
  if (process.env.LFC_DUMP && rows.length) {
    const dump = rows.flatMap((r) => r.allSignals.map((s) => ({
      sym: r.symbol, date: s.date, year: s.date.slice(0, 4), side: s.side,
      conf: s.conf, outcome: s.outcome,
    })));
    require("fs").writeFileSync(process.env.LFC_DUMP, JSON.stringify(dump));
    console.log(`\ndumped ${dump.length} signal(s) → ${process.env.LFC_DUMP}`);
  }

  // Year × conf stability grid: an honest gate must help (or at least not
  // hurt) in EVERY year, not just on the pooled average — a threshold tuned
  // on the pooled data can be pure overfit, and this grid is the check.
  if (rows.length && rows.reduce((a, r) => a + r.allSignals.length, 0) >= 50) {
    const all = rows.flatMap((r) => r.allSignals);
    const years = [...new Set(all.map((s) => s.date.slice(0, 4)))].sort();
    const bands = [[0, 1], [2, 2], [3, 4], [5, 6]];
    console.log(`\n=== YEAR × CONF GRID (hit% / EV / n) ===`);
    console.log("  year   " + bands.map(([lo, hi]) => `conf${lo}-${hi}`.padStart(16)).join("") + "        board");
    for (const y of years) {
      const ys = all.filter((s) => s.date.startsWith(y));
      const cells = bands.map(([lo, hi]) => {
        const st = statsOf(ys.filter((s) => s.conf >= lo && s.conf <= hi));
        return st.n ? `${st.hit}%/${fmtEv(st.ev)}/${st.n}`.padStart(16) : "—".padStart(16);
      });
      const bs = statsOf(ys);
      console.log(`  ${y} ${cells.join("")}  ${bs.hit}%/${fmtEv(bs.ev)}/${bs.n}`.replace(/(\d)%\//, "$1% /"));
    }
  }

  // --conf board summary + NSE baseline rebuild. With --save-nse, writes
  // tools/scan-quality-nse.json from the CONF-GATED signals so the digest's
  // board line matches what a minConfluence-gated live scan actually stores.
  if (CONF_THRESHOLD != null && rows.length) {
    const gated = rows.flatMap((r) => r.allSignals.filter((s) => s.conf >= CONF_THRESHOLD));
    const ungated = rows.flatMap((r) => r.allSignals);
    const gs = statsOf(gated), us = statsOf(ungated);
    console.log(`\n=== CONF BOARD (conf>=${CONF_THRESHOLD}, ${rows.length} symbols) ===`);
    console.log(`  ungated: ${statLine(us)}`);
    console.log(`  gated  : ${statLine(gs)}   → EV ${(gs.ev - us.ev >= 0 ? "+" : "")}${(gs.ev - us.ev).toFixed(2)}R vs ungated · kept ${gs.n}/${us.n} (${us.n ? Math.round(100 * gs.n / us.n) : 0}%)`);
    if (SAVE_NSE) {
      if (GATE) {
        console.log("--save-nse skipped: regime gate active would distort the baseline. Re-run without --regime.");
      } else {
        const nseRows = rows.filter((r) => r.symbol.endsWith(".NS") && r.statsGated.hit != null);
        const out = {};
        for (const r of nseRows) {
          const st = statsOf(r.allSignals.filter((s) => s.conf >= CONF_THRESHOLD));
          out[r.symbol] = {
            hitRate: st.hit, ev: st.ev == null ? null : Math.round(st.ev * 100) / 100,
            signals: st.n, target: st.t, stop: st.s, timeout: st.to,
            lastDate: r.lastDate,
            measuredAt: new Date().toISOString().slice(0, 10),
            minConf: CONF_THRESHOLD,
          };
        }
        const agg = statsOf(gated.filter((s) => s.date && s.date.slice && true)); // all gated (commodities included only if scanned)
        const nseGated = gated.filter((s) => rows.find((r) => r.symbol.endsWith(".NS") && r.allSignals.includes(s)));
        const ns = statsOf(nseGated);
        out.board = { hitRate: ns.hit, ev: ns.ev == null ? null : Math.round(ns.ev * 100) / 100, signals: ns.n, symbols: nseRows.length, minConf: CONF_THRESHOLD, measuredAt: new Date().toISOString().slice(0, 10) };
        require("fs").writeFileSync(nseCachePath, JSON.stringify(out, null, 2) + "\n");
        console.log(`\nsaved ${nseRows.length} NSE symbol(s) + board (conf>=${CONF_THRESHOLD}) → tools/scan-quality-nse.json`);
      }
    }
  }
})();
