/**
 * LOCAL, TEST-ONLY preview server.
 *
 * Serves the built portal (dist/client) on 127.0.0.1 and injects the same QA
 * session and QA fixtures that qa/hedge-preview.cjs seeds in Playwright, so the
 * real pages render instead of redirecting to sign-in.
 *
 * This server must never be exposed off the machine: it binds loopback only and
 * injects a fake session plus a visible "local QA preview" banner. It does not
 * call a broker, place orders, or supply market data; every Supabase REST call
 * other than auth/app_users is answered with a fixture-unavailable error.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'dist', 'client');
const host = '127.0.0.1';
const port = Number(process.env.PREVIEW_PORT || 8788);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Same values as qa/hedge-preview.cjs — keep them in sync.
const QA_SCRIPT = String.raw`(() => {
  "use strict";
  window.__LFC_QA_PREVIEW__ = true;
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "qa@portal.local", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
  const session = { access_token: "test-only-access-token", refresh_token: "test-only-refresh-token", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user };
  const profile = { ...user, username: "qa", display_name: "QA account", is_admin: true, is_active: true };
  const stamp = { u: user.id, n: "QA account", a: true, t: Date.now() };
  try {
    localStorage.setItem("sb-chbtjicvbezbiosuouwm-auth-token", JSON.stringify(session));
    localStorage.setItem("lfc.auth", JSON.stringify(stamp));
  } catch (error) {}
  const jsonResponse = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "content-type": "application/json" } });
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    let url = null;
    try {
      url = new URL(typeof input === "string" ? input : input.url, location.href);
    } catch (error) {}
    if (url && url.hostname.endsWith("supabase.co")) {
      if (url.pathname === "/auth/v1/user") return Promise.resolve(jsonResponse(user));
      if (url.pathname === "/auth/v1/token") return Promise.resolve(jsonResponse(session));
      let accept = "";
      try { accept = new Headers((init && init.headers) || (input && input.headers) || {}).get("accept") || ""; } catch (error) {}
      if (url.pathname === "/rest/v1/app_users") {
        return Promise.resolve(jsonResponse(String(accept).includes("pgrst.object") ? profile : [profile]));
      }
      return Promise.resolve(jsonResponse({ error: "LOCAL QA PREVIEW: fixture unavailable", code: "QA_PREVIEW" }, 503));
    }
    return realFetch(input, init);
  };
  const banner = () => {
    if (!document.body || document.getElementById("lfcQaPreviewBanner")) return;
    const el = document.createElement("div");
    el.id = "lfcQaPreviewBanner";
    el.setAttribute("role", "status");
    el.textContent = "LOCAL QA PREVIEW · test-only QA session · fixtures only, no live account or market data";
    el.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:min(92vw,520px);padding:6px 10px;border:1px solid #ffd166;border-radius:6px;background:#3b2f00;color:#ffd166;font:600 12px/1.4 system-ui,sans-serif;pointer-events:none";
    document.body.appendChild(el);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", banner);
  else banner();
})();`;

function inject(html) {
  const tag = '<script src="/__qa/session.js"></script>';
  const head = /<head[^>]*>/i.exec(html);
  if (!head) return tag + html;
  const at = head.index + head[0].length;
  return html.slice(0, at) + tag + html.slice(at);
}

const TERMINAL_NOTICE = String.raw`<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Quant terminal unavailable in local QA preview</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d1117; color: #e6edf3; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: min(92vw, 640px); padding: 24px; border: 1px solid #30363d; border-radius: 10px; background: #161b22; }
  .tag { display: inline-block; margin-bottom: 12px; padding: 3px 8px; border: 1px solid #ffd166; border-radius: 999px; color: #ffd166; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  h1 { margin: 0 0 10px; font-size: 22px; }
  p { margin: 0 0 12px; color: #c9d1d9; }
  code { padding: 1px 5px; border-radius: 4px; background: #0d1117; border: 1px solid #30363d; font-size: 13px; }
  ul { margin: 0 0 16px; padding-left: 20px; color: #c9d1d9; }
  li { margin-bottom: 6px; }
  a { color: #79c0ff; }
  .fine { margin: 0; font-size: 12px; color: #8b949e; }
</style>
</head>
<body>
<main>
  <span class="tag">Local QA preview · test only</span>
  <h1>Quant terminal is not available here</h1>
  <p>This static preview serves <code>dist/client</code> and a test-only QA session. It cannot run the portal Worker, so it cannot serve the terminal route.</p>
  <ul>
    <li><code>/quant-terminal</code> is proxied by the Worker to the quant daemon using <code>QUANT_API_ORIGIN</code>.</li>
    <li>The terminal also needs its own signed-in terminal session; the QA fixture account is not a terminal account.</li>
    <li>No terminal page, quote or account data is provided or imitated on this page.</li>
  </ul>
  <p>To open the real terminal, run the full portal Worker locally with a valid <code>QUANT_API_ORIGIN</code> and terminal sign-in.</p>
  <p><a href="/index.html">Back to the dashboard</a> · <a href="/gex.html">NSE hedge panel</a></p>
  <p class="fine">Served only on 127.0.0.1 by qa/preview-server.cjs. This notice is not part of the production portal.</p>
</main>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  if (pathname === "/quant-terminal" || pathname.startsWith("/quant-terminal/")) {
    res.writeHead(404, {
      "content-type": TYPES[".html"],
      "cache-control": "no-store",
      "x-lfc-qa-preview": "test-only",
    });
    return res.end(TERMINAL_NOTICE);
  }
  if (pathname === "/__qa/health") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({ ok: true, qa: true }));
  }
  if (pathname === "/__qa/session.js") {
    res.writeHead(200, { "content-type": TYPES ['.js'], "cache-control": "no-store" });
    return res.end(QA_SCRIPT);
  }
  let rel = pathname === "/" ? "/index.html" : pathname;
  const file = path.resolve(root, "." + rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    return res.end("not found");
  }
  const ext = path.extname(file).toLowerCase();
  const headers = { "content-type": TYPES[ext] || "application/octet-stream" };
  if (ext === ".html") {
    headers["cache-control"] = "no-store";
    res.writeHead(200, headers);
    return res.end(inject(fs.readFileSync(file, "utf8")));
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
});

server.listen(port, host, () => {
  console.log("LOCAL QA PREVIEW (test-only session) http://" + host + ":" + port + "/");
});
