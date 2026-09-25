#!/usr/bin/env python3
"""
LearningFundClear - data integrity check
======================================

Answers one question honestly: does everything on the site actually appear in AMFI's
published file, unchanged?

    python tools/verify-data.py           # check, print a report, exit non-zero on failure
    python tools/verify-data.py --offline FILE   # check against a saved copy of NAVAll.txt

Every scheme in assets/js/data.js is looked up in AMFI's own file by scheme code, and
compared on name, NAV, NAV date, plan and option. Exit code 0 means the site is a faithful
reproduction; any other code means figures are being shown that the publisher does not
support, which is the one failure mode a site like this must never have.

Whitespace inside AMFI's scheme names is collapsed to single spaces in data.js (some names
carry double spaces), so names are compared after normalising whitespace. Nothing else is
allowed to differ.
"""

import argparse
import json
import os
import re
import ssl
import sys
import urllib.request

NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
USER_AGENT = "Mozilla/5.0 (compatible; LearningFundClear/1.0; +data verification)"

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
DATA_PATH = os.path.join(PROJECT, "assets", "js", "data.js")

CODE_RE = re.compile(r"^\d{5,7}$")


def fetch(url):
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/plain,*/*"})
    raw = urllib.request.urlopen(request, timeout=30, context=context).read()
    for encoding in ("utf-8", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def parse_published(text):
    """code -> the publisher's own fields, straight out of NAVAll.txt."""
    rows = {}
    for line in text.split("\n"):
        parts = [p.strip() for p in line.rstrip("\r").split(";")]
        if len(parts) >= 8 and CODE_RE.match(parts[0]):
            rows[parts[0]] = {
                "name": parts[3],
                "plan": parts[4],
                "option": parts[5],
                "nav": parts[-2],
                "date": parts[-1],
            }
    return rows


def load_dataset(path):
    source = open(path, encoding="utf-8").read()
    start = source.index("window.LEARNINGFUNDCLEAR")
    payload = source[source.index("{", start): source.rindex("};") + 1]
    return json.loads(payload)


def expected_option(published):
    value = published["option"].lower()
    if value.startswith("growth"):
        return "Growth"
    if "idcw" in value or "income distribut" in value or "dividend" in value:
        return "IDCW"
    return "Other"


def main():
    parser = argparse.ArgumentParser(description="Verify data.js against AMFI's published NAV file.")
    parser.add_argument("--offline", metavar="FILE", help="check against a saved copy of NAVAll.txt")
    args = parser.parse_args()

    print("LearningFundClear data verification")
    if args.offline:
        print(f"  source : {args.offline} (offline copy)")
        text = open(args.offline, encoding="utf-8", errors="replace").read()
    else:
        print(f"  source : {NAV_URL}")
        text = fetch(NAV_URL)

    published = parse_published(text)
    data = load_dataset(DATA_PATH)
    schemes = data["schemes"]
    print(f"  published rows : {len(published)}")
    print(f"  schemes in data.js : {len(schemes)}")
    print()

    normalise = lambda s: re.sub(r"\s+", " ", s).strip()
    problems = []
    for scheme in schemes:
        row = published.get(scheme["code"])
        if row is None:
            problems.append(f"{scheme['code']}: not present in AMFI's file")
            continue
        if normalise(row["name"]) != scheme["name"]:
            problems.append(f"{scheme['code']}: name '{scheme['name']}' != published '{normalise(row['name'])}'")
        if abs(float(scheme["nav"]) - float(row["nav"])) > 1e-9:
            problems.append(f"{scheme['code']}: NAV {scheme['nav']} != published {row['nav']}")
        if scheme["date"] != row["date"]:
            problems.append(f"{scheme['code']}: NAV date {scheme['date']} != published {row['date']}")
        label = row["plan"].lower()
        if label not in ("direct plan", "regular plan"):
            problems.append(f"{scheme['code']}: published plan column is blank, data.js claims '{scheme['plan']}'")
        elif scheme["plan"] != row["plan"].split()[0].capitalize():
            problems.append(f"{scheme['code']}: plan {scheme['plan']} != published {row['plan']}")
        if scheme["option"] != expected_option(row):
            problems.append(f"{scheme['code']}: option {scheme['option']} != published '{row['option']}'")

    plans = sorted({s["plan"] for s in schemes})
    options = sorted({s["option"] for s in schemes})
    checked = {
        "schemes checked": len(schemes),
        "plan labels in use": ", ".join(plans),
        "option labels in use": ", ".join(options),
        "Direct/Regular pairs claimed": str(data["meta"].get("pairedFamilies")),
        "NAV date published": data["meta"].get("navDate", "?"),
        "discrepancies": str(len(problems)),
    }
    for key, value in checked.items():
        print(f"  {key:<30}: {value}")

    if problems:
        print("\nDISCREPANCIES (first 20):")
        for item in problems[:20]:
            print("  -", item)
        print("\nFAIL: data.js shows figures AMFI's file does not support.")
        return 1

    print("\nOK: every published scheme, NAV, date, plan and option matches AMFI's file.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
