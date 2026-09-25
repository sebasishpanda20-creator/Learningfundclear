#!/usr/bin/env python3
"""
analyze-bhavcopy.py - quick personal analysis of downloaded NSE EOD data
========================================================================

Reads the CSVs that tools/fetch-bhavcopy.py saved into data/bhavcopy/ and
prints three views of the latest (or a chosen) trading day:

  1. Top gainers      - biggest close-vs-prev-close moves
  2. Top losers       - same, downward
  3. High delivery    - stocks where most of the day's volume was delivered,
                        the classic "real accumulation vs intraday churn" signal

    python tools/analyze-bhavcopy.py                     # latest day fetched
    python tools/analyze-bhavcopy.py --date 2026-09-24
    python tools/analyze-bhavcopy.py --top 20 --min-price 50

Filters that keep the list sane
-------------------------------
- Only the EQ series by default: bhavcopy also carries SGBs, ETFs, debt and
  SME listings whose moves are not comparable to ordinary equities.
  --all-series lifts this if you want everything.
- --min-turnover (crores, default 1) drops illiquid names where a few trades
  can print a fake 20% move.
- --min-price (default 20) drops penny stocks, same reason.

Personal use only - same rule as the fetcher. Nothing here is a
recommendation; it is a sorted list of yesterday's tape.
"""

import argparse
import os
import sys

import pandas as pd

BASE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(BASE)
DATA_DIR = os.path.join(PROJECT, "data", "bhavcopy")


def available_dates(data_dir: str = DATA_DIR) -> list[str]:
    dates = set()
    for name in os.listdir(data_dir) if os.path.isdir(data_dir) else []:
        if name.endswith("-cm.csv"):
            dates.add(name[:10])
    return sorted(dates)


def load_cm(day: str, include_all_series: bool = False, data_dir: str = DATA_DIR) -> pd.DataFrame:
    df = pd.read_csv(os.path.join(data_dir, f"{day}-cm.csv"))
    df = df[df["SctySrs"].isin(["EQ", "BE"])]
    keep = df[[
        "TckrSymb", "FinInstrmNm", "SctySrs", "ClsPric", "PrvsClsgPric",
        "TtlTradgVol", "TtlTrfVal",
    ]].copy()
    keep.columns = ["symbol", "name", "series", "close", "prev_close", "volume", "turnover"]
    for col in ("close", "prev_close", "volume", "turnover"):
        keep[col] = pd.to_numeric(keep[col], errors="coerce")
    keep = keep.dropna(subset=["close", "prev_close"])
    keep = keep[keep["prev_close"] > 0]
    keep["chg_pct"] = (keep["close"] - keep["prev_close"]) / keep["prev_close"] * 100
    if not include_all_series:
        keep = keep[keep["series"] == "EQ"]
    # Some names trade in both EQ and BE; keep the EQ row when duplicated.
    rank = keep["series"].map({"EQ": 0, "BE": 1}).fillna(2)
    keep = (keep.assign(_r=rank).sort_values(["symbol", "_r"])
                .drop_duplicates("symbol").drop(columns="_r"))
    return keep


def load_delivery(day: str, data_dir: str = DATA_DIR) -> pd.DataFrame | None:
    path = os.path.join(data_dir, f"{day}-delivery.csv")
    if not os.path.exists(path):
        return None
    df = pd.read_csv(path)
    df.columns = [c.strip() for c in df.columns]          # file pads names with spaces
    for col in df.select_dtypes("object").columns:
        df[col] = df[col].str.strip()
    df = df[df["SERIES"] == "EQ"]
    keep = df[["SYMBOL", "CLOSE_PRICE", "TTL_TRD_QNTY", "TURNOVER_LACS", "DELIV_QTY", "DELIV_PER"]].copy()
    keep.columns = ["symbol", "close", "volume", "turnover_lacs", "deliv_qty", "deliv_pct"]
    for col in ("close", "volume", "turnover_lacs", "deliv_qty", "deliv_pct"):
        keep[col] = pd.to_numeric(keep[col], errors="coerce")
    return keep.dropna(subset=["deliv_pct"])


def print_table(df: pd.DataFrame, cols: list[str], fmts: dict) -> None:
    if df.empty:
        print("  (nothing passed the filters)")
        return
    out = df[cols].copy()
    for col, fmt in fmts.items():
        out[col] = out[col].map(fmt)
    print(out.to_string(index=False))


def main() -> int:
    ap = argparse.ArgumentParser(description="Analyse downloaded NSE bhavcopy data")
    ap.add_argument("--date", help="trade date YYYY-MM-DD (default: latest fetched)")
    ap.add_argument("--top", type=int, default=10, help="rows per table (default 10)")
    ap.add_argument("--min-turnover", type=float, default=1.0,
                    help="minimum turnover in crore rupees (default 1.0)")
    ap.add_argument("--min-price", type=float, default=20.0,
                    help="minimum closing price in rupees (default 20)")
    ap.add_argument("--all-series", action="store_true",
                    help="include BE and other series, not just EQ")
    ap.add_argument("--dir", default=DATA_DIR,
                    help="directory with the CSVs (default: Learningfundclear/funds/data/bhavcopy; "
                         "point it at the bhavcopy-data repo when analysing that archive)")
    args = ap.parse_args()

    dates = available_dates(args.dir)
    if not dates:
        print("No bhavcopy data yet. Run:  python tools/fetch-bhavcopy.py --delivery --backfill 10")
        return 1
    day = args.date if args.date else dates[-1]
    if day not in dates:
        print(f"No data for {day}. Available: {', '.join(dates[-5:])}")
        return 1

    cm = load_cm(day, args.all_series, args.dir)
    liquid = cm[(cm["turnover"] >= args.min_turnover * 1e7) & (cm["close"] >= args.min_price)]

    adv = int((liquid["chg_pct"] > 0).sum())
    dec = int((liquid["chg_pct"] < 0).sum())
    print(f"\nNSE equities - {day}   ({len(liquid)} liquid stocks, {adv} up / {dec} down)")

    cols = ["symbol", "close", "chg_pct", "volume", "turnover"]
    fmts = {"close": "{:,.2f}".format, "chg_pct": "{:+.2f}%".format,
            "volume": "{:,.0f}".format, "turnover": "{:,.0f}".format}

    print(f"\nTop {args.top} gainers")
    print_table(liquid.nlargest(args.top, "chg_pct"), cols, fmts)

    print(f"\nTop {args.top} losers")
    print_table(liquid.nsmallest(args.top, "chg_pct"), cols, fmts)

    dl = load_delivery(day, args.dir)
    if dl is None:
        print("\n(Delivery data not downloaded for this day - run the fetcher with --delivery)")
    else:
        joined = dl.merge(liquid[["symbol", "name", "chg_pct"]], on="symbol", how="inner") \
            if "name" in liquid.columns else dl
        high = joined[(joined["deliv_pct"] >= 70) & (joined["volume"] >= 100_000)] \
            .sort_values("deliv_pct", ascending=False).head(args.top)
        print(f"\nHigh delivery (>=70% delivered, volume >= 1 lakh shares) - top {args.top}")
        print_table(high, ["symbol", "close", "deliv_pct", "deliv_qty", "volume"],
                    {"close": "{:,.2f}".format, "deliv_pct": "{:.1f}%".format,
                     "deliv_qty": "{:,.0f}".format, "volume": "{:,.0f}".format})

    print("\nPersonal analysis only - not investment advice.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
