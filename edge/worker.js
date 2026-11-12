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

// ---------------------------------------------------------------- NSE universe + scan
// Yahoo's v7/quote and quoteSummary need a crumb, but v7/spark does not and accepts
// batched symbols, so the whole NSE list can be screened in a handful of subrequests.
const NSE_UNIVERSE_TTL_MS = 6 * 3600 * 1000;
let nseUniverseMemo = { data: null, at: 0 };
const NSE_UNIVERSE_SOURCES = [
  "https://archives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv",
  "https://archives.nseindia.com/content/indices/ind_nifty500list.csv",
];

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map(v => v.trim());
}

function parseUniverseCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map(h => h.toLowerCase());
  const iName = header.indexOf("company name");
  const iIndustry = header.indexOf("industry");
  const iSymbol = header.indexOf("symbol");
  const iSeries = header.indexOf("series");
  if (iSymbol < 0) return [];
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const symbol = cells[iSymbol] || "";
    if (!symbol || !/^[A-Z0-9&.-]{1,24}$/i.test(symbol)) continue;
    if (iSeries >= 0 && cells[iSeries] && cells[iSeries].toUpperCase() !== "EQ") continue;
    rows.push({
      symbol: symbol.toUpperCase(),
      name: cells[iName] || symbol,
      industry: cells[iIndustry] || "",
    });
  }
  return rows;
}

async function nseUniverse() {
  if (nseUniverseMemo.data && Date.now() - nseUniverseMemo.at < NSE_UNIVERSE_TTL_MS) {
    return nseUniverseMemo.data;
  }
  for (const url of NSE_UNIVERSE_SOURCES) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const rows = parseUniverseCsv(await res.text());
      if (rows.length) {
        nseUniverseMemo = { data: rows, at: Date.now() };
        return rows;
      }
    } catch (_) {
      /* try the next source */
    }
  }
  return nseUniverseMemo.data || [];
}

const scanMemo = new Map();
const SCAN_TTL_MS = 90000;
const SCAN_BATCH = 20; // Yahoo spark returns HTTP 400 above 20 symbols

function seriesMetrics(closes, meta) {
  if (!closes || closes.length < 30) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  if (!(last > 0) || !(prev > 0)) return null;
  const ago = n => closes[Math.max(0, closes.length - 1 - n)];
  const pct = from => (from > 0 ? (last / from - 1) * 100 : 0);
  const meanOf = n => {
    const arr = closes.slice(-n);
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : last;
  };
  const ma50 = meanOf(50);
  const ma200 = meanOf(200);
  const high52 = meta.fiftyTwoWeekHigh || Math.max(...closes);
  const low52 = meta.fiftyTwoWeekLow || Math.min(...closes);
  const offHigh = high52 > 0 ? (last / high52 - 1) * 100 : 0;
  const rets = [];
  for (let i = Math.max(1, closes.length - 60); i < closes.length; i++) {
    rets.push(closes[i] / closes[i - 1] - 1);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const vol = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length)) * Math.sqrt(252) * 100;
  const above200 = last > ma200;
  const d30 = pct(ago(21));
  const d90 = pct(ago(63));
  const score = 0.45 * d90 + 0.25 * d30 + (above200 ? 20 : 0) + 0.1 * (100 + offHigh);
  return {
    ltp: Math.round(last * 100) / 100,
    chg: Math.round((last / prev - 1) * 10000) / 100,
    d30: Math.round(d30 * 100) / 100,
    d90: Math.round(d90 * 100) / 100,
    offHigh: Math.round(offHigh * 100) / 100,
    high52: Math.round(high52 * 100) / 100,
    low52: Math.round(low52 * 100) / 100,
    ma50: Math.round(ma50 * 100) / 100,
    ma200: Math.round(ma200 * 100) / 100,
    above200,
    vol: Math.round(vol * 10) / 10,
    score: Math.round(score * 10) / 10,
  };
}

async function scanNse(offset, limit) {
  const key = `${offset}:${limit}`;
  const hit = scanMemo.get(key);
  if (hit && Date.now() - hit.at < SCAN_TTL_MS) return { ...hit.data, cached: true };

  const universe = await nseUniverse();
  const total = universe.length;
  if (!total) return { state: "UNAVAILABLE", offset, total: 0, scanned: 0, rows: [] };

  const slice = universe.slice(offset, offset + limit);
  const diag = [];
  const batches = [];
  for (let i = 0; i < slice.length; i += SCAN_BATCH) {
    batches.push({ start: i, items: slice.slice(i, i + SCAN_BATCH) });
  }

  // Batches run concurrently: a 160-name page is 8 spark calls in parallel, ~1s total.
  const settles = await Promise.all(
    batches.map(async ({ start, items }) => {
      const symbols = items.map(r => `${r.symbol}.NS`).join(",");
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols)}&range=1y&interval=1d`,
          { headers: { "User-Agent": UA, Accept: "application/json" } },
        );
        if (!res.ok) {
          diag.push(`batch ${start}: HTTP ${res.status}`);
          return [];
        }
        const body = await res.json();
        const results = (body && body.spark && body.spark.result) || [];
        const out = [];
        for (const item of results) {
          const response = (item.response || [])[0] || {};
          const closes = (((response.indicators || {}).quote || [{}])[0].close || []).filter(
            v => typeof v === "number" && isFinite(v),
          );
          const symbol = String(item.symbol || "").replace(/\.NS$/i, "").toUpperCase();
          const meta = items.find(r => r.symbol === symbol) || { symbol, name: symbol, industry: "" };
          const metrics = seriesMetrics(closes, response.meta || {});
          if (!metrics) continue;
          out.push({ s: meta.symbol, n: meta.name, ind: meta.industry, ...metrics });
        }
        diag.push(`batch ${start}: ${results.length} of ${items.length}`);
        return out;
      } catch (err) {
        // One bad batch must not abort the page, but it must be visible in the payload.
        diag.push(`batch ${start}: threw ${String((err && err.message) || err)}`);
        return [];
      }
    }),
  );
  const rows = settles.flat();

  rows.sort((a, b) => b.score - a.score);
  const payload = {
    state: rows.length ? "LIVE NSE QUOTES" : "UNAVAILABLE",
    offset,
    total,
    scanned: rows.length,
    diag,
    rows,
  };
  scanMemo.set(key, { data: payload, at: Date.now() });
  if (scanMemo.size > 40) scanMemo.clear();
  return payload;
}

// ---------------------------------------------------------------- Delta
// The crypto desk needs the tradable catalog, including RWA tokens, not just a
// ticker: without it the token list is empty on hosted builds.
let deltaProductsMemo = { data: null, at: 0 };
let deltaRawMemo = { data: null, at: 0 };
const DELTA_PRODUCTS_TTL_MS = 300000;
const CATEGORY_CAP = 400;

// Raw product rows carry the margin/leverage/fee spec; the categorised view does not.
async function deltaRawProducts() {
  if (deltaRawMemo.data && Date.now() - deltaRawMemo.at < DELTA_PRODUCTS_TTL_MS) return deltaRawMemo.data;
  try {
    const res = await fetch("https://api.india.delta.exchange/v2/products", {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (res.ok) {
      const body = await res.json();
      const rows = (body && body.result) || [];
      if (rows.length) {
        deltaRawMemo = { data: rows, at: Date.now() };
        return rows;
      }
    }
  } catch (_) {
    /* fall through to the memo */
  }
  return deltaRawMemo.data || [];
}

async function deltaProducts() {
  if (deltaProductsMemo.data && Date.now() - deltaProductsMemo.at < DELTA_PRODUCTS_TTL_MS) {
    return deltaProductsMemo.data;
  }
  try {
    const products = await deltaRawProducts();
    if (products.length) {
      const categories = { Futures: [], Options: [], "RWA Tokens": [] };
      // Delta reports tradable products as state "live", not "active".
      // RWA/tokenised instruments are described as "<asset> Token perpetual future"
      // (Tether Gold, PAX Gold, ONDO Token, bStocks Token), so the description is the
      // reliable discriminator — symbol prefixes only covered PAXG/XAUT.
      // Tokenised real-world assets on Delta carry an explicit issuer marker in the
      // description: "xStock Token", "bStocks Token", "ONDO Token", "Gold Token".
      // A bare "Token Perpetual" is an ordinary crypto token (WalletConnect, Venice,
      // Sun), so that generic pattern is deliberately NOT matched.
      const RWA_DESC = /(xstocks?|bstocks?|ondo)\s+token|tokeni[sz]ed|\brwa\b|gold token/i;
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
      if (path === "/api/v1/nse/universe") {
        const symbols = await nseUniverse();
        return json({
          symbols,
          count: symbols.length,
          state: symbols.length ? "NSE CONSTITUENTS" : "UNAVAILABLE",
        });
      }

      if (path === "/api/v1/nse/scan") {
        const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);
        const limit = Math.min(200, Math.max(10, parseInt(url.searchParams.get("limit") || "160", 10) || 160));
        return json(await scanNse(offset, limit));
      }

      if (path === "/api/v1/delta/products/categorized") {
        return json(await deltaProducts());
      }

      if (path.startsWith("/api/v1/delta/product/")) {
        const symbol = decodeURIComponent(path.slice("/api/v1/delta/product/".length)).toUpperCase();
        const rows = await deltaRawProducts();
        const product = rows.find(r => String(r.symbol || "").toUpperCase() === symbol);
        if (!product) return json({ state: "UNAVAILABLE", symbol });
        const num = v => {
          const n = Number(v);
          return isFinite(n) ? n : null;
        };
        return json({
          state: "LIVE DELTA API",
          symbol: product.symbol,
          description: product.short_description || "",
          initial_margin_pct: num(product.initial_margin),
          maintenance_margin_pct: num(product.maintenance_margin),
          max_leverage: num(product.default_leverage),
          contract_value: num(product.contract_value),
          contract_unit: product.contract_unit_currency || "",
          maker_fee: num(product.maker_commission_rate),
          taker_fee: num(product.taker_commission_rate),
          tick_size: num(product.tick_size),
          position_limit: num(product.position_size_limit),
        });
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
