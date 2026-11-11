#!/usr/bin/env node
/*!
 * LearningFundClear — direct unit tests for the GTF-Pro engine.
 *
 * Loads the real engine modules (CommonJS) and exercises: the four GTF
 * patterns (DBR/RBR/RBD/DBD), base/exciting classification, base-count rules
 * (1-3 / 4-5 / >5), multi-base proximal/distal construction, zone freshness
 * (3 / 1.5 / 0 — 1.5 exact, never rounded), departure scoring, context-score
 * separation, portal cap, the real opposing-zone 2R gate (exact 2R boundary,
 * <2R, overlap, wrong-side), retest-after-departure (no fixed day margin),
 * the production-data freshness gate, TRUE session-anchored 75m/15m/5m/125m
 * aggregation, incomplete-candle exclusion, buildGtfSignal end-to-end,
 * Legacy Pivot isolation, and the state machine.
 *
 * Legacy Pivot stays production; GTF-Pro is shadow-only.  Offline — no network.
 *
 * Run:  node tools/test-gtf-pro.js    (exit 0 = pass, 1 = any failure)
 */
"use strict";

const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const candle = require(path.join(ROOT, "tools/engine/candle"));
const zone = require(path.join(ROOT, "tools/engine/zone"));
const stack = require(path.join(ROOT, "tools/engine/stack"));
const pipeline = require(path.join(ROOT, "tools/engine/pipeline"));
const life = require(path.join(ROOT, "tools/engine/lifecycle"));
const gates = require(path.join(ROOT, "tools/engine/gates"));
const sc = require(path.join(ROOT, "tools/engine/scoring"));

const { buildGtfZones, isBaseCandle, isExcitingCandle, findStructurePoints, Zone } = zone;
const { resolveStack, stackBars, aggregateIntraday, INTRADAILY, SWING } = stack;
const { gtfScore, freshnessOf, departureOf, timeAtBaseOf, contextScore, portalScore } = sc;
const { opposingRoomPoints, opposing2RQualified, isRetest, isProductionFresh } = gates;

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.error("  FAIL  " + name + (extra ? " — " + extra : "")); }
}
function approx(a, b) { return Math.abs(a - b) < 1e-9; }
function B(o, h, l, c) { return { open: o, high: h, low: l, close: c, volume: 1 }; }
function BD(o, h, l, c, date) { return { open: o, high: h, low: l, close: c, volume: 1, date }; }
function pad2(n) { return String(n).padStart(2, "0"); }

// ── 1. GTF patterns: DBR / RBR / RBD / DBD ──────────────────────────────────
{
  console.log("\n1. GTF pattern detection (DBR/RBR/RBD/DBD)");
  const legDown = B(110, 112, 100, 101);   // exciting DOWN (bp 0.75)
  const legUp = B(95, 100, 94, 99);        // exciting UP   (bp 0.83)
  const base = B(101, 103, 100.5, 102);    // base          (bp 0.40)
  const base2 = B(99, 101, 98, 100);       // base          (bp 0.33)
  const outUp = B(102, 106, 101, 105);     // exciting UP, closes above base high 103
  const outDown = B(100, 100.5, 95, 96);   // exciting DOWN, closes below base low 98

  const dbr = findStructurePoints([legDown, base, outUp]);
  check("DBR (drop-base-rally, demand)", dbr.length === 1 && dbr[0].type === "DBR", JSON.stringify(dbr));

  const rbr = findStructurePoints([legUp, base, outUp]);
  check("RBR (rally-base-rally, demand)", rbr.length === 1 && rbr[0].type === "RBR", JSON.stringify(rbr));

  const rbd = findStructurePoints([legUp, base2, outDown]);
  check("RBD (rally-base-drop, supply)", rbd.length === 1 && rbd[0].type === "RBD", JSON.stringify(rbd));

  const dbd = findStructurePoints([legDown, base2, outDown]);
  check("DBD (drop-base-drop, supply)", dbd.length === 1 && dbd[0].type === "DBD", JSON.stringify(dbd));

  // Wick-only leg-out (close stays inside the base) must NOT confirm a zone.
  const wickOut = B(100, 104, 95, 99); // wicks beyond, closes at 99 (inside 98..101)
  check("wick-through without close = no pattern",
    findStructurePoints([legUp, base2, wickOut]).length === 0);

  check("no exciting leg-in → no pattern",
    findStructurePoints([B(100, 101, 99, 100.4), base, outUp]).length === 0);
  check("< 3 bars → no pattern", findStructurePoints([legDown, base]).length === 0);
}

// ── 2. Base / exciting classification ───────────────────────────────────────
{
  console.log("\n2. Base & exciting candle classification");
  check("small body = base", isBaseCandle(B(100, 101, 99, 100.5)));
  check("large-range small-body = base", isBaseCandle(B(100, 200, 40, 105)));
  check("strong body = exciting", isExcitingCandle(B(100, 140, 70, 145)));
  check("exactly 50% body = neutral (neither)", isBaseCandle(B(100, 107.5, 97.5, 105)) === false && isExcitingCandle(B(100, 107.5, 97.5, 105)) === false);
  check("zero-range doji: base yes / exciting no", isBaseCandle(B(100, 100, 100, 100)) === true && isExcitingCandle(B(100, 100, 100, 100)) === false);
}

// ── 3. Base-count rules (1-3 / 4-5 / >5) ────────────────────────────────────
{
  console.log("\n3. Base-count rules");
  check("1 base → 2", timeAtBaseOf(1) === 2);
  check("3 base → 2", timeAtBaseOf(3) === 2);
  check("4 base → 1", timeAtBaseOf(4) === 1);
  check("5 base → 1", timeAtBaseOf(5) === 1);
  check("6 base → 0", timeAtBaseOf(6) === 0);
  check("negative → 0", timeAtBaseOf(-1) === 0);
}

// ── 4. Multi-base proximal/distal + >5 rejection ────────────────────────────
{
  console.log("\n4. Zone construction (proximal/distal, base runs)");
  // 2-base demand run: proximal = MAX(max(open,close)) = 102; distal = MIN(low) = 100.2
  const twoBase = [
    B(110, 112, 100, 101),        // exciting down leg-in
    B(101, 102.8, 100.5, 101.5),  // base 1
    B(101.5, 102.6, 100.2, 102),  // base 2
    B(102, 106, 101, 105),        // exciting leg-out, closes above 102.8
  ];
  const dz = buildGtfZones(twoBase, "T", "75m");
  check("2-base DBR zone built", dz.length === 1 && dz[0].action === "D", JSON.stringify(dz));
  check("demand proximal (top) = 102", dz.length === 1 && approx(dz[0].top, 102), String(dz.length && dz[0].top));
  check("demand distal (bottom) = 100.2", dz.length === 1 && approx(dz[0].bottom, 100.2), String(dz.length && dz[0].bottom));
  check("baseCount recorded = 2", dz.length === 1 && dz[0].baseCount === 2);

  // Supply zone from a 1-base RBD: proximal = MIN(min(open,close)) = 99; distal = MAX(high) = 101
  const rbdBars = [B(95, 100, 94, 99), B(99, 101, 98, 100), B(100, 100.5, 95, 96)];
  const sz = buildGtfZones(rbdBars, "T", "75m");
  check("RBD supply zone built", sz.length === 1 && sz[0].action === "S", JSON.stringify(sz));
  check("supply proximal (bottom) = 99", sz.length === 1 && approx(sz[0].bottom, 99), String(sz.length && sz[0].bottom));
  check("supply distal (top) = 101", sz.length === 1 && approx(sz[0].top, 101), String(sz.length && sz[0].top));

  // >5 base candles = noise → zone rejected
  const noise = [B(110, 112, 100, 101)];
  for (let i = 0; i < 6; i++) noise.push(B(101, 102.6, 100.5, 102));
  noise.push(B(102, 106, 101, 105));
  check("6-base run → zone rejected", buildGtfZones(noise, "T", "75m").length === 0);
}

// ── 5. Zone freshness 3 / 1.5 / 0 (1.5 exact, unrounded) ────────────────────
{
  console.log("\n5. Zone freshness scoring");
  check("testCount 0 → 3", freshnessOf(0) === 3);
  check("testCount 1 → 1.5 (exact)", freshnessOf(1) === 1.5);
  check("1.5 preserved exactly (not rounded)", freshnessOf(1) === 1.5 && freshnessOf(1) !== 2);
  check("testCount 2 → 0", freshnessOf(2) === 0);
  check("testCount 3 → 0", freshnessOf(3) === 0);
  check("non-finite → 0", freshnessOf(NaN) === 0);
  check("gtfScore(1.5, 1, 2) = 4.5", gtfScore(1.5, 1, 2) === 4.5);
  check("gtfScore(3, 1, 2) = 6", gtfScore(3, 1, 2) === 6);
  check("gtfScore(0, 2, 0) = 2", gtfScore(0, 2, 0) === 2);
  check("all zeros = 0", gtfScore(0, 0, 0) === 0);
}

// ── 6. Departure scoring ────────────────────────────────────────────────────
{
  console.log("\n6. Departure scoring");
  check("2 exciting departure candles → 2", departureOf(2) === 2);
  check("1 exciting → 1", departureOf(1) === 1);
  check("0 exciting → 0", departureOf(0) === 0);
  check("3 exciting → 2 (capped)", departureOf(3) === 2);
  check("negative → 0", departureOf(-1) === 0);
}

// ── 7. Context / portal separation ──────────────────────────────────────────
{
  console.log("\n7. Context & portal scores");
  check("context 0 conditions → 0", contextScore([]) === 0);
  check("context 6 confirmed → 6 (cap)", contextScore([true, true, true, true, true, true, true]) === 6);
  check("secondary tags (strings) not counted", contextScore([true, "PnF", "FVG", "BOS"]) === 1);
  check("portal 7+6 = 13 (cap)", portalScore(7, 6) === 13);
  check("portal 5+5 = 10", portalScore(5, 5) === 10);
}

// ── 8. Opposing-zone 2R gate ────────────────────────────────────────────────
{
  console.log("\n8. Opposing-zone 2R (real risk/room)");
  // Long: entry 100, demand {97..100} → stop edge 97 (risk 3); supply {110..115}
  // → proximal room = 110 - 100 = 10; RR = 10/3 ≈ 3.33.
  const long = opposingRoomPoints({ id: "d1", bottom: 97, top: 100 }, { id: "s1", bottom: 110, top: 115 }, 100, true);
  check("long risk = 3", long.riskPoints === 3, String(long.riskPoints));
  check("long room = 10", long.roomPoints === 10, String(long.roomPoints));
  check("long RR = 10/3", approx(long.rr, 10 / 3), String(long.rr));

  // Short: entry 100, supply {97..103} → stop edge 103 (risk 3); demand {80..90}
  // → room = 100 - 90 = 10; RR = 10/3.
  const short = opposingRoomPoints({ id: "s1", bottom: 97, top: 103 }, { id: "d1", bottom: 80, top: 90 }, 100, false);
  check("short risk = 3", short.riskPoints === 3, String(short.riskPoints));
  check("short room = 10", short.roomPoints === 10, String(short.roomPoints));

  // Exact 2.0 boundary passes: supply proximal 106 → room 6, risk 3 → RR 2.
  const exact = opposing2RQualified({ demand: [{ id: "d1", bottom: 97, top: 100 }], supply: [{ id: "s1", bottom: 106, top: 109 }] }, 100, true);
  check("RR exactly 2.0 → qualified", exact.qualified === true && approx(exact.rr, 2), JSON.stringify(exact));

  // Just under 2R fails: supply proximal 105 → room 5 → RR 5/3.
  const under = opposing2RQualified({ demand: [{ id: "d1", bottom: 97, top: 100 }], supply: [{ id: "s1", bottom: 105, top: 108 }] }, 100, true);
  check("RR 5/3 < 2 → rejected", under.qualified === false, JSON.stringify(under));

  // Overlapping opposing zone rejected.
  const overlap = opposing2RQualified({ demand: [{ id: "d1", bottom: 97, top: 100 }], supply: [{ id: "s1", bottom: 95, top: 105 }] }, 100, true);
  check("overlap → rejected", overlap.qualified === false);

  // Opposing zone on the wrong side rejected (supply below the demand zone).
  const wrong = opposing2RQualified({ demand: [{ id: "d1", bottom: 97, top: 100 }], supply: [{ id: "s1", bottom: 80, top: 90 }] }, 100, true);
  check("wrong-side opposing zone → rejected", wrong.qualified === false);

  // Healthy long pair qualifies via the gate (room 10 / risk 3).
  const healthy = opposing2RQualified({ demand: [{ id: "d1", bottom: 97, top: 100 }], supply: [{ id: "s1", bottom: 110, top: 115 }] }, 100, true);
  check("healthy long pair → qualified (RR 10/3)", healthy.qualified === true && approx(healthy.rr, 10 / 3), JSON.stringify(healthy));
}

// ── 9. Retest after confirmed departure (no fixed day margin) ───────────────
{
  console.log("\n9. Retest handling");
  const z = { bottom: 97, top: 100, created: "2026-10-01" };
  check("bar after zone created = retest", isRetest({ date: "2026-10-02" }, z) === true);
  check("bar before zone created = not retest", isRetest({ date: "2026-09-30" }, z) === false);
  check("same timestamp = not retest", isRetest({ date: "2026-10-01" }, z) === false);
  // Same-day intrabar retest (minute labels) is valid.
  const zi = { bottom: 97, top: 100, created: "2026-10-01 10:30" };
  check("same-day later-bar retest valid", isRetest({ date: "2026-10-01 14:20" }, zi) === true);
  // Bar-index based eligibility (backtest path).
  check("index after departure = retest", isRetest({ date: "2026-10-02" }, z, 5, 3) === true);
  check("index before departure = not retest", isRetest({ date: "2026-10-02" }, z, 2, 3) === false);
}

// ── 10. Production-data freshness gate ──────────────────────────────────────
{
  console.log("\n10. Data freshness hard gate");
  const fresh = gates.freshnessOf("live", { ts: Date.now() - 1000 }, null, 10000, true);
  check("live + confirmed + fresh ts = production-fresh", fresh.mode === "production-fresh", JSON.stringify(fresh));
  check("yfinance never production-fresh", gates.freshnessOf("yfinance", { ts: Date.now() }, null, 10000, true).mode === "stale");
  check("cache blocked", gates.freshnessOf("cache", { ts: Date.now() }, null, 10000, true).mode === "stale");
  check("sample blocked", gates.freshnessOf("sample", { ts: Date.now() }, null, 10000, true).mode === "stale");
  check("offline blocked", gates.freshnessOf("offline", { ts: Date.now() }, null, 10000, true).mode === "stale");
  check("stale bar blocked", gates.freshnessOf("live", { ts: Date.now() - 86400000 * 3 }, null, 7200000, true).mode === "stale");
  check("unconfirmed candle blocked", gates.freshnessOf("live", { ts: Date.now() }, null, 10000, false).mode === "stale");
  check("isProductionFresh true only for fresh", isProductionFresh("production-fresh") === true && isProductionFresh("stale") === false);
}

// ── 11. TRUE session-anchored aggregation (75m/15m/5m/125m) ──────────────────
{
  console.log("\n11. Session-aligned aggregation");
  // 2 days × 60 five-minute bars from 09:15 (09:15–14:15), IST-labelled.
  const raw = [];
  const days = ["2026-10-01", "2026-10-02"];
  for (let d = 0; d < 2; d++) {
    for (let i = 0; i < 60; i++) {
      const mins = 555 + i * 5;
      const label = days[d] + " " + pad2(Math.floor(mins / 60)) + ":" + pad2(mins % 60);
      const o = 100 + d * 1000 + i;
      raw.push(BD(o, o + 0.5, o - 0.5, o + 0.2, label));
    }
  }
  const s5 = stackBars(raw, "5m");
  const s15 = stackBars(raw, "15m");
  const s75 = stackBars(raw, "75m");
  const s125 = stackBars(raw, "125m");
  check("5m → 120 bricks", s5.length === 120, String(s5.length));
  check("15m → 40 bricks (20/day)", s15.length === 40, String(s15.length));
  check("75m → 8 bricks (4/day)", s75.length === 8, String(s75.length));
  check("125m → 6 bricks (3/day)", s125.length === 6, String(s125.length));

  // First 75m brick = bars i 0..14 → open 100, close 114.2, high 114.5, low 99.5, vol 15.
  const b0 = s75[0];
  check("75m brick open = 100", b0 && b0.open === 100, JSON.stringify(b0));
  check("75m brick close = 114.2", b0 && approx(b0.close, 114.2), JSON.stringify(b0));
  check("75m brick high = 114.5 / low = 99.5", b0 && approx(b0.high, 114.5) && approx(b0.low, 99.5), JSON.stringify(b0));
  check("75m brick volume = 15 (summed)", b0 && b0.volume === 15, JSON.stringify(b0));
  check("75m brick labelled at 09:15 anchor", b0 && /2026-10-01 09:15/.test(b0.date), b0 && b0.date);

  // W / D pass through unchanged (daily bars arrive pre-aggregated).
  const daily = [BD(100, 110, 95, 108, "2026-10-01"), BD(108, 118, 106, 115, "2026-10-02")];
  check("D pass-through count", stackBars(daily, "D").length === 2);
  check("W pass-through count", stackBars(daily, "W").length === 2);

  // Incomplete/forming candle excluded from bricks.
  const withPartial = raw.concat([{ open: 200, high: 201, low: 199, close: null, volume: 1, date: "2026-10-02 14:20" }]);
  check("null-close bar excluded from aggregation", stackBars(withPartial, "5m").length === 120);
  check("null-close bar never exciting", isExcitingCandle({ open: 1, high: 2, low: 0, close: null }) === false);

  // resolveStack shapes.
  check("resolveStack intraday = 3 tf", resolveStack("intraday").length === 3);
  check("resolveStack swing = 4 tf", resolveStack("swing").length === 4);
  check("resolveStack 75m = single record", resolveStack("75m").length === 1 && resolveStack("75m")[0].id === "75m");
  check("INTRADAILY ids", INTRADAILY.map(t => t.id).join(",") === "75m,15m,5m");
  check("SWING ids", SWING.map(t => t.id).join(",") === "W,D,125m,75m");
}

// ── 12. buildGtfSignal end-to-end ───────────────────────────────────────────
{
  console.log("\n12. buildGtfSignal (shadow-path logic)");
  const z = new Zone("z1", "TEST", "D", "75m", 97, 100, "2026-10-01 10:30", "2026-10-01");
  z.retests = [];
  const supply = [{ id: "s1", bottom: 105, top: 108 }]; // proximal room 5.5 vs risk 2.5 → RR 2.2
  const bar = { date: "2026-10-01 14:20", open: 99, high: 100.5, low: 98, close: 99.5, volume: 10 };

  const sig = pipeline.buildGtfSignal({
    symbol: "TEST", action: "LONG", tf: { id: "75m", label: "75m" },
    zone: z, zones: { demand: [z], supply }, bar, freshSession: true,
    dataFreshness: "production-fresh", departure: 0, timeAtBase: 0,
  });
  check("READY signal built", !!sig && sig.signalStatus === "READY", JSON.stringify(sig));
  check("zone freshness 3 (0 retests)", !!sig && sig.freshness === 3, sig && String(sig.freshness));
  check("GTF = 3 (freshness only, no hardcoded points)", !!sig && sig.gtfScore === 3, sig && String(sig.gtfScore));

  // Tested once → 1.5 preserved exactly in the signal.
  z.retests = [{ date: "2026-10-01 13:00" }];
  const sig15 = pipeline.buildGtfSignal({
    symbol: "TEST", action: "LONG", tf: { id: "75m", label: "75m" },
    zone: z, zones: { demand: [z], supply }, bar, freshSession: true,
    departure: 1, timeAtBase: 2,
  });
  check("tested-once freshness 1.5 exact in signal", !!sig15 && sig15.freshness === 1.5, sig15 && String(sig15.freshness));
  check("GTF = 4.5 (1.5 + 1 + 2)", !!sig15 && sig15.gtfScore === 4.5, sig15 && String(sig15.gtfScore));

  // Stale data → never READY.
  const stale = pipeline.buildGtfSignal({
    symbol: "TEST", action: "LONG", tf: { id: "75m", label: "75m" },
    zone: z, zones: { demand: [z], supply }, bar, freshSession: false,
  });
  check("stale data → no signal", stale === null);

  // Close outside the zone (anti-repaint) → no signal.
  z.retests = [];
  const outside = pipeline.buildGtfSignal({
    symbol: "TEST", action: "LONG", tf: { id: "75m", label: "75m" },
    zone: z, zones: { demand: [z], supply },
    bar: { date: "2026-10-01 14:20", open: 100, high: 101.5, low: 99, close: 101, volume: 10 },
    freshSession: true,
  });
  check("close outside zone → no signal", outside === null);
}

// ── 13. Legacy Pivot isolation + shadow-only guards ─────────────────────────
{
  console.log("\n13. Legacy Pivot isolation & shadow-only");
  const engineSrc = fs.readFileSync(path.join(ROOT, "tools/engine.js"), "utf8");
  check("engine.js never requires scanner-logic", !/require\(.*scanner-logic/.test(engineSrc));
  const scanSrc = fs.readFileSync(path.join(ROOT, "tools/signal-scan.js"), "utf8");
  check("signal-scan gates GTF-Pro behind env flag", /GTF_PRO\s*===\s*"true"|GTF_PRO\.enabled/.test(scanSrc));
  check("signal-scan keeps shadow save path", /shadowSave/.test(scanSrc));
  check("signal-scan blocks production promotion", /production promotion blocked/.test(scanSrc));
}

// ── 14. State machine ───────────────────────────────────────────────────────
{
  console.log("\n14. State machine transitions");
  check("FAR → WATCH", life.canTransition("FAR", "WATCH"));
  check("WATCH → APPROACHING", life.canTransition("WATCH", "APPROACHING"));
  check("APPROACHING → AT_ZONE", life.canTransition("APPROACHING", "AT_ZONE"));
  check("AT_ZONE → CONFIRMATION_WAIT", life.canTransition("AT_ZONE", "CONFIRMATION_WAIT"));
  check("CONFIRMATION_WAIT → READY", life.canTransition("CONFIRMATION_WAIT", "READY"));
  check("READY → TRIGGERED", life.canTransition("READY", "TRIGGERED"));
  check("TRIGGERED → TARGET_HIT", life.canTransition("TRIGGERED", "TARGET_HIT"));
  check("TRIGGERED → SL_HIT", life.canTransition("TRIGGERED", "SL_HIT"));
  check("READY → INVALIDATED", life.canTransition("READY", "INVALIDATED"));
  check("INVALIDATED → FAR (re-arm)", life.canTransition("INVALIDATED", "FAR"));
  check("illegal TRIGGERED → FAR rejected", life.canTransition("TRIGGERED", "FAR") === false);
  check("terminal TARGET_HIT", life.isTerminal("TARGET_HIT"));
  check("terminal SL_HIT", life.isTerminal("SL_HIT"));
  check("terminal INVALIDATED", life.isTerminal("INVALIDATED"));
}

// ── summary ─────────────────────────────────────────────────────────────────
console.log("\nGTF-Pro unit tests: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
