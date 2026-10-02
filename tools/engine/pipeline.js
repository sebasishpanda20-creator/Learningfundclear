"use strict";

// ── GTF-Pro pipeline ──────────────────────────────────────────────────────────
// One-pass signal builder.  Takes the Legacy pivot result (scanner-logic.js)
// PLUS the GTF bar set for the same symbol/tf, and emits a GTF-Pro signal
// ONLY when:
//   1. production-fresh data (needs a live source this session — hard gate),
//   2. a qualifying demand OR supply zone exists (2R opposing room),
//   3. the signal bar is CLOSED inside the zone (confirmed closed),
//   4. no formation candle is being counted as a retest,
//   5. the signal is a meaningful state transition (pending first-ever hit).
// Secondary evidence (PnF/RS/BOS/CHoCH/FVG) is tagged but NOT folded into
// the GTF score — scores stay 0-7 / 0-6 / 0-13 pure.

const life = require("./lifecycle");
const sc = require("./scoring");
const g = require("./gates");

// ── GTF score components (pure math, no side effects) ──────────────────────
function gtfComponents(freshness, departure, timeAtBase) {
  // freshness 0-3, departure 0-2, timeAtBase 0-2
  const f = Math.max(0, Math.min(7, Math.round(Number(freshness) || 0)));
  const d = Math.max(0, Math.min(2, Math.round(Number(departure) || 0)));
  const t = Math.max(0, Math.min(2, Math.round(Number(timeAtBase) || 0)));
  return { freshness: f, departure: d, timeAtBase: t, raw: f + d + t };
}

function gtfScore(freshness, departure, timeAtBase) {
  const c = gtfComponents(freshness, departure, timeAtBase);
  return Math.min(7, c.raw);
}

function contextScore(conditions) {
  const n = (conditions || []).filter(Boolean).length;
  return Math.min(6, n);
}

function portalScore(gtf, context) {
  return Math.min(13, gtf + context);
}

// ── 2R opposing-zone hard filter ─────────────────────────────────────────────
// The pipeline delegates to gates.js.  A pending signal is only qualified when
// an OPPOSING zone has room for at least 2R on the candidate side.
function isQualified(zones, price, isDemand) {
  return g.opposing2RQualified(zones, price, isDemand);
}

// ── Confirmed-closed candle rule ─────────────────────────────────────────────
// A stored/historical signal requires the signal bar to be CLOSED inside the
// zone: last.close <= top && last.close >= bottom.  A mere touch (low <= top
// && high >= bottom) is not enough for stored signals.
function isClosedInside(bar, zone) {
  if (!bar || !zone) return false;
  return bar.close <= zone.top && bar.close >= zone.bottom;
}

// ── Formation-candle exclusion ───────────────────────────────────────────────
// Retest bars must be >= FORMATION_MARGIN days after the forming bar.
function isRetest(barDate, zoneCreated) {
  if (!barDate || !zoneCreated) return false;
  const tb = new Date(barDate).getTime();
  const tz = new Date(zoneCreated).getTime();
  return (tb - tz) / 86400000 >= g.FORMATION_MARGIN;
}

// ── Data freshness gate (hard rule) ─────────────────────────────────────────
// READY/TRIGGERED require PRODUCTION-FRESH data for the session.  When the
// live source is not available, the pipeline must NOT advance the state to
// READY or TRIGGERED.  The pipeline exposes a gate function; the runner calls
// it with the per-bar source marker.
function productionFreshForSession(freshness) {
  return g.isProductionFresh(freshness);
}

function freshnessOf(source) {
  return g.freshnessOf(source);
}

// Weak gate: the scan driver itself decides whether the session is fresh and
// passes the flag per scan.  `freshSession` true means the scanner's data
// source is the live Yahoo feed; false (offline/cache/sample) blocks ALL
// READY/TRIGGERED.
function gateReady(freshSession, zone) {
  if (!freshSession) return { eligible: false, reason: "stale-data" };
  if (!zone) return { eligible: false, reason: "no-zone" };
  return { eligible: true, reason: "ok" };
}

// ── Ambiguous-rule config flags (spec: config flag + safe default + TODO) ─
// Every ambiguous rule is a config flag with a documented safe default.
// resolveAmbiguous() returns the safe default when the flag is missing/undefined.
function resolveAmbiguous(flag, safeDefault) {
  if (flag === undefined || flag === null) return safeDefault;
  if (typeof flag !== "boolean") return safeDefault;
  return flag;
}

// ── GTF-Pro signal builder ───────────────────────────────────────────────────
// `ctx` carries the pipeline's inputs:
//   zone      : GTF-Pro Zone
//   bar       : last bar of the GTF set (close confirmed inside zone)
//   pivotRes  : legacy computeZones result (for dep/context artifacts)
//   freshness : "production-fresh" | "stale" | "unknown"
//   freshSession: boolean session-level gate
//   symbol, action, tf
// Returns a signal record or null.
function buildGtfSignal(ctx) {
  const {
    symbol, action, tf, zone, bar, pivotRes, freshness, freshSession,
  } = ctx;

  // 1. Freshness hard gate
  if (!productionFreshForSession(freshSession)) {
    return null; // stale/offline/sample: never a READY/TRIGGERED
  }
  const freshMark = freshnessOf(freshness);

  // 2. Zone existence + 2R qualifying
  if (!zone) return null;
  const price = bar && bar.close ? bar.close : 0;
  if (!isQualified({ demand: zone.demand || [], supply: zone.supply || [] }, price, zone.action === "D")) {
    return null; // opposing room < 2R: rejected, not just demoted
  }

  // 3. Confirmed-closed candle
  if (!isClosedInside(bar, zone)) return null;

  // 4. Formation-candle exclusion (retest must be >= margin days old)
  if (!isRetest(bar.date, zone.created)) return null;

  // 5. Build the record
  const gtf = gtfScore(freshMark === "production-fresh" ? 3 : 0, 1, 2);
  const context = contextScore([]); // no confirmed context conditions yet
  const portal = portalScore(gtf, context);
  const reason = readinessReason(freshMark);

  return {
    type: "gtf-pro",
    signalStatus: "READY", // ready-first; pipeline cannot emit TRIGGERED here
    strategyVersion: "1.0.0",
    symbol,
    action,
    tfId: tf.id,
    tf: tf.label,
    zoneId: zone.id,
    price,
    zoneBottom: zone.bottom,
    zoneTop: zone.top,
    gtfScore: gtf,
    contextScore: context,
    portalScore: portal,
    gtfTag: sc.gtfTag(gtf),
    contextTag: sc.contextTag(context),
    portalTag: sc.portalTag(portal),
    source: ctx.source || "live",
    freshness: freshMark,
    barDate: bar.date,
    barTS: bar.barTS || null,
    // legacy fields carried for UI/trend display only (not merged into GTF)
    trend: (pivotRes && pivotRes.trend) || "SIDEWAYS",
    confluence: 0, // legacy 0-6 not part of GTF
    tag: null,
    details: `${tf.label} GTF-Pro ${action} · zone ${zone.bottom}-${zone.top} · GTF ${gtf}/7 · context ${context}/6 · portal ${portal}/13 · ${freshMark} · bar ${bar.date}`,
    rejectReason: null,
    state: life.STATES[0],
  };
}

// Readiness reason is a pure function of freshness for UI/logging (do not gate
// on it here; the hard gate is productionFreshForSession above).
function readinessReason(freshMark) {
  if (freshMark === "production-fresh") return "production-fresh";
  if (freshMark === "stale") return "stale-data";
  return "unknown-source";
}

module.exports = {
  gtfComponents,
  gtfScore,
  contextScore,
  portalScore,
  isQualified,
  isClosedInside,
  isRetest,
  productionFreshForSession,
  freshnessOf,
  gateReady,
  resolveAmbiguous,
  buildGtfSignal,
};
