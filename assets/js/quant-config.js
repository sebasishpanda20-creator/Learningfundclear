/* Quant Desk embedding configuration.

 * The daemon serves its own UI, so the desk frames it. Two settings:

 *   url   — the daemon's public HTTPS origin. Used for display and the
 *           "open in new tab" link. Current value: the Render-hosted daemon
 *           (repo my_quant_platform, render.yaml service name quant-daemon).
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
  url: window.QUANT_TERMINAL_URL || "https://quant-daemon.onrender.com",
  proxy: "/quant-terminal",
};
