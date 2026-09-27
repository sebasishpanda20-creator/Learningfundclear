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
// Two secrets, each single-purpose (see the constants above the handler):
//   TV_WEBHOOK_SECRET — GitHub Actions nightly scan (high-value, never on screen)
//   TV_CHART_SECRET   — TradingView Pine indicator (low-value, screenshot-exposed)
// Both deploy the same way: supabase secrets set NAME=value, then redeploy.
//
// Optional Telegram push: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID function
// secrets and every NEW (non-duplicate) chart-source signal is pushed to that
// chat — so a paid-plan TradingView alert reaches your phone in seconds, the
// same way the nightly scan's digest does. Never fatal: a Telegram failure
// must not make the webhook return an error (TradingView would mark the
// delivery failed and may retry/dedupe oddly).
//
// Deploy once (needs your Supabase login):
//   supabase functions deploy tv-webhook --project-ref chbtjicvbezbiosuouwm
//
// Then in TradingView: alert -> Notifications -> Webhook URL:
//   https://chbtjicvbezbiosuouwm.supabase.co/functions/v1/tv-webhook
// (Edge Functions on the free plan sleep; the first alert after idle takes a few seconds.)

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Two independent secrets, so a leaked screenshot of a TradingView chart can
// never touch the nightly scanner's credentials:
//   TV_WEBHOOK_SECRET — sent by tools/signal-scan.js from GitHub Actions.
//     Compromise would let an attacker write fake signals at will.
//   TV_CHART_SECRET   — pasted into the Pine indicator's inputs, which renders
//     in the chart status line and settings dialogs that end up in screenshots.
//     Accepted for chart alerts only; revoking it never affects the scan.
const SCAN_SECRET = Deno.env.get("TV_WEBHOOK_SECRET") ?? "";
const CHART_SECRET = Deno.env.get("TV_CHART_SECRET") ?? "";

// Push a short text message to the configured Telegram chat. Fire-and-forget
// from the request path: awaited with a timeout but failures never bubble up.
async function telegramPush(text: string): Promise<void> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
  if (!token || !chatId) return; // not configured — stay silent
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.length > 3900 ? text.slice(0, 3900) + "\n… truncated" : text,
        disable_web_page_preview: true,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    // Intentionally ignore non-OK responses: Telegram being down/rate-limited
    // must not fail the webhook. The row is already safely stored.
  } catch {
    // same: swallow — the signal is stored regardless
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405 });
  }

  // 1) authenticate: shared secret in header or body — scan secret first, then
  //    the lower-value chart secret
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    // plain-text alert: keep raw text
    body = { text: await req.text() };
  }

  const given = req.headers.get("x-tv-secret") || body?.secret || "";
  let source: "scan" | "chart" | null = null;
  if (SCAN_SECRET && given === SCAN_SECRET) source = "scan";
  else if (CHART_SECRET && given === CHART_SECRET) source = "chart";
  if (!source) {
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

  // 4) Telegram push for chart-source signals only. The nightly scan already
  //    pushes its own digest, so a scan row here would double-send. Chart rows
  //    are the realtime events nobody should have to open GitHub to see.
  if (source === "chart") {
    const side = action === "LONG" ? "🟢 LONG" : "🔴 SHORT";
    const src = /zone\s+[\d.]+\s*-\s*[\d.]+/i.test(details) ? "LFC zone (chart)" : "chart alert";
    const lines = [
      `⚡ ${side} ${symbol}${price ? " @" + price : ""}`,
      details ? `   ${details.slice(0, 300)}` : "",
      "",
      `Source: ${src} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
      "Setups: https://sebasishpanda20-creator.github.io/Learningfundclear/setups.html",
      "Research heuristic — verify on your broker platform. Not advice.",
    ].filter((l) => l !== "");
    // Await but never block the response on failure — see telegramPush.
    await telegramPush(lines.join("\n"));
  }

  return new Response(JSON.stringify({ ok: true, symbol, action, source }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
