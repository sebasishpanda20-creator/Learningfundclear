# Stock & crypto scanner

Release: 24 October 2026. Research screening only; no orders or broker integration.

## Coverage and rules

- Indian stock watchlists: up to 30 NSE/BSE symbols; authenticated same-origin Yahoo history relay prevents browser CORS issues. A relay cannot guarantee provider availability.
- Crypto spot: 20 default USDT pairs, custom USDT pairs accepted, up to 30 per scan. Public Binance market-data endpoint; no API keys or trading access.
- Intraday: stock 15m/daily; crypto 15m/hourly. Swing: stock daily/weekly; crypto hourly/daily.
- 100 completed candles on both timeframes; EMA20/50 agreement, 20-candle breakout or EMA20 rejection, relative volume, turnover, extension and net reward/risk gates.
- ATR14 stop or candle extreme, whichever is farther. Initial 3R target, capped at previous 20-candle extreme for pullbacks. Estimated round-trip costs deducted from reward and added to risk.
- Score is a deterministic checklist ranking, never an estimated win rate.
- Bearish results are labelled “Bearish / avoid”; no spot short instruction.

## Reliability and efficiency

Three concurrent symbol workers, sequential timeframe requests per symbol, 60-second memory cache, bounded watchlist, cancellable requests, generation checks prevent late responses overwriting a new scan. Server cache bounded to 200 entries. Provider 401/403/429 pauses new upstream requests for one minute. No arbitrary upstream URL inputs; signed-in active account required before stock history access. Supabase tokens never forwarded to Yahoo.

Results are re-evaluated every 30 seconds for stale candles. Settings changes clear old results. Empty/error responses produce Wait. Both JSON exports and UI use re-evaluated results. CSV stock Swing fallback stays local; weekly candles aggregated from daily history, incomplete week excluded.

## Limits

These rules have not been performance-backtested or optimised. No improved profitability or daily income claim. No bid/ask check, event/earnings/calendar integration, real-time guarantee, futures sizing, or broker execution. Relative volume is against prior 20 same-length bars, not same-time-of-day volume. Turnover is a close-times-volume estimate. Public providers may fail. CSV corporate-action adjustments must be checked by the user. Funding research remains separate.

## Verification

- Unit tests: qualification, costs, conflicting trends, missing volume, stale higher timeframe, incomplete/gapped candles, malformed inputs, bearish labels, relay authentication and token isolation.
- Authenticated browser fixtures at 1440px and 390px: watchlist scan, ranked setup cards, filtering, resetting, invalid symbol rejection, and signed-out redirect. Fixture tests do not verify production data or profitability.
- Production regression guard and Cloudflare asset build.

## API reference

Binance public market data endpoint documentation:
https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md
