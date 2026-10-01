# Demand Zone Scanner — One-Page Quick Reference

**Repo:** https://github.com/sebasishpanda20-creator/Learningfundclear  ·  **Live:** https://sebasishpanda20-creator.github.io/Learningfundclear/  ·  **Page:** scanner.html
**Written:** 2026-10-02 · **Verify against the live page before printing.**

---

## 1 · Scan settings (top card)

| Control | What it does | Default |
|---|---|---|
| Pivot left / Pivot right | Bars either side of the pivot that define the zone's source structure (1–10) | 3 / 3 |
| Timeframes | Daily, Weekly, Monthly, Hourly, 15m (MIS) — tick the ones you care about | Daily, Weekly, Monthly checked |
| Daily history | 1 / 2 / 3 years of EOD bars (more history = more data to find zones in) | 2 years |
| Require bullish EMA trend | Only pass rows where EMA10 > EMA20 > EMA50 | off |
| Include candles touching a zone | also shows candles merely touching a zone edge; off → only fully "INSIDE" | on |
| Max distance above zone % | null = off; e.g. 1.0 = also keep rows where last close is ≤1% above the zone top (don't chase the breakout yet) | off |
| Volume above 20-day average | keep only rows where last volume ≥ 20-day average volume | off |

**Commit your setup:** the tool saves every setting (pivot, days, checkboxes, maxDist, volFilter) into localStorage under `lfc.scanSettings`, so a return visit restores exactly what you used.

**Watchlist** (one symbol per line): NSE equities `RELIANCE.NS`, BSE `500325.BO`, commodity futures `GC=F`, `CL=F`, `BZ=F`, `NG=F`, `HG=F`, `ALI=F`, `ZNC=F`, `PL=F`. Bare numbers → BSE, bare words → NSE. Use the **+ commodities** button to add gold, silver, crude, natgas, copper, zinc, aluminium, platinum (MCX codes don't exist on Yahoo; these global contracts track them). Import/paste CSV/lines/comma-separated; use **Replace** or **Merge**; **Defaults** restores the 75-symbol banking/IT/energy/FMCG/auto/metals/pharma/infra list.

**Run →** the scan starts 5 workers at a time. Watch the message line: it reports scanned/skipped/failed and says "Recovering N rate-limited task(s)…" while the proxy cools down.

---

## 2 · Result table & tags

```text
Symbol    TF      Price ₹   Trend        Demand zone      Position  Dist to zone   Zone date   Vol vs 20d
RELIANCE  Daily   2115.7    UPTREND      2100.00 – 2120.0  INSIDE    0%             01-07       +12%
COALINDIA TOUCHING 1200.0   SIDEWAYS     none             TOUCHING  2.5%           01-06       —
```

| Tag | Meaning |
|---|---|
| UPTREND / DOWNTREND / SIDEWAYS | EMA 10 > 20 > 50 / EMA10 < 20 < 50 / otherwise |
| INSIDE | current low/high sits inside a live demand or supply zone |
| TOUCHING | candle only touches a zone edge (only when the "Include touching" box is ticked) |
| Zone | demand zone spans [body top → low] for a confirmed pivot low; [high → body bottom] for a pivot high; dies the day the close closes through it |
| Dist to zone | the last close's distance from the zone (0% = fully inside, % = above/near the top) |
| Zone date | date the zone was created |
| Vol vs 20d | `(lastVol / avgVol20 − 1) × 100`, "+" when above average |

Columns: **Symbol · TF · Price ₹ · Trend · Demand zone · Position · Dist to zone · Zone date · Vol vs 20d · Chart**

**Chart (click any row):** candlesticks (green up / red down), EMA20 (blue), EMA50 (gold), demand zones shaded green, last price marker. Note: the reference card says "zones drawn from their pivot bar to the right edge" — a zone is only drawn from its own pivot bar rightwards, not from the current bar.

**Download Results (CSV):** UTF-8 CSV with BOM (Excel-friendly) — Symbol, TF, Price, Trend, Demand Zone, Position, Dist to zone, Zone Date, Vol vs 20d.

---

## 3 · Price / IV sanity check (use before trusting a zone)

The scanner is an independent pivot approximation on free Yahoo EOD data; it does **not** model fees, slippage, taxes, gaps, or real chart levels. Before acting:

1. Pull the exact zone on your broker's platform (or TradingView) and confirm the pivot structure.
2. Check the scan's own notes/context: is this zone fresh (just formed), or has price already closed into it several times?
3. Prefer zones that are INSIDE and fresh over zones that have been chopped through twice.
4. Read the disclaimer on every page: verify every chart on your broker, consult a SEBI-registered professional, and treat everything here as research, not advice.

**Quick skip rule:** if `maxDist` is set, a row is shown only when the last close is within that % above the zone top — that's your "don't chase" guard. If the trend filter is on, the scanner only passes straight-trend days.

---

## 4. When to skip a scan (good to know)

Skip a full scan (or narrow it) when:
- **Yahoo rate-limited** — backs off with the recovery pass (2 workers, 4 s spacing); the message line says `Recovering N rate-limited task(s)…`. Wait a few minutes and rescan.
- **No matching rows** — lower the pivot, turn on "touching", or relax `maxDist` / `volFilter`.
- **Too many rows** — tighten by raising pivotRight/pivotLeft, checking only Daily, or raising `maxDist`.
- **Watchlist too big for the day** — remove delisted or illiquid stocks (e.g. delisted BSE/NSE names) — each symbol is one task.
- **You only trust a fresh zone** — tick "Include candles touching a zone" only when you want the raw bounce material; otherwise it floods the results with low-probability touches.

---

## 5. One-page command card

```bash
# live scan of the watchlist as-is
open scanner.html                      # sign in first (see manual.md for how)

# or run the matching scanner headlessly from the repo
node tools/signal-scan.js                # uses tools/signal-rules.json (minConfluence 4 live)
node tools/signal-scan.js --conf=4 --save-nse   # also writes today's NSE rows to signal_events
```

**First scan of the day cost:** the EOD cache writes symbols+range→bars in localStorage for 20 h, so a
rescan the same day is instant; the first scan fetches each symbol (with Yahoo proxy fallback and a
small worker pool with retry/backoff).

*Freebuff · private research journal · not investment advice*
