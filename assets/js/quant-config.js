/* Quant Desk embedding configuration.

 * The daemon serves its own UI, so the desk frames it. Two settings:

 *   url   — the daemon's public HTTPS origin, used only as a fallback when no
 *           proxy path is configured. Leave empty while the Worker proxies the
 *           terminal; set window.QUANT_TERMINAL_URL to label a real host.
 *   proxy — a PATH on THIS Pages origin (see server/worker.mjs and
 *           server/quant-proxy.mjs) that mirrors the daemon. The iframe and
 *           its fetches go through it so the browser stays same-origin: no
 *           CORS, no third-party splash, and the daemon origin can change
 *           without touching the embed code again. The real upstream is the
 *           worker's QUANT_API_ORIGIN var, NOT this file.
 *
 * To point a build at a different daemon, set window.QUANT_TERMINAL_URL in a
 * script tag BEFORE this file, e.g.
 *   <script>window.QUANT_TERMINAL_URL = "https://staging.example";</script>
 * (This file is loaded directly by the browser, so no process.env here.)
 */
window.QUANT_TERMINAL = {
  // No bundled default: the Worker proxies the terminal through `proxy` below,
  // and naming an origin here only ever produced a misleading label (the plain
  // quant-daemon.onrender.com name belongs to an unrelated service). Set
  // window.QUANT_TERMINAL_URL once the real daemon host is known.
  url: window.QUANT_TERMINAL_URL || "",
  proxy: "/quant-terminal",
};
