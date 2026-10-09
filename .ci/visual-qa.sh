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
node qa/clean-routes.cjs
node qa/feed-flows.cjs
node qa/crypto-flows.cjs
node qa/research-flows.cjs
node qa/nifty500-flows.cjs
mkdir -p visual-qa-artifacts
cp qa/*.png qa/*results.json qa/page-audit.json visual-qa-artifacts/
