"use strict";

// ── GTF-Pro candle module ──────────────────────────────────────────────────────
// Aggregation/session-anchoring helpers shared by the pipeline and the backtest.
// The LEGACY engine (scanner-logic.js LfcScanner.computeZones) is a pure
// function of bars and is NOT touched by this module.

// ── Formation-candle exclusion ───────────────────────────────────────────────
// A retest bar must be at least FORMATION_MARGIN days after the bar that
// formed the zone.  GTF-Pro never scores a bar that is still forming the zone;
// that bar is part of the setup, not the retest.
const FORMATION_MARGIN = 2; // days

// ── Day helpers ───────────────────────────────────────────────────────────────
// IST (Asia/Kolkata, +5:30) is the NSE session anchor.  GTF-Pro stores all
// bars with UTC date *but* attributes an NSE day to the 09:15 IST window, so
// both 09:15-aligned session days and plain UTC days exist.  The scanner uses
// UTC days for Yahoo data; the pipeline uses IST windows for signal dates and
// formation/retest diffs so a 23:00 UTC bar and a 01:00 UTC bar on the same
// NYSE day do not drift apart.

function istDayFromUtc(utcDate) {
  // utcDate: Date | string (UTC).  Return the IST calendar day the 09:15 IST
  // session of that UTC instant belongs to.
  const ms = typeof utcDate === "string" ? Date.parse(utcDate) : utcDate.getTime();
  const utc = new Date(ms);
  const ist = utc.getTime() + 5.5 * 3600 * 1000;
  const d = new Date(ist);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A signal bar's NSE session day is where its EOD date falls in the morning
// IST window (09:15 IST).  This keeps a bar that closes after 02:00 UTC but
// before 09:15 IST as part of the prior local session.
function nseSessionDay(bar) {
  // bar.date is "YYYY-MM-DD" (UTC).  09:15 IST = 03:45 UTC.  If the bar's UTC
  // date's 03:45 UTC is still before 09:15 IST on that date, it is the prior
  // IST day.
  const utcDate = new Date(bar.date + "T00:00:00Z");
  const ist = new Date(utcDate.getTime() + 5.5 * 3600 * 1000);
  // Add 9h15m to get to 09:15 IST
  const toSession = new Date(ist.getTime() + 9 * 3600 * 1000 + 15 * 60 * 1000);
  return `${toSession.getFullYear()}-${String(toSession.getMonth() + 1).padStart(2, "0")}-${String(toSession.getDate()).padStart(2, "0")}`;
}

// ── Candle building (per signal bar, used by pipeline) ──────────────────────
// Returns a normalized candle record with both UTC and NSE session-day keys.
function makeCandle(bar) {
  return {
    date: bar.date, // "YYYY-MM-DD" UTC
    nseSessionDay: nseSessionDay(bar),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume || 0,
    barTS: bar.barTS || null,
  };
}

// Identify the LTF retest window: the LTF bars that landed INSIDE the GTF
// zone AFTER the GTF formation bar.  Pass both stores as arrays of candle
// records plus the GTF zone record.
function findRetests(gtfZone, ltfBars) {
  if (!gtfZone || !ltfBars) return [];
  const { bottom, top, created } = gtfZone;
  const formed = new Date(created || "1970-01-01").getTime();
  const retests = [];
  for (const b of ltfBars) {
    if (b.low <= top && b.high >= bottom) {
      // Exclude the formation bar itself and bars still within the formation
      // window (different days can have the same date string in tests).
      const tz = new Date(gtfZone.created || b.date).getTime();
      const tb = new Date(b.date).getTime();
      if (Math.abs(tb - tz) <= FORMATION_MARGIN * 86400000) continue;
      // A retest bar must actually be after formation, not just same-day stale
      if (tb <= tz) continue;
      retests.push(b);
    }
  }
  return retests;
}

module.exports = {
  FORMATION_MARGIN,
  istDayFromUtc,
  nseSessionDay,
  makeCandle,
  findRetests,
};
