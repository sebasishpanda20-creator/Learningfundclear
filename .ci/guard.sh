#!/usr/bin/env bash
# LearningFundClear production regression guard.
# The same script is used locally and in GitHub Actions.
# QA_PORT=9131 avoids EADDRINUSE conflicts with port 8130 (informational; test scripts use listen(0))
set -euo pipefail

PAGES=(index.html signin.html performance.html scanner.html setups.html gex.html crypto.html crypto-options.html crypto-funding.html admin.html lfc_terminal_v6.html)
FAIL=0

run_check() {
  echo
  echo "==> $*"
  if ! "$@"; then
    FAIL=1
  fi
}

run_check node .ci/guard-html-checks.mjs "${PAGES[@]}"
run_check node .ci/guard-production-contract.mjs

echo
echo "==> external JavaScript syntax"
JS_FILES=(auth-guard.js scanner-logic.js)
while IFS= read -r -d '' file; do
  JS_FILES+=("$file")
done < <(find assets/js funds/assets/js tools -type f -name '*.js' -print0 2>/dev/null)

if [ "${#JS_FILES[@]}" -eq 0 ]; then
  echo "FAIL no JavaScript files found for syntax validation"
  FAIL=1
else
  for file in "${JS_FILES[@]}"; do
    if ! node --check "$file"; then
      echo "FAIL syntax: $file"
      FAIL=1
    fi
  done
fi

# Mobile-first is a release criterion, not a styling preference:
# docs/MOBILE-FIRST-RELEASE-CRITERIA.md (MF-1 … MF-14).
run_check node --test qa/bsm.test.mjs
run_check node --test qa/fyers-worker.test.mjs
run_check node --test qa/free-tier-budget.test.mjs
run_check node --test qa/source-files.test.mjs
run_check node --test qa/market-context.test.mjs
run_check node qa/market-context-ui.cjs
run_check node qa/hosting-readiness.cjs
run_check node qa/scanner-api-ab.cjs
run_check node qa/data-propagation.cjs
run_check node qa/mock-boundary.cjs
run_check node qa/market-data-boundaries.cjs
run_check node qa/strategy-regressions.cjs
run_check node qa/mobile-first.cjs
run_check node qa/terminal-smoke.cjs
run_check python -m unittest discover -s ../Learningfundclear/backend/tests -p test_fyers_auth.py

run_check node tools/test-signal-guards.js
run_check node tools/test-weekly-line.js
run_check node --test qa/crypto-context.test.cjs qa/scanner-data.test.cjs qa/public-data.test.cjs qa/scanner-auto.test.cjs qa/research-math.test.cjs qa/nifty500.test.cjs qa/crypto-desk.test.cjs qa/crypto-advanced.test.cjs qa/crypto-validation.test.cjs qa/crypto-session.test.cjs

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  run_check git diff --check
fi

if [ "$FAIL" -ne 0 ]; then
  echo
  echo "Production regression guard FAILED."
  exit 1
fi

echo
echo "Production regression guard PASSED."

python3 qa/nifty500-collector.py
