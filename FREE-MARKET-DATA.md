# Public market data and portal integration

Implemented 6 October 2026. No broker account, demat account, trading API key, holdings, balance or order access is used by these integrations.

- Crypto spot: Binance public market-data REST API, BTC/ETH/SOL quoted in USDT. Kraken is an explicit alternative quoted in USD. Prices refresh every 20 seconds while the page is visible. These are polled snapshots, not a tick-by-tick websocket feed. No account required.
- Crypto history: completed candles only, from the selected exchange. Forming, malformed, duplicate or stale histories are rejected. Quotes and history clear when changing the selection or when a quote request fails. No synthetic market data is used in production.
- Delta India: manually requested crypto perpetual or expiry-specific options snapshots. OI uses `oi_value_usd`, not the asset-unit `oi_value`. Exchange and receipt timestamps are separate; delayed data is labelled. No account required.
- NSE/BSE: existing Yahoo historical route remains explicitly labelled as potentially delayed. A daily OHLCV CSV can be imported locally; it is not uploaded or persisted. Use data you are entitled to use. At least 100 valid, completed, sufficiently recent daily bars are needed for daily scanning. Corporate-action adjustments must be checked against the user's source. CSV imports do not imply live quotes.
- Indian stock options: external NiftyTrader and Sensibull viewing links. Separate provider login and available free features are governed by the provider. No free NSE/BSE live quote/option-chain API without broker credentials has been verified and connected. Existing index relay remains subject to source availability and freshness checks.
- IndianAPI: provider information link only. It requires a separate key and verified free-tier limits/coverage/delay. No key is collected in browser code. Any future integration must keep private keys server-side.

Provider references: https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md · https://docs.kraken.com/api/docs/rest-api/get-ticker-information · https://docs.delta.exchange/ · https://indianapi.in/indian-stock-market · https://www.niftytrader.in/register · https://web.sensibull.com/login

## Validation

- 56 authenticated page/viewport checks: 14 routes at 320, 390, 768 and 1440 px; no document overflow, one active navigation item, no uncaught script errors.
- 22 existing desktop/mobile functional checks, including journal/watchlist, performance, paper trades, scanner controls, fund browsing/calculators, navigation/theme, logout/back, cross-tab logout and failed revocation.
- 8 scanner/options feed checks and 10 crypto/local-import checks across desktop/mobile. Exchange switching, quote failures, proper currencies, USD OI and no-network CSV scanning use isolated backend fixtures.
- 24 deterministic scanner/data tests, plus existing backend signal and weekly-line guards.
- Public HTTP endpoints returned successful unauthenticated responses. Origin-header probes confirmed CORS support for the private portal origin. Headless browser outbound requests were blocked/timed out in this execution environment, so continuous end-user network availability and account-specific production login have not been certified by these fixture tests.

GitHub integration keeps the latest main NAV snapshot, scheduled scanner/watchdog/deployment workflows, and legacy/GTF-Pro backend gates. The previous shell's static-markup CI assertions were migrated to the shared dynamic shell and real authenticated DOM tests. GTF-Pro remains default off. No accuracy or profitability claim is made: signal correctness tests do not establish predictive performance.

## Automation update — 7 October 2026

The historical stock scanner now starts automatically on opening and repeats every 15 minutes while its tab is visible. The user can pause it; the preference is saved in that browser. Scans do not overlap, and local CSV mode pauses automatic downloads. Invalid/stale candles still cannot generate signals.

The separate GitHub nightly stock scan remains scheduled for 18:00 IST (GitHub may delay scheduled runs). The latest inspected successful run, 37512119622, saved one legacy-pivot signal with no posting errors; some symbols were unavailable. Its webhook secret check passed. This is background historical scanning, not exchange live quotes.

The existing index-option relay returned the 7 October 2026 15:40 IST snapshot during verification. Options overview loads automatically and refreshes every 60 seconds while visible. The relay only supports its listed indices. Individual-stock options and unattended option-chain storage remain blocked on an appropriate data connection; external viewers are not APIs.

The extensionless /signin redirect loop is fixed. Regression tests reproduce hosted .html redirects at desktop/mobile widths and under a repository subdirectory.
