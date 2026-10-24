// Fixed upstream host and bounded inputs. Portal credentials are never sent upstream.
const cache = new Map();
let blockedUntil = 0;
export async function serveStockHistory(request, config, fetcher = fetch) {
  const reply = (data, status = 200) =>
    Response.json(data, {
      status,
      headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
    });
  if (request.method !== "GET")
    return reply({ error: "Method not allowed" }, 405);
  const auth = request.headers.get("Authorization") || "";
  if (!/^Bearer [\w.-]+$/.test(auth))
    return reply({ error: "Sign in to scan stocks" }, 401);
  const url = new URL(request.url),
    symbol = url.searchParams.get("symbol"),
    interval = url.searchParams.get("interval");
  if (
    !/^[A-Z0-9&._-]{1,30}\.(NS|BO)$/.test(symbol || "") ||
    !["15m", "1d", "1wk"].includes(interval)
  )
    return reply({ error: "Invalid stock symbol or interval" }, 400);
  try {
    const headers = { apikey: config.anonKey, Authorization: auth };
    const u = await fetcher(config.url + "/auth/v1/user", {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!u.ok) return reply({ error: "Session expired" }, 401);
    const user = await u.json();
    if (!user.id) return reply({ error: "Invalid session" }, 401);
    const p = await fetcher(
      config.url +
        "/rest/v1/app_users?id=eq." +
        encodeURIComponent(user.id) +
        "&select=is_active",
      { headers, signal: AbortSignal.timeout(10000) },
    );
    if (!p.ok || !(await p.json()).some((x) => x.is_active === true))
      return reply({ error: "Active portal account required" }, 403);
    const key = symbol + ":" + interval,
      old = cache.get(key),
      now = Date.now();
    if (old && now - old.fetchedAt < 60000)
      return reply({ ...old, cached: true });
    if (now < blockedUntil)
      return reply(
        {
          error:
            "Stock history provider temporarily unavailable. Use a Swing CSV or retry later.",
        },
        503,
      );
    const range = interval === "15m" ? "1mo" : interval === "1wk" ? "5y" : "2y";
    const r = await fetcher(
      "https://query1.finance.yahoo.com/v8/finance/chart/" +
        encodeURIComponent(symbol) +
        "?range=" +
        range +
        "&interval=" +
        interval,
      {
        signal: AbortSignal.timeout(15000),
        headers: { Accept: "application/json" },
      },
    );
    if (!r.ok) {
      if ([401, 403, 429].includes(r.status)) blockedUntil = now + 60000;
      return reply(
        {
          error:
            "Stock history provider HTTP " +
            r.status +
            ". Use a Swing CSV or retry later.",
        },
        503,
      );
    }
    const raw = await r.text();
    if (raw.length > 1500000) throw Error("Oversized history");
    const chart = JSON.parse(raw),
      result = chart.chart?.result?.[0];
    if (
      chart.chart?.error ||
      result?.meta?.symbol?.toUpperCase() !== symbol ||
      !Array.isArray(result.timestamp) ||
      result.timestamp.length > 2500
    )
      throw Error("Invalid source history");
    const data = { chart, symbol, interval, fetchedAt: now };
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(key, data);
    return reply(data);
  } catch {
    return reply(
      { error: "Stock history unavailable. Use a Swing CSV or retry later." },
      503,
    );
  }
}
