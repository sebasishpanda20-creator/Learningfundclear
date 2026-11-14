# Hosted architecture for laptop-independent operation

Status: **design + readiness audit only. Nothing is deployed. Deployment requires explicit approval.**

Definitions used throughout:

- **A — mobile page works with the laptop off.** Every byte the phone loads and every
  request the page makes resolves to a public HTTPS host. No laptop process, file, database,
  tunnel or LAN address is involved.
- **B — scheduled scanning/alerts work with all user browsers closed.** A server-side
  scheduler performs the work; no open tab, no laptop cron and no browser timer is required.

## 1. Verified current state (source, not assumptions)

| Component | Where it runs now | Evidence |
|---|---|---|
| Portal HTML/JS/CSS | Cloudflare Worker static assets (`dist/client`, binding `ASSETS`) | `wrangler.jsonc` `assets`, `server/worker.mjs` `env.ASSETS.fetch` |
| Portal auth + records | Hosted Supabase (`https://<ref>.supabase.co`) | `assets/js/config.js`, `server/config.mjs` build output |
| `/api/market/yahoo`, `/api/market/mfapi` | Cloudflare Worker → Yahoo/mfapi | `server/worker.mjs:31-32`, `server/market-proxy.mjs` |
| `/api/email-alerts` | Worker + KV `ALERTS_KV` + Resend | `server/email-alerts.mjs` |
| Cron `*/1 * * * *` | Worker `scheduled()` → crypto email watches + daemon health | `wrangler.jsonc`, `server/worker.mjs` |
| `/api/v1/*`, `/quant-terminal/*` | Reverse-proxied to `https://quant-daemon-a9m2.onrender.com` | `wrangler.jsonc` `vars.QUANT_API_ORIGIN`, `server/quant-proxy.mjs` |
| FYERS auth/quote | Python `Learningfundclear/backend/live_feed_proxy.py` — **not in this Worker** | no `fyers` route in `server/*.mjs`; Worker would only reach it through `QUANT_API_ORIGIN` |
| FYERS sessions | In-process Python dict (lost on restart/sleep/multi-instance) | `live_feed_proxy.py` `_fyers_sessions` |

There are **no loopback URLs in shipped runtime code** (verified by `qa/hosting-readiness.cjs`).
The only laptop-local dependency left is operational: FYERS currently exists only in the local
Python service, and its sessions are not durable.

## 2. Target topology

```
 Phone (mobile data)                      Public HTTPS only
        │
        ▼
 Cloudflare Worker  <portal>.workers.dev  (or portal.example.com)
   ├── static assets (ASSETS)
   ├── /api/market/**        → Yahoo / mfapi          [A]
   ├── /api/fyers/**         → api-t1.fyers.in        [A, new]
   ├── /api/email-alerts     → KV + Resend            [B: delivery]
   ├── scheduled() cron      → alert checks, scan job [B]
   └── /api/v1/**            → hosted quant service (Render)  [optional]
        │
        ├── Supabase (hosted): auth, app_users, ideas, audit
        ├── Workers KV: FYERS sessions/states, alert plans
        └── Resend: transactional email for alerts
```

The Worker is the **only public origin**. Supabase, KV and Resend are managed services reached
with server-side credentials. Render is optional and only needed for the quant daemon endpoints;
it is never on the laptop.

## 3. Hosted FYERS design (decision required)

Two viable paths; both remove the laptop and both keep tokens server-side.

### Option 1 — move FYERS into the Worker (recommended)

- Routes: `/api/fyers/config-status|login|callback|disconnect|quote`, same protocol as the
  Python implementation (auth-code, `appIdHash = sha256("<client_id>:<secret>")`,
  `Authorization: <client_id>:<access_token>`, `/data/quotes`, `/api/v3/logout`).
- Session store: Workers KV.
  - `fyers:state:<random>` → `{sid, createdAt}` TTL 600 s, single use, bound to cookie.
  - `fyers:sess:<sid>` → `{access_token, expires_at}` TTL = next 06:30 IST.
  - Cookie: `lfc_fyers_session=<sid>; HttpOnly; Secure; SameSite=Lax; Path=/`.
- Secrets: `FYERS_CLIENT_ID`, `FYERS_SECRET_ID`, `FYERS_REDIRECT_URI` via `wrangler secret put`.
  `FYERS_REDIRECT_URI` is the deployed HTTPS callback, e.g.
  `https://<portal-host>/api/fyers/callback`.
- Portal authentication: `quote` also requires a valid Supabase session, so the route cannot be
  used as an open relay.
- Why recommended: one origin, no cold start, no second host, sessions survive Worker restarts.
- Cost to implement: new `server/fyers.mjs`, ~8 route tests, KV binding reuse (`ALERTS_KV` with
  `fyers:` prefix) or a dedicated namespace.

### Option 2 — host the existing Python service

- Deploy `Learningfundclear/backend` to Render **Starter ($7/mo, no sleep)**; free tier sleeps
  after 15 min idle (~1 min cold start) and is explicitly not for production.
- Sessions must move out of the process dict into Supabase Postgres or Redis (Render Key Value
  $10/mo); otherwise every restart/sleep signs the user out and multi-instance breaks isolation.
- `FYERS_REDIRECT_URI` must be the Render HTTPS callback; the Worker proxies `/api/v1/fyers/*`.
- Faster to ship (tested code), but adds a host, a cold-start surface and duplicate auth checks.

**No FYERS credentials are configured in this workspace, so no hosted FYERS login has been
tested. Until one of the options above is deployed with secrets, FYERS is a laptop dependency.**

## 4. Session storage and persistent records

| Data | Store | Survives restart | Notes |
|---|---|---|---|
| Portal login | Supabase Auth (JWT) | yes | refresh handled by the client SDK |
| Users/ideas/audit | Supabase Postgres | yes | RLS policies already in the schema |
| FYERS state/session | Workers KV (Option 1) or Postgres/Redis (Option 2) | yes | TTL-bound, single-use state |
| Alert plans + send flags | KV `ALERTS_KV` | yes | 10 h TTL already applied |
| Daemon health counters | KV | yes | best-effort |
| Scan results (proposed B) | KV or D1 | yes | not implemented |
| Python FYERS sessions today | process memory | **no** | lost on restart, sleep, redeploy |

## 5. A/B capability matrix (today)

| Requirement | A: laptop off | B: browsers closed | State |
|---|---|---|---|
| Portal pages, navigation, auth | yes, once Worker is deployed | n/a | ready |
| Market data (`/api/market/yahoo`) | yes | n/a | ready (needs Supabase session) |
| Scanner/chart/details in the page | yes | n/a | ready |
| Crypto email watches | yes | yes | cron + KV + Resend already implemented |
| Daemon health alerting | yes | yes | implemented |
| FYERS login/callback/quote | **only if** a hosted FYERS service with secrets exists | n/a | **blocked / undecided** |
| Scheduled symbol scanning | n/a | **no server-side scanner** | **missing** |
| Quote/stream push | no streaming; polling only | no | documented limitation |

## 6. B: scheduled scanning design (not implemented)

Needed for “scanning works with all browsers closed”:

1. Cron every 5–15 min (not every minute; see KV limits below).
2. Watchlist + rules stored in KV or D1 (server-owned, not `localStorage`).
3. Shared pure module for zone/GTF computation (extracted from `scanner-logic.js`) so the Worker
   and the browser use identical logic.
4. Fetch completed candles from the market proxy (internal call or shared function).
5. Persist the latest result per symbol/timeframe with `fetchedAt`, `candleAt`, counts and gaps.
6. Send email/push via Resend only on state change, with idempotency keys.
7. Surface results in the portal from the persisted store, not from a browser rescan.

Until this exists, B is **partial**: alert delivery is server-side, symbol scanning is not.

## 7. Cost (list prices checked 2026-11)

| Service | Free | Paid | What the free tier cannot do |
|---|---|---|---|
| Cloudflare Workers | 100k req/day, 10 ms CPU/request | $5/mo Workers Paid | 1-minute cron + KV writes quickly exceed free limits |
| Workers KV | 100k reads/day, **1,000 writes+lists/day**, 1 GB | included in Paid | every-minute `list()` alone is 1,440/day → over the free cap |
| Supabase | 500 MB DB, 50k MAU; **pauses after ~7 days idle** | $25/mo Pro | pause needs manual resume; no daily backups on free |
| Render web service | $0, sleeps after 15 min, ~1 min wake | $7/mo Starter (no sleep) | free tier is documented as not for production |
| Render Postgres | 1 GB, **expires 30 days** | $6/mo | expiry deletes the database |
| Resend | ~3,000 emails/mo (verify current) | usage-based | — |
| Domain (optional) | workers.dev subdomain | ~$10–15/yr | — |

Realistic minimum for A + B with 1-minute alert cron: **Cloudflare Workers Paid $5/mo**, Supabase
free (with low-activity pause risk) or Pro $25/mo, Render only if the quant daemon is needed
($7/mo to avoid cold starts). A domain is optional.

## 8. Sleep, cold start and rate behaviour

- **Cloudflare Worker:** no sleep; first request after deploy may be marginally slower; 10 ms CPU
  (free) is tight for a scan job — move scanning to cron or paid plan.
- **Workers KV:** eventually consistent across PoPs (up to ~60 s); do not use it as a lock or for
  read-after-write correctness in the same second.
- **Supabase free:** project pauses after ~7 days of low activity; resume is manual in the
  dashboard. Auth and DB return errors while paused.
- **Render free:** 15 min idle → spin down; next request shows a loading page for ~1 min; local
  filesystem is ephemeral. This loses in-memory FYERS sessions and slows `/api/v1/*`.
- **Resend:** per-second rate limits; alerts are idempotent per plan+event already.

## 9. Streaming limitations

- No WebSocket/SSE anywhere in the portal. Charts and quotes are request/response with polling and
  short caches (60–300 s at the edge for Yahoo).
- Email alerts are the only push channel and are minute-granular at best.
- With the laptop off, nothing streams from the laptop; absence of streaming is a product
  limitation, not a hosting dependency.

## 10. Restart and recovery

| Event | Effect | Recovery |
|---|---|---|
| Worker redeploy | in-flight requests drain; previous version can be rolled back | `wrangler rollback` |
| Worker isolate recycle | no state lost (all state is KV/Supabase) | automatic |
| KV outage | sessions/alerts unavailable | retry; users sign in again |
| Supabase pause/outage | auth + DB fail | resume project / wait; no data loss |
| Render restart/sleep | Python sessions and in-memory caches lost | re-login; move sessions to durable store |
| FYERS daily expiry (06:30 IST) | `connected:false` | sign in again (refresh needs PIN, not implemented) |
| Cron failure | missed alert tick | next tick reconciles from KV state; no duplicate emails |

## 11. Security requirements

- Secrets only in Worker/Render environment (`wrangler secret put`); never in `assets/`, `dist/`,
  git or chat.
- FYERS tokens never reach the browser: HttpOnly cookie only; responses expose status/expiry.
- Callback URL must be the deployed HTTPS origin; no localhost fallback (already enforced in
  Python and verified by tests).
- `quote` and any broker action require a portal session; no anonymous relay.
- Orders: none. This architecture is read-only market data and paper records.

## 12. Deployment gates (approval required)

1. Choose FYERS hosting option (Worker port vs Render Python) and whether Render is paid.
2. Approve the public origin (workers.dev subdomain or custom domain).
3. Approve secret creation and KV namespace(s).
4. Approve first deployment (preview) and then production.
5. After deployment, run the laptop-off / mobile-data verification in
   `docs/DEPLOYMENT-RUNBOOK.md`. **Laptop independence is not claimed until that passes.**
