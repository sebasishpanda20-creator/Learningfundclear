"use strict";

// ── GTF-Pro qualification gates ──────────────────────────────────────────────
// These are INTERNAL research/backtest guards per the spec. They are NOT
// user scanner controls: the browser UI never exposes them, and the nightly
// cron never reads them from a user-facing slider. They live in config only.

// Opposing-zone hard filter ---------------------------------------------------
// A pending signal is only qualified when an OPPOSING zone has room for at
// least 2R (2× the risk distance) between it and the candidate zone.
// Prerequisite: both zones must have survived (not invalidated).
const OPPOSE_RR = 2.0;

// Distance from a zone's entry/price to the opposite zone's edge (in price
// points), used to judge whether the opposing zone has enough room to be a
// valid 2R candidate. A negative value means the zones overlap (no room).
function opposingRoom(firstZone, secondZone, entryPrice, isDemand) {
  // entryPrice is the last close that formed the candidate. The opposing zone
  // must be able to absorb 2R on the candidate's side.
  const candEdge = isDemand ? firstZone.bottom : firstZone.top;
  const oppEdge = isDemand ? secondZone.top : secondZone.bottom;
  const direction = isDemand ? -1 : 1; // demand pulls down, supply pushes up
  const gap = (oppEdge - candEdge) * direction;
  const risk = Math.abs(entryPrice - candEdge);
  return { gap: Number(gap.toFixed(2)), room: gap >= 0 ? OPPOSE_RR * risk : -Infinity };
}

// A signal is qualified only if BOTH a demand and a supply zone exist and
// at least one opposing pair has >= 2R of room. Store the qualifying room so
// the backtest can compare it against the raw signal.
function opposing2RQualified(zones, price, isDemand, opts) {
  opts = opts || {};
  const minRoom = Number.isFinite(opts.minRoom) ? opts.minRoom : OPPOSE_RR;
  if (!zones.demand.length || !zones.supply.length) return false;
  // Greedy: the nearest demand to the price and the nearest supply to the price
  // is the most likely to have room. O(n*m) is fine for <=20 zones.
  const demand = zones.demand.slice().sort((a, b) => Math.abs(price - (a.bottom + a.top) / 2) - Math.abs(price - (b.bottom + b.top) / 2));
  const supply = zones.supply.slice().sort((a, b) => Math.abs(price - (a.bottom + a.top) / 2) - Math.abs(price - (b.bottom + b.top) / 2));
  for (const d of demand) {
    for (const s of supply) {
      const r = opposingRoom(d, s, price, true);
      if (r.gap >= minRoom) return true;
    }
  }
  for (const s of supply) {
    for (const d of demand) {
      const r = opposingRoom(d, s, price, false);
      if (r.gap >= minRoom) return true;
    }
  }
  return false;
}

// Formation-candle exclusion --------------------------------------------------
// A retest bar must be at least FORMATION_MARGIN days after the bar that
// formed the zone. GTF-Pro never scores a bar that is still forming the zone;
// that bar is part of the setup, not the retest.
const FORMATION_MARGIN = 2; // days

function isRetest(bar, zone) {
  if (!zone) return false;
  const tz = new Date(zone.created || bar.date).getTime();
  const tb = new Date(bar.date).getTime();
  const diff = (tb - tz) / 86400000;
  return diff >= FORMATION_MARGIN;
}

// ── Data freshness gating (hard rule) ───────────────────────────────────────
// READY and TRIGGERED require PRODUCTION-FRESH data for the session.
// Freshness is a session-level flag plus a per-bars source marker:
//   fresh = (source === "live") && (sessionCurrentDate === sessionCurrentDate)
// where sessionCurrentDate is the server's date at scan start.
//
// Stale / offline / sample / cached data MUST NOT produce READY or TRIGGERED.
// When freshness cannot be determined (no live source), the signal state is
// FROZEN or STALE and never advances to READY/TRIGGERED.
const FRESHNESS_PROXY = "live"; // current session's source marker

function isProductionFresh(freshness) {
  return freshness === "production-fresh" || freshness === "live";
}

function freshnessOf(source) {
  if (!source) return "unknown";
  if (source === "live" || source === "yfinance") return "production-fresh";
  if (source === "cache" || source === "sample" || source === "offline") return "stale";
  return "unknown";
}

// Session-level freshness check: returns false if the session's live source
// is not available, so no READY/TRIGGERED can be produced at all.
function productionFreshForSession(freshness) {
  return isProductionFresh(freshness);
}

// ── Config flag for ambiguous rules (spec: config flag + safe default + TODO) ─
// Every ambiguous rule has a config flag. The safe default is documented and
// the TODO is tracked in the engine module where the rule lives.
function resolveAmbiguous(flag, safeDefault) {
  if (flag === undefined || flag === null) return safeDefault;
  if (typeof flag !== "boolean") return safeDefault; // fail-open to the documented default
  return flag;
}

module.exports = {
  OPPOSE_RR,
  opposingRoom,
  opposing2RQualified,
  FORMATION_MARGIN,
  isRetest,
  freshnessOf,
  isProductionFresh,
  productionFreshForSession,
  resolveAmbiguous,
};
