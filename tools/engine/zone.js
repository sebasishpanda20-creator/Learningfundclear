"use strict";

// ── GTF-Pro Zone module ───────────────────────────────────────────────────────
// Zone record shape, LTF stack (Intraday 75m->15m->5m, Swing Weekly->Daily->
// 125m/75m, NSE 09:15-anchored), and shared aggregation helpers.  The Legacy
// Pivot engine (scanner-logic.js LfcScanner.computeZones) keeps its own zones
// and is NOT imported from this module.
//
// GTF-Pro zone detection is built from the LTF CANDLES directly, not from the
// Legacy pivot result.  DBR/RBR/RBD/DBD are detected from candle shapes:
//   - base candle body < 50% of range  (B)
//   - exciting candle body > 50%        (R)
//   - 1-3 base = strong, 4-5 = weaker,
//     5+ = zero (noise) — session-aligned
//   - zone confirmed only after a leg-out closes
//   - retest counted after the confirmed departure/bar index (no fixed days)

const candle = require("./candle");

// ── Zone record ───────────────────────────────────────────────────────────────
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

// ── candle-shape helpers (GTF DBR/RBR/RBD/DBD) ───────────────────────────────
// Base candle: body < 50% of range.
function isBaseCandle(b) {
  if (!b) return false;
  const body = b.close - b.open;
  const range = b.high - b.low || 1e-9;
  return Math.abs(body) / range < 0.5;
}

// Exciting candle: body > 50% of range.
function isExcitingCandle(b) {
  if (!b) return false;
  const body = b.close - b.open;
  const range = b.high - b.low || 1e-9;
  return Math.abs(body) / range > 0.5;
}

// Identify the type of a candle relative to its immediate neighbourhood:
//   "base"  : small-range bar, the candidate zone floor
//   "exciting": large-range bar that moves away from the base
function candleType(b) {
  if (!b) return "none";
  const body = b.close - b.open;
  const range = b.high - b.low || 1e-9;
  const bp = Math.abs(body) / range;
  if (bp < 0.5) return "base";
  if (bp > 0.5) return "exciting";
  return "neutral";
}

// True GTF structure detection from raw candles:
//   bars[i-1] = exciting leg INTO the base, bars[i..j-1] = consecutive base run,
//   bars[j]   = exciting leg-OUT whose CLOSE travels beyond the base run.
//   RBR (Rally-Base-Rally, demand continuation): up-leg in,   leg-out closes above
//   RBD (Rally-Base-Drop,  supply reversal)   : up-leg in,   leg-out closes below
//   DBD (Drop-Base-Drop,   supply continuation): down-leg in, leg-out closes below
//   DBR (Drop-Base-Rally,  demand reversal)   : down-leg in, leg-out closes above
// Zone confirmation needs the leg-out CLOSE (closed-candle anti-repaint) — a wick
// through the base never creates or invalidates a zone on its own.
function detectGtfPattern(bars, i) {
  if (i < 1 || i >= bars.length - 1) return null;
  const legIn = bars[i - 1];
  if (!isExcitingCandle(legIn) || !isBaseCandle(bars[i])) return null;
  let j = i;
  while (j < bars.length - 1 && isBaseCandle(bars[j])) j++;
  if (j === i) return null; // unreachable (guarded above) — keeps callers safe
  const legOut = bars[j];
  if (!isExcitingCandle(legOut)) return null;
  let baseLow = Infinity, baseHigh = -Infinity;
  for (let k = i; k < j; k++) {
    if (bars[k].low < baseLow) baseLow = bars[k].low;
    if (bars[k].high > baseHigh) baseHigh = bars[k].high;
  }
  const upLeg = legOut.close > baseHigh;   // leg-out CLOSES above the base run
  const downLeg = legOut.close < baseLow;  // leg-out CLOSES below the base run
  if (!upLeg && !downLeg) return null;
  const prevUp = legIn.close > legIn.open;
  const type = prevUp ? (upLeg ? "RBR" : "RBD") : (downLeg ? "DBD" : "DBR");
  return { type, startIndex: i, endIndex: j - 1, legOutIndex: j };
}

// A base candle is countered by an exciting candle that closes beyond the
// base's range on the opposite side, with the following bar confirming.
function detectReverseStructure(bars, i) {
  const p = detectGtfPattern(bars, i);
  return p ? p.type : null;
}

// Collect all GTF structure points from a candle array.  Each point carries the
// base-run span (startIndex..endIndex) and the leg-out index.  `index` is kept
// as the first base candle for backwards compatibility.
function findStructurePoints(bars) {
  const out = [];
  for (let i = 1; i < bars.length - 1; i++) {
    const p = detectGtfPattern(bars, i);
    if (p) out.push({ type: p.type, index: p.startIndex, startIndex: p.startIndex, endIndex: p.endIndex, legOutIndex: p.legOutIndex, bar: bars[p.startIndex] });
  }
  return out;
}

// Build GTF-Pro zones from raw candles.  A zone is confirmed only after the
// leg-out candle CLOSES beyond the base run (detectGtfPattern enforces that).
// Boundaries follow the spec, computed across the WHOLE base run:
//   Demand (DBR/RBR): top = proximal = MAX(max(open,close)); bottom = distal = MIN(low)
//   Supply (RBD/DBD): bottom = proximal = MIN(min(open,close)); top = distal = MAX(high)
//   1-3 base candles = strong, 4-5 = weaker, >5 = noise (zone rejected).
function buildGtfZones(bars, symbol, tf) {
  const pts = findStructurePoints(bars);
  if (!pts.length) return [];
  const out = [];
  const sym = symbol || "C";
  const tfId = tf || "5m";

  for (const p of pts) {
    if (p.endIndex - p.startIndex + 1 > 5) continue; // >5 base candles → reject
    const b = p.bar || bars[p.startIndex];
    if (!b) continue;

    const seg = bars.slice(p.startIndex, p.endIndex + 1);
    const isDemand = p.type === "DBR" || p.type === "RBR";
    let bottom, top;
    if (isDemand) {
      top = Math.max(...seg.map((c) => Math.max(c.open, c.close)));    // proximal
      bottom = Math.min(...seg.map((c) => c.low));                     // distal
    } else {
      bottom = Math.min(...seg.map((c) => Math.min(c.open, c.close))); // proximal
      top = Math.max(...seg.map((c) => c.high));                       // distal
    }
    if (!(bottom < top)) continue;

    const zone = new Zone(
      `${sym}_${tfId}_${b.date}_${p.type}`,
      sym,
      isDemand ? "D" : "S",
      tfId,
      bottom,
      top,
      b.date,
      candle.nseSessionDay(b)
    );
    zone.pattern = p.type;
    zone.baseCount = seg.length;
    zone.legOutIndex = p.legOutIndex;
    out.push(zone);
  }
  return out;
}

// ── Shared aggregation delegates (single implementation lives in stack.js) ──
const stack = require("./stack");

function nseHour(hour) {
  return stack.nseHour(hour);
}

function anchorToSession(bars) {
  return stack.anchorToSession(bars);
}

function groupBySessionDay(anchored) {
  return stack.groupBySessionDay(anchored);
}

function stackBars(rawBars, stackId) {
  return stack.stackBars(rawBars, stackId);
}

function resolveStack(stackId) {
  return stack.resolveStack(stackId);
}

// Kept for compatibility — the canonical definitions live in stack.js.
const STACK_TIMEFRAMES = { intraday: stack.INTRADAILY, swing: stack.SWING };

module.exports = {
  Zone,
  isBaseCandle,
  isExcitingCandle,
  candleType,
  detectReverseStructure,
  findStructurePoints,
  buildGtfZones,
  nseHour,
  anchorToSession,
  groupBySessionDay,
  stackBars,
  resolveStack,
  STACK_TIMEFRAMES,
};
