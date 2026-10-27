# LearningFundClear crypto desk — research-only release (27 October 2026)

## Production scope

This is a standalone browser research portal, not a trade execution system. **No ChatGPT or OpenAI subscription, Delta account link, API trading key, Mirror Pip link, or broker login is required for options or funding research.** The portal runs the market scan automatically after INR capital is entered (a 2/4/8-hour horizon has a default). It checks public market data, completed 15m and hourly candles, 15m/1h EMA trend, RSI(14), MACD(12,26,9), ADX(14), optional traded volume and SMC BOS/sweep evidence, option quotes and products, indicative exchange fees, funds/capital-based limits, and shows entry, spread stop/target, and quote-based monitoring for paper plans.

- **Directional gate**: both 15m and 1h EMA20/50 must align; weighted evidence from RSI, MACD, ADX, optional real volume and SMC BOS/sweep must total at least 70 points. SMC is **optional**: without it, both momentum indicators **and** directional ADX must agree. BOS/sweep without momentum does **not** qualify. These heuristic points are not a calibrated probability of success. Missing volume is N/A and does not block scoring, but provides zero supporting points.
- BTC, ETH and available XAUT tokenized-gold option listings are checked independently. No made-up strikes or gold options.
- Debit verticals may be shown as **PAPER PLAN** if gates pass. Credit spreads/iron condors are strictly **WATCH ONLY** without verified multi-leg margin/fills.
- Funding is separately displayed as **WATCH ONLY** when carry and hedge economics are unverified.
- **Historical signal validation (on demand)** compares the frozen multi-factor rule with EMA+SMC and EMA-only baselines on requested 42 calendar days of public Delta BTC/ETH 15m and hourly perpetual candles. Candle history is fetched in <=1,500-candle requests, validated for continuity and closed timestamps, chronologically split 70/30 (training/OOS), and tested with non-overlapping 2/4/8-hour hypothetical positions. A gap, limited market history or unavailable API response yields **UNAVAILABLE** rather than a performance estimate. Results include cost-adjusted R, 40-bps execution-cost sensitivity, 95% Wilson win-rate intervals, trailing ADX-defined trending/ranging/transition regimes and relative ATR volatility regimes. Predefined parameter settings are not tuned to training data; a single holdout period is not a future proof of profitability.
- **Minimum reporting sample**: 30 training and 20 out-of-sample trades per fixed method. Small samples get **INSUFFICIENT SAMPLE**; meeting minimums is **PRELIMINARY HISTORICAL RESEARCH**, not a statistically established trading edge.
- The quick 14-day legacy backtest remains available as a secondary underlying directional proxy; neither backtest includes **historical option-chain premiums/IV, transaction depth, actual orders, funding, margin or derivative-specific P&L**.
- **Capital changes automatically invalidate a locked paper plan and recalculate**. A visible budget now explains the 2% modeled loss, 30% notional caps and the portal's arbitrary $20-equivalent research threshold. ₹1,000 and ₹10,000 cannot silently share stale paper-contract sizing; market direction itself correctly stays capital-independent.
- All outputs require recent data; stale/missing market inputs lead to **NO TRADE**. Bid/ask watch stops are alerts, never exchange bracket orders.
- No live execution, order placement, broker credential access, position importing, autonomous background trades or ChatGPT requests.

## Hosting / deployment

**Cloudflare Workers (existing linked production domain)**: `learningfundclear.sebasish-panda20.workers.dev`. Cloudflare Builds is connected to `portal/cloudflare-migration` and reads that branch directly. Build from `portal/cloudflare-migration`: `npm install`, `npm run build:cloudflare`, then `npm run deploy:cloudflare`. The worker and static assets use `wrangler.jsonc`. Existing `NIFTY_FEED_PRIVATE_KEY` is only required for the optional Nifty feed API; it is **not needed for the crypto research pages**. Never put hosting or broker secrets in source files.

**No additional Cloudflare GitHub Actions secrets are needed for this existing Cloudflare Builds connection.** A verified push/merge to `portal/cloudflare-migration` triggers the already-connected Cloudflare Build. `main` remains independently used by GitHub Pages and is not the active Cloudflare production branch. Do not change the Cloudflare production branch or worker runtime secrets.

**GitHub Pages (fallback static hosting)**: `main` also triggers `.github/workflows/deploy-pages.yml`. The crypto research pages can use the public exchange endpoints in supported browsers, but GitHub Pages **cannot host Worker `/api/*` endpoints** (not needed for the crypto options/funding research scope). Supabase account login still applies to protected portal pages.

## Acceptance checks

- `bash .ci/guard.sh` — HTML/JS contracts, scanner tests, crypto desk tests and 42-day validation/capital regression tests.
- `node qa/crypto-desk-flows.cjs` — authenticated browser integration with **mock** market feeds in mobile and desktop viewports.
- `npm run build:cloudflare && npm run check:cloudflare` — Worker packaging preflight.
- Verify production browser sign-in, latest market timestamps and public exchange API access separately; mocks cannot certify external CORS, provider uptime or liquidity.
- A Cloudflare deploy has **not** been verified solely by merging a PR: inspect Cloudflare **Workers & Pages → learningfundclear → Deployments** for the exact production commit and a green build. GitHub Actions dry-run checks are not proof of a Cloudflare production deployment.

## Future features deliberately out of scope

Delta balance/position account retrieval, Mirror Pip integration, automated real orders, account buying-power checks and broker-managed stop/target placement are not required for this release. An owner-only read-only account bridge remains dormant in server source but is neither configured nor used by these pages. Never add live execution without separately authorized design/testing and account-specific safety controls.
