"use strict";

// ── GTF-Pro engine façade ─────────────────────────────────────────────────────
// Single entry point for the scanner and the backtest.  All GTF-Pro logic lives
// here; Legacy Pivot remains in scanner-logic.js (LfcScanner) and is NOT
// imported by this module, keeping the two methodologies completely separate.
//
// Exports (all CommonJS):
//   - candle.js      : nseSessionDay, istDayFromUtc, makeCandle, findRetests
//   - zone.js        : Zone, isBaseCandle, isExcitingCandle, candleType, detectReverseStructure, findStructurePoints, buildGtfZones, anchorToSession, groupBySessionDay, stackBars, resolveStack, STACK_TIMEFRAMES, nseHour
//   - stack.js       : INTRADAILY, SWING, resolveStack, anchorToSession, groupBySessionDay, stackBars, nseHour
//   - pipeline.js    : gtfComponents, gtfScore, contextScore, portalScore, isQualified, isClosedInside, isRetest, productionFreshForSession, gateReady, resolveAmbiguous, buildGtfSignal, freshnessOf
//   - lifecycle.js   : STATES, TRANSITIONS, canTransition, advance, transition, labelOf, isTerminal, isSignalState
//   - gates.js       : OPPOSE_RR, opposingRoomPoints, opposing2RQualified, isRetest, freshnessOf, isProductionFresh, productionFreshForSession, resolveAmbiguous
//   - scoring.js     : GTF_MAX, CONTEXT_MAX, PORTAL_MAX, freshnessOf, departureOf, timeAtBaseOf, gtfComponents, gtfScore, contextScore, portalScore, gtfTag, contextTag, portalTag

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
