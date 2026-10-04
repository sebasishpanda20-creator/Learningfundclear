#!/usr/bin/env bash
set -euo pipefail

BROWSER="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
if [ -z "$BROWSER" ]; then
  echo "No Chromium-compatible browser found on runner."
  exit 1
fi

QA_DIR="$(mktemp -d)"
SITE="$QA_DIR/site"
OUT="$QA_DIR/screenshots"
mkdir -p "$SITE" "$OUT"

tar --exclude=.git -cf - . | (cd "$SITE" && tar -xf -)

python3 - "$SITE" <<'PY'
from pathlib import Path
import re, sys

site = Path(sys.argv[1])
pages = [
    "index.html", "performance.html", "scanner.html", "setups.html", "gex.html",
    "funds/index.html", "funds/funds.html", "funds/compare.html",
    "funds/calculators.html", "funds/methodology.html", "funds/legal.html",
    "signin.html",
]
for rel in pages:
    p = site / rel
    text = p.read_text(encoding="utf-8")
    text = re.sub(r'<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?</script>', '', text, flags=re.I)
    if rel in {"index.html", "performance.html"}:
        text = text.replace('id="appShell" class="hidden"', 'id="appShell"')
    if rel == "signin.html":
        text = text.replace('id="authPending" class="hidden"', 'id="authPending"')
    p.write_text(text, encoding="utf-8")

(site / "auth-guard.js").write_text(
    '(function(g){g.LfcAuth={current:function(){return {u:"qa@portal.local",n:"Visual QA",a:true};},'
    'stamp:function(){},clear:function(){},require:function(fn){return fn&&fn();},guard:function(){return true;}};})(window);',
    encoding="utf-8",
)
PY

PORT=4173
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$SITE" >"$QA_DIR/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" >/dev/null 2>&1 || true; rm -rf "$QA_DIR"' EXIT

ready=0
for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:$PORT/signin.html" >/dev/null; then
    ready=1
    break
  fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "QA server did not become ready."
  cat "$QA_DIR/server.log" || true
  exit 1
fi

PAGES=(
  "signin.html"
  "index.html"
  "performance.html"
  "scanner.html"
  "setups.html"
  "gex.html"
  "funds/index.html"
)

capture() {
  local width="$1"
  local height="$2"
  local page="$3"
  local slug="${page//\//-}"
  slug="${slug%.html}"
  "$BROWSER" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --virtual-time-budget=1000 \
    --window-size="$width,$height" \
    --screenshot="$OUT/${slug}-${width}px.png" \
    "http://127.0.0.1:$PORT/$page" >/dev/null 2>&1
}

for page in "${PAGES[@]}"; do
  capture 390 2200 "$page"
  capture 768 2400 "$page"
  capture 1440 2600 "$page"
done

count="$(find "$OUT" -type f -name '*.png' | wc -l | tr -d ' ')"
if [ "$count" -ne 21 ]; then
  echo "Expected 21 screenshots, found $count"
  exit 1
fi
if find "$OUT" -type f -name '*.png' -size 0 | grep -q .; then
  echo "One or more screenshots are empty."
  exit 1
fi

mkdir -p visual-qa-artifacts
cp "$OUT"/*.png visual-qa-artifacts/
printf 'Generated %s screenshots with %s\n' "$count" "$BROWSER" > visual-qa-artifacts/README.txt
echo "Visual QA screenshots generated: $count"
