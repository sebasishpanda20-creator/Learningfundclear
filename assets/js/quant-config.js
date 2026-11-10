/* Quant Desk embedding configuration.

 * The daemon serves its own UI, so the desk frames it. Two settings:

 *   url   — the daemon's public HTTPS origin. Used for display and the
 *           "open in new tab" link. Current value: the Render 24/7 cloud
 *           daemon, which stays up when no local machine is running.
 *   proxy — a PATH on THIS Pages origin (see functions/quant-terminal/ and
 *           functions/api/v1/) that mirrors the daemon. The iframe and its
 *           fetches go through it so the browser stays same-origin: no
 *           third-party splash inside the frame, no CORS, and the daemon
 *           origin can change later without touching the embed code again.
 *
 * To point a build at a different daemon, set window.QUANT_TERMINAL_URL in a
 * script tag BEFORE this file, e.g.
 *   <script>window.QUANT_TERMINAL_URL = "https://staging.example";</script>
 * (This file is loaded directly by the browser, so no process.env here.)
 */
window.QUANT_TERMINAL = {
  url: window.QUANT_TERMINAL_URL || "https://learningfundclear-daemon.onrender.com",
  proxy: "/quant-terminal",
};
