/** Single source of truth for the Quant terminal failure-status wording.

Both the iframe-probe path (proxyMessage) and the terminal-ticket path
(ticketMessage) are rendering the same class of problem — the daemon is not
answering in a usable way — with slightly different voices. Keep them both
inside one module so a wording change is one edit, not two, and so the test
that asserts they never fork is a comparison of two functions in the same
file instead of a cross-file copy check.
 */
(function () {
  "use strict";

  // ticketMessage --------------------------------------------------- terminal-ticket path
  // POST /api/terminal-ticket (server/terminal-gate.mjs). We render the HTTP
  // status we received back from the Worker; 0 means the fetch itself failed.
  function ticketMessage(status) {
    switch (status) {
      case 401:
        return "Terminal ticket rejected (401) — sign in again";
      case 404:
        return "Terminal ticket route missing (404) — deploy the Worker route";
      case 503:
        return "Terminal ticket check unavailable (503) — Supabase could not verify the session";
      default:
        if (status === 0) return "Terminal ticket request failed (network)";
        return "Terminal ticket failed (HTTP " + status + ")";
    }
  }

  // proxyMessage --------------------------------------------------- iframe-probe path
  // GET /api/v1/health through the same-origin gate. 0 means the request failed
  // outright (DNS / tunnel / network); everything else is the real status the
  // gate forwarded from the daemon.
  function proxyMessage(status) {
    switch (status) {
      case 502:
        return "Terminal proxy failed (502) — daemon or tunnel unreachable";
      case 503:
        return "Terminal proxy unavailable (503) — daemon not ready";
      case 504:
        return "Terminal proxy timed out (504)";
      case 404:
        return "Terminal proxy route missing (404)";
      default:
        if (status === 0) return "Terminal proxy unreachable (network)";
        return "Terminal proxy failed (HTTP " + status + ")";
    }
  }

  // Public API -----------------------------------------------------------------
  // Re-export the two functions for the embed modules. The dashboard embed
  // (assets/js/quant-embed.js) and the standalone page (quant-desk.html inline
  // script) both include this module verbatim, so they always share one copy.
  if (typeof window !== "undefined") {
    window.QUANT_TERMINAL_MESSAGES = { ticketMessage, proxyMessage };
  }

  // When imported as an ES module, export the same two functions.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { ticketMessage, proxyMessage };
  }
})();
