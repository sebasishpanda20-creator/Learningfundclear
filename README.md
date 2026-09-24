# FundClear India

A small, static, independent website that publishes Indian mutual fund data — and does
nothing else. No recommendations, no return projections, no backend, no bill.

**What it is:** NAVs and scheme facts for roughly 1,400 open-ended Indian mutual fund
schemes, from AMFI's own free daily file, plus four calculators that do arithmetic on
numbers you enter. The comparison the site is built around is the one AMFI's data actually
supports: the **same fund's Direct plan versus its Regular plan**, using real NAVs.

**What it is not:** an adviser, a research analyst, a broker, a stock screener, or a
source of exchange prices. It never says buy, sell or hold, and it never suggests how much
a fund will return. See `methodology.html` and `legal.html`.

---

## Run it locally

No build step, no dependencies, no install. Any static server works:

```bash
python -m http.server 8000
# then open http://127.0.0.1:8000
```

It also opens straight from `file://` — every path is relative and nothing is fetched over
the network.

## Refresh the data

```bash
python tools/refresh-data.py          # download AMFI's file and rewrite assets/js/data.js
python tools/refresh-data.py --check  # report what would change, write nothing
python tools/verify-data.py           # prove data.js matches AMFI's file; exits non-zero if not
```

Python 3.8 or later, standard library only. Run it in this folder. `verify-data.py` is the
one that matters before you publish: it re-downloads the publisher's file and compares
every scheme's name, NAV, NAV date, plan and option, failing if the site is showing a figure
AMFI does not support. The GitHub Actions workflow runs it on every deploy.

## Personal analysis tools (not part of the site)

Two further scripts in `tools/` exist for personal NSE end-of-day analysis.
Nothing on the site reads them or their output:

```bash
python tools/fetch-bhavcopy.py --delivery --backfill 10   # -> data/bhavcopy/*.csv
python tools/analyze-bhavcopy.py                          # gainers, losers, delivery
```

`fetch-bhavcopy.py` downloads NSE's public bhavcopy and delivery files;
`analyze-bhavcopy.py` prints the day's top gainers, top losers and
high-delivery names. The analyser needs pandas (`pip install pandas`); the
fetcher is standard library only. Neither one recommends anything — they are
sorted lists of yesterday's tape.

**They exist to keep exchange data out of the site.** NSE/BSE data is licensed
for personal use, not redistribution, which is the same rule that keeps
exchange prices off every page. So the CSVs are written to `data/bhavcopy/`,
which is gitignored and therefore never committed or deployed, and
`bhavcopy-data/` holds a **separate private repository** that archives the same
files nightly (see `bhavcopy-data/README.md`). Don't add either folder to this
repo, and don't publish the CSVs.

Two things enforce that, because a CSV is easy to commit by accident: the
**pre-commit hook** in `.githooks/` refuses to stage a CSV or anything under
`data/` or `bhavcopy-data/`, and the deploy workflow refuses to publish the
folder if one ever gets past it. Git never runs hooks out of a clone on its own
— otherwise cloning any repository would run its code — so enable it once per
clone:

```bash
git config core.hooksPath .githooks
```

Nothing else depends on that line: the deploy check is the backstop, and any
clone without the hook still behaves normally.

## Structure

```
fundclear/
├─ index.html            what the site is, live latest-NAV date, the Direct-vs-Regular insight
├─ funds.html            every scheme: search, filters, sorts, URL-synced
├─ scheme.html           one scheme: facts, sibling plan, same-category peers
├─ compare.html          two to four schemes side by side, with computed deltas
├─ calculators.html      SIP, step-up SIP, lumpsum, expense-ratio drag
├─ methodology.html      data provenance, exclusions, why TER is an assumption, formulas
├─ legal.html            risk disclaimer, DPDP privacy notice, terms, grievance contact
├─ 404.html              self-contained error page
├─ assets/
│  ├─ css/style.css      the whole design system: light and dark, mobile-first
│  ├─ favicon.svg
│  └─ js/
│     ├─ data.js         GENERATED. The only data file. Every page reads it.
│     ├─ ui.js           DOM helper, Indian number formatting, URL state, toasts
│     ├─ funds.js        data access layer: search, filter, sort, plan pairing, TER ranges
│     ├─ calc.js         SIP / lumpsum / step-up / expense-drag arithmetic
│     ├─ site.js         page shell: nav, data strip, footer year, risk line
│     └─ pages/*.js      one controller per page, loaded by that page only
├─ tools/
│  ├─ refresh-data.py    the script that builds data.js from AMFI
│  ├─ verify-data.py     proves data.js matches AMFI's file, field by field
│  └─ fetch-bhavcopy.py, analyze-bhavcopy.py   personal NSE tools — see below
├─ data/bhavcopy/        those tools' output: gitignored, never committed or deployed
├─ bhavcopy-data/        SEPARATE private repo: the nightly archive of that data
├─ .github/workflows/    nightly refresh + checks + GitHub Pages deploy
├─ netlify.toml, _headers, .nojekyll, robots.txt, sitemap.xml
└─ FREE-HOSTING.md, DEPLOY.md
```

The single rule that keeps this maintainable: **every page gets its data from `data.js`
through `funds.js`**, and adding a scheme is a data-refresh, not a code change.

## Design decisions worth knowing

- **Classic scripts, not ES modules.** Modules break under `file://` and complicate
  sub-path hosting; plain scripts work everywhere, including a USB stick.
- **No build step, ever.** The refresh script writes one JSON file. What you see in this
  folder is what gets deployed.
- **TER is labelled an assumption, not a fact.** AMFI publishes no machine-readable
  expense-ratio file (the old `TERAll.txt` path returns 404), so the site ships an
  illustrative range per category, marks it as assumed wherever it is used, and lets you
  override it in the calculator. **No page claims a per-scheme expense ratio.**
- **No exchange data.** NSE/BSE prices are licensed products. The site republishes only
  AMFI's free file, which is why it can stay free and legal.
- **Prerendering is the known next improvement.** Pages render in the browser, which keeps
  hosting free but is weaker for search engines than one generated page per scheme.

## Legal posture (the short version)

Data publication plus mechanical calculators, which avoids SEBI registration — but only
because there is no advice anywhere in it. Free advice is still advice: if a recommendation
about a named scheme is ever added, that changes the regulatory position, and the Aug 2024
and Jan 2025 SEBI amendments on unregistered advice and on stock-market education are
directly relevant. The full position, and what may and may not be displayed, is on
`legal.html` and `methodology.html`.

Before launch: fill in the grievance contact at `legal.html#grievance`, and put your real
address into `sitemap.xml` (the GitHub Actions workflow does this automatically).
