/*!
 * LearningFundClear - shared sign-in gate
 * ========================================
 *
 * One small script, three jobs:
 *
 * 1. On the journal (index.html) and the sign-in page (signin.html): report whether a
 *    recent sign-in is known locally, and provide stamp()/clear() to manage it.
 *
 * 2. On every fund page (funds/*.html): bounce visitors without that local sign-in flag
 *    to signin.html?next=<this page>. The fund pages run under a strict CSP with
 *    connect-src 'none' - they cannot phone Supabase - so the gate is the same flag the
 *    sign-in page wrote after verifying the session. clearing it on sign-out keeps the
 *    two in step.
 *
 * 3. Session handoff: the ?next= target is only honoured if it stays on this site,
 *    so the redirect can never be abused to bounce someone to another domain.
 *
 * The flag is convenience, not cryptographic truth. Anyone can draw it in a console -
 * but all they unlock is the static fund pages, whose data comes from AMFI's public
 * file. The journal's real secrets stay behind Supabase RLS, which checks the session
 * on every request and knows nothing about this flag.
 */
(function (global) {
  "use strict";

  var KEY = "lfc.auth";
  var MAX_AGE_MS = 12 * 60 * 60 * 1000; // re-verify at least every 12 hours

  function read() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (!rec || !rec.u || typeof rec.t !== "number") return null;
      if (Date.now() - rec.t > MAX_AGE_MS) return null;
      return rec;
    } catch (e) {
      return null;
    }
  }

  function write(rec) {
    try {
      rec.t = Date.now();
      global.localStorage.setItem(KEY, JSON.stringify(rec));
    } catch (e) { /* storage unavailable - gate simply stays closed */ }
  }

  function clear() {
    try { global.localStorage.removeItem(KEY); } catch (e) {}
  }

  function isJournalPage() {
    return !/\/funds\//.test(global.location.pathname);
  }

  function onGatePage() {
    return /\/signin\.html$/.test(global.location.pathname);
  }

  function sameOriginTarget(url) {
    try {
      var u = new URL(url, global.location.href);
      // only ever bounce back to something on this site
      if (u.origin !== global.location.origin) return null;
      return u.pathname + u.search + u.hash;
    } catch (e) {
      return null;
    }
  }

  function guard() {
    var rec = read();
    if (rec) return rec;
    var path = global.location.pathname;
    var parts = path.split("/").filter(Boolean);
    // where to return after signing in, and where the sign-in page lives from here
    var here = isJournalPage()
      ? (path.slice(-1) === "/" ? "index.html" : parts[parts.length - 1])
      : parts.slice(-2).join("/");
    var prefix = isJournalPage() ? "" : "../";
    var target = sameOriginTarget(prefix + "signin.html?next=" + encodeURIComponent(here));
    global.location.replace(target || prefix + "signin.html");
    return null;
  }

  var API = {
    current: read,
    stamp: write,
    clear: clear,
    /** Journal pages: run fn only with a locally-known session; else go to sign-in. */
    require: function (fn) { return guard() && fn && fn(); },
    /** Fund pages: call once on load; redirects when no local session is known. */
    guard: guard,
  };

  global.LfcAuth = API;

  // Auto-gate on fund pages (they include this script and do nothing else).
  if (!isJournalPage() && !onGatePage()) guard();
})(window);
