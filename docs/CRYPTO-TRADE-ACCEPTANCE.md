# LearningFundClear crypto desk — research-only release (27 October 2026)

## Production scope

This is a standalone browser research portal, not a trade execution system. **No ChatGPT or OpenAI subscription, Delta account link, API trading key, Mirror Pip link, or broker login is required for options or funding research.** The portal runs the market scan automatically after INR capital is entered (a 2/4/8-hour horizon has a default). It checks public market data, completed 15m and hourly candles, 15m/1h EMA trend, RSI(14), MACD(12,26,9), ADX(14), optional traded volume and SMC BOS/sweep evidence, option quotes and products, indicative exchange fees, funds/capital-based limits, and shows entry, spread stop/target, and quote-based monitoring for paper plans.

- **Directional gate**: both 15m and 1h EMA20/50 must align; weighted evidence from RSI, MACD, ADX, optional real volume and SMC BOS/sweep must total at least 70 points. SMC is **optional**: without it, both momentum indicators **and** directional ADX must agree. BOS/sweep without momentum does **not** qualify. These heuristic points are not a calibrated probability of success. Missing volume is N/A and does not block scoring, but provides zero supporting points.
- BTC, ETH and available XAUT tokenized-gold option listings are checked independently. No made-up strikes or gold options.
- Debit verticals may be shown as **PAPER PLAN** if gates pass. Credit spreads/iron condors are strictly **WATCH ONLY** without verified multi-leg margin/fills.
- Funding is separately displayed as **WATCH ONLY** when carry and hedge economics are unverified.
- Backtest is an on-demand **underlying-only historical signal proxy** (not a historical options backtest). It rejects gaps, follows completed bars, charges an indicative cost allowance and tests exact 2/4/8-hour time exits. It is not a claim of profitability.
- All outputs require recent data; stale/missing market inputs lead to **NO TRADE**. Bid/ask watch stops are alerts, never exchange bracket orders.
- No live execution, order placement, broker credential access, position importing, autonomous background trades or ChatGPT requests.

## Hosting / deployment

**Cloudflare Workers (preferred existing production domain)**: `learningfundclear.sebasish-panda20.workers.dev`. Build from `main`: `npm install`, `npm run build:cloudflare`, then `npm run deploy:cloudflare`. The worker and static assets use `wrangler.jsonc`. Existing `NIFTY_FEED_PRIVATE_KEY` is only required for the optional Nifty feed API; it is **not needed for the crypto research pages**. Never put hosting or broker secrets in source files.

For automatic main-branch Cloudflare deployment, add the GitHub Actions repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to the owner's repo. The deployment workflow **reports a skip rather than falsely claiming a deploy** when either secret is missing. The workflow validates production code, builds, checks Worker packaging and then deploys if access is configured. Do not share tokens in chat.

**GitHub Pages (fallback static hosting)**: `main` also triggers `.github/workflows/deploy-pages.yml`. The crypto research pages can use the public exchange endpoints in supported browsers, but GitHub Pages **cannot host Worker `/api/*` endpoints** (not needed for the crypto options/funding research scope). Supabase account login still applies to protected portal pages.

## Acceptance checks

- `bash .ci/guard.sh` — HTML/JS contracts, scanner tests and crypto desk unit tests.
- `node qa/crypto-desk-flows.cjs` — authenticated browser integration with **mock** market feeds in mobile and desktop viewports.
- `npm run build:cloudflare && npm run check:cloudflare` — Worker packaging preflight.
- Verify production browser sign-in, latest market timestamps and public exchange API access separately; mocks cannot certify external CORS, provider uptime or liquidity.
- A Cloudflare deploy has **not** been verified solely by merging a PR: check the new deployment workflow and public domain for a successful release.

## Future features deliberately out of scope

Delta balance/position account retrieval, Mirror Pip integration, automated real orders, account buying-power checks and broker-managed stop/target placement are not required for this release. An owner-only read-only account bridge remains dormant in server source but is neither configured nor used by these pages. Never add live execution without separately authorized design/testing and account-specific safety controls.
