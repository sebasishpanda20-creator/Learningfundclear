#!/usr/bin/env bash
# LearningFundClear production regression guard.
# The same script is used locally and in GitHub Actions.

set -euo pipefail

PAGES=(index.html signin.html performance.html scanner.html setups.html gex.html crypto.html admin.html)
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

run_check node tools/test-signal-guards.js
run_check node tools/test-weekly-line.js
run_check node --test qa/scanner-data.test.cjs qa/public-data.test.cjs qa/scanner-auto.test.cjs qa/research-math.test.cjs

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
