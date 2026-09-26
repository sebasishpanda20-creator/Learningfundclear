// Supabase Edge Function: tv-webhook
// ==================================
// Receives TradingView alert webhooks and stores them in the signal_events table.
//
// TradingView side (alert message, {{ticker}} and {{close}} are TV placeholders):
//   {
//     "secret": "YOUR-LONG-RANDOM-SECRET",
//     "symbol": "{{ticker}}",
//     "action": "{{strategy.order.action}}",        // or a fixed "LONG"/"SHORT"
//     "price": {{close}},
//     "details": "BOS + OB retest"
//   }
// If your alert is plain text, the function tries to read "SYMBOL ACTION @ PRICE" from it.
//
// Deploy once (needs your Supabase login):
//   supabase functions deploy tv-webhook --project-ref chbtjicvbezbiosuouwm
//
// Then in TradingView: alert -> Notifications -> Webhook URL:
//   https://chbtjicvbezbiosuouwm.supabase.co/functions/v1/tv-webhook
// (Edge Functions on the free plan sleep; the first alert after idle takes a few seconds.)

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SECRET = Deno.env.get("TV_WEBHOOK_SECRET") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405 });
  }

  // 1) authenticate: shared secret in header or body
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    // plain-text alert: keep raw text
    body = { text: await req.text() };
  }

  const given = req.headers.get("x-tv-secret") || body?.secret || "";
  if (!SECRET || given !== SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2) normalise the payload
  let symbol: string | null = body.symbol ?? null;
  let action = String(body.action ?? "LONG").toUpperCase();
  let price: number | null = typeof body.price === "number" ? body.price : null;
  let details = String(body.details ?? body.text ?? "");

  if (!symbol && body.text) {
    // "NSE:COALINDIA LONG @ 422.5" style free text
    const m = /([A-Z0-9&\-]{2,20})(?:\.[A-Z]{2})?\s+(LONG|SHORT|BUY|SELL)\s*(?:@\s*|at\s*)?([\d.]+)?/i.exec(body.text);
    if (m) {
      symbol = m[1].toUpperCase();
      action = m[2].toUpperCase();
      if (m[3]) price = parseFloat(m[3]);
    }
  }
  if (symbol) symbol = symbol.split(":").pop()!.toUpperCase();
  if (action === "BUY") action = "LONG";
  if (action === "SELL") action = "SHORT";
  if (!symbol) {
    return new Response(JSON.stringify({ error: "no symbol in payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 3) store
  // @ts-ignore
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,   // bypasses RLS; only inside the function
  );
  // 2b) de-duplicate. The nightly EOD scan can re-find the same zone on consecutive
  // days, and a re-fired TradingView alert repeats the same zone too. With a zone
  // signature in the text we suppress repeats for a week; without one (free-form
  // alert) we only suppress bursts of the same symbol+action inside two hours.
  // The timeframe is part of the identity: a Weekly zone that happens to share a
  // Daily zone's range is still a different setup and must not be suppressed.
  // Reads fail open: if the lookup errors we still insert, never lose a signal.
  const zoneKey = (txt: string): string | null => {
    const s = String(txt || "");
    const m = /zone\s+([\d.]+)\s*-\s*([\d.]+)/i.exec(s);
    if (!m) return null;
    const tf = /^\s*(daily|weekly|monthly|hourly|15m|1h)\b/i.exec(s);
    return (tf ? tf[1].toLowerCase() : "any") + "|" +
      Number(m[1]).toFixed(2) + "-" + Number(m[2]).toFixed(2);
  };
  const wanted = zoneKey(details);
  const windowMs = wanted ? 7 * 24 * 3600 * 1000 : 2 * 3600 * 1000;
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data: recent, error: readError } = await supabase
    .from("signal_events")
    .select("details")
    .eq("symbol", symbol)
    .eq("action", action)
    .gte("created_at", since)
    .limit(50);
  if (!readError && recent) {
    const duplicate = recent.some((r: any) => {
      if (!wanted) return true;                 // no zone info: same symbol+action inside the short window
      const have = zoneKey(r.details);
      return have !== null && have === wanted;
    });
    if (duplicate) {
      return new Response(
        JSON.stringify({ ok: true, symbol, action, skipped: "duplicate" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const { error } = await supabase.from("signal_events").insert({
    symbol,
    action,
    price,
    details: details.slice(0, 500),
  });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, symbol, action }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
