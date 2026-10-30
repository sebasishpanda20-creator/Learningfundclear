# Crypto options: sideways range research

The crypto options desk now separates a genuine range from the legacy `SIDEWAYS` label. `SIDEWAYS` can mean that directional EMA timeframes disagree; it is not itself a range signal.

## RANGE_V1 rules

The detector uses completed Delta candles only. It requires 24 prior entry candles, at least two separated tests of both range boundaries, close-to-close directional efficiency <=0.30, width between 3 and 12 ATR(14), higher-timeframe EMA20 drift <=0.5 entry ATR over six bars, the latest completed close inside the central 60%, and no latest candle breakout. It checks 15m/1h by default or 5m/15m in fast mode. Missing intervals, stale bars, or bad OHLC data fail closed.

The condor sells a put at least 0.25 ATR below range support and a call at least 0.25 ATR above resistance. It buys same-expiry, same-contract-value outer wings. It requires fresh <=60-second quotes, positive non-crossed books, <=15% quote width, >=$500 option OI, and short-strike IV >=1.2x realised volatility. Delta mark IV is preferred; bid IV is a labeled fallback. All legs must be live and operational.

Targets/stop apply to the combined buyback debit: target at 50% of initial credit; stop at 125% of initial credit, capped at 95% of the wider wing. Also exits for a completed-candle range break (0.25 ATR buffer) or the 2/4/8-hour session limit. These levels are research rules, not proven edges or exchange orders.

Quantity is whole contracts, capped to 2% of capital at theoretical maximum expiry loss plus estimated fees, and 30% of capital against four-leg notional. The latter is a research budget; it is not Delta account margin or guaranteed buying power. Cost reserve models eight taker fills at product rates, 18% GST, 0.1% option-premium slippage per side and 20% underlying-notional buffer, without premium fee-cap discounts. INR uses the desk's indicative FX. Costs can differ.

## Why options may still say WAIT

All four contracts must pass quote age, range location, common expiry/value, order book, volatility, net credit, stop/target economics and capital checks. The page exposes listed/fresh/underlying-price-matched contract counts. If the exchange endpoint is delayed or serves stale quotes, no executable plan is produced. Do not bypass the freshness gate to make a suggestion appear.

The futures scanner is a separate market/feed/risk path; its functioning does not establish that options quotes are fresh.

## Limitations and validation

This is a paper candidate, not a live signal. There is no historical option-chain backtest yet, no IV surface/history, no event/news calendar, no cross-margin computation and no fill simulation at full size. Test with demo/paper data first; compare costs against a Delta account fee screen. The portal sends no orders, protective stops, or email alerts for this strategy.
