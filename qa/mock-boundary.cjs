/**
 * Mock-boundary proof: the FYERS endpoints cannot silently substitute demo or
 * fabricated data for a real broker session.
 *
 * Starts the real proxy twice (no config, dummy config) and calls it on the
 * loopback. The provider is never contacted: /login only builds a redirect.
 */
const { spawn } = require("child_process");
const path = require("path");

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, error: String(e.message || e).slice(0, 300) }); }
}
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(port, env) {
  const base = path.resolve("..", "Learningfundclear", "backend");
  const p = spawn("python", ["-m", "uvicorn", "live_feed_proxy:app", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: base,
    env: Object.assign({}, process.env, env, { PYTHONUNBUFFERED: "1" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  p.stdout.on("data", (d) => (log += d));
  p.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/v1/health`); if (r.ok) return { p, log: () => log }; } catch {}
    await wait(300);
  }
  throw new Error("backend did not start: " + log.slice(-400));
}

async function get(port, p, opts) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, Object.assign({ redirect: "manual" }, opts || {}));
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, location: r.headers.get("location") || "", text, json };
}

(async () => {
  const out = { noConfig: {}, dummyConfig: {}, checks: 0, failed: 0, failures: [] };
  const plain = await start(8771, {
    FYERS_CLIENT_ID: "", FYERS_SECRET_ID: "", FYERS_REDIRECT_URI: "",
  });
  const zero = {
    status: await get(8771, "/api/v1/fyers/config-status"),
    quote: await get(8771, "/api/v1/fyers/quote?symbol=NIFTY"),
    login: await get(8771, "/api/v1/fyers/login"),
    legacy: await get(8771, "/api/v1/fyers/code-exchange?code=x&state=y", { method: "POST" }),
    scan: await get(8771, "/api/v1/scan-sl-tp"),
  };
  plain.p.kill();

  check("without config: not configured, not connected", () => {
    eq(zero.status.status, 200);
    eq(zero.status.json.configured, false);
    eq(zero.status.json.connected, false);
    eq(zero.status.json.status, "signed_out");
  });
  check("without config: quote is refused, never demo-priced", () => {
    eq(zero.quote.status, 401, "quote status");
    assert(!/price|ltp|last_price/i.test(zero.quote.text), "quote leaked price: " + zero.quote.text);
  });
  check("without config: login refuses instead of faking a session", () => {
    eq(zero.login.status, 503, "login status");
    assert(!/access_token|token/i.test(zero.login.text), zero.login.text);
  });
  check("legacy code-exchange cannot fabricate a connection", () => {
    eq(zero.legacy.status, 410, "legacy status");
    assert(!/access_token/i.test(zero.legacy.text));
  });
  check("scan payload is a static artifact, not broker data", () => {
    eq(zero.scan.status, 200);
    assert(Array.isArray(zero.scan.json.symbols), "symbols array");
    assert(!/fyers|access_token|broker/i.test(zero.scan.text), "broker attribution present");
    const age = Date.now() - Date.parse(zero.scan.json.scanned_at);
    assert(age > 60000, "scan payload looks freshly generated");
  });

  const dummy = await start(8772, {
    FYERS_CLIENT_ID: "DUMMYAPP-100",
    FYERS_SECRET_ID: "dummy-secret",
    FYERS_REDIRECT_URI: "http://127.0.0.1:8130/api/v1/fyers/callback",
  });
  const cfg = {
    status: await get(8772, "/api/v1/fyers/config-status"),
    quote: await get(8772, "/api/v1/fyers/quote?symbol=NIFTY"),
    login: await get(8772, "/api/v1/fyers/login"),
    disconnect: await get(8772, "/api/v1/fyers/disconnect", { method: "POST" }),
  };
  dummy.p.kill();

  check("dummy config alone never yields a connected session", () => {
    eq(cfg.status.json.configured, true);
    eq(cfg.status.json.connected, false);
    eq(cfg.status.json.status, "signed_out");
    eq(cfg.status.json.expires_at, null);
  });
  check("dummy config: quote still requires a real exchange", () => {
    eq(cfg.quote.status, 401, "quote status");
    assert(!/price|ltp/i.test(cfg.quote.text));
  });
  check("dummy config: login redirects to the provider, issues no token", () => {
    eq(cfg.login.status, 302);
    assert(/^https:\/\/api-t1\.fyers\.in\//.test(cfg.login.location), cfg.login.location);
    assert(/state=/.test(cfg.login.location), "missing state");
    assert(!/access_token/i.test(cfg.login.text));
  });
  check("disconnect on a signed-out session revokes nothing and stays signed out", () => {
    eq(cfg.disconnect.status, 200);
    eq(cfg.disconnect.json.status, "disconnected");
    eq(cfg.disconnect.json.provider_revoked, false);
    assert(!/access_token/i.test(cfg.disconnect.text));
  });

  out.noConfig = zero;
  out.dummyConfig = cfg;
  out.checks = results.length;
  out.failed = results.filter((r) => !r.pass).length;
  out.failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.failed ? 1 : 0);
})().catch((e) => {
  console.log(JSON.stringify({ fatal: String((e && e.stack) || e) }, null, 2));
  process.exit(1);
});
