# Trading-material review and portal changes

## Review scope

48 uploaded PDFs, 2,624 pages; 47 byte-unique documents. This was a technical suitability review using extracted text, targeted strategy/risk passages, OCR of both Oliver Kell scans and visual inspection of four key pages. It was **not a cover-to-cover reading of every book or independent replication of their results**. The source pages below state what was examined. Original PDFs and their full extracted text are not distributed in this repository.

The YouTube URL https://youtu.be/QoGzZ2ghGOk failed in the web reader. A direct page request subsequently succeeded and exposed a Hindi auto-caption track, but its caption endpoint returned HTTP 200 with an empty body. Search identified promotional metadata for GTF Indicator 2.0, but neither its full video nor transcript was reviewed. No undisclosed/proprietary formula was inferred from that metadata.

## Implemented

- Account-scoped Trading plan with manual planning capital, trade/open/daily/weekly budgets, daily count, minimum net reward/risk, timeframe, market/session and exit notes. Starter values are practice examples, not validated recommendations.
- Pre-trade manual attestations and setup-family tagging. Plan/checklist snapshots retained on each new paper trade. These checks do not certify data freshness automatically.
- Quantity-step rounding, 1x capital commitment ceiling, existing open exposure and explicit estimated round-trip costs in sizing. INR cash/premium units only; no futures margin, FX pip conversion or short-option model.
- Net reward/risk gate. Costs and reason required on manual whole-position exit; old records retain their historical P&L and are labelled cost-unadjusted.
- Daily/weekly loss budgets use sum of losing closed trades (after entered costs) plus open estimated stop risk. Gains do not replenish them; Monday-start week and dates use Asia/Kolkata. No mark-to-market equity feed is claimed.
- Archive preserves history and budget usage; JSON exports; failed storage writes report failure instead of claiming success. Browser-local controls are not broker or multi-device enforcement.
- Strategy notebook distinguishes ORB, pullback/retest, EMA cycle, supply/demand, range/reversal and exit variants. They are unvalidated research candidates; automated signal engines are not changed by these notes.

## Not adopted

Guaranteed daily income, fixed success rates, institutional-order claims inferred from candles, guaranteed gap fills, arbitrary currency-specific tick offsets, automatic martingale/recovery sizing and untested merging of contradictory exit methods. VaR is not a hard loss ceiling. No new profitability backtest is claimed. Missing live options bid/ask/timestamps and FYERS remain separate data integration work.

## Source review register

| # | Source | PDF pages examined | Decision |
|---|---|---|---|
| 1 | 10_essentials_of_forex_trading(1).pdf | 208 | Stop placement; avoid mental-stop assumptions. |
| 2 | 3_Swing_Trading_Examples_with_Charts_Instructions_and_Defenitions(1).pdf | 2 | Dated swing examples; do not import historical quotes as signals. |
| 3 | A Practical Guide to Swing Trading - Larry Swing(1).pdf | 30 | Trailing exits; old dollar offsets are instrument-specific. |
| 4 | Breakout-Trading-Strategies-Quick-Guide(1).pdf | 2–10 | Breakout/retest candidate; fakeouts require explicit invalidation. |
| 5 | Deep Value(1).pdf | 79 | Value-investing research requires financials; not an intraday trigger. |
| 6 | Divergence-Cheat-Sheet-PDF(1).pdf | 5–17 | Divergence is context, not reliable timing by itself. |
| 7 | EZ Trade forex(1).pdf | 67 | News and execution risk; unsupported win-rate claims excluded. |
| 8 | Exchange Rules For The Frankfurt Stock Exchange(1).pdf | 11 | 2004 Frankfurt rules; not current NSE rules. |
| 9 | Exchange-Traded-Funds(1).pdf | 3 | Dated ETF background; historical performance not predictive. |
| 10 | Exploring_Value_at_Risk(1).pdf | 9 | VaR limitations; do not present a stop-risk estimate as maximum possible loss. |
| 11 | Exploring_Value_at_Risk(2).pdf | 9 | Exact byte duplicate of file 10. |
| 12 | Expose-Yourself(1).pdf | 9 | Process discipline does not substitute for tested strategies. |
| 13 | Fibonacci Ratios with Pattern Recognition(1).pdf | 170 | Explicit pattern and risk checklist; no sacred-ratio guarantee. |
| 14 | Fibonacci_Studies(1).pdf | 9 | Chart-software study instructions, not a tested strategy. |
| 15 | Forex One Minute Strategy(1).pdf | 89 | Demo/live execution differences and lot-size constraints. |
| 16 | Free-Price-Action-Trading-PDF-Guide(1).pdf | 18 | Stops should express invalidation rather than desired reward/risk. |
| 17 | Fundamental-Analysis-of-Forex-Markets-Explained-(1).pdf | 4 | Event context; not a mechanical macro prediction. |
| 18 | Gap-Trading-Strategies-Quick-Guide(1).pdf | 4 | Gap-fill percentage is not independently validated; reject certainty. |
| 19 | Highly_Reliable_Patterns(1).pdf | 1–4 (page 1 visual) | Pattern reference only; reliability labels are not measured probabilities. |
| 20 | Michael_Kahn_A_Beginner's_Guide_.pdf | 44 | Volume/context; requires appropriate source volume. |
| 21 | Oliver-Kell-Swing-Trading-Masterclass-Workbook-1.pdf | 1–33 OCR; 3–10 rules; p.6 visual | Cycle framework; original paraphrases only, no reproduced slides. |
| 22 | Oliver-Kell-Swing-Trading-Masterclass-slides-Presentation-1.pdf | 1–17 OCR; p.12 visual | 10/20 EMA framework. Bullish Base n Break slide repeats Crossback text; workbook differs. |
| 23 | Opening-Range-Breakout-Trading-Strategies.pdf | 2–9; p.5 visual | Opening range must finish before evaluating breakout; session must be explicit. |
| 24 | Order-Flow-Trading-Strategies.pdf | 8 | Price-based narrative is not measured order flow. |
| 25 | Order-block-trading-strategies.pdf | 1–8 | Chart zones cannot identify actual bank orders. |
| 26 | Pin-Bar-Trading-Strategies.pdf | 1–11 | Trend/location and completed-bar confirmation; no independent success rate. |
| 27 | Pip_Factory_Entry-1.pdf | 29 | Risk sizing and partial-exit variant; not risk-free after partials. |
| 28 | Pivots,_Patterns,_and_Intraday_Swing_Trades_Derivatives_Analysis.pdf | 208 | Predefined exits and discretionary management are different test variants. |
| 29 | Price_Action_Candlestick_Charting_Practice_Guide_Improve_Understanding.pdf | 67 | Selected chart case study; retrospective examples are not a backtest. |
| 30 | Profitable-Chart-Patterns-Trading-Guide.pdf | 6 | Neckline/breakout definition needed before automation. |
| 31 | Profitable-Gold-Trading-Strategies.pdf | 4 | Gold/FX conventions differ from NSE/crypto; safe-haven claim is not a guarantee. |
| 32 | Range-Trading-Strategies-Quick-Guide.pdf | 4 | Regime distinction: range versus trend. |
| 33 | Reversal-Trading-Strategies-for-All-Markets.pdf | 3 | Reversal candidates require additional definitions/testing. |
| 34 | Stock-Market-Basics-Intro-Guide.pdf | 7 | General market education; no new execution rule. |
| 35 | Supply-and-Demand-Forex-Trading-Guide.pdf | 6 | Zone retests and context; no claim to observe institutional inventory. |
| 36 | Swing-Trading-Strategies-Quick-Guide.pdf | 4–8 | Swing pullback and role reversal; separate from intraday timing. |
| 37 | Swing_Trading_A_Beginners_Guide_to_Highly_Profitable_Swing_Trades.pdf | 81–83 | Position size from risk and available capital; do not move stops solely to improve ratio. |
| 38 | Technical-Analysis-PDF.pdf | 4–11 | Repeatable rule set and tracking; not evidence for stacking all indicators. |
| 39 | The-ultimate-guide-to-trend-following.pdf | 18,29 | Trailing-exit variant conflicts with automatic break-even rules; keep separate. |
| 40 | The_Secrets_To_Emotion_Free_Trading_How_To_Consistently_Act_In_Your.pdf | 26,51 | Execution discipline and no doubling down to recover losses. |
| 41 | Tips And Tricks For Trading The USDJPY Currency Pair.pdf | 1–2 | Currency-specific background; do not transfer broker/correlation claims unverified. |
| 42 | Trading-Psychology-How-to-Master-Your-Trading-Mind.pdf | 1–9 | Checklist/discipline useful; reject suggestion to increase risk merely to feel emotion. |
| 43 | Trading-checklist.pdf | 1 | Pre-trade context, risk and trigger checklist. |
| 44 | Trading-plan.pdf | 1 | Markets, timeframe, session, entry and exit planning fields. |
| 45 | Trend-Trading-Strategies-in-Stock-and-Forex-Markets.pdf | 1–9 | Trend filter and pullback/confirmation as research candidate. |
| 46 | Volume-Trading-Strategy-to-Make-Successful-Trades.pdf | 1–11 | Volume context; distinguish venue-specific volume from market-wide volume. |
| 47 | [Larry_Spears,_Larry_(CON)_Swing]_Swing_Trading_Si(b-ok.cc)(1).pdf | 67,73 | Historical swing method; fixed cents and gap delays not copied. |
| 48 | fi_lecture16_exotic_options_credit_derivatives(1).pdf | 4–5 | Exotic/credit derivative education; outside retail signal-engine scope. |

## External cross-checks

- CME trade/risk management: https://www.cmegroup.com/education/courses/trade-and-risk-management (position size depends on stop distance and account risk; no percentage is universally optimal).
- NSE official market timings: https://www.nseindia.com/static/market-data/market-timings (instrument/session selection matters; no exchange calendar was newly automated here).

## Validation

See qa/trade-plan.test.cjs for risk arithmetic, long/short directions, invalid inputs, capital and lot constraints, net costs, portfolio/day/week budgets, archived history, IST boundaries and corrupt plans. Browser tests exercise authenticated user and signed-out routes, mobile/desktop layout, save/reload, paper creation and close, archives and failed storage writes. Existing production regression guard includes the new unit tests and route.
