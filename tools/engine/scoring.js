"use strict";

// ── GTF-Pro scoring contract (corrected spec) ──────────────────────────────
// GTF score = freshness + departure + time-at-base, max 7 (pure).
//   - Freshness is ZONE freshness (0, 1.5 exact, 2), NOT market-data freshness.
//   - departure: exciting departure candles rule (2 or 1), not hardcoded 2.
//   - timeAtBase: 1-3 base = 2, 4-5 = 1, 5 = 0.
//   - Data freshness is a SEPARATE hard eligibility gate and NEVER contributes
//     points to GTF score.  It only gates whether READY/TRIGGERED may be set.
//
// Legacy Pivot (D/W/M daily/weekly/monthly) keeps its own independent scoring
// in scanner-logic.js (LfcScanner.confluenceScore).  GTF-Pro does NOT touch it.

const GTF_MAX = 7;
const CONTEXT_MAX = 6;
const PORTAL_MAX = 13;

// GTF freshness is "how recently the zone was confirmed", not source freshness.
// testCount 0 = 3, testCount 1 = 1.5 (NOT rounded), testCount 2 = 0.
// Returns an exact number (may be 1.5).
function freshnessOf(testCount) {
  const n = Number(testCount);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 3;
  if (n === 1) return 1.5;
  return 0;
}

// departure: strongest exciting departure candle count
//   2 exciting departure candles = 2
//   1 exciting = 1
//   else = 0
function departureOf(excitingCount) {
  const n = Number(excitingCount);
  if (!Number.isFinite(n)) return 0;
  if (n >= 2) return 2;
  if (n === 1) return 1;
  return 0;
}

// timeAtBase: how long price sat at the base before moving
//   1-3 base = 2
//   4-5 = 1
//   >5 = 0
//   negative / non-finite = 0
function timeAtBaseOf(baseCount) {
  const n = Number(baseCount);
  if (!Number.isFinite(n) || n < 1) return 0;
  if (n <= 3) return 2;
  if (n <= 5) return 1;
  return 0;
}

function gtfComponents(freshness, departure, timeAtBase) {
  const f = Math.max(0, Math.min(GTF_MAX, Number(freshness) || 0));
  const d = Math.max(0, Math.min(2, Number(departure) || 0));
  const t = Math.max(0, Math.min(2, Number(timeAtBase) || 0));
  return { freshness: f, departure: d, timeAtBase: t, raw: f + d + t };
}

function gtfScore(freshness, departure, timeAtBase) {
  const c = gtfComponents(freshness, departure, timeAtBase);
  return Math.min(GTF_MAX, c.raw);
}

// Context 0-6 (pure component separation) ---------------------------------
// Each CONFIRMED condition (strict boolean true) contributes exactly +1.
// SMC/FVG/BOS/CHoCH/PnF/RS are kept as secondary evidence (tagged strings)
// but MUST NOT silently contribute to GTF or Context scoring.
function contextScore(conditions) {
  const n = (conditions || []).filter((c) => c === true).length;
  return Math.min(CONTEXT_MAX, n);
}

// Portal 0-13 = min(13, GTF + Context).  Never merged into a single % heuristic.
function portalScore(gtf, context) {
  return Math.min(PORTAL_MAX, gtf + context);
}

function gtfTag(score) {
  if (score >= 6) return "A";
  if (score >= 4) return "B";
  if (score >= 2) return "C";
  return "D";
}
function contextTag(score) {
  if (score >= 4) return "A";
  if (score >= 2) return "B";
  return "C";
}
function portalTag(score) {
  if (score >= 10) return "A";
  if (score >= 7) return "B";
  return "C";
}

module.exports = {
  GTF_MAX,
  CONTEXT_MAX,
  PORTAL_MAX,
  freshnessOf,
  departureOf,
  timeAtBaseOf,
  gtfComponents,
  gtfScore,
  contextScore,
  portalScore,
  gtfTag,
  contextTag,
  portalTag,
};
