# Indian options strategy preview

Route: `/india-options`. This is an explicitly synthetic, deterministic research workspace. It does not fetch live NSE prices, connect FYERS, place orders, or claim validated returns. Existing crypto desks remain independent.

## Implemented
- Completed-candle 5m breakout with aligned 5m/15m EMA20/50 direction.
- Bought calls/puts and matched-expiry bull-call/bear-put debit spreads.
- Whole-lot sizing: planned stop loss including costs <=1% capital, total premium exposure plus estimated exit costs <=10% capital; quoted-depth cap.
- Premium stop at -25%; targets at +37.5% / +62.5%; net target/stop >=1.25 at T2. Research parameters, not optimized.
- Costs at each hypothetical full exit; no cumulative T1/T2 gain claim. Brokerage ₹20 per order, STT sell premium 0.15%, stamp buy premium 0.003%, SEBI 0.0001%, GST18%, conservative exchange/clearing 0.04%, IPFT allowance 0.0005%, slippage 0.2% per side. Reconcile all fees to account contract notes before live mode.
- Stock event guard; stock expiry buffer seven calendar days is our conservative rule, not an exchange requirement. Sample lots and expiries are not exchange specifications.
- Fail-closed conditions: missing/unconfirmed bars, conflicting direction, no breakout, stale or illiquid quotes, unaffordable size, mismatched hedge, insufficient target room. Non-demo mode is deliberately blocked.

## FYERS connection stage (not implemented)
1. Add server-side OAuth authorization-code callback, session ownership and encrypted token storage. Never put app secrets/access tokens in HTML or localStorage. Read-only market data first; no order scopes until separately requested.
2. Refresh exchange symbol master to resolve actual eligible stock F&O/indices, lot size, tick size, expiries and identifiers. Do not map sample symbols to broker instruments.
3. Normalize completed 5m/15m history. Enforce trading-calendar/session checks, source timestamps, missing bars, corporate actions, and no future candles.
4. Chain endpoint `/data/options-chain-v3`; resolve expiry from expiryData; exclude the underlying row (strike_price -1). Confirm source bid/ask times and depth using market-data stream/depth. A fetch timestamp alone does not prove quote freshness.
5. Replace demo snapshots with authenticated server-backed provider data. Add source/session/event checks to the engine before removing its mode guard. Planned time window: no new entries after14:45 IST, exit review15:10 IST; broker square-off rules separately verified.
6. Historical option-bid/ask replay with fees, slippage and expired contracts; walk-forward holdout and paper forward test. Report sample count, drawdown, expectancy and rejected data. Software tests are not performance backtests.
7. Validate actual account buying power and hedge sequencing. Net debit alone is not proof of temporary margin affordability for separate leg orders. Keep both spread legs intact.

## Sources reviewed 30 Oct2026
- https://fyers.in/api-docs/v3/api/market-data/option-chain
- https://fyers.in/charges-list (public support pages contain inconsistent fee details; conservative estimates only)
- https://www.nseindia.com/static/products-services/equity-derivatives-securities-transaction-tax
- https://www.nseindia.com/static/invest/first-time-investor-stamp-duty-charges-taxes
- https://www.nseindia.com/static/products-services/equity-derivatives-individual-securities

## Tests
`node --test qa/india-options.test.cjs`
`node qa/india-options-flows.cjs` (Playwright, isolated authenticated fixtures, desktop/mobile)
`npm run build:cloudflare`
