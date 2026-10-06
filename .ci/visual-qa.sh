#!/usr/bin/env bash
# Exercise actual authenticated DOM with isolated backend fixtures; never write production data.
set -euo pipefail
npm install --ignore-scripts --no-audit --no-fund
npx playwright install --with-deps chromium
node qa/audit.cjs
node qa/flows.cjs
node qa/feed-flows.cjs
node qa/crypto-flows.cjs
mkdir -p visual-qa-artifacts
cp qa/*.png qa/*results.json qa/page-audit.json visual-qa-artifacts/
