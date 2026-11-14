# Free-tier budget for the pilot

Scope: Workers Free, Workers KV Free, Durable Objects Free, Supabase Free, Render Free (optional),
Resend Free and GitHub Actions Free. **No paid plan is enabled.** This is an estimate plus the
operations measured by `qa/free-tier-budget.test.mjs`; it is not a Cloudflare billing statement.

## 1. Quotas are separate

Workers KV limits are per operation type, not one shared bucket (Cloudflare docs, checked
2026-11-11):

| Operation | Free limit |
|---|---|
| Key reads | 100,000 / day |
| Writes to different keys | 1,000 / day |
| Deletes | 1,000 / day |
| List requests | 1,000 / day |
| Stored data | 1 GB |
| Operations per Worker invocation | 1,000 |

Workers Free: 100,000 requests/day, 10 ms CPU/request. Durable Objects Free: 100,000 requests/day,
5M SQLite rows read/day, 100,000 rows written/day, 5 GB. Resend Free: 3,000 emails/month and 100/day.
GitHub Actions Free: 2,000 minutes/month for private repositories.

An every-minute cron is allowed; a full KV listing on every tick is the workload problem.

## 2. Alert evaluation design

`server/email-alerts.mjs`:

- `ALERT_EVAL_MINUTES` (default **5**) gates the expensive work with a KV marker.
- Every cron tick performs **one KV read** of `meta:alerts-eval`.
- When the interval has not elapsed, the function returns before listing. No plan keys are read.
- When due, it writes the marker once, lists plans with `limit: 100`, and processes at most
  `ALERT_MAX_PAGES` pages (default 5 = 500 plans). A truncated run reports `truncated: true`.
- A KV read/write/list failure returns `{error: ...}`; it does not throw or retry in a loop.
- Resend is called only on a state change. Non-2xx responses are not marked delivered.
- Disclosed latency: **up to 5 minutes** by default, not real-time.

## 3. Measured operations

From `qa/free-tier-budget.test.mjs` (fake KV counts operations; 3 plans, one due run):

| Operation | Measured |
|---|---|
| marker get | 1 |
| marker put | 1 |
| list requests | 1 (100 keys/page) |
| plan gets | 3 |
| plan writes | 3 (one per sent event) |
| deletes | 0 |
| emails | 3 |

A skipped tick: 1 read, 0 lists, 0 writes.

## 4. Daily estimate

Let `N` = active plans, `P = ceil(N/100)` (bounded by 5), `S` = sends/day.

At 5-minute evaluation (288 runs/day):

| Item | Formula | N = 100 | N = 500 |
|---|---|---|---|
| Worker requests | 1,440 cron/day | 1,440 | 1,440 |
| KV reads | 288 + 288×N | 28,800 | 144,000 |
| KV writes | 288 + S | ~288+ | ~288+ |
| KV lists | 288×P | 288 | 1,440 |
| KV deletes | ≤S | small | small |
| Resend emails | S | ≤100/day cap | ≤100/day cap |

At N = 100 the design fits reads, writes and lists. At N = 500, reads exceed 100k/day and lists
exceed 1,000/day; the pilot must then raise `ALERT_EVAL_MINUTES` (for example 15) or reduce plans.
The function does not silently list more pages to compensate.

At 15 minutes (96 runs/day): reads = 96 + 96N, lists = 96P. N = 500 → 48,096 reads, 480 lists.

## 5. Email provider

- Resend Free is 100/day and 3,000/month. Alerts are one email per plan per event, idempotent by
  `Idempotency-Key`; an event is recorded only after a 2xx.
- With 100 plans all firing once, the daily email cap is reached. Further sends fail; the plan is
  not marked sent and retries on a later run, so delivery may be delayed rather than duplicated.
- The digest/nightly scan email is separate and counts against the same provider quota.

## 6. Behaviour at limits

| Limit | Behaviour |
|---|---|
| KV read/list/write quota | operation returns an error; alert run reports `kv_*_failed`; next tick retries |
| KV 1 write/s to same key | marker is written at most once per interval, so no hot key |
| Worker daily request limit | Cloudflare error 1027; no work until reset |
| Durable Object quota | FYERS status/quote returns storage unavailable; no token loss |
| Resend daily/monthly cap | send fails; event not marked sent; retried later |
| GitHub Actions minutes | scheduled scan may not run; watchdog/manual dispatch needed |
| Supabase pause | auth fails; resume in dashboard |

## 7. What still needs measurement

- Actual Cloudflare KV/DO/Worker usage after a deployed pilot (dashboard metrics).
- Actual Resend send counts and bounce behaviour.
- Whether 5-minute latency is acceptable for the product; it is not a streaming alert.

No paid approval is implied by this document.
