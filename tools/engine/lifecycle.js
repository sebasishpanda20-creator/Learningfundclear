"use strict";

// ── Signal state machine ─────────────────────────────────────────────────────
// Per-signal lifecycle, persisted in signal_events (supabase/signal-events-migration.sql).
//
//   FAR                →  pending, not yet formed
//   WATCH              →  zone touched once (watchlist entry)
//   APPROACHING        →  price range approaching zone within 1 bar
//   AT_ZONE            →  candle range overlaps zone
//   CONFIRMATION_WAIT  →  touching, awaiting formation-timestamp confirmation
//   READY              →  formation confirmed, closed candle, production-fresh data, qualifying
//   TRIGGERED          →  entry bar closed, stop/target legible, production-fresh
//   TARGET_HIT         →  target reached (exit recorded)
//   SL_HIT             →  stop reached (exit recorded)
//   INVALIDATED        →  entry invalidated (e.g. zone dies, price closes through, or stale data)

const STATES = [
  "FAR", "WATCH", "APPROACHING", "AT_ZONE", "CONFIRMATION_WAIT",
  "READY", "TRIGGERED", "TARGET_HIT", "SL_HIT", "INVALIDATED",
];

// Valid transitions (machine semantics).  Anything not listed falls back to
// INVALIDATED (fail-closed: a transition we haven't modelled must not silently
// create a READY or TRIGGERED).
const TRANSITIONS = {
  FAR: [ "WATCH", "INVALIDATED" ],
  WATCH: [ "APPROACHING", "INVALIDATED" ],
  APPROACHING: [ "AT_ZONE", "INVALIDATED" ],
  AT_ZONE: [ "CONFIRMATION_WAIT", "INVALIDATED" ],
  CONFIRMATION_WAIT: [ "READY", "INVALIDATED" ],
  READY: [ "TRIGGERED", "INVALIDATED" ],
  TRIGGERED: [ "TARGET_HIT", "SL_HIT", "INVALIDATED" ],
  TARGET_HIT: [ "INVALIDATED" ],
  SL_HIT: [ "INVALIDATED" ],
  INVALIDATED: [ "FAR" ], // re-arm after invalidation (e.g. next session)
};

function isTerminal(state) {
  return state === "TARGET_HIT" || state === "SL_HIT" || state === "INVALIDATED";
}

// Guaranteed-entry guard: the FIRST transition into a terminal state must be
// via the machine.  This is what prevents stale/offline data from producing a
// READY or TRIGGERED: the state machine only advances with production-fresh
// markers, and the pipeline enforces that before calling advance().

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function advance(state, to) {
  if (!canTransition(state, to)) {
    throw new Error(`illegal transition ${state} -> ${to}; machine limits: ${TRANSITIONS[state] || "none"}`);
  }
  return to;
}

function transition(state, to) {
  if (!canTransition(state, to)) return state; // fail-closed: keep the last valid state
  return to;
}

// State labels + machine-observable flags for the digest / webhook payloads
function labelOf(state) {
  switch (state) {
    case "FAR": return "Far from zone";
    case "WATCH": return "Watching zone";
    case "APPROACHING": return "Approaching zone";
    case "AT_ZONE": return "At zone";
    case "CONFIRMATION_WAIT": return "Confirmation pending";
    case "READY": return "Ready";
    case "TRIGGERED": return "Triggered";
    case "TARGET_HIT": return "Target hit";
    case "SL_HIT": return "Stop hit";
    case "INVALIDATED": return "Invalidated";
    default: return state;
  }
}

function isSignalState(state) {
  return STATES.includes(state);
}

module.exports = {
  STATES,
  TRANSITIONS,
  isTerminal,
  canTransition,
  advance,
  transition,
  labelOf,
  isSignalState,
};
