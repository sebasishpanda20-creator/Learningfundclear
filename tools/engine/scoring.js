"use strict";

// ── GTF-Pro scoring contract (spec C7 / Context / Portal) ───────────────────
// GTF score       = freshness + departure + time-at-base, max 7 (pure/pure).
// Context score   = 0–6 (book context from the rulebook: FVG, BOS/CHoCH,
//                   premium/discount, orderblocks, liquidity, session timing).
// Portal score    = min(13, GTF + Context).  Never merge into a single
//                   "accuracy" or % heuristic.
//
// The Legacy Pivot engine keeps its own independent 0–6 confluence metric
// (scanner-logic.js LfcScanner.confluenceScore).  GTF-Pro does NOT touch it:
// the two scoring systems are kept completely separate.

const GTF_MAX = 7;
const CONTEXT_MAX = 6;
const PORTAL_MAX = 13;

// Core GTF components ----------------------------------------------------------
// freshness    0–3   : how recently the source closed a signal bar, weighted
//                       by bar count. Live production data = 3; stale/offline
//                       sample data = 0 or the freshnessOf() value.
// departure    0–2   : strength of the zone-forming departure candle(s):
//                       0 = no clear departure, 1 = moderate, 2 = decisive.
// timeAtBase   0–2   : time-at-base (how long price sat at the zone before
//                       moving) : 0 = immediate move, 1 = 1–3 bars, 2 = >=3 bars.
function gtfComponents(freshness, departure, timeAtBase) {
  const f = Math.max(0, Math.min(GTF_MAX, Math.round(Number(freshness) || 0)));
  const d = Math.max(0, Math.min(2, Math.round(Number(departure) || 0)));
  const t = Math.max(0, Math.min(2, Math.round(Number(timeAtBase) || 0)));
  return { freshness: f, departure: d, timeAtBase: t, raw: f + d + t };
}

function gtfScore(freshness, departure, timeAtBase) {
  const c = gtfComponents(freshness, departure, timeAtBase);
  return Math.min(GTF_MAX, c.raw);
}

// Context 0–6 ------------------------------------------------------------------
// Count confirmed context conditions; the max is capped at 6 so a single bar
// cannot score more than the context scale allows.
function contextScore(conditions) {
  // conditions: array of confirmed context markers (each true/false).
  const n = (conditions || []).filter(Boolean).length;
  return Math.min(CONTEXT_MAX, n);
}

// Portal 0–13 ------------------------------------------------------------------
// Portal = min(13, GTF + Context).  Do NOT merge into one accuracy/%
// heuristic and do NOT label either as a probability.
function portalScore(gtf, context) {
  return Math.min(PORTAL_MAX, gtf + context);
}

// ── Tagging / labelling (pure scoring, no probability wording) ──────────────
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
  gtfComponents,
  gtfScore,
  contextScore,
  portalScore,
  gtfTag,
  contextTag,
  portalTag,
};
