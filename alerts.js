/*
 * alerts.js — target / stop-hit alerts for the Learning New Things portal.
 *
 * Consumption: setIdeas(ideasArray) whenever the page (re)loads ideas; quote
 * events drive evaluation. An alert fires when live LTP crosses a recorded
 * target or stop LEVEL, then re-arms only after price retreats back through a
 * hysteresis band (0.15%), so a hovering price can't spam repeats.
 * Each idea fires at most once per calendar day (IST) even across reloads.
 *
 * UI: toasts bottom-right, soft row/card highlight, a bell chip in the header
 * with unread count, and a click-to-view list of today's alerts. Mute toggle
 * persists in localStorage.
 *
 * Exposes window.Alerts = { setIdeas, processQuotes, toggleMute, muted, recent }
 */
(function () {
  "use strict";

  var LS_MUTE = "lnt_alerts_muted";
  var LS_FIRED = "lnt_alerts_fired";       // { "ideaId:KIND": "2026-09-25" }
  var HYSTERESIS = 0.0015;                  // 0.15% retreat required to re-arm

  var ideas = [];                           // open ideas with levels
  var armed = {};                           // "ideaId:KIND" -> true (currently armed)
  var fired = readFired();
  var recent = [];                          // { ticker, kind, price, at }
  var unread = 0;
  var muted = localStorage.getItem(LS_MUTE) === "1";
  var bell = null, toastHost = null;

  function readFired() {
    try { return JSON.parse(localStorage.getItem(LS_FIRED) || "{}"); }
    catch (e) { return {}; }
  }
  function todayIST() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  }
  function pruneFired() {
    var t = todayIST(), dirty = false;
    Object.keys(fired).forEach(function (k) {
      if (fired[k] !== t) { delete fired[k]; dirty = true; }
    });
    if (dirty) localStorage.setItem(LS_FIRED, JSON.stringify(fired));
  }

  function ensureBell() {
    if (bell) return bell;
    bell = document.createElement("button");
    bell.id = "alertBell";
    bell.className = "ghost";
    bell.style.cssText = "font-size:11px;padding:6px 10px;border-radius:8px;cursor:pointer;" +
      "border:1px solid #1f2937;background:transparent;color:#9ca3af;font-weight:600";
    bell.addEventListener("click", function () { unread = 0; paintBell(); showRecent(); });
    var mount = document.querySelector(".userbar") || document.querySelector("header");
    if (mount) mount.appendChild(bell);
    paintBell();
    return bell;
  }
  function paintBell() {
    if (!bell) return;
    bell.textContent = (muted ? "🔕" : "🔔") + (unread ? " " + unread : "") + " Alerts";
    bell.style.color = unread ? "#facc15" : "#9ca3af";
  }

  function toast(msg, color) {
    if (!toastHost) {
      toastHost = document.createElement("div");
      toastHost.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99;display:grid;gap:8px";
      document.body.appendChild(toastHost);
    }
    var t = document.createElement("div");
    t.style.cssText = "background:#111827;border:1px solid " + (color || "#34d399") +
      ";color:#e5e7eb;padding:12px 14px;border-radius:10px;font-size:13px;max-width:320px;" +
      "box-shadow:0 8px 24px rgba(0,0,0,.5)";
    t.innerHTML = msg;
    toastHost.appendChild(t);
    setTimeout(function () { t.remove(); }, 12000);
  }

  function beep() {
    if (muted) return;
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; g.gain.value = 0.06;
      o.start();
      setTimeout(function () { o.stop(); ctx.close(); }, 250);
    } catch (e) { /* autoplay blocked until user gesture; fine */ }
  }

  function markRow(ideaId, kind) {
    var color = kind === "TARGET_HIT" ? "var(--green)" : "var(--red)";
    document.querySelectorAll('[data-idea-id="' + ideaId + '"]').forEach(function (el) {
      el.style.boxShadow = "inset 3px 0 0 " + color;
      el.style.background = "rgba(250,204,21,.05)";
    });
  }

  function fire(idea, kind, price) {
    fired[idea.id + ":" + kind] = todayIST();
    localStorage.setItem(LS_FIRED, JSON.stringify(fired));
    armed[idea.id + ":" + kind] = false;             // wait for retreat before re-arm
    recent.unshift({ ticker: idea.ticker, kind: kind, price: price, at: new Date() });
    recent = recent.slice(0, 20);
    unread++;
    paintBell();
    var color = kind === "TARGET_HIT" ? "#34d399" : "#f87171";
    var label = kind === "TARGET_HIT" ? "🎯 Target hit" : "🛑 Stop hit";
    toast("<b>" + label + " — " + idea.ticker + "</b><br>LTP ₹" +
      Number(price).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
      (idea.target != null && kind === "TARGET_HIT" ? " · level ₹" + idea.target : "") +
      (idea.stop != null && kind === "STOP_HIT" ? " · level ₹" + idea.stop : ""), color);
    beep();
    markRow(idea.id, kind);
  }

  function evaluate(idea, ltp) {
    ["TARGET_HIT", "STOP_HIT"].forEach(function (kind) {
      var key = idea.id + ":" + kind;
      var level = kind === "TARGET_HIT" ? idea.target : idea.stop;
      if (level == null || idea.status === "CLOSED") return;
      level = Number(level);
      var crossed = kind === "TARGET_HIT" ? ltp >= level : ltp <= level;
      var keyToday = fired[key] === todayIST();
      // Cross while armed (or on first sight — the page just opened, so the user
      // was not watching earlier and deserves the alert) and not already fired today.
      if (crossed && armed[key] !== false && !keyToday) {
        fire(idea, kind, ltp);
      } else if (!crossed) {
        // require retreat beyond hysteresis before the level can trigger again
        var retreat = kind === "TARGET_HIT"
          ? ltp < level * (1 - HYSTERESIS)
          : ltp > level * (1 + HYSTERESIS);
        if (retreat) armed[key] = true;
      }
    });
  }

  // ---------- public ----------
  function setIdeas(arr) {
    ideas = (arr || []).filter(function (x) { return x && x.id; });
    pruneFired();
  }

  function processQuotes(quotes) {
    if (!quotes || !ideas.length) return;
    ideas.forEach(function (idea) {
      var q = quotes[(idea.ticker || "").toUpperCase()];
      if (q && q.ltp != null) evaluate(idea, q.ltp);
    });
  }

  function toggleMute() {
    muted = !muted;
    localStorage.setItem(LS_MUTE, muted ? "1" : "0");
    paintBell();
  }

  function showRecent() {
    var html = recent.length
      ? recent.map(function (r) {
          var c = r.kind === "TARGET_HIT" ? "var(--green)" : "var(--red)";
          return "<div style='margin:4px 0'><b style='color:" + c + "'>" +
            (r.kind === "TARGET_HIT" ? "🎯" : "🛑") + " " + r.ticker + "</b> · ₹" +
            Number(r.price).toLocaleString("en-IN") + " · " +
            r.at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) + "</div>";
        }).join("")
      : "<div style='color:#9ca3af'>No alerts yet today. Alerts fire while the page is open and prices stream.</div>";
    toast("<b>Recent alerts</b><br>" + html, "#a78bfa");
  }

  function init(getIdeas) {
    ensureBell();
    if (typeof getIdeas === "function") setIdeas(getIdeas());
  }

  window.Alerts = {
    init: init,
    setIdeas: setIdeas,
    processQuotes: processQuotes,
    toggleMute: toggleMute,
    muted: function () { return muted; },
    recent: function () { return recent; }
  };
})();
