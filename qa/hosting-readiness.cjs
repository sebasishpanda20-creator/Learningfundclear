/**
 * Hosting static audit.
 *
 * This is a STATIC source audit. Passing it does not show that a deployed page
 * works with the laptop off, that FYERS accepts a login, or that a phone on
 * mobile data can reach the service. Those are reported as NOT RUN.
 *
 * Scans first-party runtime files, generated Worker configuration and the
 * build output. Third-party vendor bundles are scanned separately with an
 * explicit allowlist for their inert defaults (for example Supabase's
 * localhost:9999 fallback).
 */
const fs = require("fs");
const path = require("path");

const results = [];
const checksFailed = [];
const blockers = [];
const setupGaps = [];

function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, pass: true, detail: detail ?? null });
  } catch (e) {
    results.push({ name, pass: false, error: String(e.message || e) });
    checksFailed.push(name + ": " + e.message);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const read = (p) => fs.readFileSync(p, "utf8");

const SKIP_DIRS = new Set(["node_modules", "qa", "docs", "tools", ".git", ".wrangler", ".dryrun-prod", "visual-qa-artifacts", "market-data", "__pycache__"]);
function walk(dir, out = [], { vendor = false } = {}) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name === "vendor" && !vendor) continue;
      walk(p, out, { vendor: vendor || entry.name === "vendor" });
    } else if (/\.(js|mjs|html|jsonc|toml|json)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const firstParty = [
  ...walk("server"),
  ...walk("assets/js"),
  ...walk("funds/assets/js"),
  ...walk("supabase/functions"),
  ...walk("dist/server"),
  ...walk("dist/client"),
  ...fs.readdirSync(".").filter((f) => f.endsWith(".html")).map((f) => path.join(".", f)),
  "auth-guard.js",
  "scanner-logic.js",
  "wrangler.jsonc",
  "assets/js/config.js",
].filter((f) => fs.existsSync(f));

const vendorFiles = [
  ...walk("assets/vendor"),
  ...walk("dist/client/assets/vendor"),
].filter((f) => fs.existsSync(f));

const LOCAL_RE = /\b(?:localhost(?:\.[a-z0-9-]+)*|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|\[::1\]|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/i;
const TUNNEL_RE = /(ngrok-free\.(?:app|dev)|ngrok\.io|loca\.lt|localtunnel\.me|trycloudflare\.com|serveo\.net|cloudflared)/i;

function hits(files, regex) {
  const found = [];
  for (const f of files) {
    let text;
    try { text = read(f); } catch { continue; }
    text.split(/\r?\n/).forEach((line, i) => {
      if (regex.test(line)) found.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  return found;
}

check("first-party runtime has no loopback aliases or 127.0.0.0/8", () => {
  const found = hits(firstParty, LOCAL_RE);
  assert(found.length === 0, found.slice(0, 5).join(" | "));
  return `${firstParty.length} first-party runtime files`;
});

check("third-party bundles only contain allowlisted inert loopback defaults", () => {
  const found = hits(vendorFiles, LOCAL_RE);
  const allowed = found.filter((h) => /supabase\.js/.test(h));
  assert(found.length === allowed.length, found.filter((h) => !allowed.includes(h)).slice(0, 3).join(" | "));
  const localhostCount = vendorFiles
    .filter((f) => f.endsWith("supabase.js"))
    .reduce((n, f) => n + (read(f).match(/http:\/\/localhost:9999/g) || []).length, 0);
  assert(localhostCount <= 2, `unexpected Supabase loopback count ${localhostCount}`);
  return `${vendorFiles.length} vendor files, Supabase inert localhost:9999 default only`;
});

check("no configured tunnel origin in runtime code or config", () => {
  const nonProxy = [...firstParty, ...vendorFiles].filter((f) => !/quant-proxy\.mjs$/.test(f));
  const found = hits(nonProxy, TUNNEL_RE);
  assert(found.length === 0, found.slice(0, 5).join(" | "));
  const proxyHits = hits(firstParty, TUNNEL_RE);
  assert(proxyHits.every((h) => /quant-proxy\.mjs/.test(h)), "tunnel host outside quant-proxy");
  return "no configured tunnel; quant-proxy origin allowlist recorded as blocker";
});

check("no file:// runtime references", () => {
  const found = hits(firstParty, /(?:src|href|fetch\()\s*["']file:\/\//);
  assert(found.length === 0, found.join(", "));
});

check("runtime URL overrides are public HTTPS", () => {
  const wrangler = read("wrangler.jsonc");
  const urls = [...wrangler.matchAll(/"(QUANT_API_ORIGIN|WEBHOOK_URL|PORTAL_ORIGIN)"\s*:\s*"([^"]+)"/g)];
  for (const [, key, value] of urls) {
    assert(!LOCAL_RE.test(value) && !TUNNEL_RE.test(value), `${key} is local/tunnel: ${value}`);
    assert(value.startsWith("https://"), `${key} is not HTTPS: ${value}`);
  }
  const worker = read("server/worker.mjs");
  assert(!/process\.env\.[A-Z_]*(?:URL|ORIGIN)[^\n]*localhost/i.test(worker), "Worker env override points at localhost");
  return urls.map((m) => m[1]).join(", ") || "no URL vars";
});

check("Worker entrypoint, assets and API-first routing are configured", () => {
  const wrangler = read("wrangler.jsonc");
  assert(/"main"\s*:\s*"[^"]+"/.test(wrangler), "missing main");
  assert(/"binding"\s*:\s*"ASSETS"/.test(wrangler), "missing ASSETS binding");
  assert(/"run_worker_first"\s*:\s*\[[^\]]*\/api\/\*/.test(wrangler), "API not worker-first");
});

check("cron has a bounded evaluation design", () => {
  const wrangler = read("wrangler.jsonc");
  const worker = read("server/worker.mjs");
  const alerts = read("server/email-alerts.mjs");
  assert(/"crons"/.test(wrangler), "no cron trigger");
  assert(/async\s+scheduled\s*\(/.test(worker), "no scheduled() handler");
  assert(/ALERT_EVAL_MINUTES/.test(alerts), "alert evaluation interval missing");
  assert(/ALERT_MAX_PAGES/.test(alerts), "bounded pagination missing");
  assert(/list\(\{prefix:'plan:',limit:100/.test(alerts), "listing limit missing");
});

check("hosted origins and client config are public HTTPS", () => {
  const wrangler = read("wrangler.jsonc");
  const m = wrangler.match(/"QUANT_API_ORIGIN"\s*:\s*"([^"]+)"/);
  assert(m, "QUANT_API_ORIGIN missing");
  assert(m[1].startsWith("https://") && !LOCAL_RE.test(m[1]) && !TUNNEL_RE.test(m[1]), m[1]);
  const cfg = read("assets/js/config.js");
  const u = cfg.match(/url:\s*"(https:\/\/[^"]+)"/);
  assert(u, "Supabase URL missing");
  assert(!LOCAL_RE.test(u[1]), "loopback Supabase URL");
  return `${m[1]} · ${u[1].replace(/https:\/\/([^.]+)\.supabase\.co/, "https://$1.supabase.co")}`;
});

check("generated Worker config matches source and stays hosted", () => {
  const source = read("server/config.mjs");
  const generatedPath = "dist/server/config.mjs";
  assert(fs.existsSync(generatedPath), "built dist/server/config.mjs missing");
  const generated = read(generatedPath);
  assert(generated === source, "generated config differs from server/config.mjs");
  assert(!LOCAL_RE.test(generated), "generated config has loopback");
  return "dist/server/config.mjs identical";
});

check("FYERS state and sessions use the atomic vault (D1 on Sites)", () => {
  const wrangler = read("wrangler.jsonc");
  const vault = read("server/fyers-vault.mjs");
  const routes = read("server/fyers-routes.mjs");
  assert(/export class D1Storage/.test(vault), "D1 storage missing");
  assert(
    /CREATE TABLE IF NOT EXISTS fyers_vault/.test(vault) && /DELETE FROM fyers_vault .*RETURNING value/.test(vault),
    "atomic D1 consumption missing",
  );
  assert(/if \(env\.DB\) return d1Vault\(env\.DB/.test(routes), "routes do not prefer the D1 vault");
  // The Durable Object stays the fallback for a plain Cloudflare deploy.
  assert(/"new_sqlite_classes"\s*:\s*\[\s*"FyersVault"/.test(wrangler), "DO migration missing");
  assert(/"class_name"\s*:\s*"FyersVault"/.test(wrangler), "DO binding missing");
  assert(/consumeState/.test(vault) && /DELETE FROM vault .*RETURNING value/.test(vault), "atomic SQL consumption missing");
  assert(/sealToken/.test(routes), "token sealing missing");
  return "d1_sqlite: delete returning";
});

check("audit documents state the corrected design and inventory", () => {
  const arch = read("docs/HOSTED-ARCHITECTURE.md");
  for (const term of ["not laptop-independent", "Durable Object", "NOT RUN", "list requests"]) {
    assert(new RegExp(term.replace(/ /g, "\\s+"), "i").test(arch), "architecture missing: " + term);
  }
  const budget = read("docs/FREE-TIER-BUDGET.md");
  for (const term of ["ALERT_EVAL_MINUTES", "list requests", "1,000", "Resend"]) {
    assert(new RegExp(term, "i").test(budget), "budget missing: " + term);
  }
  const inventory = read("docs/SCANNER-INVENTORY.md");
  for (const term of ["signal-scan.js", "scan-watchdog", "scanner-logic.js", "Nightly"]) {
    assert(new RegExp(term, "i").test(inventory), "inventory missing: " + term);
  }
  return "architecture + budget + inventory";
});

// ---- separate outcomes ----------------------------------------------------
const wrangler = read("wrangler.jsonc");
if (!/"FYERS_OWNER_EMAILS"/.test(wrangler)) {
  setupGaps.push("FYERS_OWNER_EMAILS is not configured; every FYERS route answers 503 by design.");
}
if (!/FYERS_TOKEN_KEY/.test(wrangler)) {
  setupGaps.push("FYERS_CLIENT_ID, FYERS_SECRET_ID and FYERS_TOKEN_KEY must be Worker secrets before a live login.");
}
if (!/scheduled[\s\S]{0,2000}(scan|scanner|computeZones)/i.test(read("server/worker.mjs"))) {
  blockers.push("No Worker-hosted intraday scan. The nightly EOD scan runs in GitHub Actions (docs/SCANNER-INVENTORY.md); it is not a Worker job.");
}
if (/ngrok|localtunnel|trycloudflare/i.test(read("server/quant-proxy.mjs"))) {
  blockers.push("The quant proxy still accepts tunnel-style origins; QUANT_API_ORIGIN is not a tunnel today, but the fallback must be removed before any laptop-independence claim.");
}

const out = {
  milestone: "SOURCE_AUDIT_HOSTED_DESIGN",
  static_audit: {
    pass: checksFailed.length === 0,
    checks: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    failures: results.filter((r) => !r.pass),
    first_party_files: firstParty.length,
    vendor_files: vendorFiles.length,
    generated_config_included: fs.existsSync("dist/server/config.mjs"),
  },
  hosting_blockers: blockers,
  setup_gaps: setupGaps,
  deployment: "NOT RUN",
  live_fyers: "NOT RUN",
  laptop_off_mobile_test: "NOT RUN",
  laptop_independence_claimed: false,
  production_ready: false,
  verdict: checksFailed.length ? "STATIC_AUDIT_FAILED" : "STATIC_AUDIT_PASS_BLOCKERS_REMAIN",
};
console.log(JSON.stringify(out, null, 2));
process.exit(checksFailed.length ? 1 : 0);
