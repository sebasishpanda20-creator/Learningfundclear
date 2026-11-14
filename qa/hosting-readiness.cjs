/**
 * Hosting readiness audit.
 *
 * Fails on a laptop-bound production dependency (loopback URL, tunnel origin, file://).
 * Reports known gaps that the architecture doc tracks (hosted FYERS, durable sessions,
 * server-side scanning, free-tier cron limits) without pretending they are solved.
 */
const fs = require("fs");
const path = require("path");

const results = [];
const gaps = [];
const blockers = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, pass: true, detail: detail ?? null });
  } catch (e) {
    results.push({ name, pass: false, error: String(e.message || e) });
    blockers.push(name + ": " + e.message);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const read = (p) => fs.readFileSync(p, "utf8");

const RUNTIME_GLOBS = [];
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "qa", "docs", "dist", "tools", ".git", "visual-qa-artifacts"].includes(entry.name)) continue;
      walk(p, out);
    } else if (/\.(js|mjs|html|jsonc|json)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const runtimeFiles = [
  ...walk("server"),
  ...walk("assets/js"),
  ...walk("funds/assets/js"),
  ...walk("supabase/functions"),
  ...fs.readdirSync(".").filter((f) => f.endsWith(".html")).map((f) => path.join(".", f)),
  path.join("assets", "js", "config.js"),
  "auth-guard.js",
  "scanner-logic.js",
  "wrangler.jsonc",
].filter((f) => fs.existsSync(f));

const LOCAL_RE = /\b(localhost|127\.0\.0\.1|127\.0\.0\.2|0\.0\.0\.0|\[::1\])\b/;
const TUNNEL_RE = /ngrok-free\.(app|dev)|loca\.lt|trycloudflare\.com|serveo\.net/i;

check("no loopback addresses in shipped runtime code", () => {
  const hits = [];
  for (const f of runtimeFiles) {
    const text = read(f);
    text.split(/\r?\n/).forEach((line, i) => {
      if (LOCAL_RE.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert(hits.length === 0, "loopback references: " + hits.slice(0, 5).join(" | "));
  return `${runtimeFiles.length} runtime files scanned`;
});

check("no configured tunnel URL in shipped runtime code", () => {
  const hits = runtimeFiles.filter((f) => /https?:\/\/[^"'\s]*(?:ngrok-free\.(?:app|dev)|loca\.lt|trycloudflare\.com|serveo\.net)/i.test(read(f)));
  assert(hits.length === 0, "tunnel URLs: " + hits.join(", "));
});

check("no file:// asset or API references", () => {
  const hits = runtimeFiles.filter((f) => /(?:src|href|fetch\()\s*["']file:\/\//.test(read(f)));
  assert(hits.length === 0, hits.join(", "));
});

const wrangler = read("wrangler.jsonc");
check("Worker has a deployed entrypoint and static assets", () => {
  assert(/"main"\s*:\s*"[^"]+"/.test(wrangler), "missing main");
  assert(/"assets"\s*:/.test(wrangler) && /"binding"\s*:\s*"ASSETS"/.test(wrangler), "missing ASSETS binding");
  assert(/"run_worker_first"\s*:\s*\[[^\]]*\/api\/\*/.test(wrangler), "API routes not worker-first");
});

check("cron trigger is configured and the Worker exports scheduled()", () => {
  assert(/"triggers"\s*:\s*\{[^}]*"crons"/s.test(wrangler), "no crons");
  const worker = read(path.join("server", "worker.mjs"));
  assert(/async\s+scheduled\s*\(/.test(worker), "no scheduled() handler");
});

check("upstream quant origin is public HTTPS, not loopback", () => {
  const m = wrangler.match(/"QUANT_API_ORIGIN"\s*:\s*"([^"]+)"/);
  assert(m, "QUANT_API_ORIGIN not set");
  const url = new URL(m[1]);
  assert(url.protocol === "https:", "not https: " + m[1]);
  assert(!LOCAL_RE.test(m[1]) && !TUNNEL_RE.test(m[1]), "local/tunnel origin: " + m[1]);
  return m[1];
});

check("client configuration points at hosted HTTPS services", () => {
  const cfg = read(path.join("assets", "js", "config.js"));
  const m = cfg.match(/url:\s*"(https:\/\/[^"]+)"/);
  assert(m, "Supabase URL missing");
  assert(!LOCAL_RE.test(m[1]), "loopback Supabase URL");
  return m[1].replace(/https:\/\/([^.]+)\.supabase\.co/, "https://$1.supabase.co");
});

check("production deploy path exists in package scripts", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(/wrangler deploy/.test(pkg.scripts?.["deploy:cloudflare"] || ""), "no deploy script");
  assert(/wrangler/.test(Object.keys(pkg.devDependencies || {}).join(",")), "wrangler not pinned");
});

check("FYERS callback is env-configured, never a hardcoded host", () => {
  const py = read(path.resolve("..", "Learningfundclear", "backend", "live_feed_proxy.py"));
  assert(/FYERS_REDIRECT_URI/.test(py), "callback env var missing");
  assert(!/http:\/\/(localhost|127\.0\.0\.1)/.test(py), "loopback callback default");
  return "env-driven";
});

check("FYERS auth and quotes are served by the Worker", () => {
  const routes = read("server/fyers-routes.mjs");
  const worker = read("server/worker.mjs");
  assert(/\/api\/fyers\//.test(worker), "worker route missing");
  assert(/validate-authcode/.test(routes), "token exchange missing");
  assert(/FYERS_OWNER_EMAILS/.test(routes), "owner gate missing");
  assert(/sealToken/.test(routes), "token sealing missing");
  assert(/login_url/.test(routes), "login URL missing");
  return "owner-gated, sealed tokens";
});

check("FYERS state and sessions use a Durable Object", () => {
  assert(/"new_sqlite_classes"\s*:\s*\[\s*"FyersVault"/.test(wrangler), "DO migration missing");
  assert(/FYERS_VAULT/.test(wrangler), "DO binding missing");
  assert(/consumeState/.test(read("server/fyers-vault.mjs")), "one-time state consumption missing");
  return "durable_object_sqlite";
});

check("architecture and runbook documents exist with required sections", () => {
  const doc = read(path.join("docs", "HOSTED-ARCHITECTURE.md"));
  const run = read(path.join("docs", "DEPLOYMENT-RUNBOOK.md"));
  for (const t of ["Cost", "Sleep", "Streaming", "Restart", "A — mobile page", "B — scheduled"]) {
    assert(new RegExp(t, "i").test(doc), "architecture missing: " + t);
  }
  for (const t of ["laptop", "mobile data", "wrangler deploy"]) {
    assert(new RegExp(t, "i").test(run), "runbook missing: " + t);
  }
});

// ---- tracked gaps (reported, not silently passed) ------------------------
const workerSrc = ["server/worker.mjs", "server/market-proxy.mjs", "server/quant-proxy.mjs", "server/terminal-gate.mjs", "server/fyers-routes.mjs"].map(read).join("\n");
if (!/"FYERS_OWNER_EMAILS"/.test(wrangler)) {
  gaps.push({
    id: "FYERS_OWNER_EMAILS_UNSET",
    severity: "setup",
    detail:
      "Set FYERS_OWNER_EMAILS to the portal account allowed to connect the broker; without it every FYERS route answers 503 by design.",
  });
}
if (!/FYERS_TOKEN_KEY/.test(wrangler)) {
  gaps.push({
    id: "FYERS_SECRETS_PENDING",
    severity: "setup",
    detail:
      "FYERS_CLIENT_ID, FYERS_SECRET_ID and FYERS_TOKEN_KEY must be Worker secrets (FYERS_TOKEN_KEY = 32 random bytes, base64). They are intentionally absent from source.",
  });
}
if (/"crons"\s*:\s*\[\s*"\*\/1 \* \* \* \*"\s*\]/.test(wrangler)) {
  gaps.push({
    id: "CRON_EVERY_MINUTE_VS_KV_FREE",
    severity: "cost",
    detail:
      "Every-minute cron lists alert keys: ~1,440 KV list ops/day exceed the Workers KV free allowance (1,000/day). Use Workers Paid ($5/mo) or a slower cron.",
  });
}
if (!/scheduled[\s\S]{0,4000}(scan|scanner|computeZones)/i.test(workerSrc)) {
  gaps.push({
    id: "NO_SERVER_SIDE_SCAN_JOB",
    severity: "capability",
    detail:
      "B is partial: cron sends email watches and checks daemon health, but no server-side scanner computes/persists symbol scans with browsers closed.",
  });
}
if (!/WebSocket|EventSource|text\/event-stream/.test(runtimeFiles.map(read).join("\n"))) {
  gaps.push({
    id: "NO_STREAMING",
    severity: "product",
    detail: "No WebSocket/SSE. Quotes and charts are polling/request-based; email is the only push channel.",
  });
}
if (/ngrok-free|loca\.lt|trycloudflare/i.test(workerSrc)) {
  gaps.push({
    id: "TUNNEL_SUPPORT_IN_PROXY",
    severity: "risk",
    detail:
      "server/quant-proxy.mjs still supports ngrok-style origins. QUANT_API_ORIGIN is not a tunnel today; keep it on a managed HTTPS host and remove tunnel fallbacks once the daemon is stable.",
  });
}
if (/"QUANT_API_ORIGIN"\s*:\s*"https:\/\/[^"]*onrender\.com"/.test(wrangler)) {
  gaps.push({
    id: "RENDER_COLD_START",
    severity: "availability",
    detail:
      "The quant daemon is hosted on Render; on the free plan it sleeps after 15 min and wakes in ~1 min. Confirm the paid plan or accept the first-request delay.",
  });
}

const out = {
  runtime_files_scanned: runtimeFiles.length,
  checks: results.length,
  failed: results.filter((r) => !r.pass).length,
  failed_checks: results.filter((r) => !r.pass),
  gaps,
  verdict: blockers.length ? "BLOCKED" : "READY_WITH_GAPS",
  a_mobile_laptop_off: blockers.length
    ? "not yet: resolve failed checks"
    : "Worker code hosts pages, auth, market proxy, owner-gated FYERS auth/quote and alerts; deployment plus the laptop-off mobile-data test are still pending",
  b_browsers_closed: "partial: alert delivery yes, scheduled symbol scanning no",
};
console.log(JSON.stringify(out, null, 2));
process.exit(blockers.length ? 1 : 0);
