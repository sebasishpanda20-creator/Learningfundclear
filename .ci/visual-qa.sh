#!/usr/bin/env bash
# Exercise actual authenticated DOM with isolated backend fixtures; never write production data.
set -euo pipefail
npm install --ignore-scripts --no-audit --no-fund
if command -v google-chrome >/dev/null 2>&1; then
  export TEST_BROWSER_PATH="$(command -v google-chrome)"
else
  timeout 180 npx playwright install chromium
fi
node qa/audit.cjs
node qa/flows.cjs
node qa/trade-plan-flows.cjs
node qa/quality-scanner-flows.cjs
node qa/clean-routes.cjs
node qa/feed-flows.cjs
node qa/crypto-flows.cjs
node qa/crypto-desk-flows.cjs
node qa/crypto-context-flows.cjs
node qa/registration-approvals-flows.cjs
node qa/futures-flows.cjs
node qa/ui-experience-flows.cjs
node qa/research-flows.cjs
node qa/nifty500-flows.cjs
node qa/index-scanner-flows.cjs
node qa/india-options-flows.cjs
node qa/crypto-range-flows.cjs
mkdir -p visual-qa-artifacts
cp qa/*.png qa/*results.json qa/page-audit.json visual-qa-artifacts/
