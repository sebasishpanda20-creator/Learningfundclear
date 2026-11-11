"use strict";

// ── GTF-Pro timeframe stacks (TRUE session-aligned aggregation) ────────────
// One shared aggregation function consumed by BOTH the scanner and the backtest.
// Bars are bucketed from the NSE 09:15 IST session anchor:
//   75m : 09:15-10:30, 10:30-11:45, 11:45-13:00, 13:00-14:15, 14:15-15:30
//   15m : 15-minute bricks anchored at 09:15
//   5m  : 5-minute bricks anchored at 09:15
//   125m: 09:15-11:20, 11:20-13:25, 13:25-15:30
// W / D are pass-through (daily/weekly bars arrive pre-aggregated).
//
// Intraday bar labels follow the scanner's parseYahoo format:
// "YYYY-MM-DD HH:MM" (IST-labelled). Daily labels are "YYYY-MM-DD".
// The Legacy Pivot engine (scanner-logic.js) is independent and untouched.

const candle = require("./candle");

// 09:15 IST expressed as minutes-from-midnight on the bar's own (IST) label.
const SESSION_START_MIN = 9 * 60 + 15; // 555

// ── Timeframe definitions shared by scanner + backtest ──────────────────────
const INTRADAILY = [
  { id: "75m",  label: "75m",  minBars: 25,  minutes: 75  },
  { id: "15m",  label: "15m",  minBars: 120, minutes: 15  },
  { id: "5m",   label: "5m",   minBars: 200, minutes: 5   },
];

const SWING = [
  { id: "W",    label: "W",    minBars: 120 },
  { id: "D",    label: "D",    minBars: 200 },
  { id: "125m", label: "125m", minBars: 60,  minutes: 125 },
  { id: "75m",  label: "75m",  minBars: 75,  minutes: 75  },
];

// ── Label parsing ────────────────────────────────────────────────────────────
// "2026-10-01 09:20" → { day: "2026-10-01", minutes: 560 }
// "2026-10-01"       → { day: "2026-10-01", minutes: null }  (daily bar)
function parseBarLabel(label) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(label || ""));
  if (!m) return null;
  return {
    day: m[1],
    minutes: m[2] != null ? Number(m[2]) * 60 + Number(m[3]) : null,
  };
}

function pad2(n) { return String(n).padStart(2, "0"); }

// ── TRUE aggregation: bucket raw intraday bars into brickMinutes candles ────
// Bucket index = floor((minutesFromMidnight − 09:15) / brickMinutes), keyed per
// session day. First bar's open, running max/min, last close, summed volume.
// Incomplete bars (missing OHLC) are excluded — a forming candle must never
// contribute to a confirmed brick.
function aggregateIntraday(rawBars, brickMinutes) {
  const out = [];
  if (!brickMinutes || brickMinutes <= 0) return out;
  const map = new Map();
  for (const b of rawBars || []) {
    if (!b || b.open == null || b.high == null || b.low == null || b.close == null) continue;
    const p = parseBarLabel(b.date);
    if (!p || p.minutes == null) continue; // not an intraday-labelled bar
    const slot = Math.floor((p.minutes - SESSION_START_MIN) / brickMinutes);
    if (slot < 0) continue;               // pre-open tick
    const key = p.day + "#" + slot;
    const cur = map.get(key);
    if (!cur) {
      const startMin = SESSION_START_MIN + slot * brickMinutes;
      map.set(key, {
        date: p.day + " " + pad2(Math.floor(startMin / 60) % 24) + ":" + pad2(startMin % 60),
        nseSessionDay: p.day,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume || 0,
        barTS: b.barTS || null,
      });
    } else {
      if (b.high > cur.high) cur.high = b.high;
      if (b.low < cur.low) cur.low = b.low;
      cur.close = b.close;
      cur.volume += b.volume || 0;
    }
  }
  // Preserve chronological order (day asc, slot asc).
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, v]) => v);
}

// ── Shared entry point (scanner + backtest call this) ───────────────────────
function stackBars(rawBars, stackId) {
  if (/^[WD]$/.test(stackId)) {
    return (rawBars || []).map((b) => candle.makeCandle(b));
  }
  const mins = { "75m": 75, "15m": 15, "5m": 5, "125m": 125 }[stackId];
  if (!mins) return (rawBars || []).map((b) => candle.makeCandle(b));
  return aggregateIntraday(rawBars || [], mins);
}

// ── Session anchor helpers (kept for compatibility) ─────────────────────────
function nseHour(hour) {
  return hour < 3; // 09:15 IST = 03:45 UTC
}

function anchorToSession(bars) {
  const out = [];
  for (const b of bars) {
    out.push({ rawDate: b.date, sessionDay: candle.nseSessionDay(b), bar: b });
  }
  return out;
}

function groupBySessionDay(anchored) {
  const map = new Map();
  for (const a of anchored) {
    if (!map.has(a.sessionDay)) map.set(a.sessionDay, []);
    map.get(a.sessionDay).push(a.bar);
  }
  return Array.from(map.entries()).sort((x, y) =>
    x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0
  );
}

// Resolve the ordered list of timeframes a scan session walks.
function resolveStack(stackId) {
  if (!stackId) return INTRADAILY;
  const s = stackId.toLowerCase();
  if (s === "intraday") return INTRADAILY;
  if (s === "swing") return SWING;
  if (s === "nse") return INTRADAILY;
  for (const x of INTRADAILY.concat(SWING)) if (x.id === stackId) return [x];
  return INTRADAILY;
}

module.exports = {
  SESSION_START_MIN,
  INTRADAILY,
  SWING,
  parseBarLabel,
  aggregateIntraday,
  nseHour,
  anchorToSession,
  groupBySessionDay,
  stackBars,
  resolveStack,
};
