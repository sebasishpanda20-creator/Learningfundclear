"use strict";

// ── GTF-Pro signal state machine + persistence ────────────────────────────────
// Per-signal lifecycle persisted in supabase/signal-events-migration.sql rows.
//   FAR                →  pending, not yet formed
//   WATCH              →  zone touched once (watchlist entry)
//   APPROACHING        →  price range approaching zone within 1 bar
//   AT_ZONE            →  candle range overlaps zone
//   CONFIRMATION_WAIT  →  touching, awaiting formation-timestamp confirmation
//   READY              →  formation confirmed, closed candle, production-fresh
//   TRIGGERED          →  entry bar closed, stop/target legible, production-fresh
//   TARGET_HIT         →  target reached (exit recorded)
//   SL_HIT             →  stop reached (exit recorded)
//   INVALIDATED        →  entry invalidated (zone dies / price closes through /
//                         stale data / failed 2R qualifier)

const life = require("./engine/lifecycle");

// Canonical state list — returned in order.
const STATES = life.STATES;
const TRANSITIONS = life.TRANSITIONS;
const canTransition = life.canTransition;
const advance = life.advance;
const transition = life.transition;
const labelOf = life.labelOf;
const isTerminal = life.isTerminal;
const isSignalState = life.isSignalState;

// ── Persistent signal record (one row in signal_events) ──────────────────────
// Fields stored for every GTF-Pro signal.  The same fields are duplicated for
// Legacy Pivot signals (signal_events is a union table).  `strategyVersion` +
// `symbol` + `scannerType` + `direction` + `zoneId` + `signalStatus` is the
// minimum dedup key set.
function makeSignalRecord(input) {
  const s = input || {};
  return {
    // Identity
    strategyVersion: s.strategyVersion || "1.0.0",
    symbol: s.symbol,
    scannerType: s.scannerType || "gtf-pro", // "legacy-pivot" | "gtf-pro"
    direction: s.action || null,
    zoneId: s.zoneId || null,

    // Scores (GTF-Pro)
    gtfScore: Number(s.gtfScore) || 0,
    contextScore: Number(s.contextScore) || 0,
    portalScore: Number(s.portalScore) || 0,
    gtfTag: s.gtfTag || null,
    contextTag: s.contextTag || null,
    portalTag: s.portalTag || null,

    // Zone
    tfId: s.tfId || null,
    tf: s.tf || null,
    price: Number(s.price) || 0,
    zoneBottom: Number(s.zoneBottom) || 0,
    zoneTop: Number(s.zoneTop) || 0,

    // Rulebook / context artifacts (secondary evidence only — NOT merged into GTF)
    trend: s.trend || null,
    structureEvent: s.structureEvent || null,
    fvg: s.fvg || null,
    rangeZone: s.rangeZone || null,
    rejectionWick: s.rejectionWick ? JSON.stringify(s.rejectionWick) : null,

    // Lifecycle state
    signalStatus: s.signalStatus || "FAR",
    state: s.state || life.STATES[0],

    // Timing / data
    barDate: s.barDate || null,
    barTS: s.barTS || null,
    source: s.source || "live",
    freshness: s.freshness || "unknown",
    rejectReason: s.rejectReason || null,
    createdAt: s.createdAt || new Date().toISOString(),
    updatedAt: s.updatedAt || new Date().toISOString(),

    // Precedence / dedupe
    priority: Number(s.priority) || 0,
    details: s.details || "",
  };
}

// Assert a transition is legal; return (prevState, newState).
function assertTransition(prev, next) {
  if (!canTransition(prev, next)) {
    throw new Error(`illegal GTF-Pro state transition ${prev} -> ${next}`);
  }
  return { prev, next };
}

// Apply a state transition, updating the record.  Returns the updated record.
function applyTransition(record, next) {
  const { prev, next: state } = assertTransition(record.state, next);
  record.state = state;
  record.updatedAt = new Date().toISOString();
  return record;
}

// Convenient aliases for the common terminal-state transitions.
function goReady(r) { return applyTransition(r, "READY"); }
function goTriggered(r) { return applyTransition(r, "TRIGGERED"); }
function goTargetHit(r) { return applyTransition(r, "TARGET_HIT"); }
function goSlHit(r) { return applyTransition(r, "SL_HIT"); }
function goInvalidated(r) { return applyTransition(r, "INVALIDATED"); }
function goFar(r) { return applyTransition(r, "FAR"); }

module.exports = {
  STATES,
  TRANSITIONS,
  canTransition,
  advance,
  transition,
  labelOf,
  isTerminal,
  isSignalState,
  makeSignalRecord,
  applyTransition,
  goReady,
  goTriggered,
  goTargetHit,
  goSlHit,
  goInvalidated,
  goFar,
};
