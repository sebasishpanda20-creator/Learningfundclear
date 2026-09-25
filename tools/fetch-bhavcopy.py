#!/usr/bin/env python3
"""
fetch-bhavcopy.py - free NSE end-of-day stock data for personal analysis
=========================================================================

Downloads NSE's publicly published bhavcopy files (official end-of-day prices
for every traded equity) into local CSVs you can analyse with Excel, pandas,
whatever you like.

    python tools/fetch-bhavcopy.py                     # latest trading day
    python tools/fetch-bhavcopy.py --date 2026-09-23   # a specific day
    python tools/fetch-bhavcopy.py --delivery          # also grab delivery data
    python tools/fetch-bhavcopy.py --backfill 10       # last 10 calendar days

Where the data comes from
-------------------------
NSE publishes these files free on nseindia.com (see "All Reports"):
  1. CM bhavcopy (UDiFF format, since Jul 2024):
     https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_<YYYYMMDD>_F_0000.csv.zip
     OHLC, last price, volumes per security.
  2. sec_bhavdata_full (with delivery quantities/percentages):
     https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_<DDMMYYYY>.csv

IMPORTANT - the compliance line this tool sits behind
-----------------------------------------------------
This tool is for YOUR PERSONAL USE AND ANALYSIS ONLY. Exchange data is
licensed, not owned: the moment bhavcopy prices end up displayed on the
public LearningFundClear site (or any public page), you are redistributing licensed
data and need exchange approval. Keep the output directory out of the site
(it already is: data/ is not referenced by any page) and do not commit it
to a public repo. Personal analysis is the carve-out everyone's terms allow;
public display is the thing that requires permission.

NSE quirks this tool handles
----------------------------
- Plain urllib requests get 403'd: NSE wants browser-ish headers and session
  cookies. We first touch www.nseindia.com to collect cookies, then request
  the archive host with a full header set.
- Weekends/holidays have no file: when walking back we just stop at the most
  recent day that yields a file.
"""

import argparse
import datetime as dt
import http.cookiejar
import io
import os
import sys
import urllib.error
import urllib.request
import zipfile

BASE = os.path.dirname(os.path.abspath(__file__))
# This script lives in two places: <project>/tools in the public LearningFundClear repo,
# and at the root of the private bhavcopy-data repo (where the nightly workflow
# runs `python3 fetch-bhavcopy.py` and commits `data/`). Either way the CSVs
# belong in <project>/data/bhavcopy, so only step up out of a tools/ folder.
PROJECT = os.path.dirname(BASE) if os.path.basename(BASE) == "tools" else BASE
OUT_DIR = os.path.join(PROJECT, "data", "bhavcopy")

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
    "Accept": "*/*",
    "Accept-Language": "en-IN,en;q=0.9",
    "Referer": "https://www.nseindia.com/all-reports",
}

opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def get(url: str, timeout: int = 30) -> bytes:
    """GET with cookies; touch the main site first so NSE hands us a session."""
    try:
        opener.open(urllib.request.Request("https://www.nseindia.com", headers=HEADERS), timeout=timeout).read(1024)
    except urllib.error.URLError:
        pass  # cookie warm-up is best-effort; the archive request is what matters
    req = urllib.request.Request(url, headers=HEADERS)
    with opener.open(req, timeout=timeout) as resp:
        return resp.read()


def fetch_cm_bhavcopy(day: dt.date) -> str | None:
    """Download and unzip the UDiFF CM bhavcopy for `day`. Returns the CSV text."""
    yyyymmdd = day.strftime("%Y%m%d")
    url = f"https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{yyyymmdd}_F_0000.csv.zip"
    try:
        blob = get(url)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None  # no trading that day
        raise
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        name = z.namelist()[0]
        return z.read(name).decode("utf-8", errors="replace")


def fetch_delivery(day: dt.date) -> str | None:
    """sec_bhavdata_full adds delivered-quantity / delivery-percent columns."""
    ddmmyyyy = day.strftime("%d%m%Y")
    url = f"https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{ddmmyyyy}.csv"
    try:
        return get(url).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def save(day: dt.date, text: str, kind: str) -> str:
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{day.isoformat()}-{kind}.csv")
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    return path


def run_for(day: dt.date, delivery: bool) -> bool:
    got_any = False
    cm = fetch_cm_bhavcopy(day)
    if cm is not None:
        rows = cm.count("\n")
        print(f"{day}  CM bhavcopy   {rows - 1:>6} securities  -> {save(day, cm, 'cm')}")
        got_any = True
    if delivery:
        full = fetch_delivery(day)
        if full is not None:
            print(f"{day}  delivery data {full.count(chr(10)) - 1:>6} securities  -> {save(day, full, 'delivery')}")
            got_any = True
        else:
            print(f"{day}  delivery data not available")
    return got_any


def main() -> int:
    ap = argparse.ArgumentParser(description="Download NSE EOD bhavcopy for personal analysis")
    ap.add_argument("--date", help="single trading day, YYYY-MM-DD")
    ap.add_argument("--backfill", type=int, default=0,
                    help="walk back N calendar days (stops at last day with data)")
    ap.add_argument("--delivery", action="store_true",
                    help="also download sec_bhavdata_full (delivery quantity/percent)")
    args = ap.parse_args()

    if args.date:
        days = [dt.date.fromisoformat(args.date)]
    else:
        # Most recent weekday onwards; skip empty days up to a week back.
        start = dt.date.today()
        days = [start - dt.timedelta(days=i) for i in range(max(1, args.backfill) + (0 if args.backfill else 7))]

    found = 0
    for day in days:
        try:
            if run_for(day, args.delivery):
                found += 1
                if not args.backfill and not args.date:
                    break  # single "latest" run stops at the first day that has data
        except urllib.error.URLError as e:
            print(f"{day}  network error: {e}", file=sys.stderr)
        except zipfile.BadZipFile:
            pass  # not a trading day / bad response, keep walking back

    print(f"\nDone. {found} day(s) of data in {OUT_DIR}")
    print("Remember: personal analysis only - do not publish this data on the site.")
    return 0 if found else 1


if __name__ == "__main__":
    sys.exit(main())
