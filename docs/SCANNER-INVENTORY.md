# Scanner and scheduled-job inventory

This reconciles the readiness gap that previously said “NO_SERVER_SIDE_SCAN_JOB”. A nightly EOD
scan does exist, outside the Worker. What does **not** exist is a Worker-hosted intraday scan.
Several jobs are distinct and must not be merged into a second engine.

| # | Job | Source | Runtime | Schedule | Enabled | Inputs | Rule / version | Output | Latest available evidence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Nightly EOD zone scan | `tools/signal-scan.js` + `scanner-logic.js` | Node 20 on GitHub Actions | `30 12 * * *` (18:00 IST) | workflow schedule enabled in source | `tools/signal-watchlist.json`, optional `SCAN_SYMBOLS`, `SCAN_TIMEFRAMES=d,w,m`, Yahoo EOD bars | Legacy Pivot (`computeZones`, 0–6 confluence). GTF-Pro exists but `GTF_PRO` defaults off; `--gtf-pro`/`GTF_PRO=true` required | Supabase `signal_events` via `tv-webhook`; optional Telegram digest; job summary | `success` 2026-11-10T19:55Z run `42890057935` (schedule). Earlier: 2026-11-10T00:47Z dispatch, 2026-11-09T22:37Z schedule |
| 2 | Missed-scan watchdog | `.github/workflows/scan-watchdog.yml` | GitHub Actions | `0 16 * * *`, `30 17 * * *` | enabled in source | GitHub Actions run history for `signal-scan.yml` | N/A — dispatches job 1 | Recovery dispatch + GitHub issue; optional Telegram | `success` 2026-11-10T22:27Z run `42914717190` |
| 3 | Browser demand/supply scanner | `scanner.html`, `scanner-logic.js`, `scanner-auto.js` | Browser (no server) | on open + every 15 min while visible | enabled | Yahoo chart API or local CSV; watchlist in page | `scanner-logic.js` zone/confluence rules (same code used by job 1) | DOM table, setup sheet, `lfc.bars.v2.*` browser cache; no server persistence | `qa/scanner-api-ab.cjs` 21/21; `qa/data-propagation.cjs` 7/7 |
| 4 | Crypto watch evaluation | `server/email-alerts.mjs` | Cloudflare Worker cron | Worker tick every minute; work gated by `ALERT_EVAL_MINUTES` (default 5) | code ready, not deployed | KV `plan:*` (paper debit spreads), Delta public tickers | `LfcCryptoDesk.monitor` (crypto-desk-engine) | Resend email on `STOP WATCH` / `TARGET WATCH` / `TIME EXIT` | `qa/free-tier-budget.test.mjs` 7/7; live send **NOT RUN** |
| 5 | Daemon health watchdog | `server/daemon-watch.mjs`, `server/keep-warm.mjs` | Cloudflare Worker cron | every minute | code ready, not deployed | `QUANT_API_ORIGIN`, KV `daemon:health` | 5 consecutive failures → one email per outage | Resend email | `qa/daemon-watch.test.mjs` |
| 6 | Nifty 500 data collector | `.github/workflows/nifty500-data.yml`, `qa/nifty500-collector.py` | GitHub Actions + Python | weekday slots 04:00–10:45 UTC, 12:30/14:00/15:30 UTC | enabled in source | NSE/AMFI public data | data collection, not a scanner | encrypted `market-data/*.enc.json` snapshot | workflow history not queried here |

## Distinctions

- **Nightly/EOD scanning:** job 1. Runs after close, writes `signal_events`; not intraday.
- **Intraday scanning:** job 3 only, in the browser. There is no Worker/server intraday scan.
- **Watch evaluation:** job 4 (paper crypto spreads) and job 5 (daemon health).
- **Email delivery:** jobs 4 and 5 via Resend; job 1 can post a Telegram digest.
- **Recovery:** job 2 dispatches job 1; it does not scan.

## Duplicate-engine check

`tools/signal-scan.js` requires `scanner-logic.js` rather than reimplementing zones. The browser
uses the same file. GTF-Pro is a separate engine behind an explicit flag and defaults off. No new
Worker scanner has been added, and the market-context milestone does not compute signals.

## Caveats

- The latest runs found locally are 2026-11-10. This audit does not prove the schedule is currently
  running; GitHub Actions schedules are best-effort and can be delayed or dropped.
- Job 1 writes to Supabase through a webhook secret; that secret is not present in this workspace,
  so the scan was not executed here.
- Job 4 has no live Delta/Resend credentials here; its tests use fakes.
