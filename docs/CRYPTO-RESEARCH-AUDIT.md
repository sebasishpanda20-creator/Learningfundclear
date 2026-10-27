# Independent research audit — Delta Exchange India, 27 October 2026

## What was verified against primary sources

1. **Funding payment snapshot, not holding-time prorating:** Delta India states that the engine snapshots positions at the funding exchange time; any position present in the snapshot pays/receives the full funding for that interval regardless of how long it was held. Holding only minutes DOES NOT guarantee a payment: quote spread, sudden mark-price moves, order rejections, execution latency and an uncertain snapshot can dominate. Source: https://guides.delta.exchange/delta-exchange-india-user-guide/derivatives-guide/docs
2. **Most 8-hour settlements:** 05:30, 13:30 and 21:30 IST. Individual contracts may use shorter intervals, so **the portal MUST prefer the exchange's actual `nfr` field**, and must not claim a specific live deadline solely from clock arithmetic. Source: same.
3. **Authoritative live funding channel:** `wss://public-socket.india.delta.exchange` with `funding_rate` subscription. Its message `fr` is a **percentage** (illustration 0.01 denotes 0.01%), `nfr` is a UTC **microsecond timestamp**, `ts` is UTC microseconds, `fi` is seconds. Existing REST ticker fields alone do not establish the same units and next eligible settlement. Portal code now discards stale/unverified websocket values. Source: https://docs.delta.exchange/#funding_rate
4. **Funding formula:** funding payment = position notional at index price × funding decimal rate. Positive generally pays shorts; negative generally pays longs. Delta charges no separate fee for the **funding transfer**, but exchange trading commissions, GST and market slippage may apply to opening/closing positions. Source: Delta India perpetual guide.
5. **Options are distinct from perpetuals:** the India official guide describes BTC and ETH European-style options expiring at 17:30 IST. **XAUT options must not be assumed to exist**; only exchange-verified listings can be candidates. Source: https://guides.delta.exchange/delta-exchange-india-user-guide/derivatives-guide/options-guide
6. **Indian INR presentation:** raw USD-settled derivative calculations and a third-party indicative FX quote should not be advertised as the account's actual INR settlement rate. Source: https://guides.delta.exchange/delta-exchange-india-user-guide/account-setup/usd-inr-rate

## Open-source design references reviewed (not copied or adopted blindly)

- Freqtrade: https://github.com/freqtrade/freqtrade — direction signal backtesting, data leakage checks and walk-forward validation. Its `lookahead-analysis` demonstrates why a promising strategy can look artificially profitable when future candles enter indicators. https://www.freqtrade.io/en/stable/lookahead-analysis/
- Hummingbot: https://github.com/hummingbot/hummingbot/blob/master/scripts/v2_funding_rate_arb.py — funding-rate arbitrage research involving cross-venue positions, threshold checks and position management. **Its connectors and multi-leg assumption are not a drop-in strategy for Delta India.**
- Hummingbot discusses funding-rate arbitrage and ongoing position-management concerns. https://hummingbot.org/release-notes/1.27.0/

## Limits of the current portal

- The funding dashboard ranks **illustrative single-perpetual receipts after a sample one-leg trading-cost allowance**, not hedged net profit. In the absence of a verified spot hedge, borrow fees, live two-market depth and basis risk, it must show **WATCH ONLY** rather than trade execution advice.
- Illustrative fee floor in the dashboard: 0.05% each-side taker commission ×2, GST 18% on commission, and 0.10% each-side slippage ×2 = **0.318% of notional**. This is a scenario assumption, not the verified current account fee schedule; actual fee and slippage can differ, so do not label it realized profit. Funding rate can change until the snapshot.
- If there is no fresh Delta funding WebSocket value/next timestamp, the system must show **WAIT**, not invent a coin ranking.
- Funding 'last moments' tactics are particularly vulnerable to execution/settlement snapshot risk and liquidation or price moves. There is no dependable passive-income guarantee.
- Directional options research uses completed 15m/1h EMA20/50 with RSI, MACD, ADX, optional volume and SMC confirmations; BOS/sweep are not mandatory. The on-demand 42-day underlying-perpetual signal study compares a fixed multi-factor rule with two baselines across a chronological train/test split and prior ADX/ATR regimes, rejecting truncated or gapped datasets. **This is not a backtest of historical options premium, bid/ask, implied volatility, margin or actual fills, and it cannot establish a verified forward profitability edge.**

## Acceptance bar for better strategies

Require strategy tests across trending, mean-reverting and volatile environments; contemporaneous quotes/fees; a walk-forward holdout with unchanged parameters; simulated missed fills; realistic spread, IV, funding and margin; and paper observation before any recommendation can be ranked by expected **net** profit.

The UI remains India-first, capital-only, and read-only.
