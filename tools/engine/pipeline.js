"use strict";

// ── GTF-Pro pipeline ──────────────────────────────────────────────────────────
// One-pass signal builder.  Takes the Legacy pivot result (scanner-logic.js)
// PLUS the GTF bar set for the same symbol/tf, and emits a GTF-Pro signal
// ONLY when:
//   1. production-fresh data (hard gate: source type, bar ts, session clock,
//      max age, confirmed candle) — never yfinance auto-fresh
//   2. a qualifying demand OR supply zone exists (real 2R opposing room)
//   3. the signal bar is CLOSED inside the zone (confirmed closed)
//   4. no formation candle is being counted as a retest
//   5. the signal is a meaningful state transition (pending first-ever hit)
//
// GTF scoring: freshness = ZONE freshness (0 / 1.5 / 2), departure =
// exciting-departure rule, time-at-base (1-3/4-5/5+).  Freshness is NEVER
// added as a point; data freshness is a separate eligibility gate only.
// Secondary evidence (PnF/RS/BOS/CHoCH/FVG) is tagged but NOT folded into the
// GTF score — scores stay 0-7 / 0-6 / 0-13 pure.

const life = require("./lifecycle");
const sc = require("./scoring");
const g = require("./gates");

// ── GTF score components (pure math, no side effects) ──────────────────────
function gtfComponents(freshness, departure, timeAtBase) {
  const f = Math.max(0, Math.min(sc.GTF_MAX, Number(freshness) || 0));
  const d = Math.max(0, Math.min(2, Number(departure) || 0));
  const t = Math.max(0, Math.min(2, Number(timeAtBase) || 0));
  return { freshness: f, departure: d, timeAtBase: t, raw: f + d + t };
}

function gtfScore(freshness, departure, timeAtBase) {
  const c = gtfComponents(freshness, departure, timeAtBase);
  return Math.min(sc.GTF_MAX, c.raw);
}

function contextScore(conditions) {
  // Only strict boolean true = a confirmed condition.  Tagged secondary
  // evidence (strings) never counts.
  return Math.min(sc.CONTEXT_MAX, (conditions || []).filter((c) => c === true).length);
}

function portalScore(gtf, context) {
  return Math.min(sc.PORTAL_MAX, gtf + context);
}

// ── 2R opposing-zone hard filter (engine/gates.js) ─────────────────────────
function isQualified(zones, price, isDemand) {
  return g.opposing2RQualified(zones, price, isDemand);
}

// ── Confirmed-closed candle rule ─────────────────────────────────────────────
function isClosedInside(bar, zone) {
  if (!bar || !zone) return false;
  return bar.close <= zone.top && bar.close >= zone.bottom;
}

// ── Data freshness hard gate ─────────────────────────────────────────────────
function productionFreshForSession(freshness) {
  return g.isProductionFresh(freshness);
}

// Session-level gate: stale/offline/sample/yfinance data blocks ALL READY/TRIGGERED.
function gateReady(freshSession, zone) {
  if (!freshSession) return { eligible: false, reason: "stale-data" };
  if (!zone) return { eligible: false, reason: "no-zone" };
  return { eligible: true, reason: "ok" };
}

// Retest helper: compare bar vs zone-formation bar index.
function isRetest(bar, zone) {
  if (!bar || !zone) return false;
  const tb = new Date(bar.date).getTime();
  const tz = new Date(zone.created || bar.date).getTime();
  if (tb <= tz) return false;
  return true;
}
// ── GTF-Pro signal builder ───────────────────────────────────────────────
// ctx:
//   symbol, action, tf {id,label}, zone (candidate Zone record),
//   zones {demand:[...], supply:[...]} for the 2R gate,
//   bar (CLOSED candle attempting entry), pivotRes (legacy context, tagged only),
//   freshSession (boolean — data-freshness hard-gate outcome),
//   dataFreshness (string — gate detail, stored, NEVER scored),
//   departure (0|1|2 from the exciting-departure rule),
//   timeAtBase (0|1|2 from the base-count rule),
//   contextConditions (array of confirmed booleans → Context 0-6).
function buildGtfSignal(ctx) {
  const {
    symbol, action, tf, zone, zones, bar, pivotRes, freshSession,
    dataFreshness, departure, timeAtBase, contextConditions,
  } = ctx;

  // 1. Data freshness — SEPARATE hard eligibility gate.  Stale / cache /
  //    sample / yfinance data never produces READY/TRIGGERED and never adds
  //    points to the GTF score.
  if (!productionFreshForSession(freshSession)) return null;

  // 2. Zone existence + real 2R opposing-room qualification.
  if (!zone || !bar) return null;
  const price = Number(bar.close);
  if (!(price > 0)) return null;
  const bothLists = zones || (zone.action === "D"
    ? { demand: [zone], supply: [] }
    : { demand: [], supply: [zone] });
  const qual = isQualified(bothLists, price, zone.action === "D");
  if (!qual || !qual.qualified) return null;

  // 3. Closed-candle anti-repaint: the entry bar must CLOSE inside the zone.
  if (!isClosedInside(bar, zone)) return null;

  // 4. Retest counted only AFTER the confirmed departure / zone-creation
  //    timestamp — no fixed calendar-day margin.
  if (!isRetest(bar, zone)) return null;

  // 5. GTF score = ZONE freshness (retest count: 3 / 1.5 / 0, unrounded)
  //    + departure (exciting rule) + time-at-base.  Data freshness NEVER adds.
  const zoneFreshness = sc.freshnessOf(Array.isArray(zone.retests) ? zone.retests.length : 0);
  const dep = Number.isFinite(departure) ? Number(departure) : 0;
  const tab = Number.isFinite(timeAtBase) ? Number(timeAtBase) : 0;
  const gtf = gtfScore(zoneFreshness, dep, tab);
  const context = contextScore(contextConditions || []);
  const portal = portalScore(gtf, context);

  return {
    type: "gtf-pro",
    signalStatus: "READY",
    strategyVersion: "1.0.0",
    symbol,
    action,
    tfId: tf && tf.id,
    tf: tf && tf.label,
    zoneId: zone.id,
    pattern: zone.pattern || null,
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
    freshness: zoneFreshness,
    dataFreshness: dataFreshness || "production-fresh",
    barDate: bar.date,
    barTS: bar.barTS || null,
    trend: (pivotRes && pivotRes.trend) || "SIDEWAYS",
    confluence: 0,
    tag: null,
    details: `${tf && tf.label} GTF-Pro ${action} · zone ${zone.bottom}-${zone.top} · GTF ${gtf}/7 · context ${context}/6 · portal ${portal}/13 · bar ${bar.date}`,
    rejectReason: null,
    state: life.STATES[0],
  };
}

// Re-export helpers the scanner/backtest use.
function freshnessOf(source, latestBar, expectedSession, maxAgeMs, isConfirmed) {
  return g.freshnessOf(source, latestBar, expectedSession, maxAgeMs, isConfirmed);
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
  gateReady,
  buildGtfSignal,
  freshnessOf,
};
