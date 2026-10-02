"use strict";

// ── GTF-Pro Zone module ───────────────────────────────────────────────────────
// Zone record shape, LTF stack (Intraday 75m->15m->5m, Swing Weekly->Daily->
// 125m/75m, NSE 09:15-anchored), and aggregation helpers.  The Legacy Pivot
// engine (scanner-logic.js LfcScanner.computeZones) keeps its own zones and is
// NOT imported from this module.

const candle = require("./candle");

// ── Zone record ───────────────────────────────────────────────────────────────
// A demand or supply zone for a GTF-Pro signal.  `created` is the UTC date of
// the bar that formed the pivot.  `nseSessionDay` is the 09:15 IST session day
// the forming bar belongs to.
function Zone(id, symbol, action, tf, floor, ceiling, created, nseSessionDay) {
  this.id = id;
  this.symbol = symbol;
  this.action = action; // "D" demand / "S" supply
  this.tf = tf; // timeframe id, e.g. "5m", "15m", "75m", "W", "D"
  this.bottom = floor;
  this.top = ceiling;
  this.created = created || null; // UTC date "YYYY-MM-DD" of forming bar
  this.nseSessionDay = nseSessionDay || null; // 09:15 IST session day
  this.retests = []; // bars that later closed inside this zone
  this.score = 0; // computed by pipeline
}

// ── LTF stacks ───────────────────────────────────────────────────────────────
// Intraday: 75m location -> 15m trend -> 5m execution.
const INTRADAILY = [
  { id: "75m", minBars: 300 }, // location
  { id: "15m", minBars: 120 }, // trend
  { id: "5m",  minBars: 60  }, // execution
];

// Swing: Weekly -> Daily -> 125m/75m (higher timeframes for swing, lower for
// the active zone).  The 125m/75m pair is a swing-aligned pair: 125m is the
// primary swing execution, 75m is the bias/confirmation slice.
const SWING = [
  { id: "W",  minBars: 120 },
  { id: "D",  minBars: 200 },
  { id: "125m", minBars: 125 },
  { id: "75m",  minBars: 75  },
];

// ── NSE 09:15 IST-anchored aggregation ───────────────────────────────────────
// Use the bar's UTC date but anchor the session day to the 09:15 IST window.
// `sessionDay` is assigned by nseSessionDay() from the candle module.
function nseHour(hour) {
  // 09:15 IST = 03:45 UTC.  Bars before 03:45 UTC on day D belong to the
  // prior IST day's session (their 09:15 window was the previous local day).
  return hour < 3; // hour in UTC; session boundary is 03:45 UTC = 09:15 IST
}

// Session-anchor a bar's date to the IST day of the 09:15 session.
function anchorToSession(bars) {
  // Returns [{date, sessionDay, hour}] preserving order (older first).
  const out = [];
  for (const b of bars) {
    const d = new Date(b.date + "T00:00:00Z");
    const hour = d.getUTCHours();
    out.push({
      rawDate: b.date,
      sessionDay: candle.nseSessionDay(b),
      hour,
      bar: b,
    });
  }
  return out;
}

// Group session-anchored bars into per-day ISOs, sorted, for the 75m/5m and
// Daily/weekly stacks.
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

// ── Zone creation from a Pivot result (reuse legacy scanner-logic zones) ───
// The Legacy engine already produces demandZones/supplyZones.  This converts
// each to a GTF-Pro Zone record.  `tf` is the GTF timeframe.
function zonesToGtf(pivotRes, symbol, timeframeId) {
  const out = [];
  const price = pivotRes.price || 0;
  const base = Date.parse(pivotRes.date || "") || Date.now();
  const iso = base ? new Date(base).toISOString().slice(0, 10) : null;

  for (const z of (pivotRes.demandZones || [])) {
    const created = z.created || iso;
    const bottom = Math.min(z.bottom, z.top);
    const top = Math.max(z.bottom, z.top);
    if (bottom >= top) continue;
    out.push(new Zone(
      `${symbol}_D_${timeframeId}_${created}`,
      symbol, "D", timeframeId, bottom, top, created, candle.nseSessionDay({ date: created })
    ));
  }
  for (const z of (pivotRes.supplyZones || [])) {
    const created = z.created || iso;
    const bottom = Math.min(z.bottom, z.top);
    const top = Math.max(z.bottom, z.top);
    if (bottom >= top) continue;
    out.push(new Zone(
      `${symbol}_S_${timeframeId}_${created}`,
      symbol, "S", timeframeId, bottom, top, created, candle.nseSessionDay({ date: created })
    ));
  }
  return out;
}

module.exports = {
  Zone,
  INTRADAILY,
  SWING,
  nseHour,
  anchorToSession,
  groupBySessionDay,
  zonesToGtf,
};
