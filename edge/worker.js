// LearningFundClear hosted feed — NSE, MCX and Delta, served from the edge.
// Replaces the laptop-bound Python proxy so the portal works with the laptop off,
// on any network, from mobile.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const INDEX_MAP = {
  NIFTY: "NIFTY 50",
  NIFTY50: "NIFTY 50",
  BANKNIFTY: "NIFTY BANK",
  NIFTYBANK: "NIFTY BANK",
  FINNIFTY: "NIFTY FINANCIAL SERVICES",
  MIDCPNIFTY: "NIFTY MIDCAP 50",
};

const MCX_URL = "https://www.mcxindia.com/market-data/market-watch/GetMarketWatch";
const MCX_TTL_MS = 20000;

const num = (value) => {
  const parsed = parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });

// ---------------------------------------------------------------- NSE
let nseCookie = { value: "", at: 0 };

async function nseHeaders() {
  const now = Date.now();
  if (!nseCookie.value || now - nseCookie.at > 240000) {
    try {
      const warm = await fetch("https://www.nseindia.com/", {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      });
      const list =
        typeof warm.headers.getSetCookie === "function"
          ? warm.headers.getSetCookie()
          : [warm.headers.get("set-cookie") || ""];
      nseCookie = {
        value: list.map((c) => String(c).split(";")[0]).filter(Boolean).join("; "),
        at: now,
      };
    } catch (_) {
      /* keep the previous cookie */
    }
  }
  const headers = {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    Referer: "https://www.nseindia.com/",
  };
  if (nseCookie.value) headers.Cookie = nseCookie.value;
  return headers;
}

async function nseIndexLookup(sym, headers) {
  const indexName = INDEX_MAP[sym];
  if (!indexName) return null;
  try {
    const res = await fetch("https://www.nseindia.com/api/allIndices", { headers });
    if (!res.ok) return null;
    const body = await res.json();
    const row = (body.data || []).find((r) => r.indexSymbol === indexName || r.index === indexName);
    const ltp = num(row && row.last);
    if (ltp <= 0) return null;
    return {
      symbol: sym,
      ltp,
      change: num(row.variation),
      pChange: num(row.percentChange),
      state: "REAL-TIME NSE DIRECT",
      feed_note: "NSE official API (hosted edge)",
    };
  } catch (_) {
    return null;
  }
}

async function nseEquityLookup(sym, headers) {
  const attempts = [];

  const indexes = ["NIFTY 50", "NIFTY NEXT 50", "SECURITIES IN F&O"];
  for (const index of indexes) {
    try {
      const res = await fetch(
        `https://www.nseindia.com/api/equity-stockIndices?index=${encodeURIComponent(index)}`,
        { headers }
      );
      attempts.push(`${index}=${res.status}`);
      if (!res.ok) continue;
      const body = await res.json();
      const row = (body.data || []).find((r) => String(r.symbol).toUpperCase() === sym);
      const ltp = num(row && row.lastPrice);
      if (ltp > 0) {
        return {
          symbol: sym,
          ltp,
          change: num(row.change),
          pChange: num(row.pChange),
          volume: num(row.totalTradedVolume),
          state: "REAL-TIME NSE DIRECT",
          feed_note: `NSE official API (hosted edge, ${index})`,
        };
      }
    } catch (_) {
      attempts.push(`${index}=ERR`);
    }
  }

  try {
    const res = await fetch(`https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(sym)}`, {
      headers,
    });
    attempts.push(`quote-equity=${res.status}`);
    if (res.ok) {
      const body = await res.json();
      const priceInfo = body.priceInfo || {};
      const ltp = num(priceInfo.lastPrice);
      if (ltp > 0) {
        return {
          symbol: sym,
          ltp,
          change: num(priceInfo.change),
          pChange: num(priceInfo.pChange),
          state: "REAL-TIME NSE DIRECT",
          feed_note: "NSE official API (hosted edge, quote-equity)",
        };
      }
    }
  } catch (_) {
    attempts.push("quote-equity=ERR");
  }

  return {
    symbol: sym,
    ltp: 0,
    change: 0,
    pChange: 0,
    state: "UNAVAILABLE",
    feed_note: `no NSE feed for this symbol (${attempts.join(", ")})`,
  };
}

// NSE's equity JSON endpoints 404/403 from an edge egress, but Yahoo's chart API
// responds, so single stocks fall back to it.
const YF_INDEX = {
  NIFTY: "^NSEI",
  NIFTY50: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  NIFTYBANK: "^NSEBANK",
  FINNIFTY: "NIFTY_FIN_SERVICE.NS",
};

async function yahooLive(sym) {
  const upper = String(sym || "").toUpperCase();
  const ticker = YF_INDEX[upper] || `${upper}.NS`;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1m`,
      { headers: { "User-Agent": UA, Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const body = await res.json();
    const result = body && body.chart && body.chart.result && body.chart.result[0];
    if (!result) return null;
    const meta = result.meta || {};
    const ltp = num(meta.regularMarketPrice);
    const prev = num(meta.chartPreviousClose || meta.previousClose);
    if (!(ltp > 0)) return null;
    const change = prev > 0 ? Math.round((ltp - prev) * 100) / 100 : 0;
    const pChange = prev > 0 ? Math.round((change / prev) * 10000) / 100 : 0;
    return {
      symbol: upper,
      ltp: Math.round(ltp * 100) / 100,
      change,
      pChange,
      state: "REAL-TIME YFINANCE",
      feed_note: `Yahoo ${ticker} (edge fallback)`,
    };
  } catch (_) {
    return null;
  }
}

async function nseLive(symbol) {
  const sym = String(symbol || "").toUpperCase();
  const headers = await nseHeaders();
  const index = await nseIndexLookup(sym, headers);
  if (index) return index;
  const equity = await nseEquityLookup(sym, headers);
  if (equity.ltp > 0) return equity;
  const yahoo = await yahooLive(sym);
  if (yahoo) return yahoo;
  return equity;
}

// ---------------------------------------------------------------- MCX
// The default Cache API is not available to this Worker, so the market-watch
// payload is memoised per isolate for 20s instead.
let mcxMemo = { rows: null, at: 0 };

async function mcxRows() {
  const now = Date.now();
  if (mcxMemo.rows && now - mcxMemo.at < MCX_TTL_MS) return mcxMemo.rows;

  const res = await fetch(MCX_URL, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://www.mcxindia.com/market-data/market-watch",
    },
  });
  if (!res.ok) return mcxMemo.rows;
  const body = await res.json();
  const rows = body && body.data && body.data.Data;
  if (!Array.isArray(rows)) return mcxMemo.rows;

  mcxMemo = { rows, at: now };
  return rows;
}

const parseExpiry = (value) => {
  const text = String(value || "").trim().toUpperCase();
  const m = /^(\d{1,2})([A-Z]{3})(\d{4})$/.exec(text);
  if (!m) return Infinity;
  const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  const month = months[m[2]];
  if (month === undefined) return Infinity;
  return Date.UTC(Number(m[3]), month, Number(m[1]));
};

const pick = (row, ...names) => {
  const lowered = {};
  for (const [k, v] of Object.entries(row)) lowered[String(k).toLowerCase()] = v;
  for (const name of names) {
    if (lowered[name.toLowerCase()] !== undefined) return lowered[name.toLowerCase()];
  }
  return undefined;
};

async function mcxLive(commodity) {
  const target = String(commodity || "").toUpperCase();
  const rows = await mcxRows();
  if (!rows) {
    return { symbol: target, ltp: 0, state: "UNAVAILABLE", feed_note: "MCX market watch unreachable" };
  }

  const candidates = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const instrument = String(pick(row, "InstrumentName") || "").toUpperCase();
    if (instrument && instrument !== "FUTCOM") continue;
    const symbol = String(pick(row, "Symbol", "ProductCode") || "").toUpperCase();
    if (symbol !== target) continue;
    const ltp = num(pick(row, "LTP", "LastPrice"));
    if (ltp <= 0) continue;
    candidates.push({ expiry: parseExpiry(pick(row, "ExpiryDate")), row, symbol });
  }

  if (!candidates.length) {
    return { symbol: target, ltp: 0, state: "UNAVAILABLE", feed_note: "no MCX contract for this commodity" };
  }

  candidates.sort((a, b) => a.expiry - b.expiry);
  const { row, symbol } = candidates[0];
  const ltp = num(pick(row, "LTP", "LastPrice"));
  const circuit = num(pick(row, "CircuitLimit"), 0) || 4;

  return {
    symbol,
    ltp: Math.round(ltp * 100) / 100,
    high: num(pick(row, "High")),
    low: num(pick(row, "Low")),
    open: num(pick(row, "Open")),
    volume: num(pick(row, "Volume")),
    change: Math.round(num(pick(row, "AbsoluteChange")) * 100) / 100,
    pChange: Math.round(num(pick(row, "PercentChange")) * 100) / 100,
    expiry: String(pick(row, "ExpiryDate") || ""),
    upper_circuit: Math.round(ltp * (1 + circuit / 100) * 100) / 100,
    lower_circuit: Math.round(ltp * (1 - circuit / 100) * 100) / 100,
    state: "REAL-TIME MCX DIRECT",
    feed_note: "MCX market watch (hosted edge, FUTCOM nearest expiry)",
  };
}

// ---------------------------------------------------------------- Delta
// The crypto desk needs the tradable catalog, including RWA tokens, not just a
// ticker: without it the token list is empty on hosted builds.
let deltaProductsMemo = { data: null, at: 0 };
const DELTA_PRODUCTS_TTL_MS = 300000;
const CATEGORY_CAP = 400;

async function deltaProducts() {
  if (deltaProductsMemo.data && Date.now() - deltaProductsMemo.at < DELTA_PRODUCTS_TTL_MS) {
    return deltaProductsMemo.data;
  }
  try {
    const res = await fetch("https://api.india.delta.exchange/v2/products", {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (res.ok) {
      const body = await res.json();
      const products = (body && body.result) || [];
      const categories = { Futures: [], Options: [], "RWA Tokens": [] };
      // Delta reports tradable products as state "live", not "active".
      // RWA/tokenised instruments are described as "<asset> Token perpetual future"
      // (Tether Gold, PAX Gold, ONDO Token, bStocks Token), so the description is the
      // reliable discriminator — symbol prefixes only covered PAXG/XAUT.
      const RWA_DESC = /(ondo|bstock|rwa|tokeni[sz]ed|gold token|silver.*token) token|[a-z] token perpetual/i;
      for (const product of products) {
        const state = String(product.state || "").toLowerCase();
        if (state !== "active" && state !== "live") continue;
        const sym = String(product.symbol || "");
        const contractType = String(product.contract_type || "").toLowerCase();
        const descriptor = `${product.description || ""} ${product.short_description || ""}`;
        const isToken = product.is_rwa === true || /rwa/i.test(sym) || RWA_DESC.test(descriptor);
        if (isToken && !contractType.includes("option")) {
          categories["RWA Tokens"].push({
            id: sym,
            label: product.short_description || `${sym} (RWA token)`,
          });
        } else if (contractType.includes("option")) {
          categories.Options.push({ id: sym, label: `${sym} (Option)` });
        } else {
          categories.Futures.push({ id: sym, label: `${sym} (Perp)` });
        }
      }
      for (const key of Object.keys(categories)) {
        if (categories[key].length > CATEGORY_CAP) {
          categories[key] = categories[key].slice(0, CATEGORY_CAP);
        }
      }
      const payload = {
        categories,
        state: "LIVE DELTA API",
        counts: {
          futures: categories.Futures.length,
          options: categories.Options.length,
          rwa: categories["RWA Tokens"].length,
        },
      };
      deltaProductsMemo = { data: payload, at: Date.now() };
      return payload;
    }
  } catch (_) {
    /* fall through to the memo or an empty catalog */
  }
  if (deltaProductsMemo.data) return { ...deltaProductsMemo.data, state: "SNAPSHOT" };
  return { categories: { Futures: [], Options: [], "RWA Tokens": [] }, state: "UNAVAILABLE" };
}

async function deltaLive(symbol) {
  const sym = String(symbol || "").toUpperCase();
  try {
    const res = await fetch(`https://api.india.delta.exchange/v2/tickers/${sym}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (res.ok) {
      const body = await res.json();
      const result = (body && body.result) || {};
      const ltp = num(result.close || result.mark_price);
      if (ltp > 0) {
        const band = result.price_band || {};
        return {
          symbol: sym,
          ltp: Math.round(ltp * 100) / 100,
          change: num(result.mark_change_24h),
          pChange: num(result.mark_change_24h),
          mark_price: num(result.mark_price),
          funding_rate: num(result.funding_rate),
          upper_circuit: num(band.upper_limit),
          lower_circuit: num(band.lower_limit),
          state: "LIVE DELTA API",
        };
      }
    }
  } catch (_) {
    /* unavailable below */
  }
  return {
    symbol: sym,
    ltp: 0,
    change: 0,
    pChange: 0,
    state: "UNAVAILABLE",
    feed_note: "Delta ticker unavailable",
  };
}

// ---------------------------------------------------------------- router
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "*",
        },
      });
    }

    try {
      let m;
      if (path === "/api/v1/health") {
        return json({
          status: "ONLINE",
          version: "6.1-edge",
          proxy: "LearningFundClear edge feed",
          nse: true,
          mcx: true,
          delta: true,
        });
      }
      if ((m = /^\/api\/v1\/nse\/live\/([A-Za-z0-9^&._-]+)$/.exec(path))) {
        return json(await nseLive(m[1]));
      }
      if ((m = /^\/api\/v1\/mcx\/live\/([A-Za-z0-9&._-]+)$/.exec(path))) {
        return json(await mcxLive(m[1]));
      }
      if ((m = /^\/api\/v1\/delta\/ticker\/([A-Za-z0-9&._-]+)$/.exec(path))) {
        return json(await deltaLive(m[1]));
      }
      if (path === "/api/v1/delta/products/categorized") {
        return json(await deltaProducts());
      }
      if (path.startsWith("/api/")) {
        return json({ state: "UNAVAILABLE", error: "unknown endpoint" }, 404);
      }
    } catch (err) {
      return json({ state: "UNAVAILABLE", error: String(err) });
    }

    return env.ASSETS.fetch(request);
  },
};
