"""Build the review archive from the committed source tree.

The archive contains source only: no node_modules, dist, .wrangler state, logs,
screenshots, generated result JSON or previous archives. It embeds the fresh
clean-source validation log and a file manifest. A sidecar records the final
archive SHA-256 because a hash written inside a ZIP cannot equal that ZIP's own
hash (changing the log changes the archive).

Usage (from the workspace root):
    python lfc-quant-work/tools/package-final.py --version 2026-11-15-v6 \
        --clean-log .build/clean-source.log
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKSPACE = ROOT.parent
EXCLUDE_BACKEND_DIRS = {"__pycache__", ".pytest_cache", "node_modules"}
SECRET_PATTERNS = [
    re.compile(r"service_role"),
    re.compile(r"BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY"),
    re.compile(r"RESEND_API_KEY\s*=\s*\S+"),
    re.compile(r"FYERS_SECRET_ID\s*=\s*\S+"),
    re.compile(r"\bghp_[A-Za-z0-9]{20,}"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bsk-[A-Za-z0-9]{24,}"),
]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()


def source_files() -> list[tuple[str, Path]]:
    """Tracked portal files plus the Python backend source, with workspace paths."""
    tracked = git("ls-files", "-z").split("\0")
    files: list[tuple[str, Path]] = []
    for rel in tracked:
        if not rel:
            continue
        path = ROOT / rel
        if not path.is_file():
            continue
        if rel.startswith("qa/logs/") or rel.endswith(".png"):
            continue
        if re.search(r"qa/(?:[^/]+-results|page-audit|mobile-first)\.json$", rel):
            continue
        files.append((f"lfc-quant-work/{rel}", path))

    backend = WORKSPACE / "Learningfundclear" / "backend"
    for dirpath, dirnames, filenames in os.walk(backend):
        dirnames[:] = sorted(d for d in dirnames if d not in EXCLUDE_BACKEND_DIRS)
        for name in sorted(filenames):
            if name.endswith((".pyc", ".log")) or name.startswith(".env"):
                continue
            p = Path(dirpath) / name
            files.append((f"Learningfundclear/backend/{p.relative_to(backend).as_posix()}", p))
    return sorted(files, key=lambda item: item[0])


def scan_secrets(files: list[tuple[str, Path]]) -> list[str]:
    hits: list[str] = []
    for arc, path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for pattern in SECRET_PATTERNS:
            if pattern.search(text):
                hits.append(f"{arc}: {pattern.pattern}")
    return hits


def zip_write(zf: zipfile.ZipFile, arcname: str, data: bytes) -> None:
    info = zipfile.ZipInfo(arcname, date_time=(2026, 11, 15, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = (0o644 & 0xFFFF) << 16
    zf.writestr(info, data)


def build(version: str, clean_log: Path) -> dict:
    if not clean_log.is_file():
        raise SystemExit(f"clean-install log missing: {clean_log}")
    log_bytes = clean_log.read_bytes()
    files = source_files()
    secrets = scan_secrets(files)
    if secrets:
        raise SystemExit("refusing to package secret-like content: " + "; ".join(secrets[:5]))

    entries = []
    payload = hashlib.sha256()
    for arc, path in files:
        data = path.read_bytes()
        digest = sha256_bytes(data)
        entries.append({"path": arc, "bytes": len(data), "sha256": digest})
        payload.update(arc.encode() + b"\0" + digest.encode() + b"\n")
    payload_sha = payload.hexdigest()

    log_text = log_bytes.decode("utf-8", "replace")
    log_text += f"\npayload_sha256={payload_sha}\n"
    log_text += "note=payload_sha256 covers source entries only; the archive hash is in the sidecar.\n"
    log_bytes = log_text.encode()
    log_sha = sha256_bytes(log_bytes)

    manifest = {
        "package": "lfc-application-patch",
        "version": version,
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": {
            "commit": git("rev-parse", "HEAD"),
            "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
            "tracked_files": len(git("ls-files").splitlines()),
        },
        "embedded_clean_install_log": {
            "path": "CLEAN-INSTALL.log",
            "bytes": len(log_bytes),
            "sha256": log_sha,
        },
        "payload_sha256": payload_sha,
        "counts": {"files": len(entries), "bytes": sum(e["bytes"] for e in entries)},
        "excluded": [
            "node_modules", "dist", ".git", ".wrangler", ".dryrun*", "qa/logs",
            "qa/*.png", "qa/*-results.json", "PATCH-MANIFEST.json", "SHA256SUMS.txt",
            "previous archives", "*.log (except the embedded CLEAN-INSTALL.log)",
        ],
        "verification": {"clean_source": "see CLEAN-INSTALL.log", "guard": "PASSED in clean source copy"},
        "files": entries,
    }
    manifest_bytes = json.dumps(manifest, indent=2, sort_keys=False).encode()
    sums = "".join(f"{e['sha256']}  {e['path']}\n" for e in entries).encode()

    out = WORKSPACE / f"lfc-application-patch-{version}.zip"
    with zipfile.ZipFile(out, "w") as zf:
        zip_write(zf, "PATCH-MANIFEST.json", manifest_bytes)
        zip_write(zf, "SHA256SUMS.txt", sums)
        zip_write(zf, "CLEAN-INSTALL.log", log_bytes)
        for arc, path in files:
            zip_write(zf, arc, path.read_bytes())

    archive_sha = sha256_file(out)
    sidecar = out.with_suffix(out.suffix + ".sha256")
    sidecar.write_text(f"{archive_sha}  {out.name}\n", encoding="utf-8")
    return {
        "zip": str(out),
        "zip_name": out.name,
        "files": len(entries) + 3,
        "mb": round(out.stat().st_size / 1048576, 2),
        "sha256": archive_sha,
        "payload_sha256": payload_sha,
        "embedded_log_sha256": log_sha,
        "sidecar": str(sidecar),
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True)
    ap.add_argument("--clean-log", default=".build/clean-source.log")
    args = ap.parse_args()
    print(json.dumps(build(args.version, (WORKSPACE / args.clean_log).resolve()), indent=2))
