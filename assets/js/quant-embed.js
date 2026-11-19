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
 * through the gated same-origin path so the response status is readable: only
 * a 200 counts as online, since a no-cors ping resolves for 401/403/5xx too.
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
    var gated = !!frameBase;
    var POLL_MS = 30000;
    if (!frameBase) frameBase = base;
    var frame = root.querySelector(".quant-frame");
    var status = root.querySelector(".quant-status");
    var open = root.querySelector("[data-quant-open]");
    var reload = root.querySelector("[data-quant-reload]");
    var fallback = root.querySelector(".quant-fallback");
    if (!frame || !status) return;

    if (window.__LFC_QA_PREVIEW__ === true) {
      status.textContent = "Terminal unavailable in this preview";
      status.dataset.state = "offline";
      if (frame.parentNode) frame.parentNode.hidden = true;
      if (open) open.hidden = true;
      if (reload) reload.hidden = true;
      if (fallback) {
        fallback.hidden = false;
        fallback.setAttribute("role", "status");
        fallback.innerHTML = "<p><strong>Terminal unavailable in this preview.</strong> The local QA preview serves static files and fixtures, not the portal Worker or the quant daemon, so no terminal iframe is loaded here.</p>";
      }
      return;
    }

    if (!frameBase) {
      if (fallback) fallback.hidden = false;
      frame.hidden = true;
      status.textContent = "Not configured";
      status.dataset.state = "offline";
      if (open) open.hidden = true;
      if (reload) reload.hidden = true;
      return;
    }

    // Freshness marker. The pill reports the last probe result; this says when
    // that result was taken, so a stale "Terminal online" is visible instead of
    // silently ageing while the tunnel dies behind it.
    var stamped = document.createElement("span");
    stamped.className = "quant-checked";
    stamped.style.cssText = "margin-left:6px;opacity:.65;font-size:.85em;white-space:nowrap";
    if (status.parentNode) status.parentNode.insertBefore(stamped, status.nextSibling);

    function noteCheck() {
      var at = new Date();
      var time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      stamped.textContent = "· checked " + time;
      status.title = "Last checked " + at.toLocaleString() + ". Re-probed every " + Math.round(POLL_MS / 1000) + " s.";
    }

    // Stamp every probe result, including the sign-in 401, so the time shown
    // always matches the last request actually made.
    function probe() {
      return probeOnce().then(function (result) {
        noteCheck();
        return result;
      });
    }

    var host = "";
    try { host = new URL(base).host; } catch (e) { host = base; }
    var origin = root.querySelector("[data-quant-origin]");
    if (origin) origin.textContent = host;
    // Point the new tab at the same gated path as the frame, so it carries the
    // terminal cookie instead of hitting the raw daemon origin directly.
    if (open) open.href = frameBase + "/";

    function probeOnce() {
      // Through the gate the request is same-origin, so the real status code is
      // readable: 200 means the daemon answered, while the gate's 401 (no cookie
      // yet) or a 5xx from an unreachable tunnel does not. A no-cors probe
      // resolves for ANY status, which is how this panel used to claim
      // "Terminal online" with the daemon or its tunnel down.
      var request = gated
        ? fetch(frameBase + "/api/v1/health", {
            cache: "no-store",
            credentials: "same-origin",
          }).then(function (response) { return { ok: response.ok, unauthorized: response.status === 401, status: response.status }; })
        : fetch(frameBase + "/api/v1/health", {
            mode: "no-cors",
            cache: "no-store",
          }).then(function () { return { ok: true, unauthorized: false, status: 0 }; });
      return request.catch(function () { return { ok: false, unauthorized: false, status: 0 }; });
    }

    // The worker serves the terminal only to a signed-in session. Hand it the
    // Supabase access token once per page load and it replies with a short-lived
    // HttpOnly cookie scoped to the terminal path; the frame must be pointed at
    // the terminal only after that cookie exists.
    function ticketMessage(status) {
      return window.QUANT_TERMINAL_MESSAGES.ticketMessage(status);
    }

    function proxyMessage(status) {
      return window.QUANT_TERMINAL_MESSAGES.proxyMessage(status);
    }

    function authorize() {
      var auth = window.LfcAuth;
      if (!gated) return Promise.resolve({ ok: true, status: 200 });
      if (!auth || !auth.client || !auth.client.auth) {
        return Promise.resolve({ ok: false, status: 0, message: "Portal session unavailable — sign in again" });
      }
      return auth.client.auth
        .getSession()
        .then(function (result) {
          var session = result && result.data && result.data.session;
          if (!session || !session.access_token) {
            return { ok: false, status: 0, message: "No portal session — sign in again" };
          }
          return fetch("/api/terminal-ticket", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { Authorization: "Bearer " + session.access_token },
          }).then(function (response) {
            return { ok: response.ok, status: response.status, message: response.ok ? "" : ticketMessage(response.status) };
          });
        })
        .catch(function () {
          return { ok: false, status: 0, message: "Terminal ticket request failed (network)" };
        });
    }

    var authorized = false;

    var lastOk = null;

    // A frame parked on the browser's error page never recovers by itself: once
    // a probe says the daemon is back, point it at the terminal again so the
    // panel stops showing the dead page and nobody has to press Reload.
    function reloadFrame() {
      if (!frame || !frameBase) return;
      frame.src = frameBase + "/?_r=" + Date.now();
    }

    function showReachability(result) {
      if (!authorized) return;
      if (result.unauthorized) {
        status.textContent = "Terminal session rejected (401) — sign in again";
        status.dataset.state = "offline";
        return;
      }
      var wasDown = lastOk === false;
      lastOk = !!result.ok;
      status.textContent = result.ok ? "Terminal online" : proxyMessage(result.status);
      status.dataset.state = result.ok ? "online" : "offline";
      if (result.ok && wasDown) reloadFrame();
    }

    function showTicketFailure(ticket) {
      status.textContent = ticket.message || ticketMessage(ticket.status);
      status.dataset.state = "offline";
    }

    function load() {
      status.textContent = "Connecting…";
      status.dataset.state = "pending";
      authorize().then(function (ticket) {
        authorized = ticket.ok;
        if (!authorized) showTicketFailure(ticket);
        frame.src = frameBase + "/";
        return probe().then(showReachability);
      });
    }

    frame.addEventListener("load", function () {
      if (!frame.src || frame.src === "about:blank") return;
      probe().then(showReachability);
    });

    // Keep the pill honest after the page has loaded. Without this the panel
    // keeps saying "Terminal online" until someone presses Reload, even if the
    // daemon or its tunnel died a minute later.
    function poll() {
      probe().then(function (result) {
        if (!result.unauthorized) { showReachability(result); return; }
        // The terminal cookie is short-lived; try a fresh ticket before calling
        // this an outage, because the dashboard session itself may still be fine.
        authorize().then(function (ticket) {
          if (!ticket.ok) { showTicketFailure(ticket); return; }
          probe().then(showReachability);
        });
      });
    }
    window.setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) poll();
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
