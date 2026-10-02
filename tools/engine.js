"use strict";

// ── GTF-Pro engine façade ─────────────────────────────────────────────────────
// Single entry point for the scanner and the backtest.  All GTF-Pro logic lives
// here; Legacy Pivot remains in scanner-logic.js (LfcScanner) and is NOT
// imported by this module, keeping the two methodologies completely separate.
//
// Exports (all CommonJS):
//   - candle.js      : nseSessionDay, istDayFromUtc, makeCandle, findRetests
//   - zone.js        : Zone, INTRADAILY, SWING, anchorToSession, groupBySessionDay, zonesToGtf
//   - stack.js       : INTRADAILY, SWING, resolveStack, anchorToSession, groupBySessionDay, stackBars
//   - pipeline.js    : gtfScore, contextScore, portalScore, isQualified, isClosedInside,
//                      isRetest, productionFreshForSession, freshnessOf, gateReady,
//                      resolveAmbiguous, buildGtfSignal
//   - state.js       : STATE, TRANSITIONS, canTransition, advance, transition, labelOf
//   - gates.js       : OPPOSE_RR, opposingRoom, opposing2RQualified, FORMATION_MARGIN,
//                      isRetest, freshnessOf, isProductionFresh, productionFreshForSession,
//                      resolveAmbiguous
//   - scoring.js     : GTF_MAX, CONTEXT_MAX, PORTAL_MAX, gtfComponents, gtfScore,
//                      contextScore, portalScore, gtfTag, contextTag, portalTag

const candle = require("./engine/candle");
const zone = require("./engine/zone");
const stack = require("./engine/stack");
const pipeline = require("./engine/pipeline");
const life = require("./engine/lifecycle");
const gates = require("./engine/gates");
const sc = require("./engine/scoring");

module.exports = {
  candle,
  zone,
  stack,
  pipeline,
  state: life,
  gates,
  scoring: sc,
};
