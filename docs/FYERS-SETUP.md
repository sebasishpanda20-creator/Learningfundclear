# FYERS setup (Freebuff Sites)

How to take the FYERS read-only quote integration from "routes present, nothing configured"
to "owner can connect and read a quote", on the Sites deployment. Every name and error code
below comes from `server/fyers-routes.mjs` and `server/fyers-core.mjs`; keep this file in step
with them.

Routes live on the Worker at `/api/fyers/*` (`server/worker.mjs` dispatches that prefix to
`handleFyers`). Configuration is read from `env` on every request, so a value that is missing
means the route answers its documented error — never a silent half-working state.

## 1. Required environment variables

All five are server-side values. On Sites they are **secrets**, set per environment
(Preview and Production are separate). Never in `assets/`, `dist/`, git or chat.

| Name | Required for | Format | Effect if missing or wrong |
|---|---|---|---|
| `FYERS_CLIENT_ID` | every FYERS route | Fyers app id, e.g. `XXXXXXXX-100` | `configured` is false → `503 FYERS_NOT_CONFIGURED` |
| `FYERS_SECRET_ID` | every FYERS route | app secret; the app-id hash is `SHA-256("client_id:secret_id")` (hex) | same `503 FYERS_NOT_CONFIGURED` |
| `FYERS_REDIRECT_URI` | every FYERS route | the **exact** HTTPS callback URL (below). A non-HTTPS value sets `redirectSecure=false`, which also makes `configured` false | `503 FYERS_NOT_CONFIGURED` |
| `FYERS_TOKEN_KEY` | login completion | random string; AES-GCM key that seals the stored broker token | callback redirects with `?fyers=error&reason=storage_failed`; a changed key makes previously stored tokens unreadable |
| `FYERS_OWNER_EMAILS` | every route except the callback | comma-separated portal emails, matched case-insensitively after trimming | empty → `503 FYERS_OWNER_NOT_CONFIGURED`; not listed → `403 FYERS_OWNER_ONLY` |

Beyond the variables, the routes need the session vault binding `FYERS_VAULT`
(`FyersVault`, SQLite Durable Object). **A Freebuff Sites deployment cannot have it**: Sites
hosts a Worker plus static assets and its deploy manifest carries only modules and assets —
"arbitrary Durable Object classes are not supported", and only D1, R2, secrets, sign-in and
realtime can be attached. So on Sites `env.FYERS_VAULT` is `undefined`, `vaultFrom()` returns
`null`, and `/api/fyers/login`, `/quote` and `/disconnect` answer `503
FYERS_STORAGE_UNAVAILABLE` (a login callback would end at `?fyers=error&reason=storage_failed`).
The replacement is a D1 table pair (`fyers_tokens`, `fyers_states`) behind the same vault
interface; until that port lands, setting the five variables alone will not complete a login.

## 2. Exact callback URIs

Register one of these verbatim in the Fyers app — scheme, host, path, no trailing slash, no
query string:

```
Preview     https://site-23b1cf14061d4794ae7e85a2474951ea.freebuff.page/api/fyers/callback
Production  https://site-443e334f4a224d008788726d8cf4b9ed.freebuff.page/api/fyers/callback
```

`FYERS_REDIRECT_URI` in that environment must be the same string, character for character.
The path is hard-coded in `server/fyers-routes.mjs` (`/api/fyers/callback`); the callback is
the only unauthenticated FYERS route, and it is protected by the single-use `state` plus the
sid cookie.

If a Fyers app can hold only one redirect URL, point the live app at the Production URI and
register the Preview URI in a second app whose client id and secret are set only on Preview.
Do not put a `localhost` or tunnel URL in Production: the deployed HTTPS callback is the only
one that is accepted.

## 3. Owner allowlist

`FYERS_OWNER_EMAILS` gates every FYERS route except the callback, after the portal session is
authenticated. Its value must be the **portal account's email** — the address on the Supabase
user that signs in to the portal, not a Fyers login id — lower case and comma-separated for
more than one owner:

```
FYERS_OWNER_EMAILS = owner@example.com
```

An empty value is not "open to all": every request answers `503 FYERS_OWNER_NOT_CONFIGURED`
with the message "Set FYERS_OWNER_EMAILS to the portal account that may connect FYERS." A
signed-in user whose email is not on the list gets `403 FYERS_OWNER_ONLY`. The comparison is
`user.email` lower-cased and trimmed against the lower-cased list, so list entries are
case-insensitive but must otherwise match exactly.

## 4. Order to set them in

The order matters because Sites attaches secrets to an existing deployment, the redirect URI
must name an address that already serves, and the callback needs the sealing key at the moment
it runs.

1. **Deploy the build to the target environment** (Preview or Production). Sites secrets attach
   to a deployment, so there is nothing to attach to before the first deploy.
2. **Port the vault to D1 and deploy it** — create the environment's D1 database, attach it,
   and code the token/state store against it. Until this is done, steps 3–6 will still end in
   `503 FYERS_STORAGE_UNAVAILABLE`.
3. **Set the five variables** in Sites → Secrets for that environment (all five, same
   environment; Preview and Production do not share them). Project usage is 25 user variables
   across environments and currently sits at 2, so the five fit, but they count twice if you
   configure both environments.
4. **Register the callback URI** from §2 in the Fyers app and confirm the value of
   `FYERS_REDIRECT_URI` matches it exactly.
5. **Sign in to the portal** as the allowlisted email, then Connect in the FYERS dialog. The
   provider should return to the callback and redirect to the page with `?fyers=connected`.
6. **Verify** `GET /api/fyers/config-status` while signed in: `configured:true`,
   `connected:true`, `owner_only:true`, and a sane `expires_at_iso`. The status is read-only
   and does not touch the broker.

Rotating `FYERS_TOKEN_KEY` after a successful connect invalidates the sealed token: expect to
reconnect. Rotating the client id or secret invalidates nothing stored, but the app-id hash
changes, so a fresh login is required.

## 5. Failure map

| Symptom | Cause | Fix |
|---|---|---|
| `503 FYERS_NOT_CONFIGURED` | any of client id, secret id, redirect URI missing; or redirect URI is not HTTPS | set all three in the same environment |
| `503 FYERS_OWNER_NOT_CONFIGURED` | `FYERS_OWNER_EMAILS` empty | set it to the portal account's email |
| `403 FYERS_OWNER_ONLY` | signed-in email not on the list | add the exact portal email |
| `503 FYERS_STORAGE_UNAVAILABLE` | no `FYERS_VAULT` binding (always true on Sites until the D1 port) | port the vault to D1 and deploy |
| callback → `?fyers=error&reason=not_configured` | redirect URI emptied or non-HTTPS at callback time | correct `FYERS_REDIRECT_URI` |
| callback → `?fyers=error&reason=missing_code` | the provider returned no `auth_code` | retry the login; check the Fyers app is active and the redirect URL matches |
| callback → `?fyers=error&reason=invalid_state` | state expired (600 s TTL), already consumed, wrong sid, or cookies blocked | start the login again in the same browser |
| callback → `?fyers=error&reason=token_exchange_failed` | wrong client id/secret, or the code was already redeemed | check the app id hash and retry |
| callback → `?fyers=error&reason=storage_failed` | vault unavailable, or `FYERS_TOKEN_KEY` missing | set the key; port the vault |
| `?fyers=error&reason=provider_refused` | Fyers returned an error instead of a code | read the Fyers app settings (redirect URL, app status) |

## 6. What this integration is not

Read-only quotes. No order placement, no positions, no funds movement. Tokens are sealed
server-side and never reach the browser, URLs or logs; sessions expire at the provider's own
06:30 IST cycle and there is no refresh flow, so a long-lived session is not expected.
