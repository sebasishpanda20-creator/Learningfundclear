/* Quant Terminal embed for authenticated pages.
 *
 * Renders the execution-terminal frame (the same widget quant-desk.html shows)
 * into any page's [data-quant-embed] host. The daemon URL is defined once in
 * assets/js/quant-config.js (window.QUANT_TERMINAL); this module only reads it.
 *
 * Signing-in gating: the iframe is initialized ONLY after LfcAuth verifies a
 * session — the frame sits on about:blank until then, so a signed-out visitor
 * (who auth-guard.js is already redirecting) never loads the daemon page.
 *
 * An iframe's load event also fires for the browser's error page, so it cannot
 * tell "terminal up" from "host unreachable". The health endpoint is probed
 * with a no-cors request instead: no CORS headers needed, rejects offline.
 */
(function () {
  "use strict";

  function initEmbed() {
    var root = document.querySelector("[data-quant-embed]");
    if (!root) return;

    var cfg = window.QUANT_TERMINAL || {};
    var base = String(cfg.url || "").trim().replace(/\/+$/, "");
    // Same-origin mirror path on this Pages project (see functions/quant-terminal).
    // Falls back to the raw daemon origin when no proxy path is configured.
    var frameBase = String(cfg.proxy || "").trim().replace(/\/+$/, "");
    if (!frameBase) frameBase = base;
    var frame = root.querySelector(".quant-frame");
    var status = root.querySelector(".quant-status");
    var open = root.querySelector("[data-quant-open]");
    var reload = root.querySelector("[data-quant-reload]");
    var fallback = root.querySelector(".quant-fallback");
    if (!frame || !status) return;

    if (!frameBase) {
      if (fallback) fallback.hidden = false;
      frame.hidden = true;
      status.textContent = "Not configured";
      status.dataset.state = "offline";
      if (open) open.hidden = true;
      if (reload) reload.hidden = true;
      return;
    }

    var host = "";
    try { host = new URL(base).host; } catch (e) { host = base; }
    var origin = root.querySelector("[data-quant-origin]");
    if (origin) origin.textContent = host;
    if (open) open.href = base + "/";

    function probe() {
      var controller = window.AbortController ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 6000) : null;
      return fetch(frameBase + "/api/v1/health", {
        mode: "no-cors",
        cache: "no-store",
        signal: controller ? controller.signal : undefined,
      }).then(function () { return true; }).catch(function () { return false; }).then(function (ok) {
        if (timer) clearTimeout(timer);
        return ok;
      });
    }

    function load() {
      status.textContent = "Connecting…";
      status.dataset.state = "pending";
      frame.src = frameBase + "/";
      probe().then(function (ok) {
        status.textContent = ok ? "Terminal online" : "Terminal unreachable";
        status.dataset.state = ok ? "online" : "offline";
      });
    }

    frame.addEventListener("load", function () {
      if (!frame.src || frame.src === "about:blank") return;
      probe().then(function (ok) {
        status.textContent = ok ? "Terminal online" : "Terminal unreachable";
        status.dataset.state = ok ? "online" : "offline";
      });
    });

    if (reload) reload.addEventListener("click", load);

    // Initialize on demand so the first paint after sign-in shows Connecting…
    load();
  }

  function start() {
    if (window.LfcAuth && window.LfcAuth.ready) {
      window.LfcAuth.ready.then(function (user) {
        if (user) initEmbed();
      });
    } else {
      initEmbed();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
