# Hosted architecture — source audit and design only

**Status: source-audit / hosted-design milestone. Nothing is deployed. The portal is not
laptop-independent and is not production-ready.** Deployment requires explicit approval.

Definitions:

- **A — mobile page with the laptop off.** Every request the phone makes resolves to a public
  HTTPS host with no laptop process, file, database, tunnel or LAN address.
- **B — scheduled work with all browsers closed.** A server-side scheduler performs the work.

Neither A nor B has been demonstrated end-to-end. Static checks, clean-extraction tests and a
local Worker run are evidence for the source, not for the deployed service.

## 1. Current source state

| Component | Source / runtime target | Evidence | Deployed? |
|---|---|---|---|
| Portal HTML/JS/CSS | Cloudflare Worker static assets | `wrangler.jsonc` `assets`, `server/worker.mjs` `env.ASSETS.fetch` | no |
| Portal auth + records | Hosted Supabase | `assets/js/config.js`, `server/config.mjs` | existing service; deployment of this Worker not run |
| `/api/market/yahoo`, `/api/market/mfapi` | Worker → Yahoo/mfapi | `server/market-proxy.mjs` | no |
| `/api/fyers/**` | Worker → FYERS v3 | `server/fyers-routes.mjs`, `server/fyers-core.mjs` | no |
| FYERS state/session | SQLite-backed Durable Object `FyersVault` | `server/fyers-vault.mjs`, `wrangler.jsonc` migrations | no |
| `/api/email-alerts` | Worker + KV `ALERTS_KV` + Resend | `server/email-alerts.mjs` | no |
| Cron `*/1 * * * *` | Worker `scheduled()`; evaluation gated to 5 min by default | `wrangler.jsonc`, `server/worker.mjs`, `server/email-alerts.mjs` | no |
| `/api/v1/*`, `/quant-terminal/*` | Reverse proxy to Render quant daemon | `wrangler.jsonc` `vars.QUANT_API_ORIGIN` | daemon existing; Worker not deployed |
| Nightly EOD scan | GitHub Actions `signal-scan.yml` → `tools/signal-scan.js` → Supabase `signal_events` | workflow + script | existing workflow; latest local lookup 2026-11-10 |
| Intraday/web scan | Browser `scanner.html` + `scanner-logic.js` | `scanner-auto.js` | browser-only |
| Alert watches / health | Worker cron | `server/email-alerts.mjs`, `server/daemon-watch.mjs` | no |

The legacy Python FYERS service (`Learningfundclear/backend/live_feed_proxy.py`) still exists but is
no longer the production FYERS path in this source tree. Its in-memory sessions are legacy and
must not be described as durable.

## 2. FYERS storage — transactional Durable Object

Workers KV is **not** used for OAuth state or sessions. KV has no atomic check-and-delete across
locations and is eventually consistent; a TTL or a delete is not single-use consumption under
concurrent callbacks.

`FyersVault` is a SQLite-backed Durable Object (`new_sqlite_classes`):

- One named instance (`fyers-owner`). State consumption is a single SQL
  `DELETE FROM vault WHERE key = ? RETURNING value`, not a separate read and delete, so two
  concurrent callbacks cannot both receive the same state record.
- `consumeState(hash, sid)` deletes and returns in one statement, then validates. A wrong sid,
  wrong user binding or expired record is burned and returns `null`; a captured state cannot be
  replayed.
- State is stored only as `sha256(state)` with `{sid, userId, expiresAt}`; the raw state never
  reaches storage.
- Sessions store `{sid, userId, sealed, expiresAt, connectedAt, clientId}`. The broker token is
  AES-GCM sealed with `FYERS_TOKEN_KEY`; ciphertext and IV only. The key is a Worker secret and
  never reaches the browser or logs.
- Callback binding: the sid cookie plus the state record's `userId`; the callback does not trust a
  browser-supplied identity and does not need a Bearer header on a top-level navigation.
- Logout/revocation: provider `/api/v3/logout` is attempted, then the local session is deleted and
  the cookie expired. Provider success is reported separately; local deletion always happens.
- Responses use `Cache-Control: no-store`, `Vary: Cookie, Authorization`; the owner allowlist
  (`FYERS_OWNER_EMAILS`) gates every non-callback route.

Quota basis (Workers Free): 100,000 Durable Object requests/day, 5M SQLite rows read/day,
100,000 rows written/day, 5 GB stored. A login uses a handful of requests and writes; a daily quote
poll at 1/min for 6.5 h is ~390 requests, far inside the free allowance. See
`docs/FREE-TIER-BUDGET.md`.

Evidence: `qa/fyers-worker.test.mjs` includes concurrent callbacks (exactly one session), replay,
wrong sid, expired state, user isolation, expiry, logout and no-token-leak assertions. It uses a
fake provider and fake portal session; live FYERS is **NOT RUN**.

## 3. Free-tier budget and scheduler design

The Worker trigger remains every minute for daemon keep-warm, but alert evaluation is gated:

- `ALERT_EVAL_MINUTES` (default 5): a KV marker is read each tick; the plan listing runs only when
  the interval has elapsed. A skipped tick performs one read, not a listing.
- `ALERT_MAX_PAGES` (default 5): at most 500 plans per evaluation; a truncated run is reported.
- No full listing when alerts are unconfigured or the interval has not elapsed.
- KV read/write/list/delete failures return a status and do not throw or retry in a loop.
- Resend is called only on a state change, with an idempotency key; failures are not marked sent.
- Alert latency is disclosed as up to the evaluation interval (default 5 min), not real-time.

Free quotas (checked 2026-11): Workers 100k requests/day; KV 100k reads/day, 1,000 writes/day,
1,000 deletes/day, 1,000 list requests/day, 1 GB; Durable Objects as above; Resend 3,000/month and
100/day; GitHub Actions 2,000 minutes/month (private). No paid plan is enabled or required for the
pilot. Full arithmetic: `docs/FREE-TIER-BUDGET.md`.

## 4. A/B capability matrix — status

| Requirement | A (laptop off) | B (browsers closed) | Status |
|---|---|---|---|
| Portal pages/navigation/auth | code ready, not deployed | n/a | **NOT VERIFIED** |
| Market data `/api/market/yahoo` | code ready; needs portal session | n/a | **NOT VERIFIED** |
| Scanner/chart/details | browser route exists | n/a | **NOT VERIFIED** |
| FYERS login/callback/quote | code + tests ready | n/a | **LIVE NOT RUN** |
| Crypto email watches | n/a | code + tests | **NOT DEPLOYED** |
| Daemon health alerting | n/a | code | **NOT DEPLOYED** |
| Nightly EOD symbol scan | n/a | GitHub Actions + Supabase | existing workflow; last local evidence 2026-11-10 |
| Intraday server-side scan | n/a | no Worker scan job | **NOT IMPLEMENTED** |
| Streaming | none anywhere | none | polling only |

## 5. Scanner inventory (summary)

Full table: `docs/SCANNER-INVENTORY.md`. In short:

- `tools/signal-scan.js` — nightly EOD, GitHub Actions `signal-scan.yml` (12:30 UTC), legacy pivot
  default, GTF-Pro opt-in, writes Supabase `signal_events` via `tv-webhook`.
- `scanner.html` + `scanner-logic.js` — browser demand/supply-zone scan, automatic every 15 min
  while visible; not a server job.
- `server/email-alerts.mjs` — watches open crypto paper plans, gated evaluation, email delivery.
- `server/daemon-watch.mjs` — Render health probe on the Worker cron.
- `scan-watchdog.yml` — recovery dispatcher, not a scanner.

There is **no duplicate Worker scanner**. The readiness gap is now worded as “no server-side
intraday scan in the Worker”, not “no scan exists”.

## 6. Cost table (free vs paid)

| Service | Free allowance | Paid starting point | Pilot consequence |
|---|---|---|---|
| Workers | 100k req/day, 10 ms CPU | $5/mo | static + API traffic fits; cron requests count |
| KV reads | 100k/day | $5/mo Workers Paid | 1/min marker = 1,440/day |
| KV writes | 1,000/day | same | 5-min evaluation = 288 marker writes/day |
| KV deletes | 1,000/day | same | only on TIME EXIT |
| KV lists | 1,000/day | same | 288/day at 5 min for one page |
| Durable Objects | 100k req/day, 5M reads, 100k writes, 5 GB | Workers Paid | FYERS login/quote well inside |
| Supabase | 500 MB, pauses after ~7 days idle | $25/mo | pause risk, no paid plan enabled |
| Render | sleeps after 15 min, ~1 min wake | $7/mo | optional daemon only |
| Resend | 3,000/mo, 100/day | usage-based | alerts only on state change |
| GitHub Actions | 2,000 min/mo private | — | nightly scan minutes |

No paid service is enabled. A paid plan is not approved by this document.

## 7. Sleep, consistency and failure behaviour

- **Worker:** no sleep; 10 ms CPU per free request. Cron invocations count as requests.
- **KV:** eventually consistent; not used as a lock. Marker may be stale across PoPs, which is
  acceptable for a 5-minute evaluation gate; it is not used for OAuth state.
- **Durable Object:** single-writer per instance; survives restarts; SQLite storage.
- **Supabase free:** project pause after inactivity; auth/DB errors until resumed.
- **Render free:** 15 min idle, ~1 min wake; local filesystem ephemeral.
- **Resend:** daily/monthly caps; a 429 is treated as a failed send, retried next evaluation.
- **GitHub Actions:** scheduled runs can be delayed or dropped; `scan-watchdog.yml` dispatches a
  recovery run and opens an issue. That is best-effort, not a guarantee.

## 8. Streaming limitations

No WebSocket/SSE. Quotes, OI and charts are request/polling based with short caches. Email is the
only push channel and is interval-bound. “Streaming” is not claimed.

## 9. Restart and recovery

| Event | Effect | Recovery |
|---|---|---|
| Worker redeploy | in-flight drain | rollback previous version |
| Isolate recycle | DO/KV state persists | automatic |
| DO storage error | FYERS state/session unavailable | sign in again; no token plaintext |
| KV quota/outage | alerts skip/error | next evaluation |
| Supabase pause | auth/records fail | resume project |
| Render sleep | daemon cold start; no FYERS state (now in DO) | wait/re-login |
| FYERS 06:30 IST expiry | `connected:false` | sign in again |
| Scan cron missed | no new `signal_events` | watchdog dispatch or manual run |

## 10. Security

- Secrets only in Worker secrets/environment; never in `assets/`, `dist/`, git or chat.
- FYERS tokens sealed server-side; never in browser storage, URLs or logs.
- Callback must be the deployed HTTPS `/api/fyers/callback`.
- Owner-only FYERS routes; portal session required for status/quote/disconnect.
- No orders, no execution. Read-only quotes.

## 11. Deployment gates

1. Approve hosted FYERS (Worker + DO) and the public origin.
2. Configure `FYERS_CLIENT_ID`, `FYERS_SECRET_ID`, `FYERS_REDIRECT_URI`, `FYERS_TOKEN_KEY`,
   `FYERS_OWNER_EMAILS`; register the exact callback with FYERS.
3. Approve preview deployment, then production.
4. Run the laptop-off/mobile-data protocol in `docs/DEPLOYMENT-RUNBOOK.md`.
5. Only after that may A or B be claimed. This document does not claim either.
