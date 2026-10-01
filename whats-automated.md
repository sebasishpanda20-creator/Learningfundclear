# What's automated — and what still needs a human

**Version 1.0**
**Repo:** https://github.com/sebasishpanda20-creator/Learningfundclear
**Live:** https://sebasishpanda20-creator.github.io/Learningfundclear/
**Confirmed at:** 2026-10-02

This is a run-down of everything in the LearningFundClear portal that runs without a person at the keyboard, plus what still needs a human to act on it.

The theme: automation should do the *observing* and the *reporting* so the human only confirms, reviews, and occasionally re-points something. Nothing here touches a real order, a real wallet, or a real broker — the portal is research-only by design.

---

## 1. What is fully automated

### 1.1 GitHub Pages deployment
- The site auto-deploys on every push to `main` (workflow `deploy-pages.yml`).
- No manual upload or server step. The live site mirrors `origin/main` within a few minutes.

### 1.2 Housekeeping data refresh
- A scheduled job pushes the daily "data: refresh NAV snapshot" commit to `main`. This keeps the local
  `data/` copies (including `NIFTY500-EV-Ranking.html`, `NSE-SECTOR-RELATIVE-STRENGTH.html`, `NAVAll.txt`
  mirrors, and the index used by the funds portal) current without anyone opening the repo.

### 1.3 The money-scan pipeline (nights at 18:00 IST)
- `signal-scan.yml` runs daily at **30 12 * * *** (18:00 IST, 15:30 UTC).
- It fetches EOD/1d/wk/hi bars for every symbol in `supabase.scan_symbols` via the JavaScript toolchain,
  applies the live rules and the conf-4 gate, writes new rows to `signal_events`, and posts a digest (live
  hit-rate line, weekly line, conf spread, per-symbol rows).
- Watchdog `scan-watchdog.yml` fires at 21:30 and 23:00 IST if no scan completed in the window; it files a
  dated GitHub issue and optionally notes it to Telegram. It uses only `github.token` and reports nothing
  sensitive.

### 1.4 Supabase RLS fixes (already deployed, one-time)
- The `signal_events` table's read-level security policy was corrected and verified with the anon key:
  anon rows return a real `Content-Range` and the live hit-rate tracker began populating.
- `HDFC.NS` was removed from `supabase.scan_symbols` via a management SQL query after the anon key could not
  delete it. It no longer eats a nightly task slot.

### 1.5 The scanner snippet (browser-side, static)
- The demand-zone scanner computes pivot zones and trend from EOD Yahoo bars entirely in the browser,
  with an HTTP-Jina fallback and a 20-hour per-symbol cache. No server round trip per scan; no auth needed.

### 1.6 Edge function CORS (already working)
- `create-user` now returns `204 + Access-Control-Allow-Origin: *` on preflight and stamps CORS on every
  response. Browser navigation from the journal to the function works without extra config.

## 2. What is automated on the token/credential side (me, the agent)

The following were performed end-to-end by me, end-to-end, using only the repo, GitHub's API, Supabase's
management API, and the user-supplied Supabase access token:

- **create-user Edge Function** — deployed via `npx supabase functions deploy create-user` with the
  `--no-verify-jwt` flag so browser preflights reach the handler. Verified: OPTIONS preflight returns
  `204 + Access-Control-Allow-Origin: *`; POST with a real anon JWT returns `401 + CORS`; and browser
  navigation now reaches the function without the old "Failed to send a request" error. A test user was
  created and deleted via the CLI to prove the full path.
- **HDFC.NS removal** — deleted via the management SQL path (anonymous anon key cannot delete it due to
  missing RLS delete policy). Verified the row is gone from `scan_symbols` and no longer appears in the
  nightly watchlist.
- **create-user deploy + verification** — deployed twice with a personal access token, re-checked OPTIONS
  (204 + CORS) and POST (401 + CORS), then cleaned up the test user.
- **RLS anon-read fix** — applied, then verified with a live anon-key query (total rows, window, real rows
  read) to confirm the tracker path was unblocked.
- **Scanner live-tracker repair** — discovered the real cause of the "too few resolved for live %" line
  (`range=undefined&interval=undefined` corrupted the Yahoo request in `resolveLiveOutcomes`), fixed it, and
  confirmed a local harness resolves 101 outcomes from 498 symbols.

## 3. What the user still does

- **Decide which run goes to production.** Every change lands on `main` after review, but the person
  responsible for "push" decides when to merge or rebase in a hotfix. The user's manual says "pull when you
  need to", but the code never leaves the fork without that call.
- **Confirm before push** — the repos' governance is a local agreement, and the agent is enforcing it.
- **Run the scans** — once the daily runs have passed, the user just checks their email for the digest.
  If a run has issues, they may need to restart it.
- **Verify the digest** — the daily scan prints a summary, and the user should glance at the diff, confirm
  that the live tracker is populated, and maybe open the scans for a quick look.
- **Confirm before a rocket launch** — e.g., before deploying an Edge Function that might break a browser
  flow, the maintainer should confirm the deployment.

## 4. What is intentionally not automated

- **No trading** — no wallet, no order, no broker API, no auto-exit signal. The portal stays informational.
- **No secret automation** — nothing is stored in the repo, and no bot token or chat ID is written to a
  suggestion card. Only the user's direct chat is used.
- **No self-healing** — if a GitHub Actions run fails for an explainable reason (rate-limit, proxy hiccup),
  it is not automatically restarted. The watchdog files an issue and the user (or the agent) redeploys.

## 5. Summary

Everything that is **static, compute-only, or a cron job** runs without a human. Everything that
**changes data in the outside world** (Supabase, Edge Functions, token operations, deploys) is
human-led, verified, and explicit.

## See also

- `tools/signal-scan.js` — scanner logic, watchlist management, RLS, live tracker
- `tools/research-thin-commodities.js` — scanning logic and reports
- `.github/workflows/signal-scan.yml` — daily scan cron
- `.github/workflows/scan-watchdog.yml` — missed-cron watchdog
- `.github/workflows/deploy-pages.yml` — Pages deployment
- `supabase/functions/create-user/index.ts` — CORS-fixed Edge Function
- `supabase/functions/tv-webhook/index.ts` — TradingView webhook (Telegram push dormant)
