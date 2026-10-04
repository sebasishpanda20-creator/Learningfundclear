#!/usr/bin/env bash
# ── pre-push guard ──
# Fails the push if any journal page damages the shared HTML/JS contract:
#   1. the $( "#" anti-pattern (getElementById wrapper with a selector prefix)
#   2. duplicate const / let / var declarations inside an inline <script>
#   3. $( "id" ) references to element ids that do not exist in that page
#   4. left-over hidePending() calls on index.html
# Exit 0 = clean, 1 = fail. The same script runs in GitHub Actions and locally.

set -u

PAGES=(index.html signin.html performance.html scanner.html setups.html gex.html)

FAIL=0

# ── 1. selector-prefix misuse: $( "#id" ) must not exist ──
for p in "${PAGES[@]}"; do
  if grep -n '\$("#' "$p" >/dev/null 2>&1; then
    echo "FAIL $p: selector-prefix misuse \$(\"# ...\" with \$ = getElementById"
    FAIL=1
  fi
done

# ── 2. duplicate const / let / var inside inline scripts ──
for p in "${PAGES[@]}"; do
  node .ci/guard-html-checks.mjs "$p" || FAIL=1
done

# ── 3. stray hidePending() on index.html ──
if grep -n 'function hidePending' index.html >/dev/null; then
  echo "FAIL index.html: function hidePending still defined"
  FAIL=1
fi
if grep -n 'hidePending()' index.html >/dev/null; then
  echo "FAIL index.html: hidePending still called"
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo
  echo 'HTML/JS contract violated — push blocked. Fix the errors above and retry.'
  exit 1
fi
echo 'HTML/JS contract OK (6 pages).'
