"""LearningFundClear local data proxy v5.0 — NSE, MCX and Delta India feeds.

Fixes applied on top of the v5.0 spec:
  * ``nsemine`` is imported defensively. The spec's ``from nsemine import live, fno``
    raises ImportError at startup and takes the whole proxy down when the package
    is absent or exposes a different surface; here the endpoints degrade instead.
  * nsemine call signatures are probed, so a version bump does not 500 the route.
  * Private Network Access headers so a public https page can reach loopback.
  * A 503 with a clear message instead of a fabricated 0.0 quote.

Run:
    pip install -r requirements.txt
    uvicorn backend.live_feed_proxy:app --host 127.0.0.1 --port 8000 --reload
"""

from __future__ import annotations

from typing import Any, Optional

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="LearningFundClear Local Data Proxy v5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Referer": "https://www.nseindia.com/",
})


@app.middleware("http")
async def private_network_access(request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Cache-Control"] = "no-store"
    return response


# ---------------------------------------------------------------------------
# Optional dependencies: a missing nsemine must not take the process down.
# ---------------------------------------------------------------------------
def _nsemine():
    try:
        import nsemine  # type: ignore
        return nsemine
    except Exception:
        return None


def _nsemine_live():
    """Return nsemine's live module/object if this release ships one."""
    ns = _nsemine()
    if ns is None:
        return None
    return getattr(ns, "live", ns)


def _num(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
        return out if out == out else default  # reject NaN
    except (TypeError, ValueError):
        return default


def _first_quote(payload: Any) -> Optional[dict[str, Any]]:
    """Normalise whatever nsemine returns into a flat quote dict."""
    if payload is None:
        return None
    if isinstance(payload, (list, tuple)):
        return _first_quote(payload[0]) if payload else None
    if isinstance(payload, (int, float)):
        return {"lastPrice": float(payload)}
    if not isinstance(payload, dict):
        try:
            payload = dict(payload)
        except Exception:
            return None
    return payload


def _nse_quote(symbol: str) -> Optional[dict[str, Any]]:
    live = _nsemine_live()
    if live is None:
        return None

    sym = symbol.upper()
    index_map = {
        "NIFTY": "NIFTY 50",
        "BANKNIFTY": "NIFTY BANK",
        "FINNIFTY": "NIFTY FINANCIAL SERVICES",
    }

    attempts: list[tuple[str, dict[str, Any]]] = []
    if sym in index_map:
        attempts.append(("get_index_live_price", {"index": index_map[sym], "raw": False}))
    attempts.append(("get_stock_live_quotes", {"stock_symbol": sym, "raw": False}))
    attempts.append(("get_stock_live_price", {"stock_symbol": sym, "raw": False}))

    for name, kwargs in attempts:
        fn = getattr(live, name, None)
        if not callable(fn):
            continue
        try:
            raw = fn(**kwargs)
        except Exception:
            try:
                raw = fn(sym)
            except Exception:
                continue
        quote = _first_quote(raw)
        if quote and _num(quote.get("lastPrice")) > 0:
            return quote
    return None


@app.get("/api/v1/health")
def health() -> dict[str, Any]:
    return {
        "status": "ONLINE",
        "version": "5.0",
        "proxy": "Quant Core Local Proxy",
        "nsemine": _nsemine() is not None,
    }


@app.get("/api/v1/nse/live/{symbol}")
def get_nse_live(symbol: str) -> JSONResponse:
    sym = symbol.upper()
    try:
        quote = _nse_quote(sym)
    except Exception as exc:  # defensive: never 500 on a vendor glitch
        raise HTTPException(status_code=502, detail=f"nsemine lookup failed: {exc}")

    if not quote:
        raise HTTPException(
            status_code=503,
            detail=(
                "No live NSE quote available. Install nsemine (pip install nsemine) "
                "or rely on the portal's deterministic snapshot fallback."
            ),
        )

    ltp = _num(quote.get("lastPrice"))
    return JSONResponse({
        "symbol": sym,
        "ltp": ltp,
        "price": ltp,  # kept for older clients that read `price`
        "volume": int(_num(quote.get("totalTradedVolume"))),
        "change_pct": _num(quote.get("pChange")),
        "state": "REAL-TIME PROXY",
    })


@app.api_route("/api/v1/mcx/live/{commodity}", methods=["GET", "POST"])
def get_mcx_live(commodity: str) -> JSONResponse:
    """Live MCX commodity price with circuit bands; falls back to a labelled snapshot."""
    try:
        resp = session.post(
            "https://www.mcxindia.com/backpage.aspx/GetMarketWatch",
            json={},
            headers={"X-Requested-With": "XMLHttpRequest"},
            timeout=5,
        )
        if resp.status_code == 200:
            rows = resp.json().get("d", [])
            if isinstance(rows, str):
                rows = []
            for row in rows:
                sym = str(row.get("Symbol", "")).upper()
                if commodity.upper() in sym:
                    ltp = _num(row.get("LTP"))
                    if ltp > 0:
                        return JSONResponse({
                            "symbol": sym,
                            "ltp": ltp,
                            "high": _num(row.get("High")),
                            "low": _num(row.get("Low")),
                            "open": _num(row.get("Open")),
                            "volume": _num(row.get("Volume")),
                            "upper_circuit": round(ltp * 1.04, 2),
                            "lower_circuit": round(ltp * 0.96, 2),
                            "state": "REAL-TIME MCX DIRECT",
                        })
    except Exception:
        pass

    base_price = 6850.0 if "CRUDE" in commodity.upper() else (75400.0 if "GOLD" in commodity.upper() else 92400.0)
    return JSONResponse({
        "symbol": commodity.upper(),
        "ltp": base_price,
        "volume": 14200,
        "upper_circuit": round(base_price * 1.04, 2),
        "lower_circuit": round(base_price * 0.96, 2),
        "state": "SNAPSHOT",
    })


@app.get("/api/v1/delta/products/categorized")
def get_delta_categorized() -> JSONResponse:
    try:
        r = requests.get("https://api.india.delta.exchange/v2/products", timeout=5)
        if r.status_code == 200:
            cats: dict[str, list[dict[str, str]]] = {"Futures": [], "Options": [], "RWA Tokens": []}
            for p in r.json().get("result", []):
                if p.get("state") != "active":
                    continue
                s = str(p.get("symbol", ""))
                ct = str(p.get("contract_type", "")).lower()
                if "rwa" in s.lower():
                    cats["RWA Tokens"].append({"id": s, "label": f"{s} (RWA)"})
                elif "option" in ct:
                    cats["Options"].append({"id": s, "label": f"{s} (Option)"})
                else:
                    cats["Futures"].append({"id": s, "label": f"{s} (Perp)"})
            return JSONResponse({"categories": cats, "state": "LIVE DELTA API"})
    except Exception:
        pass

    return JSONResponse({
        "categories": {
            "Futures": [
                {"id": "BTCUSD", "label": "BTCUSD (Perp)"},
                {"id": "ETHUSD", "label": "ETHUSD (Perp)"},
            ]
        },
        "state": "FALLBACK",
    })


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
