#!/usr/bin/env node
/*!
 * LearningFundClear — local guard tests for tools/signal-scan.js
 * =====================================================================
 * signal-scan.js is a CLI (no exports, runs main() on load), so instead
 * of requiring it we read its source, extract the guard functions with
 * brace matching, and exercise them directly. Everything runs offline:
 * no Yahoo calls, no webhook calls (fetch is stubbed), rules are loaded
 * from a temp directory.
 *
 * Covered guards (added from the reference-portal hardening pass):
 *   parseYahoo — bar sanity: finite/positive OHLC, high >= max(o,c,l),
 *                low <= min(o,c,h), junk volume coerced to 0
 *   post       — payload validation: NaN/Infinity never reach
 *                JSON.stringify, action must be LONG/SHORT, price > 0
 *   loadRules  — fail-closed range checks (pivot 1-10, stopBufPct 0-5,
 *                rrTarget 0.5-10, minVolume >= 0), unknown keys, wrong
 *                types, bad JSON, missing file -> defaults
 *
 * Run:  node tools/test-signal-guards.js
 * Exit 0 = all pass, 1 = at least one failure.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "signal-scan.js"), "utf8");

// ── extract a top-level block by marker, matching braces naively ──────────
// (safe here: the guarded functions have no unbalanced braces in strings)
function extractBlock(startMarker, name) {
  const i = SRC.indexOf(startMarker);
  if (i < 0) throw new Error(`marker not found in signal-scan.js: ${startMarker}`);
  const open = SRC.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}") {
      depth--;
      if (depth === 0) return SRC.slice(i, j + 1);
    }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

function exitThrows(fn) {
  try {
    fn();
  } catch (e) {
    if (e && e.message === "EXIT:1") return true;
    throw e;
  }
  return false;
}

// ── harness ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${extra ? " — " + extra : ""}`);
  }
}

// ── 1. parseYahoo: bar sanity ─────────────────────────────────────────────
console.log("\nparseYahoo — bar sanity guard");
const parseYahoo = vm.runInNewContext(`(${extractBlock("function parseYahoo(", "parseYahoo")})`);

function yahooJSON(bars) {
  const n = bars.length;
  return {
    chart: {
      result: [{
        timestamp: bars.map((_, i) => 1700000000 + i * 86400),
        indicators: {
          quote: [{
            open: bars.map((b) => (b && "o" in b ? b.o : null)),
            high: bars.map((b) => (b && "h" in b ? b.h : null)),
            low: bars.map((b) => (b && "l" in b ? b.l : null)),
            close: bars.map((b) => (b && "c" in b ? b.c : null)),
            volume: bars.map((b) => (b && "v" in b ? b.v : 1000)),
          }],
        },
      }],
    },
  };
}

// parseYahoo returns null when NO bars survive, a non-empty array otherwise
const rejectsAll = (bars) => {
  const out = parseYahoo(yahooJSON(bars));
  return out === null || (Array.isArray(out) && out.length === 0);
};
const keepsOnly = (bars, n) => {
  const out = parseYahoo(yahooJSON(bars));
  return Array.isArray(out) && out.length === n;
};

{
  // good bar passes with volume kept
  const out = parseYahoo(yahooJSON([{ o: 100, h: 110, l: 95, c: 105, v: 12345 }]));
  check("good bar kept with volume", out && out.length === 1 && out[0].volume === 12345, JSON.stringify(out));

  // NaN close rejected
  check("NaN close rejected", rejectsAll([{ o: 100, h: 110, l: 95, c: NaN }]));

  // Infinity high rejected
  check("Infinity high rejected", rejectsAll([{ o: 100, h: Infinity, l: 95, c: 105 }]));

  // zero / negative prices rejected
  check("zero and negative OHLC rejected", rejectsAll([{ o: 0, h: 110, l: 95, c: 105 }, { o: -5, h: 4, l: -9, c: 2 }]));

  // high < max(open, close, low) rejected
  check("high below close rejected", rejectsAll([{ o: 100, h: 90, l: 95, c: 105 }]));

  // low > min(open, close, high) rejected
  check("low above open rejected", rejectsAll([{ o: 100, h: 110, l: 120, c: 105 }]));

  // null OHLC still skipped (pre-existing behaviour)
  check("null bar skipped, good bar kept", keepsOnly([null, { o: 100, h: 110, l: 95, c: 105 }], 1));

  // junk volume coerced to 0 (NaN / negative / Infinity)
  const junkVol = parseYahoo(yahooJSON([
    { o: 100, h: 110, l: 95, c: 105, v: NaN },
    { o: 100, h: 110, l: 95, c: 106, v: -7 },
    { o: 100, h: 110, l: 95, c: 107, v: Infinity },
  ]));
  check("junk volume coerced to 0", junkVol && junkVol.length === 3 && junkVol.every((b) => b.volume === 0), JSON.stringify(junkVol && junkVol.map((b) => b.volume)));

  // malformed payload → null
  check("missing chart result returns null", parseYahoo({ chart: { result: [] } }) === null && parseYahoo(null) === null);
}

// ── 2. post: payload validation ───────────────────────────────────────────
console.log("\npost — payload validation guard");
let fetchCalls = [];
const fakeFetch = async (url, opts) => {
  fetchCalls.push({ url, body: JSON.parse(opts.body) });
  return { status: 200, text: async () => '{"ok":true}' };
};
const makePost = () => new Function(
  "WEBHOOK_URL", "SECRET", "fetch",
  `return (${extractBlock("async function post(", "post")})`
)("https://webhook.example/functions/v1/tv-webhook", "test-secret", fakeFetch);

const post = makePost();

(async () => {
  {
    fetchCalls = [];
    let r = await post({ symbol: "SBIN.NS", action: "LONG", price: NaN, details: "x" });
    check("NaN price → not posted, status 0", r.status === 0 && fetchCalls.length === 0, JSON.stringify(r));

    r = await post({ symbol: "SBIN.NS", action: "LONG", price: Infinity, details: "x" });
    check("Infinity price → not posted", r.status === 0 && fetchCalls.length === 0);

    r = await post({ symbol: "SBIN.NS", action: "BUY", price: 100, details: "x" });
    check("action BUY rejected (LONG/SHORT only)", r.status === 0 && fetchCalls.length === 0);

    r = await post({ symbol: "SBIN.NS", action: "long", price: 100, details: "x" });
    check("lowercase action rejected", r.status === 0 && fetchCalls.length === 0);

    r = await post({ symbol: "", action: "LONG", price: 100, details: "x" });
    check("empty symbol rejected", r.status === 0 && fetchCalls.length === 0);

    r = await post({ symbol: "SBIN.NS", action: "LONG", price: 0, details: "x" });
    check("price 0 rejected", r.status === 0 && fetchCalls.length === 0);

    r = await post({ symbol: "SBIN.NS", action: "SHORT", price: -3, details: "x" });
    check("negative price rejected", r.status === 0 && fetchCalls.length === 0);

    // valid payload goes through, price finite, details truncated to 500
    fetchCalls = [];
    const longDetails = "d".repeat(600);
    r = await post({ symbol: "SBIN.NS", action: "LONG", price: 812.35, details: longDetails });
    const sent = fetchCalls[0] && fetchCalls[0].body;
    check("valid LONG posted", r.status === 200 && fetchCalls.length === 1);
    check("posted price is the finite number", sent && sent.price === 812.35);
    check("details truncated to 500 chars", sent && sent.details.length === 500);
    check("secret and symbol carried in body", sent && sent.secret === "test-secret" && sent.symbol === "SBIN.NS");

    // missing details doesn't crash
    fetchCalls = [];
    r = await post({ symbol: "SBIN.NS", action: "SHORT", price: 5 });
    check("missing details → empty string, still posted", r.status === 200 && fetchCalls[0].body.details === "");
  }

  // ── 3. loadRules: fail-closed checks (offline, temp dir) ────────────────
  console.log("\nloadRules — fail-closed rules checks");
  const RULES_DEFAULTS = (() => {
    const block = extractBlock("const RULES_DEFAULTS =", "RULES_DEFAULTS");
    const open = block.indexOf("{");
    return vm.runInNewContext(`(${block.slice(open)})`);
  })();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lfc-rules-"));
  const fakeProcess = { exit: () => { throw new Error("EXIT:1"); } };

  const loadRulesFrom = (dir) => new Function(
    "RULES_DEFAULTS", "fs", "path", "__dirname", "console", "process",
    `return (${extractBlock("function loadRules(", "loadRules")})()`
  )(RULES_DEFAULTS, fs, path, dir, console, fakeProcess);

  const writeRules = (obj) => fs.writeFileSync(path.join(tmp, "scan-rules.json"), JSON.stringify(obj));
  const rulesCase = (name, obj, shouldExit) => {
    writeRules(obj);
    let exited = false, result;
    try {
      result = loadRulesFrom(tmp);
    } catch (e) {
      if (e.message === "EXIT:1") exited = true;
      else throw e;
    }
    if (shouldExit) {
      check(name + " → FATAL exit", exited);
    } else {
      check(name + " → accepted", !exited && !!result, exited ? "exited instead" : "");
    }
    return result;
  };

  // valid file accepted, values pass through
  let rules = rulesCase("valid rules", { trendFilter: true, pivotLeft: 3, pivotRight: 3, stopBufPct: 0.5, rrTarget: 2, minVolume: 100000 }, false);
  check("valid rules values loaded", rules && rules.trendFilter === true && rules.minVolume === 100000);

  // _comment key is exempt
  rulesCase("_comment key accepted", { _comment: "why", trendFilter: true }, false);

  // range checks
  rulesCase("pivotLeft 50 out of range", { pivotLeft: 50 }, true);
  rulesCase("pivotRight 0 out of range", { pivotRight: 0 }, true);
  rulesCase("stopBufPct 7 out of range", { stopBufPct: 7 }, true);
  rulesCase("rrTarget 0.1 out of range", { rrTarget: 0.1 }, true);
  rulesCase("rrTarget 99 out of range", { rrTarget: 99 }, true);
  rulesCase("minVolume -1 out of range", { minVolume: -1 }, true);

  // unknown keys and wrong types
  rulesCase("unknown key rejected", { trendFiter: true }, true);
  rulesCase("wrong type (string boolean) rejected", { trendFilter: "yes" }, true);
  rulesCase("wrong type (float pivot) rejected", { pivotLeft: 2.5 }, true);

  // bad JSON
  fs.writeFileSync(path.join(tmp, "scan-rules.json"), "{not json");
  check("invalid JSON → FATAL exit", exitThrows(() => loadRulesFrom(tmp)));

  // missing file → built-in defaults (trendFilter off etc.)
  fs.unlinkSync(path.join(tmp, "scan-rules.json"));
  rules = loadRulesFrom(tmp);
  check("missing file → documented defaults", rules && rules.trendFilter === false && rules.pivotLeft === 3 && rules.rrTarget === 2);

  // cleanup
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("test harness error:", e);
  process.exit(1);
});
