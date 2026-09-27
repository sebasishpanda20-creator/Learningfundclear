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
 * Usage: node tools/research-thin-commodities.js [symbols...] [--save]
 *   --save  writes each symbol's hit rate (only if >= 5 signals) into
 *           tools/scan-quality.json, which the nightly digest reads for its
 *           "Commodities (90d signals · backtest hit %)" line.
 * Read-only on market data: fetches Yahoo, posts nothing.
 */
"use strict";

const path = require("path");
global.window = global;
require(path.join(__dirname, "..", "scanner-logic.js"));
const computeZones = global.LfcScanner.computeZones;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SYMBOLS = process.argv.slice(2).length ? process.argv.slice(2) : ["ZNC=F", "ALI=F", "PL=F", "GC=F", "CL=F"];
const PIVOT = 3, STOP_BUF = 0.5, RR = 2.0, MAX_HOLD = 60, DEDUP_DAYS = 7;

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

async function getBars(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1095d&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => null);
  const bars = json && parseYahoo(json);
  if (!bars) throw new Error("no bars");
  return bars;
}

// Walk forward from the bar AFTER the signal bar. First close beyond stop or
// target decides. (EOD approximation: intrabar touch order unknowable here.)
function outcome(bars, from, side, entry, stop, target) {
  for (let i = from; i < Math.min(bars.length, from + MAX_HOLD); i++) {
    const c = bars[i].close;
    if (side === "LONG") {
      if (c <= stop) return "STOP";
      if (c >= target) return "TARGET";
    } else {
      if (c >= stop) return "STOP";
      if (c <= target) return "TARGET";
    }
  }
  return "TIMEOUT";
}

async function runSymbol(symbol) {
  const bars = await getBars(symbol);
  // Need >=100 bars before computeZones works, so scanning starts there.
  const signals = [];
  let lastZoneFire = new Map(); // zoneKey -> bar index of last fire

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
      const oc = outcome(bars, i + 1, side, price, stop, target);
      signals.push({ date: last.date, side, price: price.toFixed(2), zone: `${best.bottom.toFixed(2)}-${best.top.toFixed(2)}`, stop: stop.toFixed(2), target: target.toFixed(2), outcome: oc, barsHeld: oc === "TIMEOUT" ? MAX_HOLD : undefined });
    };

    consider(res.demandZones, "LONG", up);
    consider(res.supplyZones, "SHORT", down);
  }

  const t = signals.filter((s) => s.outcome === "TARGET").length;
  const s = signals.filter((x) => x.outcome === "STOP").length;
  const to = signals.filter((x) => x.outcome === "TIMEOUT").length;
  return { symbol, bars: bars.length, lastDate: bars[bars.length - 1].date, signals, t, s, to };
}

(async () => {
  const SAVE = process.argv.includes("--save");
  const cachePath = path.join(__dirname, "scan-quality.json");
  const cache = SAVE
    ? (() => { try { return JSON.parse(require("fs").readFileSync(cachePath, "utf8")); } catch { return {}; } })()
    : null;
  for (const sym of SYMBOLS) {
    try {
      const r = await runSymbol(sym);
      console.log(`\n=== ${sym} — ${r.bars} bars to ${r.lastDate} ===`);
      console.log(`signals (deduped, trend-filtered): ${r.signals.length}  |  TARGET ${r.t} · STOP ${r.s} · TIMEOUT ${r.to}` +
        (r.signals.length ? `  (hit rate ${Math.round(100 * r.t / r.signals.length)}%)` : ""));
      r.signals.forEach((x) => console.log(
        `  ${x.date}  ${x.side.padEnd(5)} @${x.price.padStart(9)}  zone ${x.zone.padStart(14)}  stop ${x.stop.padStart(9)}  tgt ${x.target.padStart(9)}  → ${x.outcome}`));
      if (SAVE && r.signals.length >= 5) {
        cache[sym] = {
          hitRate: Math.round(100 * r.t / r.signals.length),
          signals: r.signals.length,
          target: r.t, stop: r.s, timeout: r.to,
          lastDate: r.lastDate,
          measuredAt: new Date().toISOString().slice(0, 10),
        };
      }
    } catch (e) {
      console.log(`\n=== ${sym} — FAILED: ${e.message} ===`);
    }
  }
  if (SAVE) {
    require("fs").writeFileSync(cachePath, JSON.stringify(cache, null, 2) + "\n");
    console.log(`\nsaved ${Object.keys(cache).length} entr(ies) → tools/scan-quality.json`);
  }
})();
