# Deployment runbook (approval-gated)

> **Do not deploy from this document without explicit approval.** No command here has been run
> against production. Values shown as `<…>` are placeholders; never paste secret values into chat,
> logs or the repository.

## 0. Preconditions

- [ ] FYERS hosting decision made (Worker port or hosted Python) — see `HOSTED-ARCHITECTURE.md` §3.
- [ ] Public origin chosen: `<portal>.workers.dev` or a custom domain.
- [ ] Supabase project available and reachable (not paused).
- [ ] Deployment approval recorded in the conversation.
- [ ] `bash .ci/guard.sh` and `node qa/hosting-readiness.cjs` pass locally.

## 1. Build and verify locally

```bash
cd lfc-quant-work
npm ci
npm run build:cloudflare
bash .ci/guard.sh
node qa/hosting-readiness.cjs
```

Expected: guard PASSED; readiness has no `fail` entries (warnings/gaps allowed and listed).

## 2. Secrets (names only)

```bash
./node_modules/.bin/wrangler secret put FYERS_CLIENT_ID
./node_modules/.bin/wrangler secret put FYERS_SECRET_ID
./node_modules/.bin/wrangler secret put FYERS_REDIRECT_URI   # https://<portal-host>/api/fyers/callback
./node_modules/.bin/wrangler secret put RESEND_API_KEY       # alerts
./node_modules/.bin/wrangler secret put ALERT_FROM           # verified sender
```

Do not create `FYERS_REDIRECT_URI` with a localhost value. The deployed callback is the only
registered callback.

## 3. KV

Existing: `ALERTS_KV` (`wrangler.jsonc`). For hosted FYERS sessions either:

- reuse `ALERTS_KV` with the `fyers:` prefix (no new namespace), or
- create a dedicated namespace and add it to `wrangler.jsonc`:

```bash
./node_modules/.bin/wrangler kv namespace create FYERS_KV
# paste the returned id into kv_namespaces, binding FYERS_KV
```

## 4. Preview deploy

```bash
./node_modules/.bin/wrangler deploy --env preview    # or a separate preview Worker name
```

Record the preview URL; run the smoke checks in §6 against it. Preview is public: treat it as
production for secrets and data.

## 5. Production deploy

```bash
./node_modules/.bin/wrangler deploy
```

Rollback if needed:

```bash
./node_modules/.bin/wrangler rollback
```

## 6. Post-deploy smoke (from the laptop, before the phone test)

```bash
curl -sS https://<portal-host>/api/health || true
curl -sS -o /dev/null -w "%{http_code}\n" https://<portal-host>/scanner.html
curl -sS -o /dev/null -w "%{http_code}\n" "https://<portal-host>/api/market/yahoo?symbol=TCS.NS&interval=1d&range=5d"
```

Expected: page 200; market route 401 without a session; no 5xx. If a route returns 404, the Worker
is not the origin serving it.

## 7. Laptop-off / mobile-data verification (mandatory)

1. Sign in on the phone, open the portal, confirm navigation.
2. **Switch the laptop fully off** (not sleep).
3. Turn off Wi-Fi on the phone; use mobile data only. Disable any VPN that routes via the laptop.
4. Load the public URL and walk: dashboard → scanner → chart → setup details.
5. Confirm the developer/network panel shows only `https://<portal-host>` and Supabase/Yahoo hosts —
   no `127.0.0.1`, `localhost`, LAN IP or tunnel host.
6. If FYERS credentials are configured: Connect → provider login → callback returns to
   `https://<portal-host>/api/fyers/callback` → `connected:true` → one quote.
7. Wait for or force session expiry (FYERS 06:30 IST / Supabase token refresh) and confirm
   re-authentication works without a laptop.
8. Redeploy or restart the Worker; confirm pages and sessions recover as documented.
9. If scheduled scanning/alerts are in scope: close all browsers and confirm a cron-triggered email
   or persisted scan result arrives.

Record: timestamps, phone network type, screenshots of the page and network log, status codes.
Only then may “works with the laptop off” be stated.

## 8. Failure playbook

| Symptom | Likely cause | Action |
|---|---|---|
| 404 on `/api/...` | Worker not the origin / route missing | check `run_worker_first` and deployed version |
| 401 everywhere | Supabase paused or project URL changed | resume project, verify config |
| 503 FYERS | secrets missing or hosted service asleep | set secrets; warm service or use Worker port |
| slow first request | Render free cold start | upgrade to Starter or move FYERS to Worker |
| stale quotes | edge cache (60–300 s) | expected; wait for TTL |
| alert email missing | Resend/KV not configured | check `/api/email-alerts` status |
