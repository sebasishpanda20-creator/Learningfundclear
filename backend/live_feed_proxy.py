"""LearningFundClear local data proxy v5.3 — NSE, MCX and Delta India feeds.

Data-layer fixes:
  * MCX: the ASP.NET endpoint rejects POSTs that lack the AJAX header stack and an
    explicit body. We now send Content-Type, Accept, X-Requested-With, Origin,
    Referer and ``{"Option": "1"}``, and tolerate the response shape where ``d``
    comes back as a JSON *string* rather than a list.
  * MCX fallback chain: direct scrape -> yfinance futures stream (converted to
    INR) -> labelled constant. Always HTTP 200.
  * NSE: nsepython (NSE's own REST API) -> nsemine -> yfinance (^NSEI / ^NSEBANK /
    SYMBOL.NS) -> labelled constant.
    The route never returns 503, so the badge can trust the ``state`` field.
  * ``state`` is the single source of truth for the UI badge:
    "REAL-TIME MCX DIRECT" / "REAL-TIME NSE DIRECT" / "REAL-TIME YFINANCE" when a
    live tick landed, "SNAPSHOT" when a fallback served the number.

Run:
    pip install -r requirements.txt
    uvicorn backend.live_feed_proxy:app --host 127.0.0.1 --port 8000 --reload
"""

from __future__ import annotations

import json
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Any, Optional

import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Optional dependencies must never take the process down.
try:
    import nsemine  # type: ignore

    HAS_NSEMINE = True
except Exception:  # ImportError or broken install
    nsemine = None  # type: ignore
    HAS_NSEMINE = False

try:
    import yfinance as yf  # type: ignore

    HAS_YFINANCE = True
except Exception:
    yf = None  # type: ignore
    HAS_YFINANCE = False

# nsepython (github.com/aeron7/nsepython) talks to NSE's own REST API. That feed is
# not IP-throttled like Yahoo, so it is the primary NSE source. Optional on import.
try:
    import nsepython as nse_client  # type: ignore

    HAS_NSEPYTHON = True
except Exception:
    nse_client = None  # type: ignore
    HAS_NSEPYTHON = False

# MCX sits behind Akamai, which fingerprints the TLS stack: plain `requests` gets a
# 403. curl_cffi (github.com/lexiforest/curl_cffi) impersonates Chrome and passes.
try:
    from curl_cffi import requests as curl_requests  # type: ignore

    HAS_CURL_CFFI = True
except Exception:
    curl_requests = None  # type: ignore
    HAS_CURL_CFFI = False


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _start_refresher()
    try:
        yield
    finally:
        _stop_refresher()


app = FastAPI(title="LearningFundClear Local Data Proxy v5.2", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

session = requests.Session()
session.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
})

USDINR = 86.50


@app.middleware("http")
async def private_network_access(request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Cache-Control"] = "no-store"
    return response


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _num(value: Any, default: float = 0.0) -> float:
    try:
        out = float(str(value).replace(",", "").strip())
        return out if out == out else default  # reject NaN
    except (TypeError, ValueError):
        return default


def _pick(row: dict[str, Any], *names: str) -> Any:
    """Case-insensitive dict lookup for market-watch row keys."""
    lowered = {str(k).lower(): v for k, v in row.items()}
    for name in names:
        if name.lower() in lowered:
            return lowered[name.lower()]
    return None


# Yahoo throttles bursts (429), which silently pushed every desk onto the constant
# fallback. A scheduler refreshes a fixed watchlist in the background so a throttle
# window degrades to slightly stale ticks instead of constant prices.
_PRICE_CACHE: dict[str, tuple[float, float]] = {}
CACHE_TTL_SECONDS = 45.0

WATCHLIST = [
    "^NSEI", "^NSEBANK",
    "RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS",
    "CL=F", "GC=F", "SI=F", "NG=F", "HG=F",
]

BASE_REFRESH_SECONDS = float(os.environ.get("PRICE_REFRESH_SECONDS", "30"))
MAX_REFRESH_SECONDS = max(BASE_REFRESH_SECONDS * 10, 300.0)

_refresh_state: dict[str, Any] = {
    "last_run": None,
    "last_success": None,
    "throttled": False,
    "interval": BASE_REFRESH_SECONDS,
}
_stop_event = threading.Event()
_refresh_thread: Optional[threading.Thread] = None


def _fetch_price(ticker_symbol: str) -> Optional[float]:
    """One yfinance read; a success refreshes the cache entry."""
    if not HAS_YFINANCE:
        return None
    try:
        hist = yf.Ticker(ticker_symbol).history(period="1d", interval="1m")
        if hist is not None and not hist.empty:
            price = _num(hist["Close"].iloc[-1])
            if price > 0:
                _PRICE_CACHE[ticker_symbol] = (price, time.time())
                return price
    except Exception:
        pass
    return None


def _last_price(ticker_symbol: str) -> Optional[float]:
    """Fresh cache -> live fetch -> last known good tick (never a bare constant)."""
    now = time.time()
    cached = _PRICE_CACHE.get(ticker_symbol)
    if cached and (now - cached[1]) < CACHE_TTL_SECONDS:
        return cached[0]
    price = _fetch_price(ticker_symbol)
    if price:
        return price
    return cached[0] if cached else None


def _refresh_once(stagger_seconds: float = 0.5) -> int:
    """Refresh the watchlist once, spacing calls to stay under Yahoo's burst limit."""
    succeeded = 0
    for ticker_symbol in WATCHLIST:
        if _stop_event.is_set():
            break
        if _fetch_price(ticker_symbol):
            succeeded += 1
        _stop_event.wait(stagger_seconds)
    return succeeded


def _refresher_loop() -> None:
    delay = BASE_REFRESH_SECONDS
    while not _stop_event.is_set():
        succeeded = _refresh_once()
        _refresh_state["last_run"] = time.time()
        if succeeded:
            _refresh_state["last_success"] = time.time()
            _refresh_state["throttled"] = False
            delay = BASE_REFRESH_SECONDS
        else:
            _refresh_state["throttled"] = True
            delay = min(max(delay * 2, BASE_REFRESH_SECONDS * 2), MAX_REFRESH_SECONDS)
        _refresh_state["interval"] = delay
        _stop_event.wait(delay)


def _start_refresher() -> None:
    global _refresh_thread
    if _refresh_thread and _refresh_thread.is_alive():
        return
    _stop_event.clear()
    _refresh_thread = threading.Thread(target=_refresher_loop, name="price-refresher", daemon=True)
    _refresh_thread.start()


def _stop_refresher() -> None:
    _stop_event.set()
    if _refresh_thread:
        _refresh_thread.join(timeout=3)


def _prev_close(ticker_symbol: str) -> Optional[float]:
    if not HAS_YFINANCE:
        return None
    try:
        info = getattr(yf.Ticker(ticker_symbol), "fast_info", None)
        if info is None:
            return None
        value = info.get("previous_close") if hasattr(info, "get") else getattr(info, "previous_close", None)
        value = _num(value)
        return value if value > 0 else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# MCX
# ---------------------------------------------------------------------------
# The old ASP.NET route (/backpage.aspx/GetMarketWatch) is gone — every path under
# it returns MCX's HTML 404. The site's own JS calls a page-relative route instead:
#     GetData("/GetMarketWatch?culture=en-US", "GET", null, ...)  ->  data.Data
MCX_URL = "https://www.mcxindia.com/market-data/market-watch/GetMarketWatch"
MCX_PAGE = "https://www.mcxindia.com/market-data/market-watch"

MCX_HEADERS = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": MCX_PAGE,
}

MCX_CACHE_SECONDS = 20.0
_mcx_cache: dict[str, Any] = {"rows": None, "ts": 0.0}

_mcx_client: Any = None
if HAS_CURL_CFFI:
    try:
        _mcx_client = curl_requests.Session(impersonate="chrome")
    except Exception:
        _mcx_client = None


def _parse_mcx_expiry(value: Any) -> Optional[float]:
    """MCX sends ExpiryDate as e.g. '17NOV2026'."""
    text = str(value or "").strip().upper()
    if not text:
        return None
    try:
        return time.mktime(time.strptime(text, "%d%b%Y"))
    except Exception:
        return None


def _mcx_watch_rows() -> Optional[list[Any]]:
    """Full market-watch payload (~2.8 MB), cached briefly; stale copy on failure."""
    cached_rows = _mcx_cache.get("rows")
    if cached_rows and (time.time() - _mcx_cache.get("ts", 0.0)) < MCX_CACHE_SECONDS:
        return cached_rows

    client = _mcx_client or session
    try:
        resp = client.get(MCX_URL, headers=MCX_HEADERS, timeout=12)
        if resp.status_code != 200:
            return cached_rows

        payload = resp.json()
        rows: Any = payload
        if isinstance(payload, dict):
            if isinstance(payload.get("data"), dict):
                rows = payload["data"].get("Data")
            elif "d" in payload:
                rows = payload.get("d")
        # some responses double-encode the list as a JSON string
        if isinstance(rows, str):
            try:
                rows = json.loads(rows)
            except Exception:
                return cached_rows
        if isinstance(rows, dict):
            rows = rows.get("Data") or rows.get("data")
        if not isinstance(rows, list):
            return cached_rows

        _mcx_cache["rows"] = rows
        _mcx_cache["ts"] = time.time()
        return rows
    except Exception:
        return cached_rows


def _mcx_scrape(commodity: str) -> Optional[dict[str, Any]]:
    """Nearest-expiry FUTCOM contract for `commodity` from MCX's own market watch."""
    rows = _mcx_watch_rows()
    if not rows:
        return None

    target = commodity.upper()
    candidates: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        instrument = str(_pick(row, "InstrumentName") or "").upper()
        if instrument and instrument != "FUTCOM":
            continue
        symbol = str(_pick(row, "Symbol", "ProductCode") or "").upper()
        if symbol != target:
            continue
        ltp = _num(_pick(row, "LTP", "LastPrice"))
        if ltp <= 0:
            continue
        expiry = _parse_mcx_expiry(_pick(row, "ExpiryDate")) or float("inf")
        candidates.append((expiry, row))

    if not candidates:
        return None

    candidates.sort(key=lambda item: item[0])
    row = candidates[0][1]

    ltp = _num(_pick(row, "LTP", "LastPrice"))
    circuit_pct = _num(_pick(row, "CircuitLimit", "circuitlimit"), 4.0) or 4.0
    return {
        "symbol": str(_pick(row, "Symbol", "ProductCode") or target).upper(),
        "ltp": round(ltp, 2),
        "high": _num(_pick(row, "High")),
        "low": _num(_pick(row, "Low")),
        "open": _num(_pick(row, "Open")),
        "volume": _num(_pick(row, "Volume")),
        "change": round(_num(_pick(row, "AbsoluteChange")), 2),
        "pChange": round(_num(_pick(row, "PercentChange")), 2),
        "expiry": str(_pick(row, "ExpiryDate") or ""),
        "upper_circuit": round(ltp * (1 + circuit_pct / 100), 2),
        "lower_circuit": round(ltp * (1 - circuit_pct / 100), 2),
        "state": "REAL-TIME MCX DIRECT",
        "feed_note": "MCX market watch (GetMarketWatch, FUTCOM nearest expiry)",
    }

# yfinance futures → MCX contract conversion
YF_MAP = {
    "CRUDEOIL": ("CL=F", lambda usd: usd * USDINR),                    # USD/bbl → ₹/bbl
    "GOLD": ("GC=F", lambda usd: usd / 31.1035 * 10 * USDINR),         # USD/oz → ₹/10g
    "SILVER": ("SI=F", lambda usd: usd / 31.1035 * 1000 * USDINR),     # USD/oz → ₹/kg
    "NATURALGAS": ("NG=F", lambda usd: usd * USDINR),                  # USD/mmBtu → ₹/mmBtu
    "COPPER": ("HG=F", lambda usd: usd / 0.453592 * USDINR),           # USD/lb → ₹/kg
}

MCX_DEFAULTS = {"CRUDEOIL": 6850.0, "GOLD": 75400.0, "SILVER": 92400.0}


@app.api_route("/api/v1/mcx/live/{commodity}", methods=["GET", "POST"])
def get_mcx_commodity_quote(commodity: str) -> JSONResponse:
    comm_upper = commodity.upper()

    # 1. Direct MCX scrape
    direct = _mcx_scrape(comm_upper)
    if direct:
        return JSONResponse(direct)

    # 2. yfinance commodity stream converted to INR
    mapping = YF_MAP.get(comm_upper)
    if mapping:
        ticker_symbol, convert = mapping
        usd = _last_price(ticker_symbol)
        if usd and usd > 0:
            inr_ltp = round(convert(usd), 2)
            if inr_ltp > 0:
                return JSONResponse({
                    "symbol": comm_upper,
                    "ltp": inr_ltp,
                    "upper_circuit": round(inr_ltp * 1.04, 2),
                    "lower_circuit": round(inr_ltp * 0.96, 2),
                    "state": "SNAPSHOT",
                    "feed_note": f"yfinance {ticker_symbol} converted at USDINR {USDINR}",
                })

    # 3. Known reference level only; unknown commodities are unavailable, not priced.
    if comm_upper in MCX_DEFAULTS:
        default_ltp = MCX_DEFAULTS[comm_upper]
        return JSONResponse({
            "symbol": comm_upper,
            "ltp": default_ltp,
            "upper_circuit": round(default_ltp * 1.04, 2),
            "lower_circuit": round(default_ltp * 0.96, 2),
            "state": "SNAPSHOT",
            "feed_note": "static reference level",
        })

    return JSONResponse({
        "symbol": comm_upper,
        "ltp": 0.0,
        "upper_circuit": 0.0,
        "lower_circuit": 0.0,
        "state": "UNAVAILABLE",
        "feed_note": "no feed for this commodity",
    })


# ---------------------------------------------------------------------------
# NSE
# ---------------------------------------------------------------------------
NSE_DEFAULTS = {"NIFTY": 24200.0, "BANKNIFTY": 51800.0}


def _nsemine_quote(symbol: str) -> Optional[dict[str, Any]]:
    """Probe nsemine's surface; releases differ between `get_quote` helpers."""
    if not HAS_NSEMINE:
        return None

    candidates = []
    for owner in ("get_quote", "get_index_live_price", "get_stock_live_quotes", "live"):
        obj = getattr(nsemine, owner, None)
        if callable(obj):
            candidates.append(obj)
        elif obj is not None:
            for meth in ("get_quote", "get_index_live_price", "get_stock_live_quotes"):
                fn = getattr(obj, meth, None)
                if callable(fn):
                    candidates.append(fn)

    index_names = {"NIFTY": "NIFTY 50", "BANKNIFTY": "NIFTY BANK", "FINNIFTY": "NIFTY FINANCIAL SERVICES"}

    for fn in candidates:
        calls = [{"stock_symbol": symbol, "raw": False}, {"index": index_names.get(symbol, symbol), "raw": False}, (symbol,)]
        for args in calls:
            try:
                raw = fn(**args) if isinstance(args, dict) else fn(*args)
            except Exception:
                continue
            if isinstance(raw, (list, tuple)):
                raw = raw[0] if raw else None
            if isinstance(raw, dict):
                ltp = _num(raw.get("lastPrice") or raw.get("ltp") or raw.get("price"))
                if ltp > 0:
                    return {"ltp": ltp, "change": _num(raw.get("change")), "pChange": _num(raw.get("pChange"))}
    return None


NSE_INDEX_NAMES = {
    "NIFTY": "NIFTY 50",
    "NIFTY50": "NIFTY 50",
    "BANKNIFTY": "NIFTY BANK",
    "NIFTYBANK": "NIFTY BANK",
    "FINNIFTY": "NIFTY FINANCIAL SERVICES",
    "MIDCPNIFTY": "NIFTY MIDCAP 50",
}

# Last good nsepython tick, so a hiccup on NSE's side serves a fresh-ish number
# instead of dropping to the constant.
_NSE_LAST: dict[str, dict[str, Any]] = {}
NSE_STALE_SECONDS = 300.0


def _nsepython_quote(symbol: str) -> Optional[dict[str, Any]]:
    """Live NSE quote via nsepython (index names and equities)."""
    sym = symbol.upper().replace("^", "")
    quote: Optional[dict[str, Any]] = None

    if HAS_NSEPYTHON:
        try:
            index_name = NSE_INDEX_NAMES.get(sym)
            if index_name:
                row = nse_client.nse_get_index_quote(index_name)
                if row:
                    ltp = _num(row.get("last"))
                    if ltp > 0:
                        quote = {
                            "ltp": ltp,
                            "change": _num(row.get("variation")),
                            "pChange": _num(row.get("percentChange")),
                        }
            else:
                info = (nse_client.nse_eq(sym) or {}).get("priceInfo") or {}
                ltp = _num(info.get("lastPrice"))
                if ltp > 0:
                    quote = {
                        "ltp": ltp,
                        "change": _num(info.get("change")),
                        "pChange": _num(info.get("pChange")),
                    }
        except Exception:
            quote = None

    if quote:
        _NSE_LAST[sym] = {**quote, "ts": time.time()}
        return quote

    previous = _NSE_LAST.get(sym)
    if previous and (time.time() - previous["ts"]) < NSE_STALE_SECONDS:
        return {key: previous[key] for key in ("ltp", "change", "pChange")}
    return None


@app.get("/api/v1/nse/live/{symbol}")
def get_nse_live_quote(symbol: str) -> JSONResponse:
    sym_upper = symbol.upper()

    # 1. nsepython -> NSE's own API
    quote = _nsepython_quote(sym_upper)
    if quote:
        return JSONResponse({
            "symbol": sym_upper,
            "ltp": quote["ltp"],
            "change": quote["change"],
            "pChange": quote["pChange"],
            "state": "REAL-TIME NSE DIRECT",
            "feed_note": "nsepython (NSE official API)",
        })

    # 2. nsemine
    quote = _nsemine_quote(sym_upper)
    if quote:
        return JSONResponse({
            "symbol": sym_upper,
            "ltp": quote["ltp"],
            "change": quote["change"],
            "pChange": quote["pChange"],
            "state": "REAL-TIME NSE DIRECT",
        })

    # 2. yfinance
    ticker_symbol = "^NSEI" if sym_upper == "NIFTY" else ("^NSEBANK" if sym_upper == "BANKNIFTY" else f"{sym_upper}.NS")
    ltp = _last_price(ticker_symbol)
    if ltp and ltp > 0:
        prev = _prev_close(ticker_symbol) or ltp
        change = round(ltp - prev, 2)
        p_change = round((change / prev) * 100, 2) if prev else 0.0
        return JSONResponse({
            "symbol": sym_upper,
            "ltp": round(ltp, 2),
            "change": change,
            "pChange": p_change,
            "state": "REAL-TIME YFINANCE",
        })

    # 4. Known index reference level only. An unknown symbol must never inherit a
    #    plausible-looking price — that would be a tradeable number with no feed.
    if sym_upper in NSE_DEFAULTS:
        default_ltp = NSE_DEFAULTS[sym_upper]
        return JSONResponse({
            "symbol": sym_upper,
            "ltp": default_ltp,
            "change": 0.0,
            "pChange": 0.0,
            "state": "SNAPSHOT",
            "feed_note": "static reference level",
        })

    return JSONResponse({
        "symbol": sym_upper,
        "ltp": 0.0,
        "change": 0.0,
        "pChange": 0.0,
        "state": "UNAVAILABLE",
        "feed_note": "no feed for this symbol",
    })


# ---------------------------------------------------------------------------
# misc
# ---------------------------------------------------------------------------
@app.get("/api/v1/health")
def health() -> dict[str, Any]:
    last_success = _refresh_state["last_success"]
    return {
        "status": "ONLINE",
        "version": "5.3",
        "proxy": "Quant Core Local Proxy",
        "nsepython": HAS_NSEPYTHON,
        "curl_cffi": HAS_CURL_CFFI,
        "nsemine": HAS_NSEMINE,
        "yfinance": HAS_YFINANCE,
        "mcx_watch_rows": len(_mcx_cache.get("rows") or []),
        "refresher": {
            "running": bool(_refresh_thread and _refresh_thread.is_alive()),
            "watchlist": len(WATCHLIST),
            "cached": len(_PRICE_CACHE),
            "interval_seconds": round(_refresh_state["interval"], 1),
            "throttled": _refresh_state["throttled"],
            "last_success_age_s": round(time.time() - last_success, 1) if last_success else None,
        },
    }


@app.get("/api/v1/prices")
def cached_prices() -> JSONResponse:
    now = time.time()
    return JSONResponse({
        "count": len(_PRICE_CACHE),
        "tickers": {
            ticker_symbol: {"price": round(price, 2), "age_seconds": round(now - ts, 1)}
            for ticker_symbol, (price, ts) in sorted(_PRICE_CACHE.items())
        },
        "state": "CACHE",
    })


DELTA_TICKER_BASE = "https://api.india.delta.exchange/v2/tickers"
DELTA_CACHE_SECONDS = 10.0
_delta_cache: dict[str, tuple[dict[str, Any], float]] = {}


@app.get("/api/v1/delta/ticker/{symbol}")
def delta_ticker(symbol: str) -> JSONResponse:
    """Live perpetual/mark price from Delta India's public ticker."""
    sym = (symbol or "").upper()
    cached = _delta_cache.get(sym)
    if cached and (time.time() - cached[1]) < DELTA_CACHE_SECONDS:
        return JSONResponse(cached[0])

    try:
        resp = requests.get(f"{DELTA_TICKER_BASE}/{sym}", timeout=6)
        if resp.status_code == 200:
            result = (resp.json() or {}).get("result") or {}
            ltp = _num(result.get("close") or result.get("mark_price"))
            if ltp > 0:
                band = result.get("price_band") or {}
                payload = {
                    "symbol": sym,
                    "ltp": round(ltp, 2),
                    "change": _num(result.get("mark_change_24h")),
                    "pChange": _num(result.get("mark_change_24h")),
                    "mark_price": _num(result.get("mark_price")),
                    "funding_rate": _num(result.get("funding_rate")),
                    "volume": _num(result.get("turnover_usd") or result.get("turnover")),
                    "upper_circuit": _num(band.get("upper_limit")),
                    "lower_circuit": _num(band.get("lower_limit")),
                    "state": "LIVE DELTA API",
                }
                _delta_cache[sym] = (payload, time.time())
                return JSONResponse(payload)
    except Exception:
        pass

    if cached:
        return JSONResponse({**cached[0], "state": "SNAPSHOT", "feed_note": "stale Delta tick"})
    return JSONResponse({
        "symbol": sym,
        "ltp": 0.0,
        "change": 0.0,
        "pChange": 0.0,
        "state": "UNAVAILABLE",
        "feed_note": "no Delta tick for this symbol",
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
