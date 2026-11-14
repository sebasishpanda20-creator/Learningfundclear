/**
 * Frontend-to-backend routing check.
 * Serves the static page and forwards /api/* to the real FastAPI proxy started
 * with DUMMY credentials. The provider is never contacted: /login only redirects,
 * /quote is unauthenticated, so nothing here is live authentication.
 */
const { chromium } = require("playwright");
const { fixture, port } = require("./fixtures.cjs");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const API_PORT = 8765;
const root = path.resolve("..");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForApi() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${API_PORT}/api/v1/health`);
      if (r.ok) return true;
    } catch (e) {}
    await wait(300);
  }
  return false;
}

(async () => {
  const env = Object.assign({}, process.env, {
    FYERS_CLIENT_ID: "DUMMYAPP-100",
    FYERS_SECRET_ID: "dummy-secret",
    FYERS_REDIRECT_URI: `http://127.0.0.1:${port}/api/v1/fyers/callback`,
    PYTHONUNBUFFERED: "1",
  });
  const api = spawn(
    "python",
    ["-m", "uvicorn", "live_feed_proxy:app", "--host", "127.0.0.1", "--port", String(API_PORT)],
    { cwd: path.join(root, "Learningfundclear", "backend"), env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let apiLog = "";
  api.stdout.on("data", (d) => (apiLog += d));
  api.stderr.on("data", (d) => (apiLog += d));

  const ready = await waitForApi();
  if (!ready) {
    console.log(JSON.stringify({ started: false, log: apiLog.slice(-800) }));
    api.kill();
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/api/")) {
      // The terminal now calls the hosted same-origin FYERS routes; this local
      // harness maps them onto the Python service's /api/v1/fyers equivalents.
      const target = url.pathname.startsWith("/api/fyers/")
        ? "/api/v1/fyers/" + url.pathname.slice("/api/fyers/".length) + url.search
        : req.url;
      const proxied = http.request(
        { host: "127.0.0.1", port: API_PORT, path: target, method: req.method, headers: req.headers },
        (up) => {
          res.writeHead(up.statusCode, up.headers);
          up.pipe(res);
        },
      );
      req.pipe(proxied);
      proxied.on("error", () => {
        res.statusCode = 502;
        res.end("proxy error");
      });
      return;
    }
    let f = path.resolve(".", "." + url.pathname);
    if (f.endsWith("/")) f += "index.html";
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".json") ? "application/json" : "text/html");
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));

  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await fixture(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(origin + "/lfc_terminal_v6.html", { waitUntil: "load" });
  await page.waitForTimeout(900);
  await page.evaluate(() => document.getElementById("connectFyersBtn").click());
  await page.waitForTimeout(500);

  const dialog = await page.evaluate(() => ({
    open: document.getElementById("fyersModal").open,
    note: document.getElementById("fyersConfigNote").textContent.trim(),
    redirect: document.getElementById("fyersRedirectUri").textContent.trim(),
    auth: document.getElementById("fyersAuthState").textContent.trim(),
    data: document.getElementById("fyersDataState").textContent.trim(),
    loginDisabled: document.getElementById("loginWithFyersBtn").disabled,
    disconnectHidden: document.getElementById("discFyersBtn").hidden,
  }));

  const status = await page.evaluate(async () => {
    const r = await fetch("/api/v1/fyers/config-status", { cache: "no-store" });
    return { status: r.status, body: await r.json() };
  });
  const quote = await page.evaluate(async () => (await fetch("/api/v1/fyers/quote?symbol=NIFTY")).status);
  const loginRedirect = await page.evaluate(async () => {
    const r = await fetch("/api/v1/fyers/login", { redirect: "manual" });
    return { type: r.type, status: r.status };
  });
  const loginRaw = await new Promise((resolve) => {
    http.get(`${origin}/api/v1/fyers/login`, (r) => resolve({ status: r.statusCode, location: r.headers.location || "" }));
  });

  console.log(
    JSON.stringify(
      {
        started: true,
        dialog,
        status,
        quoteStatus: quote,
        loginManualFetch: loginRedirect,
        loginServerRedirect: { status: loginRaw.status, providerHost: (loginRaw.location.match(/^https:\/\/([^/]+)/) || [])[1], hasState: /state=/.test(loginRaw.location) },
        errors,
      },
      null,
      2,
    ),
  );

  await browser.close();
  server.close();
  api.kill();
  process.exit(0);
})();
