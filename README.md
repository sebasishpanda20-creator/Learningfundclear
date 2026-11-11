# LearningFundClear — Institutional Quant Terminal v5.0 (with MCX Desk)

Single-file static portal plus a FastAPI data proxy for un-delayed NSE quotes,
MCX commodity prices, Delta India products and fundamental data.

## Desks

| Desk | Coverage |
|---|---|
| Daily Income & Theta | Multi-regime income board, defined-risk theta spreads |
| Stocks F&O (NSE) | BSM options Greeks & skew, beta index hedge & collar |
| **MCX Commodities** | Commodity futures with circuit bands, storage & carry yield |
| Crypto VDA (Delta India) | Perps with 5-window walk-forward, 8h funding carry |
| Fundamental Investing | 9-point Piotroski F-score, 2-stage DCF |
| Risk & Tax Ledger | Sec 115BBH VDA tax (31.2%), 1% TDS u/s 194S |

## Quickstart Runbook

1. Start the Python local proxy:

   ```bash
   pip install -r requirements.txt
   uvicorn backend.live_feed_proxy:app --host 127.0.0.1 --port 8000 --reload
   ```

2. Open `index.html` directly in a browser, or serve it over HTTP.

The portal probes `http://127.0.0.1:8000` first for every quote and falls back to a
deterministic snapshot feed when the proxy is offline, so the UI always renders.

## Proxy endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/v1/health` | service status and whether nsemine is installed |
| GET | `/api/v1/nse/live/{symbol}` | `ltp`, `price`, `volume`, `change_pct` |
| GET/POST | `/api/v1/mcx/live/{commodity}` | `ltp`, OHLC, `upper_circuit`, `lower_circuit` |
| GET | `/api/v1/delta/products/categorized` | Futures / Options / RWA tokens |

## Safety model

* Panic kill-switch (`#panic-bar`) hard-locks every verdict to WAIT / NO TRADE.
* Advisory only: the terminal issues signals, never orders.
* Mandate: no suggestion is issued unless post-cost expectancy is positive.

## Deployment

Published as a static site (Cloudflare Pages project `learningfundclear`); only
`index.html` and `robots.txt` are served. The Python proxy stays local and is
never published.
