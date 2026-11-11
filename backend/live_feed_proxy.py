"""Local FastAPI microservice for un-delayed NSE price quotes.

Serves real-time / delayed-free NSE data on port 8000 with CORS enabled.
Uses `nsemine` for un-delayed quotes and `yfinance` for fundamental data.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Live NSE Feed Proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/v1/nse/live/<symbol>")
async def live_quote(symbol: str):
    """Return un-delayed NSE quote for <symbol> using nsemine."""
    # Placeholder: actual implementation uses nsemine library
    return {"symbol": symbol, "price": 0.0, "source": "nsemine-placeholder", "delayed": False}


@app.get("/api/v1/fundamental/<symbol>")
async def fundamental_data(symbol: str):
    """Return fundamental balance sheet data using yfinance."""
    # Placeholder: actual implementation uses yfinance
    return {"symbol": symbol, "pe_ratio": 0.0, "source": "yfinance-placeholder"}