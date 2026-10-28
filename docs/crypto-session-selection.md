# Session selection V2

Problem found: the selector ranked debit spreads by maximum expiry payoff / maximum loss. A high expiry ratio could still have a negative net short-session target or less reward than the modeled stop loss. Existing costs are conservative estimates and remain unchanged.

For each otherwise eligible spread, use the existing target (min of 90% width and 160% entry debit), stop (50% entry debit), and estimated full round-trip cost reserve. Compute net target gain = target minus debit minus costs; net stop loss = debit minus stop plus costs. Require positive net target, net target/stop >= 1, and the present bid/ask close value strictly above the stop. Rank qualifying debit spreads by net target/stop. Maximum expiry profit remains displayed as a distinct quantity. Equal capital scales reward, risk and costs together; it cannot fix poor unit economics.

The 1:1 rule is an explicit conservative planning constraint, not a statistically optimized threshold or evidence of positive expectancy. It can reduce signals. A larger target is not necessarily more attainable. Realized outcomes and time exits differ; no historical option-chain or fill backtest has been completed. Existing underlying-proxy validation does not validate option selection V2.

During monitoring, refresh current 15m/1h trend data. Opposite, unconfirmed or unavailable trend shows TREND REVIEW while keeping the saved spread and exits fixed. Saved direction is no longer presented as fresh confirmation. No trades are executed.

Checks: regression fixtures now specify product taker rates for positive cases; standalone fallback-fee tests remain. Added boundary tests for fee-erased targets, stop already breached, net reward below loss, and expiry width not inflating session score.

Reference for the distinction between expiry maximum payoff and pre-expiry trading: https://www.optionseducation.org/strategies/all-strategies/bull-call-spread-debit-call-spread
