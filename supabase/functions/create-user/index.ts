// Supabase Edge Function: create-user
// ===================================
// Admin-only: creates a portal sign-in. Called from the journal Admin panel
// (index.html) and the sign-in page's admin card (signin.html) via
// sb.functions.invoke("create-user", { body: { username, display_name, password } })
// with the caller's session token in the Authorization header.
//
// Why this file exists: the originally-deployed version had no CORS handling —
// the browser's OPTIONS preflight got a 405 and every response lacked
// Access-Control-Allow-Origin, so the browser blocked the call and supabase-js
// surfaced it as "Failed to send a request to the Edge Function". This version
// answers preflights and stamps CORS headers on every response.
//
// Behaviour:
//   1. Verifies the caller's JWT and that their app_users row has is_admin.
//   2. Creates the auth user as <username>@portal.local (email confirmed, so
//      no confirmation mail — sign-in is username + password on signin.html).
//   3. Inserts the matching app_users row (is_admin: false, is_active: true;
//      the journal Admin panel can promote/deactivate later).
//
// Deploy (needs a Supabase access token — `supabase login` or SUPABASE_ACCESS_TOKEN):
//   supabase functions deploy create-user --project-ref chbtjicvbezbiosuouwm
//
// The service-role key is injected by Supabase automatically as
// SUPABASE_SERVICE_ROLE_KEY; it never reaches the browser.

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // Browsers send this before every cross-origin POST — must answer 2xx.
  if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Unauthorized" });

  const supabase = createClient(
    // Injected by the edge runtime on every project.
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // 1) who is calling?
  const { data: caller, error: callerErr } = await supabase.auth.getUser(token);
  if (callerErr || !caller?.user) return json(401, { error: "Unauthorized" });

  const { data: callerRow, error: rowErr } = await supabase
    .from("app_users")
    .select("is_admin, is_active")
    .eq("id", caller.user.id)
    .single();
  if (rowErr || !callerRow?.is_admin || callerRow?.is_active === false) {
    return json(403, { error: "Admin access is required" });
  }

  // 2) payload
  let body: { username?: string; display_name?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const username = String(body.username ?? "").trim();
  const display_name = String(body.display_name ?? "").trim() || username;
  const password = String(body.password ?? "");
  if (!/^[A-Za-z0-9_.-]{2,32}$/.test(username)) {
    return json(400, { error: "Username must be 2-32 letters, digits, dot, dash or underscore" });
  }
  if (password.length < 6) return json(400, { error: "Password must be at least 6 characters" });

  const email = (username + "@portal.local").toLowerCase();

  // 3) create the auth user (confirmed immediately — no mail loop)
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, display_name },
  });
  if (createErr) {
    const msg = String(createErr.message || "");
    if (/already|duplicate|exists/i.test(msg)) return json(409, { error: "That username is already taken" });
    return json(400, { error: msg });
  }

  // 4) app_users row drives the journal's role checks
  const { error: insertErr } = await supabase.from("app_users").insert({
    id: created.user!.id,
    username,
    display_name,
    is_admin: false,
    is_active: true,
  });
  if (insertErr) {
    // Roll the auth user back so a half-created account never lingers.
    await supabase.auth.admin.deleteUser(created.user!.id);
    return json(500, { error: "Could not store the user profile: " + insertErr.message });
  }

  return json(200, { ok: true, username });
});
