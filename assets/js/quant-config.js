/* Quant Desk embedding configuration.
 *
 * The daemon serves its own UI, so the desk frames it. Two settings:
 *
 *   url   — the daemon's public HTTPS origin. Used for display and the
 *           "open in new tab" link. Current value: ngrok's free-tier
 *           reserved domain (permanent hostname, free, no card), which
 *           front-runs the laptop daemon.
 *   proxy — a PATH on THIS Pages origin (see functions/quant-terminal/ and
 *           functions/api/v1/) that mirrors the daemon. The iframe and its
 *           fetches go through it so the browser stays same-origin: no ngrok
 *           splash inside the frame, no CORS, and the daemon origin can
 *           change later without touching the embed code again.
 */
window.QUANT_TERMINAL = {
  url: "https://treat-eradicate-spendable.ngrok-free.dev",
  proxy: "/quant-terminal",
};
