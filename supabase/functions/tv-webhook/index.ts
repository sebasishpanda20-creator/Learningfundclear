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
