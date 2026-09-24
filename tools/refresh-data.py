#!/usr/bin/env python3
"""
FundClear India - data refresh
==============================

Regenerates assets/js/data.js from AMFI's publicly published NAV file.

    python tools/refresh-data.py            # refresh in place
    python tools/refresh-data.py --check    # download, report, write nothing

Why this script exists
----------------------
The site is deliberately a plain static site with no build step and no backend.
AMFI publishes NAVAll.txt every working day and it is free to use, but it is not a
file you fetch from a browser (no CORS headers, ~1.5 MB, ~18 000 rows). So the job
is: download here, curate to a bounded useful subset, write one JS file. Every page
reads that one file.

What this script does NOT do
----------------------------
It does not fetch expense ratios (TER). AMFI has no machine-readable TER feed at its
public paths - /spages/TERAll.txt returns 404 - so the site never *claims* a
per-scheme TER. Instead each category carries an explicitly illustrative industry
range, labelled as an assumption in the UI, and the calculators make the user
confirm or edit it. Do not quietly fold invented TERs into scheme data.

Rules this parser holds itself to
--------------------------------
1. An explicit "Direct Plan" or "Regular Plan" in AMFI's plan column is required. Blank
   is not treated as "Regular" - see the note in parse_rows().
2. Expense ratio is never invented, only labelled as an assumption per category.
3. A stale NAV is dropped rather than shown as current.

Header vocabulary this parser was written against (real lines from NAVAll.txt):
    Open Ended Schemes(Equity Scheme - Large Cap Fund)
    Open Ended Schemes(Equity Schemes - Sectoral Fund)          <- plural, and easy to
    Open Ended Schemes(Income/Debt Oriented Schemes - Liquid Fund)  miss
    Open Ended Schemes(Index Funds - Equity Funds)
    Open Ended Schemes(Exchange Traded Funds (ETFs) - Gold ETF)
    Close Ended Schemes(...)        <- excluded: not purchasable open-ended schemes
    IL&FS Mutual Fund (IDF)         <- a fund house, not a category

Data source: https://www.amfiindia.com/spages/NAVAll.txt
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.request

NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
USER_AGENT = "Mozilla/5.0 (compatible; FundClearIndia/1.0; +static data refresh)"

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
OUT_PATH = os.path.join(PROJECT, "assets", "js", "data.js")

# Bound the payload: Indian mobile traffic is mostly 4G, so keep the file small.
TOTAL_CAP = 1400
PER_BUCKET_CAP = 4          # fund families kept per (fund house, category)
PER_AMC_CAP = 44            # families per fund house, so no single AMC eats the budget
OTHER_BUCKET_CAP = 3        # index/ETF/FoF categories are numerous; keep them in check

# Fair shares per fund house, so cheap index funds are not squeezed out by the
# hundreds of active equity funds. Index funds matter here: they are the standard
# example of how much a Regular plan costs versus buying direct.
PER_AMC_GROUP_CAP = {"Equity": 20, "Hybrid": 10, "Debt": 8, "Solution": 2, "Other": 4}
FRESH_DAYS = 2              # ignore NAVs older than this, they are stale or closed schemes

# Active equity and hybrid funds are what people actually search for, so they are
# collected first; index/FoF/ETF fill whatever budget is left.
GROUP_ORDER = ["Equity", "Hybrid", "Debt", "Solution", "Other"]

SECTIONS = ("Open Ended Schemes", "Close Ended Schemes", "Interval Fund Schemes")

# Prefix on the left of " - " -> which group the scheme belongs to.
# Anything not listed here keeps its full header text as the category name.
PREFIX_GROUPS = {
    "equity scheme": "Equity",
    "equity schemes": "Equity",
    "growth": "Equity",
    "elss": "Equity",
    "debt scheme": "Debt",
    "debt schemes": "Debt",
    "income/debt oriented schemes": "Debt",
    "income": "Debt",
    "gilt": "Debt",
    "money market": "Debt",
    "hybrid scheme": "Hybrid",
    "hybrid schemes": "Hybrid",
    "solution oriented scheme": "Solution",
    "solution oriented schemes": "Solution",
    "children's fund": "Solution",
    "retirement fund": "Solution",
    "life cycle funds": "Solution",
}

# Fund houses people are most likely to search for, in priority order.
AMC_PRIORITY = [
    "SBI Mutual Fund", "HDFC Mutual Fund", "ICICI Prudential Mutual Fund",
    "Nippon India Mutual Fund", "Kotak Mahindra Mutual Fund", "Axis Mutual Fund",
    "Aditya Birla Sun Life Mutual Fund", "UTI Mutual Fund", "Mirae Asset Mutual Fund",
    "PPFAS Mutual Fund", "DSP Mutual Fund", "Tata Mutual Fund", "Franklin Templeton Mutual Fund",
    "Quant Mutual Fund", "Motilal Oswal Mutual Fund", "Edelweiss Mutual Fund",
    "Bandhan Mutual Fund", "Canara Robeco Mutual Fund", "Invesco Mutual Fund",
    "Sundaram Mutual Fund", "HSBC Mutual Fund", "IDFC Mutual Fund", "PGIM India Mutual Fund",
    "JM Financial Mutual Fund", "Union Mutual Fund", "Baroda BNP Paribas Mutual Fund",
    "Mahindra Manulife Mutual Fund", "360 ONE Mutual Fund", "Navi Mutual Fund",
    "Zerodha Mutual Fund", "Groww Mutual Fund", "Helios Mutual Fund", "WhiteOak Capital Mutual Fund",
    "Bajaj Finserv Mutual Fund", "Bank of India Mutual Fund", "ITI Mutual Fund",
    "Samco Mutual Fund", "Shriram Mutual Fund", "TRUST Mutual Fund", "Unifi Mutual Fund",
]

# Illustrative annual expense-ratio ranges, as (direct_min, direct_max, regular_min,
# regular_max) in percent. These are ASSUMPTIONS for calculator defaults, never
# presented as fetched data. First match wins, so order matters.
TER_RULES = [
    (r"^overnight", (0.05, 0.20, 0.15, 0.60)),
    (r"^liquid", (0.10, 0.35, 0.30, 0.90)),
    (r"money market|ultra short|low duration|short term|short duration|floater|floating|arbitrage",
     (0.10, 0.50, 0.30, 1.20)),
    (r"index fund|\betf\b|exchange traded", (0.10, 0.45, 0.60, 1.30)),
    (r"fund of funds|overseas|life cycle", (0.30, 1.10, 1.00, 2.10)),
    (r"small cap", (0.50, 1.20, 1.60, 2.50)),
    (r"mid ?cap", (0.50, 1.15, 1.60, 2.50)),
    (r"large and mid|large & mid", (0.50, 1.10, 1.50, 2.40)),
    (r"large cap", (0.40, 1.00, 1.40, 2.30)),
    (r"flexi|multi cap|focused|value|contra|dividend yield", (0.50, 1.15, 1.55, 2.45)),
    (r"elss", (0.50, 1.20, 1.50, 2.40)),
    (r"sectoral|thematic", (0.60, 1.30, 1.60, 2.50)),
    (r"children|retirement", (0.60, 1.20, 1.50, 2.40)),
    (r"balanced advantage|aggressive hybrid|conservative hybrid|equity savings|hybrid",
     (0.40, 1.05, 1.20, 2.25)),
    (r"corporate bond|banking and psu|gilt|constant maturity", (0.15, 0.60, 0.40, 1.30)),
    (r"credit risk", (0.30, 0.90, 0.70, 1.70)),
    (r"debt|income|duration|dynamic|long term|medium term", (0.20, 0.80, 0.50, 1.50)),
]
DEFAULT_TER_BAND = (0.50, 1.20, 1.50, 2.50)


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")


def clean(text):
    """AMFI's file mixes encodings; strip the resulting replacement characters."""
    return re.sub(r"\s+", " ", str(text).replace("\ufffd", "'").replace("\u2019", "'")).strip()


def ter_band(category):
    """Illustrative expense-ratio range for a category label."""
    lowered = category.lower()
    for pattern, band in TER_RULES:
        if re.search(pattern, lowered):
            return band
    return DEFAULT_TER_BAND


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


def parse_category(line):
    """Return (section, category_name, group) for a section header, else None.

    Only lines that open a real AMFI section count. A fund house whose name happens
    to contain brackets - "IL&FS Mutual Fund (IDF)" - must not be mistaken for one.
    """
    for section in SECTIONS:
        if line.startswith(section + "(") and line.endswith(")"):
            inner = clean(line[len(section) + 1:-1])
            return section, inner, None
    return None


def category_details(inner):
    """Split a section's inner text into a display category and a group."""
    if " - " in inner:
        prefix, _, rest = inner.partition(" - ")
        prefix_key = prefix.lower().strip()
        group = PREFIX_GROUPS.get(prefix_key)
        if group:
            # e.g. "Equity Scheme - Large Cap Fund" -> "Large Cap Fund"
            return rest.strip(), group
        # e.g. "Index Funds - Equity Funds" -> keep both halves, they are both meaningful
        if rest.strip().lower() == prefix_key:
            return prefix.strip(), "Other"
        return f"{prefix.strip()} - {rest.strip()}", "Other"

    group = PREFIX_GROUPS.get(inner.lower().strip(), "Other")
    return inner, group


def parse(text):
    rows, section, category, group, amc = [], None, None, None, None
    skipped = 0
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.lower().startswith("scheme code;"):
            continue

        header = parse_category(line)
        if header:
            section, inner, _ = header
            category, group = category_details(inner)
            continue

        if ";" not in line:
            # Fund house name line. Guard against noise that is neither name nor category.
            if section and not re.search(r"\d", line):
                amc = clean(line)
            continue

        parts = [p.strip() for p in line.split(";")]
        if len(parts) < 8:
            skipped += 1
            continue
        code, isin_growth, isin_reinv, name, plan, option, nav, date = parts[:8]
        if not code.isdigit() or not category or not amc or section != "Open Ended Schemes":
            skipped += 1
            continue

        # The plan field is BLANK on 5,760 of AMFI's ~14,400 rows: ETF series, legacy
        # plans, segregated portfolios. Those rows are ambiguous - an ETF has no plans at
        # all, and a blank field is not evidence of "Regular". Guessing here would have
        # put invented plan labels next to real NAVs and would have fabricated
        # Direct/Regular pairs, so an explicit label is required. 8,634 rows carry one.
        plan_label = plan.strip().lower()
        if plan_label == "direct plan":
            plan_out = "Direct"
        elif plan_label == "regular plan":
            plan_out = "Regular"
        else:
            skipped += 1
            continue

        option_label = option.strip().lower()
        if option_label.startswith("growth"):
            option_out = "Growth"
        elif "idcw" in option_label or "income distribut" in option_label or "dividend" in option_label:
            option_out = "IDCW"
        else:
            option_out = "Other"

        try:
            nav_value = float(nav)
        except ValueError:
            skipped += 1
            continue
        rows.append({
            "code": code,
            "isin": isin_growth if isin_growth not in ("", "-") else (isin_reinv if isin_reinv != "-" else None),
            "name": clean(name),
            "amc": amc,
            "category": category,
            "group": group or "Other",
            "plan": plan_out,
            "option": option_out,
            "nav": round(nav_value, 4),
            "date": clean(date),
        })
    return rows, skipped


def drop_stale(rows):
    """A handful of schemes carry NAVs years out of date.

    Showing a 2016 NAV as today's price would be worse than dropping the scheme, so
    anything outside FRESH_DAYS of the newest date is excluded and counted.
    """
    if not rows:
        return [], 0
    dated = [(dt.datetime.strptime(r["date"], "%d-%b-%Y"), r) for r in rows]
    latest = max(d for d, _ in dated)
    fresh = [r for d, r in dated if (latest - d).days <= FRESH_DAYS]
    return fresh, len(rows) - len(fresh)


def curate(rows):
    """Keep a bounded, recognisable slice, preserving Direct/Regular pairs.

    Schemes are grouped by (fund house, category, scheme name) so that when a fund
    offers both plans, both survive together - the whole point of the comparison page.
    """
    amc_rank = {name: i for i, name in enumerate(AMC_PRIORITY)}
    keep = [r for r in rows
            if r["amc"] in amc_rank
            and r["option"] == "Growth"
            and r["plan"] in ("Direct", "Regular")]

    def group_rank(group):
        return GROUP_ORDER.index(group) if group in GROUP_ORDER else len(GROUP_ORDER)

    group_of = {r["category"]: r["group"] for r in keep}
    families = {}
    for row in keep:
        # "HDFC Flexi Cap Fund - Direct Plan" and "... - Regular Plan" share a family.
        family = re.split(r"\s*-\s*(Direct|Regular)\s*Plan", row["name"])[0].strip()
        families.setdefault((row["amc"], row["category"], family), []).append(row)

    ordered = sorted(
        families.items(),
        key=lambda kv: (amc_rank[kv[0][0]], group_rank(group_of[kv[0][1]]), kv[0][1], kv[0][2]),
    )

    per_bucket, per_amc, per_amc_group, seen_code, out = {}, {}, {}, set(), []
    for (amc, category, _family), members in ordered:
        bucket = (amc, category)
        group = group_of[category]
        cap = OTHER_BUCKET_CAP if group in ("Other", "Solution") else PER_BUCKET_CAP
        if (per_bucket.get(bucket, 0) >= cap
                or per_amc.get(amc, 0) >= PER_AMC_CAP
                or per_amc_group.get((amc, group), 0) >= PER_AMC_GROUP_CAP.get(group, 3)):
            continue
        # Every counter here counts fund families, not rows, so a fund offering both
        # plans cannot consume two slots of the budget.
        per_bucket[bucket] = per_bucket.get(bucket, 0) + 1
        per_amc_group[(amc, group)] = per_amc_group.get((amc, group), 0) + 1
        per_amc[amc] = per_amc.get(amc, 0) + 1
        for row in sorted(members, key=lambda r: r["plan"]):
            if row["code"] in seen_code:
                continue
            seen_code.add(row["code"])
            out.append(row)
        if len(out) >= TOTAL_CAP:
            break

    out.sort(key=lambda r: (amc_rank[r["amc"]], group_rank(r["group"]), r["category"], r["name"], r["plan"]))
    return out


def family_name(scheme_name):
    """Display name of the fund without its plan suffix - used for pairing plans."""
    return re.split(r"\s*-\s*(Direct|Regular)\s*Plan", scheme_name)[0].strip()


def build(rows, source_rows, skipped, dropped_stale):
    nav_dates = sorted({r["date"] for r in rows}, key=lambda d: dt.datetime.strptime(d, "%d-%b-%Y"))
    categories = sorted({(r["category"], r["group"]) for r in rows}, key=lambda c: (c[1], c[0]))
    amcs = sorted({r["amc"] for r in rows})

    category_meta = []
    for name, group in categories:
        direct, regular = ter_band(name)[:2], ter_band(name)[2:]
        category_meta.append({
            "id": slug(name),
            "name": name,
            "group": group,
            "terDirect": [direct[0], direct[1]],
            "terRegular": [regular[0], regular[1]],
            "schemeCount": sum(1 for r in rows if r["category"] == name),
        })

    families = {}
    for row in rows:
        families.setdefault(row["amc"] + "||" + family_name(row["name"]), []).append(row["plan"])
    paired = sum(1 for plans in families.values() if "Direct" in plans and "Regular" in plans)

    return {
        "meta": {
            "site": "FundClear India",
            "source": "AMFI NAVAll.txt",
            "sourceUrl": NAV_URL,
            "sourceNote": ("AMFI publishes this file every working day. FundClear does not use "
                           "NSE or BSE price feeds and does not redistribute licensed exchange data."),
            "fetchedAt": dt.datetime.now().astimezone().strftime("%d %b %Y, %H:%M %Z"),
            "navDates": nav_dates,
            "navDate": nav_dates[-1] if nav_dates else None,
            "schemeCount": len(rows),
            "sourceRowCount": source_rows,
            "rowsSkipped": skipped,
            "droppedStale": dropped_stale,
            "freshnessDays": FRESH_DAYS,
            "skippedNote": ("Rows skipped are closed-ended, interval, malformed or non-NAV rows - "
                            "this portal only lists open-ended schemes you can actually buy."),
            "pairedFamilies": paired,
            "amcCount": len(amcs),
            "categoryCount": len(categories),
            "terPolicy": ("Expense ratios are not fetched: AMFI publishes no machine-readable TER file "
                          "(/spages/TERAll.txt returns 404). Every TER on this site is an editable "
                          "assumption you must confirm against the AMC factsheet."),
        },
        "groups": ["Equity", "Hybrid", "Debt", "Solution", "Other"],
        "plans": ["Direct", "Regular"],
        "categories": category_meta,
        "schemes": rows,
    }


def write_js(payload, out_path):
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    meta = payload["meta"]
    js = (
        "/*!\n"
        " * FundClear India - site data  (GENERATED FILE - do not hand-edit)\n"
        " *\n"
        f" * Source  : {meta['source']} ({meta['sourceUrl']})\n"
        f" * Fetched : {meta['fetchedAt']}\n"
        f" * NAV date: {meta['navDate']}   Schemes: {meta['schemeCount']}"
        f"   Fund houses: {meta['amcCount']}   Categories: {meta['categoryCount']}\n"
        " *\n"
        " * Expense ratios are NOT in this file - see tools/refresh-data.py for why.\n"
        " * Regenerate with:  python tools/refresh-data.py\n"
        " */\n"
        f"window.FUNDCLEAR = {body};\n"
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(js)
    return len(js.encode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description="Refresh FundClear's data file from AMFI.")
    parser.add_argument("--check", action="store_true", help="report only, write nothing")
    parser.add_argument("--url", default=NAV_URL, help="override the NAV file URL")
    parser.add_argument("--out", default=OUT_PATH, help="output JS path")
    args = parser.parse_args()

    print(f"Fetching {args.url}")
    text = download(args.url)
    rows, skipped = parse(text)
    fresh, dropped_stale = drop_stale(rows)
    curated = curate(fresh)
    payload = build(curated, len(rows), skipped, dropped_stale)
    meta = payload["meta"]

    print(f"  parsed open-ended rows : {len(rows)}")
    print(f"  skipped (closed/other) : {skipped}")
    print(f"  dropped stale NAVs     : {dropped_stale} (older than {FRESH_DAYS} days)")
    print(f"  kept after curate      : {meta['schemeCount']}  "
          f"({meta['pairedFamilies']} Direct/Regular pairs)")
    print(f"  fund houses            : {meta['amcCount']}")
    print(f"  categories             : {meta['categoryCount']}")
    print(f"  NAV date               : {meta['navDate']}")

    if not curated:
        print("No rows survived curation - refusing to overwrite the data file.", file=sys.stderr)
        return 2
    if args.check:
        print("--check: nothing written")
        return 0

    size = write_js(payload, args.out)
    print(f"  wrote                  : {args.out} ({size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
