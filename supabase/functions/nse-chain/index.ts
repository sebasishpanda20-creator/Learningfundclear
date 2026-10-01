// Supabase Edge Function: nse-chain
// =================================
// Relays NSE India's option chain for index symbols and stamps every response
// with a server-side timestamp, so the portal's GEX view (gex.html) can show a
// trustworthy "last updated" instead of a third-party sheet's stale LUT.
//
// Flow (mirrors what www.nseindia.com's own SPA does):
//   1. GET /option-chain          -> collect Akamai cookies
//   2. GET /api/option-chain-contract-info?symbol=X -> expiry list
//   3. GET /api/option-chain-v3?type=Indices&symbol=X&expiry=DD-MMM-YYYY
//      (the &expiry= param is REQUIRED; without it NSE returns an empty {})
//
// Response: { fetched_at, nse_timestamp, underlying, expiry, expiries, strikes[] }
//   fetched_at    = when WE fetched it (server clock, ISO UTC)
//   nse_timestamp = NSE's own "as on" stamp from the payload
//
// GET params:  symbol (default NIFTY), expiry (default nearest)
// Deploy:      supabase functions deploy nse-chain --project-ref <ref> --no-verify-jwt

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"]);
const NSE = "https://www.nseindia.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function browserHeaders(refererPath: string): Record<string, string> {
  return {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": NSE + refererPath,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
  };
}

function apiHeaders(cookie: string): Record<string, string> {
  return {
    "User-Agent": UA,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": NSE + "/option-chain",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    cookie,
  };
}

async function nseGet(path: string, headers: Record<string, string>): Promise<Response> {
  return await fetch(NSE + path, { headers, signal: AbortSignal.timeout(12000) });
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      // 204 responses must have a NULL body — a body here throws and kills the preflight.
      return new Response(null, { status: 204, headers: CORS });
    }
    if (req.method !== "GET") return json(405, { error: "Method not allowed" });

    const url = new URL(req.url);
    const symbol = (url.searchParams.get("symbol") ?? "NIFTY").toUpperCase();
    if (!SYMBOLS.has(symbol)) return json(400, { error: "Unsupported symbol: " + symbol });
    const expiryParam = url.searchParams.get("expiry");

    // 1) bootstrap cookies like a browser landing on the option-chain page
    const home = await nseGet("/option-chain", browserHeaders("/option-chain"));
    const jar: Record<string, string> = {};
    for (const sc of home.headers.getSetCookie?.() ?? []) {
      const kv = sc.split(";")[0];
      jar[kv.split("=")[0]] = kv;
    }
    const cookie = Object.values(jar).join("; ");
    if (!cookie) return json(502, { error: "NSE did not issue cookies; try again shortly" });

    // 2) expiry list (or use the requested one)
    let expiry = expiryParam ?? "";
    let expiries: string[] = [];
    const ci = await nseGet(`/api/option-chain-contract-info?symbol=${encodeURIComponent(symbol)}`, apiHeaders(cookie));
    if (ci.ok) {
      try {
        const cj = await ci.json();
        expiries = cj.expiryDates ?? [];
        if (!expiry && expiries.length) expiry = expiries[0];
      } catch { /* fall through: expiry may still be set via param */ }
    }
    if (!expiry) return json(502, { error: "Could not resolve an expiry date from NSE" });

    // 3) the chain itself — &expiry= is mandatory on option-chain-v3
    const chainUrl = `/api/option-chain-v3?type=Indices&symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}`;
    let chain: any = null;
    for (let attempt = 0; attempt < 2 && !chain; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 900));
      const r = await nseGet(chainUrl, apiHeaders(cookie));
      if (!r.ok) continue;
      const t = await r.text();
      if (!t.trim().startsWith("{")) continue;
      const j = JSON.parse(t);
      const recs = j.records ?? (Object.keys(j).length && j.data ? j : null);
      if (recs && Array.isArray(recs.data) && recs.data.length) chain = recs;
    }
    if (!chain) {
      return json(502, { error: "NSE returned no chain data (rate limit or blocked). Retry in a minute." });
    }

    const rows = (chain.data as any[])
      .filter((d) => d.CE || d.PE)
      .map((d) => ({
        strike: d.strikePrice,
        ce: d.CE ? {
          oi: d.CE.openInterest ?? 0,
          oi_chg: d.CE.changeinOpenInterest ?? 0,
          vol: d.CE.totalTradedVolume ?? 0,
          ltp: d.CE.lastPrice ?? 0,
          iv: d.CE.impliedVolatility ?? 0,
        } : null,
        pe: d.PE ? {
          oi: d.PE.openInterest ?? 0,
          oi_chg: d.PE.changeinOpenInterest ?? 0,
          vol: d.PE.totalTradedVolume ?? 0,
          ltp: d.PE.lastPrice ?? 0,
          iv: d.PE.impliedVolatility ?? 0,
        } : null,
      }))
      .sort((a, b) => a.strike - b.strike);

    return json(200, {
      fetched_at: new Date().toISOString(),
      nse_timestamp: chain.timestamp ?? null,
      underlying: chain.underlyingValue ?? null,
      symbol,
      expiry,
      expiries,
      strikes: rows,
      source: "NSE option-chain-v3",
    });
  } catch (err) {
    // Never let a throw escape without CORS headers.
    console.error("nse-chain failed:", err);
    return json(500, { error: "Internal error: " + String((err as Error)?.message ?? err) });
  }
});
