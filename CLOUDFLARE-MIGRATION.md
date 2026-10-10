# LearningFundClear: independent Cloudflare hosting

Status: source preparation only. A deployment in the owner's Cloudflare account,
the matching runtime secret, and production acceptance tests are still required.
The existing Site remains available until the replacement is verified.

## What moves

Cloudflare Workers hosts the HTML/CSS/JS and `/api/nifty500` from this repository.
No ChatGPT identity, subscription, or Sites runtime is used by this deployment.
Supabase remains the existing user/account database. GitHub Actions continues
collecting and encrypting delayed and EOD data; do not duplicate those schedules.
The deployment does not solve missing historical candles, incomplete option
feeds, or the pending Supabase audit-preserving deletion migration.

## Owner account setup

1. Use the owner's Cloudflare account on the Free plan. Do not enable paid extras.
2. Import this GitHub repository into Workers Builds, selecting the production
   branch after review. Use worker name `learningfundclear`, build command
   `npm run build:cloudflare`, deploy command `npm run deploy:cloudflare`, and
   repository root as the build directory. Review GitHub connection permissions.
3. Configure `NIFTY_FEED_PRIVATE_KEY` as a **runtime secret** on that Worker.
   It must be the key matching `market-data/feed-public-key.pem`. Do not paste it
   into chat, source, build variables, logs, or the browser bundle. The config
   requires this secret so an incomplete deployment fails rather than silently
   publishing a broken feed. Complete secret setup before final deployment.
4. The current private key was configured in Sites and cannot be assumed
   exportable: its value is redacted by the management API. If the original key
   is not available through an approved secure transfer, coordinate key
   replacement and re-encryption of all retained snapshots. Do not rotate the
   repository public key alone: that would break the running portal.
5. Retain the same Supabase project. Add the final Cloudflare origin to any
   configured authentication redirects/CORS allowlists as applicable. Existing
   passwords and records should not be recreated. Users sign in again on the
   new origin; browser-only preferences/imports do not automatically transfer.
6. Keep `workers.dev` public; the portal's own Supabase login and API membership
   checks provide application access control. Do not add Cloudflare Access if
   visitors should not require an additional provider account.

## Validation before switching links

- `npm ci`, `npm run build:cloudflare`, `npm run check:cloudflare`.
- `bash .ci/guard.sh`; existing desktop/mobile browser suites in GitHub CI.
- Visit the actual new URL without ChatGPT cookies: sign-in must load.
- No bearer token: `/api/nifty500?mode=eod` must return 401 JSON.
- An inactive account must return 403. A valid active account must receive a
  decrypted snapshot in both modes, with original source dates and no-store.
- Test login, logout/back, every tab, admin permissions, and 390/320px layouts.
- Observe one collector publication appearing on the new host without a rebuild.
- Measure Worker CPU and request usage under the Free plan. A dry run is not
  proof of staying within its CPU limit or of provider availability.
- Share the verified new URL only after these checks pass. Keep the existing
  Site until the owner confirms access works; no deletion is part of setup.

## Deployment independence

Workers Builds can deploy future main-branch changes without ChatGPT. Scope
build watch paths to application files if data-only commits cause excessive
builds. Keep credentials in Cloudflare's secret storage. The free address is
assigned by Cloudflare; no URL or availability is promised before deployment.
