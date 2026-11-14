"""Build the review archive + manifest for the LFC patch.

Usage (from the workspace root):
    python lfc-quant-work/tools/package-patch.py [--version 2026-11-14-v3]

Writes PATCH-MANIFEST.json at the workspace root and
lfc-application-patch-<version>.zip next to it. Hash is printed.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import subprocess
import zipfile
from pathlib import Path

SKIP_DIRS = {"node_modules", ".git", ".wrangler", "__pycache__", ".next", "dist", "visual-qa-artifacts"}
BASES = ("lfc-quant-work", "Learningfundclear/backend")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def collect() -> list[Path]:
    files: list[Path] = []
    for base in BASES:
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
            for name in sorted(filenames):
                p = Path(dirpath) / name
                if p.suffix in {".pyc", ".zip", ".log"}:
                    continue
                files.append(p)
    return files


def ignored_paths(files: list[Path]) -> set[str]:
    payload = "\0".join(p.as_posix() for p in files).encode("utf-8")
    try:
        res = subprocess.run(
            ["git", "check-ignore", "--stdin", "-z"],
            input=payload,
            capture_output=True,
            check=False,
        )
        return {part for part in res.stdout.decode("utf-8", "replace").split("\0") if part}
    except Exception:
        return set()


def build(version: str) -> Path:
    root = Path(".")
    out = root / f"lfc-application-patch-{version}.zip"
    files = collect()
    ignored = ignored_paths(files)

    contents = [
        {
            "path": p.as_posix(),
            "bytes": p.stat().st_size,
            "sha256": sha256(p),
            "gitignored": p.as_posix() in ignored,
        }
        for p in files
    ]

    manifest = {
        "package": "lfc-application-patch",
        "version": version,
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": {
            "root": str(Path(".").resolve()).replace(os.sep, "/"),
            "git": {
                "commits": 0,
                "tracked_files": 0,
                "index_present": (root / ".git" / "index").exists(),
                "note": (
                    "The repository has no initial commit and no .git/index, so every path is "
                    "untracked and `git add` is a no-op. That is separate from .gitignore: the "
                    "paths marked gitignored=true would stay out of a commit even after the first "
                    "commit."
                ),
            },
            "gitignore_rules": {
                "lfc-quant-work/.gitignore": ["dist/", "qa/*.png", "data/", "bhavcopy-data/"],
                ".gitignore": ["/freebuff-sites-build/"],
            },
            "screenshots_note": "qa/shot-*.png are included for review although qa/*.png is gitignored",
        },
        "excluded_from_zip": [
            "**/node_modules",
            "**/.git",
            "**/dist",
            "**/visual-qa-artifacts",
            "**/.wrangler",
            "**/__pycache__",
            "*.pyc",
            "*.zip",
        ],
        "counts": {"files": len(contents), "bytes": sum(c["bytes"] for c in contents)},
        "commands": {
            "backend_compile": "python -m py_compile live_feed_proxy.py",
            "backend_tests": "python -m unittest discover -s tests -p test_fyers_auth.py",
            "backend_start": "python -m uvicorn live_feed_proxy:app --host 127.0.0.1 --port 8770",
            "frontend_install": "npm ci",
            "frontend_build": "npm run build:cloudflare",
            "guard": "bash .ci/guard.sh",
            "hosting_readiness": "node qa/hosting-readiness.cjs",
            "propagation": "node qa/data-propagation.cjs",
            "mock_boundary": "node qa/mock-boundary.cjs",
            "worker_preview": "./node_modules/.bin/wrangler dev --port 8790 --ip 127.0.0.1",
        },
        "verification": {
            "guard": "PASSED (qa/logs/guard-final.log)",
            "suites": {
                "hosting-readiness": 10,
                "scanner-api-ab": 21,
                "data-propagation": 7,
                "mock-boundary": 9,
                "market-data-boundaries": 11,
                "strategy-regressions": 13,
                "mobile-first": 223,
                "terminal-smoke": 88,
                "backend-unittest": 16,
            },
            "mock_boundaries": {
                "fyers_auth": "provider mocked for auth/quote tests; live login NOT RUN (no credentials)",
                "market_provider": "browser suites intercept /api/market/yahoo; the real Worker answers 401 without a portal session",
                "scan_payload": "scan_sl_tp.json is a static DEMO artifact, not broker data",
            },
        },
        "contents": contents,
    }

    (root / "PATCH-MANIFEST.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write("PATCH-MANIFEST.json", "PATCH-MANIFEST.json")
        for p in files:
            zf.write(p, p.as_posix())
        zf.writestr(
            "SHA256SUMS.txt",
            "\n".join(f"{c['sha256']}  {c['path']}" for c in contents) + "\n",
        )

    print(
        json.dumps(
            {
                "zip": out.name,
                "files": len(files) + 2,
                "mb": round(out.stat().st_size / 1048576, 2),
                "sha256": sha256(out),
                "gitignored_entries": [c["path"] for c in contents if c["gitignored"]],
            },
            indent=2,
        )
    )
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="2026-11-14-v3")
    args = ap.parse_args()
    build(args.version)
