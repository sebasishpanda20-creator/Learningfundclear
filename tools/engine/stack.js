"use strict";

// ── GTF-Pro timeframe stacks ──────────────────────────────────────────────────
// The pipeline builds a stack of timeframes per symbol for cross-checking.
// Legacy Pivot (Daily/Weekly/Monthly) is untouched and runs in parallel.

const candle = require("./candle");

// Intraday: 75m location -> 15m trend -> 5m execution
const INTRADAILY = [
  { id: "75m", label: "75m",  minBars: 300 },
  { id: "15m", label: "15m",  minBars: 120 },
  { id: "5m",  label: "5m",   minBars: 60  },
];

// Swing: Weekly -> Daily -> 125m/75m
const SWING = [
  { id: "W",   label: "W",    minBars: 120 },
  { id: "D",   label: "D",    minBars: 200 },
  { id: "125m", label: "125m", minBars: 125 },
  { id: "75m",  label: "75m",  minBars: 75  },
];

// NSE 09:15 IST-anchored aggregation (session-day keyed, not generic resampling)
// Bars are bucketed by the IST 09:15 session day (03:45 UTC = 09:15 IST).
// This is the anchor the daily/weekly stacks walk from.
function nseHour(hour) {
  return hour < 3; // 09:15 IST = 03:45 UTC; after that = same local session
}

// Session-anchor a bar array to IST session days, preserving oldest-first order.
function anchorToSession(bars) {
  const out = [];
  for (const b of bars) {
    const d = new Date(b.date + "T00:00:00Z");
    const hour = d.getUTCHours();
    out.push({
      rawDate: b.date,
      sessionDay: candle.nseSessionDay(b),
      hour, // UTC hour for anchoring
      bar: b,
    });
  }
  return out;
}

// Group session-anchored bars into a Map of sessionDay -> bars (sorted by date).
function groupBySessionDay(anchored) {
  const map = new Map();
  for (const a of anchored) {
    if (!map.has(a.sessionDay)) map.set(a.sessionDay, []);
    map.get(a.sessionDay).push(a.bar);
  }
  return Array.from(map.entries())
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
}

// Build a per-session-day OHLC bar from raw ticks (for LTF stacks, simplest
// is to aggregate the last 5m / 15m / 75m by session anchor then resample).
// Returns a descendant bar set keyed by session for the pipeline.
function stackBars(rawBars, stackId) {
  // Stack id must be one of INTRADAILY or SWING ids.  Raw bars are already
  // session-anchored by the caller; here we just tag them so the pipeline
  // knows which timeframes the bar spans.
  const out = [];
  for (const b of rawBars) {
    const isDaily = /^[WMDS]$/.test(stackId);
    if (isDaily) {
      // Daily ticks are W/D sums over a calendar session (NSE trading day).
      out.push(candle.makeCandle(b));
    } else {
      // Intraday / 125m / 75m: take the daily bar itself and let the express
      // bins (5m/15m/75m) be built by the scanner from raw intraday ticks.
      out.push(candle.makeCandle(b));
    }
  }
  return out;
}

// The GTF-Pro executable stack: returns the ordered list of timeframes that a
// scan session walks, per symbol.  Intraday symbols walk 75m->15m->5m; swing
// symbols walk W->D->125m->75m.  The same aggregation/strategy code path is
// shared by production and backtest (no duplicated logic).
function resolveStack(stackId) {
  if (!stackId) return INTRADAILY;
  const s = stackId.toLowerCase();
  if (s === "intraday") return INTRADAILY;
  if (s === "swing") return SWING;
  if (s === "nse") return INTRADAILY; // NSE default = intraday stack
  if (INTRADAILY.some((x) => x.id === stackId)) return INTRADAILY;
  if (SWING.some((x) => x.id === stackId)) return SWING;
  return INTRADAILY;
}

module.exports = {
  INTRADAILY,
  SWING,
  resolveStack,
  anchorToSession,
  groupBySessionDay,
  stackBars,
  nseHour,
};
