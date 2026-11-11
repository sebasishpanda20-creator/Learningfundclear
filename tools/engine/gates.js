"use strict";

// ── GTF-Pro qualification gates (internal; never user-exposed UI controls) ─
//
// Opposing-zone 2R calculation:
//   riskPoints  = abs(entry - stop)
//   Long :
//     roomPoints = nearestSupplyProximal - entry
//   Short:
//     roomPoints = entry - nearestDemandProximal
//   availableRR = roomPoints / riskPoints
//   Require: availableRR >= 2
//   Reject overlapping/incorrectly placed opposing zones.
//   Do NOT compare raw price gaps directly to 2.
//
// Formation-candle exclusion: retest bars are counted after the confirmed
// departure/zone-creation timestamp or bar index, NOT a fixed 2-calendar-day
// delay (NSE hourly is intraday; fixed days are invalid for same-day 75m/15m/5m).

const OPPOSE_RR = 2.0;

// One-sided room: given a candidate zone and its opposing zone, compute
// roomPoints and riskPoints for a long (demand candidate) or short (supply
// candidate).  Room uses the OPPOSING zone's PROXIMAL edge (the conservative,
// nearest edge):
//   Long : roomPoints = supplyProximal (supply.bottom) - entry
//   Short: roomPoints = entry - demandProximal (demand.top)
// riskPoints = abs(entry - candidate stop edge)  (long: demand bottom / distal;
// short: supply top / distal).
function opposingRoomPoints(firstZone, secondZone, entryPrice, isDemand) {
  // candEdge is the stop edge of the candidate zone.
  const candEdge = isDemand ? firstZone.bottom : firstZone.top;
  const riskPoints = Math.abs(entryPrice - candEdge);
  if (riskPoints <= 0) return { riskPoints, roomPoints: 0, rr: 0 };

  // The opposing zone's PROXIMAL edge on the candidate's side.
  const oppProximal = isDemand ? secondZone.bottom : secondZone.top;
  const roomPoints = isDemand
    ? Math.max(0, oppProximal - entryPrice)  // long: room up to supply proximal
    : Math.max(0, entryPrice - oppProximal); // short: room down to demand proximal

  const rr = roomPoints / riskPoints;
  return { riskPoints, roomPoints, rr: rr };
}

// Opposing-zone qualification with real 2R:
//   riskPoints  = abs(entry - candidate proximal edge)   (long: demand bottom;
//               short: supply top — the stop edge)
//   Long : roomPoints = nearestSupplyProximal - entry
//   Short: roomPoints = entry - nearestDemandProximal
//   availableRR = roomPoints / riskPoints;  require availableRR >= minRR (2)
// Rejects: overlapping zones, opposing zone on the wrong side of the candidate,
// non-positive risk, and non-positive room.  Never compares raw point gaps to 2.
function opposing2RQualified(zones, price, isDemand, opts) {
  opts = opts || {};
  const minRR = Number.isFinite(opts.minRR) ? opts.minRR : OPPOSE_RR;
  const entryZones = isDemand ? (zones.demand || []) : (zones.supply || []);
  const oppZones = isDemand ? (zones.supply || []) : (zones.demand || []);
  if (!entryZones.length || !oppZones.length || !(price > 0)) {
    return { qualified: false, room: 0, rr: 0, riskPoints: 0, reason: "no-zones" };
  }

  let best = null;
  for (const cz of entryZones) {
    const riskPoints = Math.abs(price - (isDemand ? cz.bottom : cz.top));
    if (!(riskPoints > 0)) continue; // invalid risk (entry on the stop edge)
    for (const oz of oppZones) {
      // Opposing zone must sit FULLY beyond the candidate on the trade side.
      // Long: supply bottom above the demand top.  Short: demand top below the
      // supply bottom.  Anything else is overlap or wrong-side → rejected.
      if (isDemand && !(oz.bottom > cz.top)) continue;
      if (!isDemand && !(oz.top < cz.bottom)) continue;
      const roomPoints = isDemand ? oz.bottom - price : price - oz.top;
      if (!(roomPoints > 0)) continue; // no structural room on this side
      const rr = roomPoints / riskPoints;
      if (!best || rr > best.rr) {
        best = {
          qualified: rr >= minRR,
          room: roomPoints,
          rr,
          riskPoints,
          entryZone: cz.id || null,
          opposingZone: oz.id || null,
        };
      }
    }
  }
  return best || { qualified: false, room: 0, rr: 0, riskPoints: 0, reason: "no-valid-pair" };
}

// Formation-candle exclusion: retest counted after the confirmed departure/bar
// index, not a fixed calendar-day delay.
function isRetest(bar, zone, barIndex, zoneIndex) {
  if (!bar || !zone) return false;
  const tb = new Date(bar.date).getTime();
  const tz = new Date(zone.created || bar.date).getTime();
  if (tb <= tz) return false;
  // If barIndex/zoneIndex are passed, compare those (LTF bar-index retest as well).
  if (Number.isFinite(barIndex) && Number.isFinite(zoneIndex)) {
    const di = barIndex - zoneIndex;
    return di >= 0;
  }
  return true; // no fixed margin; retest counted after confirmed departure
}

// ── Data freshness gate (hard rule) ─────────────────────────────────────────
// READY/TRIGGERED require PRODUCTION-FRESH.
//   - source type (live/market data, never yfinance auto = production)
//   - newest bar timestamp
//   - expected exchange/session clock
//   - maximum acceptable age
//   - whether the relevant timeframe candle is confirmed
// Stale/cached/offline/sample data MUST NOT produce READY/TRIGGERED.
function freshnessOf(source, latestBar, expectedSession, maxAgeMs, isConfirmed) {
  if (!source) return { mode: "unknown", reason: "no-source" };
  if (source === "live" || source === "market") {
    if (!isConfirmed) return { mode: "stale", reason: "candle-not-confirmed" };
    if (latestBar && latestBar.ts) {
      const age = Date.now() - latestBar.ts;
      if (age > maxAgeMs) return { mode: "stale", reason: "bar-stale" };
      return { mode: "production-fresh", reason: "ok" };
    }
    return { mode: "production-fresh", reason: "ok" };
  }
  if (source === "yfinance") return { mode: "stale", reason: "yfinance-not-production" };
  if (source === "cache" || source === "sample" || source === "offline") {
    return { mode: "stale", reason: "offline-sample" };
  }
  return { mode: "unknown", reason: "unknown-source" };
}

function isProductionFresh(freshness) {
  return freshness === true || freshness === "production-fresh" || freshness === "live";
}

function isRetestStrict(bar, zone) {
  return isRetest(bar, zone);
}

module.exports = {
  OPPOSE_RR,
  opposingRoomPoints,
  opposing2RQualified,
  isRetest,
  isRetestStrict,
  freshnessOf,
  isProductionFresh,
};
