# Scanner runbook — rate-limit recovery & maintenance notes

**Repo:** https://github.com/sebasishpanda20-creator/Learningfundclear
**Live:** https://sebasishpanda20-creator.github.io/Learningfundclear/
**Written:** 2026-10-02
**Applies to:** `tools/signal-scan.js` (nightly GitHub Actions scan), `scanner.html` / `scanner-logic.js` (browser scanner), `tools/research-thin-commodities.js` (research harness).

This page is the maintainer's short memory for the Yahoo rate-limit handling in this codebase. If it's wrong, fix it in this file and tell the next person what changed — it's deliberately small and repeatable.

---

## 1. How Yahoo throttles us here

- **429 (Too Many Requests)** shows up when a bulk scan fires all the symbols in one breath, or when two different parts of the pipeline fetch the same symbol in the same minute.
- The browser scanner is **not** the bottleneck: its pool is 5 workers and it uses `AbortController` timeouts of 15 s, so a hung response can't hold a slot.
- The **real throughput driver** is `tools/signal-scan.js` (the nightly CI scan) which fetches hundreds of symbols × timeframes through the same Yahoo endpoint. That's the workload that historically lost 487/501 symbols to transient `fetch failed` on full-board runs.

## 2. Where the recovery logic lives

### Browser scanner (`scanner.html` → `scanner-logic.js`)
- **Pool:** 5 workers for the first pass, 2 workers with 4 s spacing for the recovery pass.
- **`sleep(ms)`** — plain `setTimeout` promise, reused by both passes.
- **Recovery path:** `recoverFailures(failed, days, onResult)` — calls `sleep(2500)`, then a 2-worker pool with one spaced retry each (`sleep(4000).then(...)`).
- **Per-symbol cache:** 20 h TTL (`cacheKey(symbol, tf)`, `CACHE_TTL = 20 * 60 * 60 * 1000`). First scan of the day is slow; rescans are instant.
- **Hard timeouts:** `fetchT(url, 15000)` in `fetchDirect`; proxy fallback via `fetchViaProxy` (jina.ai) at 25 s.

### Nightly CI scan (`tools/signal-scan.js`)
- **`getBars()` retry/backoff in `research-thin-commodities.js`:** 4 attempts, `1500ms × attempt`, breaks early on `"not found|delisted"`. Asymmetric to the browser pool — the CI tool is the slow, heavy-duty one.
- **Run at 6:00 AM IST** (cron `30 12 * * *` in `.github/workflows/signal-scan.yml`).
- **Dry-run mode:** pass `--dry-run` to exercise everything except the database "saved" path. Useful for testing the gate and report lines without a run today.

## 3. Recovery timing (the numbers to remember)

| Stage | Delay | Why |
|---|---|---|
| Initial burst | 5 workers, no backoff | Fast bulk fetch; a stuck symbol holds one slot until done or aborted |
| First failure seen | 2,500 ms chill | Give the proxy a moment before the recovery pass starts |
| Recovery worker slot | 2 workers | Half the original pool, so a stall doesn't cascade |
| Retry spacing (recovery pass) | 4,000 ms | Once per worker per symbol; short enough to finish the day, long enough to let the proxy breathe |
| Per-bars fetch timeout | 15,000 ms | Hard abort so a hung response can't hold a worker forever |
| Daily-bar cache | 20 h TTL | Same-day rescans are instant; different symbols are fetched fresh |

**Rule of thumb:** a full back-to-back run loses roughly 1 in 180 symbols to 429s; the recovery pass gets nearly all of them back within ~20–30 s of the first failure. If a symbol is still missing after the recovery pass (e.g. delisted or "not found"), it's left as a skip, not retried forever.

## 4. Ci run log reading

- **Job log:** `curl -sL -H "Authorization: Bearer $TOKEN" https://api.github.com/repos/<owner>/<repo>/actions/jobs/<job-id>/logs`
- **Strip the job header timestamps:** `sed -i 's/^\S\+Z //' joblog.txt`
- **Watch the tail for:** `N rate-limited task(s)` → recovery pass message, final `Done.` / `No stocks matched` line, and the digest (conf spread, live hit-rate line, weekly line, saved-signal count).
- **Dry-run digest example:** `board 45% hit · +0.47R EV`, spread line like `_Conf spread tonight: 3·n · 4·n · 5-6·n (4+ would keep X/Y)_`, live 90-day line.

## 5. If it keeps failing

1. **Verify the URL shape** — if the script fetches `?range=undefined&interval=undefined` to Yahoo, every request 400s and zero rows resolve. The current code passes the TIMEFRAMES daily entry (e.g. `{ id: "d", label: "Daily", yrange: "1d" }`), so range/interval are correct.
2. **Check the proxy** — the jina.ai fallback is the fallback for literally every fetch; if the proxy is down, everything 429s.
3. **Watch the burst window** — two consecutive full-board runs share the same Yahoo allowance. If you re-run a scan manually while a CI run is warm, expect more 429s and a longer recovery.
4. **Watchlists:** a symbol that nets a 429 on every pass is either rate-limited or delisted/missing — check its symbol in a browser, not in the log.
5. **Daily-bar cache expiry:** if you manually re-fetch the same symbol ~20 h later, the cache misses and you pay a fresh Yahoo request — that's expected, not a bug.

## 6. Known-good settings (as of this runbook)

- `minConfluence: 4` (live), trend filter on, inside only, `maxZones: 20`
- Live scanner: `pivotLeft / pivotRight = 3 / 3`, Daily + Weekly + Monthly, 2-year history, trend filter on, touching-on, no distance cap, no volume filter
- Safe day-ahead rescan: same settings + cached bars (no re-fetch) = instant, zero 429 risk

> *If you hit a 429 pattern we haven't seen before, copy the log lines (job ID + timestamp) here or into the repo and have the next person verify the retry/backoff vs. the numbers above before changing it.*

---
*Generated 2026-10-02. Update this file whenever the retry/backoff, pool size, or recovery window changes.*
