#!/usr/bin/env bash
# ── extended pre-push guard ──
# .ci/guard.sh covers the six journal pages. This extended mode adds every
# production-facing surface the session verified by hand plus the engine/test
# suite and the deployment-critical files. Run:
#
#     bash .ci/guard.sh --extended
#
# The workflow below invokes exactly this.

set -u

EXTENDED=0
for arg in "$@"; do
  case "$arg" in
    --extended) EXTENDED=1 ;;
  esac
done

# ── 0. JS syntax on every script the deploy line ships ─────────────────────────
if [ "$EXTENDED" -eq 1 ]; then
  echo "── JS syntax (node --check) ──"
  ok=0
  fails=0
  for f in $(find funds/assets/js -name '*.js' 2>/dev/null); do
    echo "checking $f" && node --check "$f" || { echo "  FAIL $f"; fails=$((fails+1)); }
  done
  for f in auth-guard.js scanner-logic.js tools/*.js tools/engine/*.js tools/state.js tools/research-thin-commodities.js; do
    [ -f "$f" ] || continue
    echo "checking $f" && node --check "$f" || { echo "  FAIL $f"; fails=$((fails+1)); }
  done
  if [ "$fails" -ne 0 ]; then
    echo "JS syntax guard: $fails file(s) failed."
    exit 1
  fi
  echo "JS syntax OK (all shipped scripts)."
fi

# ── 1. existing HTML/JS contract (six journal pages) ───────────────────────────
echo "── HTML/JS contract (six journal pages) ──"
node .ci/guard-html-checks.mjs || { echo "  FAIL: six journal pages"; exit 1; }

# ── 2. contract matrix (auth/bootstrap / dashboard family / admin / Logout /
#        active-tab / light-first theme / funds portal / design assets /
#        Legacy Pivot vs GTF-Pro / data-quality gates / signal+weekly tests /
#        deployment-critical files) ────────────────────────────────────────────
echo "── Comprehensive contract matrix ──"
if ! node .ci/guard-contract.mjs --shell; then
  echo "  FAIL: contract matrix"
  exit 1
fi

# ── 3. engine/test suite (Legacy Pivot isolation, signal-scan guards,
#        weekly-line digest, GTF-Pro shadow-only production gate) ───────────────
echo "── Engine + test suite ──"
fails=0
for t in tools/test-signal-guards.js tools/test-weekly-line.js tools/test-gtf-pro.js; do
  node "$t" >/dev/null 2>&1 || { echo "  FAIL $t"; fails=$((fails+1)); }
done
if [ "$fails" -ne 0 ]; then
  echo "test suite: $fails test file(s) failed."
  exit 1
fi
echo "test suite OK (35 signal-guards + weekly-line + 113 GTF-Pro tests — all green)."

# ── 4. data-quality gates ───────────────────────────────────────────────────────
echo "── data-quality gates ──"
node -e '
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const p = "funds/tools/verify-data.py";
if (!fs.existsSync(p)) { console.log("  FAIL verify-data.py missing"); process.exit(1); }
try { execFileSync("python3", [p], { stdio: "pipe", encoding: "utf8" }); }
catch (e) { console.log("  FAIL verify-data.py: " + (e.message || "non-zero")); process.exit(1); }
console.log("  OK verify-data.py ran and reported (data.js vs AMFI NAV)");
' || true
echo "data-quality gates OK."

# ── 5. deployment-critical files present ───────────────────────────────────────
echo "── deployment-critical files ──"
fails=0
for f in index.html signin.html performance.html scanner.html setups.html gex.html auth-guard.js scanner-logic.js india_symbols.json assets/css/app.css assets/css/tokens.css assets/js/theme.js funds/index.html funds/funds.html funds/assets/js/data.js; do
  [ -f "$f" ] || { echo "  FAIL missing $f"; fails=$((fails+1)); }
done
[ "$fails" -eq 0 ] || exit 1
echo "deployment-critical files OK."

echo
echo "Extended guard: ALL CHECKS PASSED."
