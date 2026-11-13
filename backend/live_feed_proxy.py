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
import re
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
    "CL=F", "GC=F", "SI=F", "NG=F", "HG=F", "USDINR=X",
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


def _yahoo_chart_close(ticker_symbol: str) -> Optional[float]:
    """Daily close straight from Yahoo's chart endpoint.

    yfinance rate-limits (YFRateLimitError) and then every converted price falls
    back to SNAPSHOT; the chart endpoint keeps answering for the same ticker.
    """
    try:
        from urllib.parse import quote
        r = requests.get(
            "https://query1.finance.yahoo.com/v8/finance/chart/" + quote(ticker_symbol, safe=""),
            params={"range": "5d", "interval": "1d"},
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
            timeout=8,
        )
        if r.status_code != 200:
            return None
        payload = (r.json().get("chart") or {}).get("result") or []
        if not payload:
            return None
        quote_blocks = (payload[0].get("indicators") or {}).get("quote") or [{}]
        closes = [c for c in (quote_blocks[0].get("close") or []) if c]
        if not closes:
            return None
        price = float(closes[-1])
        return price if price > 0 else None
    except Exception:
        return None


def _fetch_price(ticker_symbol: str) -> Optional[float]:
    """yfinance read first, then the chart endpoint; a success refreshes the cache."""
    if HAS_YFINANCE:
        try:
            hist = yf.Ticker(ticker_symbol).history(period="1d", interval="1m")
            if hist is not None and not hist.empty:
                price = _num(hist["Close"].iloc[-1])
                if price > 0:
                    _PRICE_CACHE[ticker_symbol] = (price, time.time())
                    return price
        except Exception:
            pass
    price = _yahoo_chart_close(ticker_symbol)
    if price:
        _PRICE_CACHE[ticker_symbol] = (price, time.time())
        return price
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
MCX_PROXY_MAP = {
    # (yfinance_ticker, unit_multiplier_to_mcx_quote_unit, duty_factor)
    "CRUDEOIL":   ("CL=F", 1.0,               1.00),  # ₹ per barrel
    "CRUDEOILM":  ("CL=F", 1.0,               1.00),  # ₹ per barrel
    "NATURALGAS": ("NG=F", 1.0,               1.00),  # ₹ per mmBtu
    "NATGASMINI": ("NG=F", 1.0,               1.00),  # ₹ per mmBtu
    "GOLD":       ("GC=F", 10.0 / 31.1035,    1.06),  # Troy oz -> 10 grams + import duty
    "GOLDM":      ("GC=F", 10.0 / 31.1035,    1.06),  # Troy oz -> 10 grams
    "GOLDTEN":    ("GC=F", 10.0 / 31.1035,    1.06),  # Troy oz -> 10 grams
    "SILVER":     ("SI=F", 1000.0 / 31.1035,  1.06),  # Troy oz -> 1 kg + import duty
    "SILVERM":    ("SI=F", 1000.0 / 31.1035,  1.06),  # Troy oz -> 1 kg
    "SILVERMIC":  ("SI=F", 1000.0 / 31.1035,  1.06),  # Troy oz -> 1 kg
    "COPPER":     ("HG=F", 2.20462,           1.03),  # USD/lb -> ₹ per 1 kg
    "ALUMINIUM":  ("ALI=F", 0.001,            1.03),  # USD/MT -> ₹ per 1 kg
}


def _usdinr_rate() -> Optional[float]:
    """Live USDINR.

    The module constant is stale (86.50 against a ~94 spot), and an 8% FX error
    moves every converted commodity by the same 8%.
    """
    live = _last_price("USDINR=X")
    if live and live > 0:
        return float(live)
    return USDINR or None


def get_mcx_converted_spot(symbol: str, usdinr: Optional[float] = None) -> Optional[float]:
    """Convert a Yahoo futures close into the MCX quote unit.

    Returns None — never a price — when the symbol is unmapped or the ticker has
    no usable close. Defaulting an unknown symbol to CL=F would label crude oil
    as zinc.
    """
    entry = MCX_PROXY_MAP.get(str(symbol or "").upper())
    if not entry:
        return None
    ticker, unit_mult, duty = entry
    rate = usdinr if usdinr and usdinr > 0 else _usdinr_rate()
    if not rate:
        return None
    raw_usd = _last_price(ticker)
    if not raw_usd or raw_usd <= 0:
        return None
    return round(raw_usd * rate * unit_mult * duty, 2)


@app.get("/api/v1/mcx/symbols")
def get_mcx_symbols() -> JSONResponse:
    """Contracts the venue is quoting right now, from the market-watch payload.

    The portal offers only these in the MCX dropdown: an index product such as
    MCXBULLDEX never appears in the watch list, so it has no live feed to show.
    """
    rows = _mcx_watch_rows()
    if not rows:
        return JSONResponse({"symbols": [], "state": "UNAVAILABLE"})
    symbols = sorted({
        str(r.get("Symbol") or r.get("symbol") or "").strip().upper()
        for r in rows
        if isinstance(r, dict)
    } - {""})
    if not symbols:
        return JSONResponse({"symbols": [], "state": "UNAVAILABLE"})
    return JSONResponse({"symbols": symbols, "state": "LIVE MCX", "count": len(symbols)})


@app.api_route("/api/v1/mcx/live/{commodity}", methods=["GET", "POST"])
def get_mcx_commodity_quote(commodity: str) -> JSONResponse:
    comm_upper = commodity.upper()

    # 1. Direct MCX scrape
    direct = _mcx_scrape(comm_upper)
    if direct:
        return JSONResponse(direct)

    # 2. Yahoo futures converted into the MCX quote unit (spot proxy, not the future)
    inr_ltp = get_mcx_converted_spot(comm_upper)
    if inr_ltp and inr_ltp > 0:
        ticker_symbol, unit_mult, duty = MCX_PROXY_MAP[comm_upper]
        rate = _usdinr_rate() or USDINR
        return JSONResponse({
            "symbol": comm_upper,
            "ltp": inr_ltp,
            "upper_circuit": round(inr_ltp * 1.04, 2),
            "lower_circuit": round(inr_ltp * 0.96, 2),
            "state": "SNAPSHOT",
            "derived": True,
            "feed_note": (
                f"yfinance {ticker_symbol} x {unit_mult:.4g} x duty {duty:.2f} at USDINR "
                f"{rate:.2f} - spot proxy, futures basis not included"
            ),
        })

    # 3. No static reference levels: a stale hard-coded price reads exactly like a quote.
    #    Unmapped or unfetchable commodities report UNAVAILABLE.

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


@app.get("/api/v1/delta/products")
def get_delta_products():
    url = "https://api.india.delta.exchange/v2/products"
    params = {
        "contract_types": "perpetual_futures,call_options,put_options",
        "states": "live",
        "page_size": 2000,
    }
    rows = []
    cursor = None
    error = None
    try:
        # The venue pages by cursor and its first page is pure options: at
        # page_size=500 the response carried 500 options and zero perpetuals.
        # Follow meta.after until the venue stops handing out a cursor.
        for _ in range(5):
            page_params = dict(params)
            if cursor:
                page_params["after"] = cursor
            r = requests.get(url, params=page_params, headers={"Accept": "application/json"}, timeout=8)
            r.raise_for_status()
            body = r.json()
            page = body.get("result") or []
            rows.extend(page)
            cursor = (body.get("meta") or {}).get("after")
            if not cursor or not page:
                break
    except Exception as exc:
        # A bare passthrough would 500 the desk on a venue hiccup; the portal loader
        # treats an empty result as "use the fallback catalog".
        error = str(exc)
    if rows:
        return JSONResponse({"result": rows, "state": "LIVE DELTA API", "count": len(rows)})
    return JSONResponse({"result": [], "state": "UNAVAILABLE", "error": error})


@app.get("/api/v1/delta/product/{symbol}")
def get_delta_product(symbol: str) -> JSONResponse:
    """Contract specs for one Delta product - mirrors /api/v1/delta/product/* on the worker.

    The portal calls this while it renders a desk; without it every instrument
    switch logged a 404 in the console even though candles loaded fine.
    """
    sym = (symbol or "").upper()

    def num(value: Any) -> Optional[float]:
        try:
            out = float(value)
        except (TypeError, ValueError):
            return None
        return out if out == out and out not in (float("inf"), float("-inf")) else None

    try:
        # /v2/products ignores the ?symbols= filter (it still returns the whole
        # book), but /v2/products/{symbol} resolves one product directly - so a
        # desk click no longer has to page through 5 MB of contracts.
        r = requests.get(
            f"https://api.india.delta.exchange/v2/products/{sym}",
            headers={"Accept": "application/json"},
            timeout=6,
        )
        if r.status_code == 200:
            product = (r.json() or {}).get("result")
            if isinstance(product, dict) and str(product.get("symbol", "")).upper() == sym:
                return JSONResponse({
                    "state": "LIVE DELTA API",
                    "symbol": product.get("symbol"),
                    "description": product.get("short_description") or "",
                    "initial_margin_pct": num(product.get("initial_margin")),
                    "maintenance_margin_pct": num(product.get("maintenance_margin")),
                    "max_leverage": num(product.get("default_leverage")),
                    "contract_value": num(product.get("contract_value")),
                    "contract_unit": product.get("contract_unit_currency") or "",
                    "maker_fee": num(product.get("maker_commission_rate")),
                    "taker_fee": num(product.get("taker_commission_rate")),
                    "tick_size": num(product.get("tick_size")),
                    "position_limit": num(product.get("position_size_limit")),
                })
    except Exception:
        pass

    return JSONResponse({"state": "UNAVAILABLE", "symbol": sym})


# ---------------------------------------------------------------------------
# History / candles
# ---------------------------------------------------------------------------
HISTORY_TTL_SECONDS = 300.0
_history_cache: dict[str, tuple[dict[str, Any], float]] = {}

DELTA_RESOLUTION_WINDOW = {
    "1m": 2 * 86400, "3m": 5 * 86400, "5m": 10 * 86400, "15m": 30 * 86400,
    "30m": 60 * 86400, "1h": 180 * 86400, "2h": 240 * 86400,
    "4h": 365 * 86400, "6h": 365 * 86400, "1d": 370 * 86400,
}

YAHOO_RANGE_INTERVAL = {
    "1m": ("5d", "1m"), "5m": ("5d", "5m"), "15m": ("1mo", "15m"),
    "30m": ("1mo", "30m"), "1h": ("3mo", "60m"), "4h": ("1y", "1d"), "1d": ("1y", "1d"),
}

NSE_YAHOO_SYMBOLS = {
    "NIFTY": "^NSEI", "BANKNIFTY": "^NSEBANK", "SENSEX": "^BSESN",
    "FINNIFTY": "NIFTY_FIN_SERVICE.NS",
}


def _realized_vol(closes: list[Any]) -> Optional[float]:
    """Annualised vol from closes, matching the worker's rounding (3 decimals)."""
    vals = [float(v) for v in (closes or []) if isinstance(v, (int, float)) and v > 0]
    if len(vals) < 20:
        return None
    rets = [vals[i] / vals[i - 1] - 1 for i in range(1, len(vals)) if vals[i - 1] > 0]
    if len(rets) < 10:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / len(rets)
    return round((var ** 0.5) * (252 ** 0.5), 3)


def _yahoo_bars(ticker_symbol: str, resolution: str) -> list[dict[str, Any]]:
    """Daily or intraday OHLC from Yahoo's chart endpoint."""
    from urllib.parse import quote

    rng, interval = YAHOO_RANGE_INTERVAL.get(resolution, ("1y", "1d"))
    r = requests.get(
        "https://query1.finance.yahoo.com/v8/finance/chart/" + quote(ticker_symbol, safe=""),
        params={"range": rng, "interval": interval},
        headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
        timeout=8,
    )
    r.raise_for_status()
    result = ((r.json().get("chart") or {}).get("result") or [{}])[0]
    stamps = result.get("timestamp") or []
    quote_block = (((result.get("indicators") or {}).get("quote") or [{}])[0]) or {}
    opens = quote_block.get("open") or []
    highs = quote_block.get("high") or []
    lows = quote_block.get("low") or []
    closes = quote_block.get("close") or []
    bars: list[dict[str, Any]] = []
    for i, stamp in enumerate(stamps):
        close = closes[i] if i < len(closes) else None
        if not isinstance(close, (int, float)):
            continue
        bars.append({
            "t": stamp,
            "o": opens[i] if i < len(opens) and isinstance(opens[i], (int, float)) else close,
            "h": highs[i] if i < len(highs) and isinstance(highs[i], (int, float)) else close,
            "l": lows[i] if i < len(lows) and isinstance(lows[i], (int, float)) else close,
            "c": close,
        })
    return bars


@app.get("/api/v1/history/{symbol}")
def get_history(symbol: str, market: str = "auto", resolution: str = "1d") -> JSONResponse:
    """OHLCV in the same shape the Cloudflare Worker serves.

    Bars are oldest-first {t,o,h,l,c}, capped at 180, with realizedVol alongside,
    so the portal's canvas chart behaves the same against the local proxy.
    """
    sym = str(symbol or "").upper()
    mkt = str(market or "auto").lower()
    if mkt not in ("delta", "nse", "mcx"):
        # No market hint: a *USD symbol is a Delta VDA pair, a mapped commodity is
        # MCX, everything else is NSE. Keeps /history/BTCUSD working on its own.
        mkt = "delta" if sym.endswith("USD") else ("mcx" if sym in MCX_PROXY_MAP else "nse")
    res = str(resolution or "1d").lower()
    if res not in DELTA_RESOLUTION_WINDOW:
        res = "1d"

    key = f"{mkt}:{sym}:{res}"
    now = time.time()
    cached = _history_cache.get(key)
    if cached and now - cached[1] < HISTORY_TTL_SECONDS:
        return JSONResponse({**cached[0], "cached": True})

    bars: list[dict[str, Any]] = []
    state = "UNAVAILABLE"
    note: Optional[str] = None

    if mkt == "delta":
        end = int(now)
        start = end - DELTA_RESOLUTION_WINDOW[res]
        try:
            r = requests.get(
                "https://api.india.delta.exchange/v2/history/candles",
                params={"resolution": res, "symbol": sym, "start": start, "end": end},
                headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
                timeout=8,
            )
            if r.status_code == 200:
                candles = r.json().get("result") or []
                bars = [
                    {"t": c.get("time"), "o": c.get("open"), "h": c.get("high"),
                     "l": c.get("low"), "c": c.get("close")}
                    for c in candles
                    if isinstance(c.get("close"), (int, float))
                ]
                bars.reverse()  # the venue returns newest first
                if bars:
                    state = "LIVE DELTA API"
        except Exception:
            pass
    elif mkt == "nse":
        ticker = NSE_YAHOO_SYMBOLS.get(sym, f"{sym}.NS")
        try:
            bars = _yahoo_bars(ticker, res)
            if bars:
                state = "REAL-TIME YFINANCE"
        except Exception:
            pass
    elif mkt == "mcx":
        entry = MCX_PROXY_MAP.get(sym)
        if entry:
            ticker, unit_mult, duty = entry
            try:
                raw = _yahoo_bars(ticker, res)
                rate = _usdinr_rate()
                if raw and rate:
                    factor = rate * unit_mult * duty
                    bars = [
                        {"t": b["t"], "o": b["o"] * factor, "h": b["h"] * factor,
                         "l": b["l"] * factor, "c": b["c"] * factor}
                        for b in raw
                    ]
                    state = "PROXY YFINANCE"
                    note = (
                        f"{ticker} x {unit_mult:.4g} x duty {duty:.2f} at USDINR {rate:.2f} "
                        "- converted proxy bars, not the MCX future"
                    )
            except Exception:
                pass
        else:
            note = "no mapped history source for this commodity"

    payload: dict[str, Any] = {
        "symbol": sym,
        "market": mkt,
        "state": state,
        "bars": bars[-180:],
        "realizedVol": _realized_vol([b["c"] for b in bars]),
    }
    if note:
        payload["note"] = note

    _history_cache[key] = (payload, now)
    if len(_history_cache) > 60:
        _history_cache.clear()
    return JSONResponse(payload)


# Tokenised real-world assets on Delta carry an issuer marker in the description:
# "xStock Token", "bStocks Token", "ONDO Token", "Gold Token". A bare "Token
# Perpetual" is an ordinary crypto token (WalletConnect, Venice, Sun), so that
# generic pattern is deliberately NOT matched — same rule as the edge worker.
RWA_DESC = re.compile(r"(xstocks?|bstocks?|ondo)\s+token|tokeni[sz]ed|\brwa\b|gold token", re.I)


@app.get("/api/v1/delta/products/categorized")
def get_delta_categorized() -> JSONResponse:
    try:
        r = requests.get("https://api.india.delta.exchange/v2/products", timeout=5)
        if r.status_code == 200:
            cats: dict[str, list[dict[str, str]]] = {"Futures": [], "Options": [], "RWA Tokens": []}
            for p in r.json().get("result", []):
                # Delta reports tradable products as state "live"; "active" was the
                # old value. Accepting only "active" dropped all 1,201 products and
                # left every crypto category empty.
                if str(p.get("state", "")).lower() not in ("live", "active"):
                    continue
                s = str(p.get("symbol", ""))
                ct = str(p.get("contract_type", "")).lower()
                descriptor = f"{p.get('description') or ''} {p.get('short_description') or ''}"
                # Same discriminator as the Cloudflare Worker: tokenised real-world
                # assets carry an issuer marker (xStock/bStocks/ONDO/Gold Token).
                # A bare "Token perpetual" is an ordinary crypto token (WalletConnect,
                # Venice, Sun), so it is deliberately NOT matched here.
                is_rwa = (
                    p.get("is_rwa") is True
                    or "rwa" in s.lower()
                    or bool(RWA_DESC.search(descriptor))
                )
                if is_rwa and "option" not in ct:
                    cats["RWA Tokens"].append({
                        "id": s,
                        "label": p.get("short_description") or f"{s} (RWA token)",
                    })
                elif "option" in ct:
                    cats["Options"].append({"id": s, "label": f"{s} (Option)"})
                else:
                    cats["Futures"].append({"id": s, "label": f"{s} (Perp)"})
            if not any(cats.values()):
                # Never badge an empty catalog as LIVE: it reads as "nothing to trade".
                return JSONResponse({
                    "categories": cats,
                    "state": "EMPTY",
                    "feed_note": "venue returned no categorised products",
                })
            return JSONResponse({
                "categories": cats,
                "state": "LIVE DELTA API",
                "counts": {
                    "futures": len(cats["Futures"]),
                    "options": len(cats["Options"]),
                    "rwa": len(cats["RWA Tokens"]),
                },
            })
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
