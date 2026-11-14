import io
import glob
import os
import re

targets = sorted(glob.glob("*.html")) + sorted(glob.glob("funds/*.html"))

CSS_LINK = '<link rel="stylesheet" href="%sassets/css/mobile-first.css" />'
JS_TAG = '<script src="%sassets/js/mobile-first.js"></script>'

# Remove any body-level include from the first pass, then place the script in
# <head> so window.LfcMobile exists before page scripts run.
body_js = re.compile(r'[ \t]*<script src="[^"]*assets/js/mobile-first\.js"></script>\r?\n')

changed = []
problems = []

for path in targets:
    nested = ("/" in path) or ("\\" in path)
    prefix = "../" if nested else ""
    src = io.open(path, encoding="utf-8", newline="").read()
    original = src

    src = body_js.sub("", src)

    if "mobile-first.css" not in src:
        if "</head>" not in src:
            problems.append((path, "missing </head>"))
            continue
        src = src.replace(
            "</head>", "    " + (CSS_LINK % prefix) + "\n  </head>", 1
        )

    if "mobile-first.js" not in src:
        if "</head>" not in src:
            problems.append((path, "missing </head>"))
            continue
        src = src.replace(
            "</head>",
            "    " + (JS_TAG % prefix) + "\n  </head>",
            1,
        )

    if src != original:
        io.open(path, "w", encoding="utf-8", newline="").write(src)
        changed.append(path)

print("pages:", len(targets), "updated:", len(changed))
for p in changed:
    print("  +", p)
if problems:
    print("problems:", problems)

for path in targets:
    src = io.open(path, encoding="utf-8", newline="").read()
    head = src.split("</head>")[0]
    body = src.split("</head>")[-1]
    ok = "mobile-first.css" in head and "mobile-first.js" in head
    if not ok:
        print("  !! not wired:", path)
    if "mobile-first.js" in body:
        print("  !! still in body:", path)
