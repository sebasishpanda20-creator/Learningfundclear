# LearningFundClear — Quant Terminal v4.0

## Overview
Single-file institutional trading portal with local Python data proxy. Built for advisory-only signal generation with Quarter-Kelly position sizing. All execution is hard-locked to WAIT / NO TRADE via panic kill-switch.

## File Structure
```
Learningfundclear/
├── index.html                   ← Complete Production Portal (Single-File App)
├── backend/
│   └── live_feed_proxy.py       ← Local FastAPI Un-Delayed NSE Scraping Proxy
├── requirements.txt             ← Python Dependencies (fastapi, uvicorn, nsemine, yfinance)
└── README.md                    ← Quickstart & Architecture Documentation
```

## Local Development

### 1. Start the Python Proxy
```bash
cd backend
pip install -r ../requirements.txt
uvicorn live_feed_proxy:app --host 0.0.0.0 --port 8000
```

### 2. Open the Portal
Open `index.html` in a browser or serve via any static HTTP server.
The portal will attempt to connect to `http://127.0.0.1:8000/api/v1/nse/live/{symbol}` first for zero-delay NSE data.
If the local proxy is offline, it falls back seamlessly to deterministic snapshot feeds.

### 3. Portal Features
- **Panic Kill-Switch**: Top-bar strip (`#panic-bar`) hard-locks all signals to WAIT / NO TRADE
- **Mode Toggle**: Button toggles between `ADVISORY (SIGNAL)` and other modes
- **Dark Mode**: Switch between light and dark color schemes
- **Instrument Selection**: NIFTY, BANKNIFTY, RELIANCE, BTCUSD
- **Timeframe Selection**: 5m/15m, 15m/1h, 1h/4h
- **Capital & Risk Input**: Capital (₹ INR), Max Risk / Trade (%), Daily Income Goal (₹)
- **Desk Modules**: Daily Income & Theta Desk, Stocks F&O Desk, Crypto VDA Desk, Fundamental Desk, Risk & Tax Ledger

## Architecture
- **Frontend**: `index.html` — single-file HTML/React application with light-first fintech styling & dark mode
- **Backend**: `backend/live_feed_proxy.py` — FastAPI microservice on port 8000, CORS `allow_origins=["*"]`
- **Data**: `nsemine` for un-delayed NSE quotes; `yfinance` for fundamental data
- **Sizing Mode**: Strictly ADVISORY (Signal Generation with Quarter-Kelly sizing)
- **Mandate**: NO PROFITABLE SETUP AFTER STATUTORY COSTS + EXPECTANCY > ₹0, NO TRADE SUGGESTION

## Cloudflare Pages Deployment
- Project Name: `learningfundclear`
- Framework Preset: `None (Static HTML)`
- Build Command: (Leave Blank)
- Build Output Directory: `/`