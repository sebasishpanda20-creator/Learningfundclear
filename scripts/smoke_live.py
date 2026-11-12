#!/usr/bin/env python3
"""
Live smoke test for the LearningFundClear portal.

    python scripts/smoke_live.py
    python scripts/smoke_live.py --portal https://... --proxy http://127.0.0.1:8000

Two halves, because the portal is two things:

  * the **published static site** (Cloudflare Pages project `learningfundclear`),
    which must serve the exact bytes committed in `dist-portal/`, and
  * the **local FastAPI proxy**, which is the only source of real quotes and is
    never published, so it can only be checked on the machine running it.

Checks, in the order a user would hit them:

  1. published index.html is up and byte-identical to the committed build
  2. published robots.txt is up and byte-identical
  3. proxy health is ONLINE
  4. NSE live quote is real-time and priced
  5. MCX quote is real-time, priced, and sits inside its circuit band
  6. Delta XAUTUSD is priced with sane circuits and funding
  7. a desk that claims LIVE must not return empty categories
  8. unknown symbols never look tradeable

Writes docs/smoke/live-results.json and .md and exits non-zero on failure, so it
can gate a deploy. No third-party dependencies: stdlib only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "smoke"
BUILD_INDEX = ROOT / "dist-portal" / "index.html"
BUILD_ROBOTS = ROOT / "dist-portal" / "robots.txt"

DEFAULT_PORTAL = "https://site-443e334f4a224d008788726d8cf4b9ed.freebuff.page"
DEFAULT_PROXY = "http://127.0.0.1:8000"

checks: list[dict] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    checks.append({"name": name, "ok": ok, "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'}  {name}{f' - {detail}' if detail else ''}")


def get_bytes(url: str, timeout: float = 25.0) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers={"accept": "*/*", "user-agent": "lfc-smoke/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def get_json(url: str, timeout: float = 25.0) -> tuple[int, dict]:
    status, body = get_bytes(url, timeout)
    try:
        return status, json.loads(body.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        return status, {"_raw": body[:200].decode("utf-8", "replace")}


def num(value) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fmt(value) -> str:
    """Compact number formatting so the Markdown table stays readable."""
    if isinstance(value, float):
        return f"{value:,.4f}".rstrip("0").rstrip(".")
    return str(value)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portal", default=DEFAULT_PORTAL)
    parser.add_argument("--proxy", default=DEFAULT_PROXY)
    args = parser.parse_args()

    # Windows consoles default to cp1252 and would crash on this script's output.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    portal = args.portal.rstrip("/")
    proxy = args.proxy.rstrip("/")
    started = datetime.now(timezone.utc)

    print(f"portal  {portal}\nproxy   {proxy}\n")

    # 1-2. published build must be the committed build
    expected_index = BUILD_INDEX.read_bytes() if BUILD_INDEX.exists() else b""
    expected_robots = BUILD_ROBOTS.read_bytes() if BUILD_ROBOTS.exists() else b""
    deployed = {"index": None, "robots": None}

    try:
        status, body = get_bytes(f"{portal}/")
        deployed["index"] = body
        title_ok = b"<title>LearningFundClear" in body
        record("published index.html served", status == 200 and title_ok,
               f"HTTP {status}, {len(body):,} bytes")
        record(
            "published index.html matches committed build",
            body == expected_index,
            f"sha256 {sha(body)[:12]} vs build {sha(expected_index)[:12]}",
        )
    except Exception as error:  # noqa: BLE001 - a smoke test reports, never raises
        record("published index.html served", False, str(error))

    try:
        status, body = get_bytes(f"{portal}/robots.txt")
        deployed["robots"] = body
        record("published robots.txt served", status == 200, f"HTTP {status}, {len(body)} bytes")
        record("published robots.txt matches committed build", body == expected_robots,
               f"sha256 {sha(body)[:12]} vs build {sha(expected_robots)[:12]}")
    except Exception as error:  # noqa: BLE001
        record("published robots.txt served", False, str(error))

    # 3. proxy health
    health = None
    try:
        status, payload = get_json(f"{proxy}/api/v1/health")
        health = payload
        record("proxy health ONLINE", status == 200 and payload.get("status") == "ONLINE",
               f"HTTP {status}, version {payload.get('version')}, nsemine={payload.get('nsemine')}")
    except Exception as error:  # noqa: BLE001
        record("proxy health ONLINE", False, str(error))

    # 4. NSE live quote
    nse = None
    try:
        status, payload = get_json(f"{proxy}/api/v1/nse/live/RELIANCE")
        nse = payload
        ltp = num(payload.get("ltp")) or 0.0
        state = str(payload.get("state", ""))
        record("NSE RELIANCE priced", status == 200 and ltp > 0, f"ltp {fmt(ltp)}")
        record("NSE RELIANCE is real-time", state.startswith("REAL-TIME"), f"state={state}")
    except Exception as error:  # noqa: BLE001
        record("NSE RELIANCE priced", False, str(error))

    # 5. MCX quote inside its circuit band
    mcx = None
    try:
        status, payload = get_json(f"{proxy}/api/v1/mcx/live/GOLD")
        mcx = payload
        ltp = num(payload.get("ltp")) or 0.0
        upper = num(payload.get("upper_circuit")) or 0.0
        lower = num(payload.get("lower_circuit")) or 0.0
        state = str(payload.get("state", ""))
        record("MCX GOLD priced", status == 200 and ltp > 0,
               f"ltp {fmt(ltp)}, expiry {payload.get('expiry')}")
        record("MCX GOLD is real-time", state.startswith("REAL-TIME"), f"state={state}")
        record("MCX GOLD inside circuit band", lower < ltp < upper,
               f"{fmt(lower)} < {fmt(ltp)} < {fmt(upper)}")
    except Exception as error:  # noqa: BLE001
        record("MCX GOLD priced", False, str(error))

    # 6. Delta XAUT — the crypto desk's gold leg
    xaut = None
    try:
        status, payload = get_json(f"{proxy}/api/v1/delta/ticker/XAUTUSD")
        xaut = payload
        ltp = num(payload.get("ltp")) or 0.0
        mark = num(payload.get("mark_price")) or 0.0
        upper = num(payload.get("upper_circuit")) or 0.0
        lower = num(payload.get("lower_circuit")) or 0.0
        record("XAUTUSD priced", status == 200 and ltp > 0, f"ltp {fmt(ltp)}, mark {fmt(mark)}")
        record("XAUTUSD badged LIVE", payload.get("state") == "LIVE DELTA API",
               f"state={payload.get('state')}")
        record("XAUTUSD inside circuit band", lower < ltp < upper,
               f"{fmt(lower)} < {fmt(ltp)} < {fmt(upper)}")
    except Exception as error:  # noqa: BLE001
        record("XAUTUSD priced", False, str(error))

    # 7. a LIVE desk must not be empty
    categorized = None
    try:
        status, payload = get_json(f"{proxy}/api/v1/delta/products/categorized")
        categorized = payload
        categories = payload.get("categories") or {}
        counts = {name: len(rows or []) for name, rows in categories.items()}
        claims_live = payload.get("state") == "LIVE DELTA API"
        record(
            "categorized products not empty while claiming LIVE",
            not (claims_live and sum(counts.values()) == 0),
            f"state={payload.get('state')}, counts={counts}",
        )
    except Exception as error:  # noqa: BLE001
        record("categorized products not empty while claiming LIVE", False, str(error))

    # 8. unknown symbols must never look tradeable
    try:
        _, payload = get_json(f"{proxy}/api/v1/delta/ticker/NOTAREAL")
        ltp = num(payload.get("ltp")) or 0.0
        record("unknown Delta symbol not tradeable",
               ltp == 0 and payload.get("state") == "UNAVAILABLE",
               f"ltp {fmt(ltp)}, state={payload.get('state')}")
    except Exception as error:  # noqa: BLE001
        record("unknown Delta symbol not tradeable", False, str(error))

    try:
        _, payload = get_json(f"{proxy}/api/v1/nse/live/NOTAREALSYM")
        ltp = num(payload.get("ltp")) or 0.0
        record("unknown NSE symbol not tradeable",
               ltp == 0 and payload.get("state") == "UNAVAILABLE",
               f"ltp {fmt(ltp)}, state={payload.get('state')}")
    except Exception as error:  # noqa: BLE001
        record("unknown NSE symbol not tradeable", False, str(error))

    finished = datetime.now(timezone.utc)
    failed = [check for check in checks if not check["ok"]]
    summary = {
        "portal": portal,
        "proxy": proxy,
        "started_at": started.isoformat(),
        "finished_at": finished.isoformat(),
        "duration_ms": int((finished - started).total_seconds() * 1000),
        "passed": len(checks) - len(failed),
        "failed": len(failed),
        "ok": not failed,
        "checks": checks,
        "snapshots": {
            "health": health,
            "nse_reliance": nse,
            "mcx_gold": mcx,
            "xaut": xaut,
            "delta_categorized": categorized,
        },
        "deployed_index_sha256": sha(deployed["index"]) if deployed["index"] else None,
        "build_index_sha256": sha(expected_index) if expected_index else None,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "live-results.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    rows = "\n".join(
        f"| {check['name']} | {'pass' if check['ok'] else '**fail**'} | "
        f"{str(check['detail']).replace('|', chr(92) + '|')} |"
        for check in checks
    )
    md = f"""# LearningFundClear — live smoke run

- **Published portal:** {portal}
- **Local proxy:** {proxy}
- **Run at:** {summary['started_at']}
- **Result:** {'PASS' if summary['ok'] else 'FAIL'} ({summary['passed']}/{len(checks)} checks, {summary['duration_ms']} ms)

## Checks

| Check | Result | Detail |
| --- | --- | --- |
{rows}

## Live snapshot

### MCX GOLD (NSE/MCX proxy)
- LTP {fmt(mcx.get('ltp')) if mcx else '—'} · open {fmt(mcx.get('open')) if mcx else '—'} · high {fmt(mcx.get('high')) if mcx else '—'} · low {fmt(mcx.get('low')) if mcx else '—'}
- Circuit band {fmt(mcx.get('lower_circuit')) if mcx else '—'} – {fmt(mcx.get('upper_circuit')) if mcx else '—'} · expiry {(mcx or {}).get('expiry', '—')}
- State {(mcx or {}).get('state', '—')}

### NSE RELIANCE
- LTP {fmt(nse.get('ltp')) if nse else '—'} · change {fmt(nse.get('pChange')) if nse else '—'}%
- State {(nse or {}).get('state', '—')} · feed {(nse or {}).get('feed_note', '—')}

### Delta XAUTUSD (crypto VDA desk)
- LTP {fmt(xaut.get('ltp')) if xaut else '—'} · mark {fmt(xaut.get('mark_price')) if xaut else '—'}
- 24h change {fmt(xaut.get('pChange')) if xaut else '—'}% · funding {fmt(xaut.get('funding_rate')) if xaut else '—'}
- 24h turnover USD {fmt(xaut.get('volume')) if xaut else '—'}
- Circuit band {fmt(xaut.get('lower_circuit')) if xaut else '—'} – {fmt(xaut.get('upper_circuit')) if xaut else '—'}
- State {(xaut or {}).get('state', '—')}

### Deployed build
- deployed index.html sha256 `{(summary['deployed_index_sha256'] or '—')[:16]}…`
- committed build sha256 `{(summary['build_index_sha256'] or '—')[:16]}…`
"""
    (OUT_DIR / "live-results.md").write_text(md, encoding="utf-8")

    print(f"\n{'smoke passed' if summary['ok'] else 'smoke failed'} - "
          f"{summary['passed']}/{len(checks)} checks in {summary['duration_ms']} ms")
    print("  results  docs/smoke/live-results.json")
    print("  report   docs/smoke/live-results.md")
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
