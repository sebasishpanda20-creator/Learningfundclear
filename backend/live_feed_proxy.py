"""Local FastAPI microservice for un-delayed NSE quotes and fundamentals.

Serves the portal's data engine at http://127.0.0.1:8000 with permissive CORS so
the static site can call it from any origin (including https pages), and answers
Private Network Access preflights so modern Chrome lets a public page reach a
loopback service.

Run:
    pip install -r requirements.txt
    uvicorn live_feed_proxy:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="LearningFundClear Live NSE Proxy", version="4.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def private_network_access(request, call_next):
    """Allow public https pages to reach this loopback service (Chrome PNA)."""
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Cache-Control"] = "no-store"
    return response


# ---------------------------------------------------------------------------
# Optional dependencies. The proxy degrades gracefully instead of crashing so
# the portal falls back to its snapshot feed when nothing is installed.
# ---------------------------------------------------------------------------
def _load_nsemine():
    try:
        import nsemine  # type: ignore

        return nsemine
    except Exception:
        return None


def _load_yfinance():
    try:
        import yfinance  # type: ignore

        return yfinance
    except Exception:
        return None


def _nsemine_quote(symbol: str) -> Optional[dict[str, Any]]:
    """Try the nsemine client entry points that expose a live NSE quote.

    nsemine has changed its surface between releases, so probe the common
    callables instead of pinning one signature. Returns None when unavailable.
    """
    ns = _load_nsemine()
    if ns is None:
        return None

    candidates = []
    for owner_name in ("NSE", "Nse", "nse"):
        owner = getattr(ns, owner_name, None)
        if owner is None:
            continue
        instance = owner() if callable(owner) else owner
        for meth in ("get_quote", "quote", "get_quotes", "live_price", "get_live_price"):
            fn = getattr(instance, meth, None)
            if callable(fn):
                candidates.append(fn)

    for fn in candidates:
        for args in ((symbol,), (symbol, "EQ"), (symbol.upper(),)):
            try:
                raw = fn(*args)
            except Exception:
                continue
            payload = _normalise_quote(raw)
            if payload:
                payload["source"] = "nsemine"
                payload["delayed"] = False
                return payload
    return None


def _normalise_quote(raw: Any) -> Optional[dict[str, Any]]:
    """Coerce whatever nsemine/yfinance returns into a flat quote payload."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return {"price": float(raw)}
    if isinstance(raw, (list, tuple)) and raw:
        return _normalise_quote(raw[0])
    if not isinstance(raw, dict):
        try:
            raw = dict(raw)
        except Exception:
            return None

    def pick(keys):
        for key in keys:
            for k, v in raw.items():
                if str(k).lower().replace("_", "") == key:
                    try:
                        return float(v)
                    except (TypeError, ValueError):
                        continue
        return None

    price = pick(("lastprice", "ltp", "price", "last", "close", "lasttradedprice"))
    if price is None:
        return None
    return {
        "symbol": raw.get("symbol") or raw.get("Symbol") or "",
        "price": price,
        "change_pct": pick(("pchange", "changepercent", "changeinpercent", "changepct")),
        "open": pick(("open", "openprice")),
        "high": pick(("dayhigh", "high")),
        "low": pick(("daylow", "low")),
        "volume": pick(("totaltradedvolume", "volume")),
    }


def _yfinance_quote(symbol: str) -> Optional[dict[str, Any]]:
    yf = _load_yfinance()
    if yf is None:
        return None
    ticker_symbol = symbol if symbol.endswith(".NS") or symbol.endswith("-USD") else f"{symbol}.NS"
    try:
        ticker = yf.Ticker(ticker_symbol)
        info = getattr(ticker, "fast_info", None)
        price = None
        if info is not None:
            price = info.get("last_price") if hasattr(info, "get") else getattr(info, "last_price", None)
        if price is None:
            hist = ticker.history(period="1d", interval="1m")
            if hist is not None and not hist.empty:
                price = float(hist["Close"].iloc[-1])
        if price is None:
            return None
        return {"symbol": symbol, "price": float(price), "source": "yfinance", "delayed": True}
    except Exception:
        return None


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "learningfundclear-live-feed-proxy",
        "version": "4.0.0",
        "nsemine": _load_nsemine() is not None,
        "yfinance": _load_yfinance() is not None,
    }


@app.get("/api/v1/nse/live/{symbol}")
async def live_quote(symbol: str) -> JSONResponse:
    """Un-delayed NSE quote, with a clearly-flagged delayed fallback."""
    quote = _nsemine_quote(symbol)
    if quote is None:
        quote = _yfinance_quote(symbol)
    if quote is None:
        raise HTTPException(
            status_code=503,
            detail="No quote source available. Install nsemine (un-delayed) or yfinance (delayed).",
        )
    quote.setdefault("symbol", symbol)
    return JSONResponse(quote)


@app.get("/api/v1/fundamental/{symbol}")
async def fundamental(symbol: str) -> JSONResponse:
    """Fundamental snapshot used by the Piotroski / DCF desk."""
    yf = _load_yfinance()
    if yf is None:
        raise HTTPException(status_code=503, detail="yfinance is not installed.")

    ticker_symbol = symbol if symbol.endswith(".NS") else f"{symbol}.NS"
    try:
        info = yf.Ticker(ticker_symbol).info or {}
    except Exception as exc:  # pragma: no cover - network dependent
        raise HTTPException(status_code=502, detail=f"yfinance lookup failed: {exc}")

    fields = {
        "symbol": symbol,
        "name": info.get("longName") or info.get("shortName"),
        "pe_ratio": info.get("trailingPE"),
        "pb_ratio": info.get("priceToBook"),
        "roe": info.get("returnOnEquity"),
        "roa": info.get("returnOnAssets"),
        "debt_to_equity": info.get("debtToEquity"),
        "free_cash_flow": info.get("freeCashflow"),
        "market_cap": info.get("marketCap"),
        "source": "yfinance",
    }
    return JSONResponse(fields)


@app.get("/api/v1/usdinr")
async def usd_inr() -> JSONResponse:
    yf = _load_yfinance()
    if yf is None:
        raise HTTPException(status_code=503, detail="yfinance is not installed.")
    try:
        hist = yf.Ticker("INR=X").history(period="1d", interval="1m")
        rate = float(hist["Close"].iloc[-1]) if hist is not None and not hist.empty else None
    except Exception as exc:  # pragma: no cover - network dependent
        raise HTTPException(status_code=502, detail=f"FX lookup failed: {exc}")
    if rate is None:
        raise HTTPException(status_code=503, detail="No FX data available.")
    return JSONResponse({"pair": "USDINR", "rate": rate, "source": "yfinance"})
