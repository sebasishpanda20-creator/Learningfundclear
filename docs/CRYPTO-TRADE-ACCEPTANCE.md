# Crypto Trading Desk — Integration & Acceptance Status (27 October 2026)

This is a **research / paper-plan system**. It does not place orders or connect to Mirror Pip for execution.

## Delivered
- Live-public Delta India market candles, options tickers, contract metadata, completed-candle direction, executable-bid/ask paper monitoring (unchanged).
- Two-leg **credit-spread and four-leg iron-condor** cost/risk screen in `assets/js/crypto-advanced-engine.js`, separate from the existing debit vertical and straddle logic. All credit structures are `WATCH ONLY`, never sent as orders. Max theoretical loss uses worst wing **minus total net premium credit plus full-leg estimated fees/GST/slippage**. Candidate integer sizing is capped at 2% of submitted USD-equivalent capital modeled risk and 30% underlying notional, and is *not* account buying power.
- On-demand gap-rejecting non-overlapping walk-forward backtest of completed underlying perpetual candles (BTC/ETH). Entry is next 15-minute candle open; stop on structure invalidation; target at 1.5R; conservative stop-first when both barriers occur inside a candle; 20 bps round-trip assumed execution burden. **This does not backtest historical options or spreads.** No calibrated volatility regime, out-of-sample holdout, tax modeling or order-book replay. Minimum 20 signals to label a historical proxy.
- Owner-only authenticated **Delta read-only** account API bridge: `GET /api/delta/account?view=wallet|positions|orders`. HMAC signatures are generated server-side and never exposed to the browser. Backend denies anonymous, non-admin, non-owner sessions, all write methods, and all unlisted upstream paths. Requires secrets:
  - `DELTA_API_KEY`: **read-data-only** Delta India API key.
  - `DELTA_API_SECRET`: associated Delta API secret.
  - `DELTA_ACCOUNT_OWNER_USER_ID`: exact Supabase auth user UUID with active admin role. **Do not commit these, paste them in chat, put them in frontend JS, or expose them in logging.**
- Non-executable JSON export for manual strategy review and a separately labeled Mirror Pip external link. Mirror Pip documents a TradingView **single-leg** webhook message and endpoint at https://docs.mirrorpip.com/indicator-automation, but this does not establish compatibility with four-leg options or risk-synchronized spread exits. There is **no tested Mirror Pip multi-leg submission**, and exported JSON is **not** presented as an accepted Mirror Pip order schema.

## Live trading remains deliberately disabled
Never deploy trading API credentials simply by replacing the read-only key: the server exposes only `GET` and never signs an order mutation. There is no unattended trade execution, no valid multi-leg atomic fill guarantee, and no stop/target bracket placement. Paper plans cannot be interpreted as actual positions.

**Prerequisites before considering a live release:**
1. Verify active Delta India trading permissions, sub-account/margin type, fee schedule, order size units and tick increments using a controlled test account.
2. Model and verify official exchange buying power and the order sequence for 2-leg and 4-leg structures; handle partially filled shorts and cancellations/rollback, slippage, exchange downtime and uncertain order acknowledgments.
3. Prove server-side trade authorisation, isolated secret storage, maximum daily loss, notional/exposure caps across *all* positions, one-live-order idempotency, heartbeat/kill switch, auditable event log, error alerts and explicit operator consent to enabling trade execution.
4. Confirm Mirror Pip's official support for multi-leg Delta options beyond its published TradingView single-leg webhook schema, obtain the account's private routing code, and prove authenticated delivery, cancellation, duplicate protection and position reconciliation. Public third-party snippets are not authoritative API documentation.
5. Run historical **option-chain** replay with contemporaneous IV, quote depth, executions, funding/fees and margin, strict out-of-sample research and forward paper trading. Underlying directional proxies cannot establish options-strategy expectancy.
6. Test authenticated deployment against real account read-only responses, browser same-origin requests, failure injection and mobile layouts. GitHub fixture tests are not proof of live account availability.

## Vendor references
- https://docs.delta.exchange/
- https://guides.delta.exchange/delta-exchange-india-user-guide/trading-guide/margin-explainer
- https://www.mirrorpip.com/
- https://docs.mirrorpip.com/indicator-automation

## Offline validation
`node --test qa/crypto-desk.test.cjs qa/crypto-advanced.test.cjs`

The automatic workflow runs this alongside production contract guards.
