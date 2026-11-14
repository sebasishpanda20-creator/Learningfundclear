/* ---------------------------------------------------------------------------
   MOBILE-FIRST-RELEASE-CRITERIA.md — shared behaviour layer.

   Plain script (no modules), safe on every page: every entry point no-ops when
   its target markup is absent. Exposes window.LfcMobile.
   --------------------------------------------------------------------------- */
(function () {
  "use strict";

  var root = document.documentElement;
  var Lfc = (window.LfcMobile = window.LfcMobile || {});

  /* ---------------------------------------------------------------- MF-13 */
  var motionQuery =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  function syncMotion() {
    root.classList.toggle("mf-reduced-motion", !!(motionQuery && motionQuery.matches));
  }
  syncMotion();
  if (motionQuery) {
    if (motionQuery.addEventListener) motionQuery.addEventListener("change", syncMotion);
    else if (motionQuery.addListener) motionQuery.addListener(syncMotion);
  }
  Lfc.reducedMotion = function () {
    return !!(motionQuery && motionQuery.matches);
  };

  // Pause decorative animation while the tab is hidden.
  document.addEventListener("visibilitychange", function () {
    root.classList.toggle("mf-hidden", document.hidden);
    if (!document.hidden) return;
    document.getAnimations?.().forEach(function (a) {
      if (a.playState === "running") a.pause();
    });
  });

  /* ----------------------------------------------------------------- MF-3 */
  Lfc.tapTarget = 44;

  /* ---------------------------------------------------------------- MF-12 */
  // Publish the height of fixed/sticky chrome so CSS can reserve the space.
  function measureChrome() {
    var top = 0;
    var bottom = 0;
    document.querySelectorAll('[data-mf-chrome="top"], .topbar').forEach(function (el) {
      if (!el || el.offsetParent === null) return;
      var pos = getComputedStyle(el).position;
      if (pos === "fixed" || pos === "sticky") {
        top = Math.max(top, el.getBoundingClientRect().height);
      }
    });
    document.querySelectorAll('[data-mf-chrome="bottom"], .mf-fixed-bottom').forEach(function (el) {
      if (!el || el.offsetParent === null) return;
      var pos = getComputedStyle(el).position;
      if (pos === "fixed" || pos === "sticky") {
        bottom = Math.max(bottom, el.getBoundingClientRect().height);
      }
    });
    root.style.setProperty("--mf-sticky-top", Math.round(top) + "px");
    root.style.setProperty("--mf-sticky-bottom", Math.round(bottom) + "px");
    return { top: top, bottom: bottom };
  }
  Lfc.measureChrome = measureChrome;

  /* ---------------------------------------------------------------- MF-11 */
  // On-screen keyboard: shrink-aware height plus keep the focused field clear.
  var vv = window.visualViewport;
  function syncViewport() {
    if (!vv) return;
    var kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty("--mf-keyboard", Math.round(kb) + "px");
    root.classList.toggle("mf-keyboard-open", kb > 120);
  }
  if (vv) {
    vv.addEventListener("resize", syncViewport);
    vv.addEventListener("scroll", syncViewport);
    syncViewport();
  }

  document.addEventListener(
    "focusin",
    function (e) {
      var el = e.target;
      if (!el || !el.matches || !el.matches("input, select, textarea, [contenteditable]")) return;
      // Let the keyboard finish animating, then bring the field into view. The
      // check runs on the real geometry, so it also covers browsers that shrink
      // the layout viewport instead of the visual one and never fire a
      // visualViewport resize.
      window.setTimeout(function () {
        var vv = window.visualViewport;
        var top = vv ? vv.offsetTop : 0;
        var bottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
        var r = el.getBoundingClientRect();
        if (r.top >= top + 8 && r.bottom <= bottom - 8) return;
        try {
          // "instant" so a smooth-scroll preference cannot leave the field
          // half-visible while the user is already typing.
          el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
        } catch (_) {}
      }, 250);
    },
    true,
  );

  /* ---------------------------------------------------------------- MF-14 */
  // Debounced width-change notification: one event per completed resize, and
  // only when the width actually changed (rotation, breakpoint crossing).
  var lastWidth = window.innerWidth;
  var widthTimer = null;
  function emitWidthChange(reason) {
    var width = window.innerWidth;
    if (width === lastWidth && reason === "resize") return;
    lastWidth = width;
    window.dispatchEvent(
      new CustomEvent("mf:widthchange", { detail: { width: width, reason: reason } }),
    );
  }
  window.addEventListener("resize", function () {
    window.clearTimeout(widthTimer);
    widthTimer = window.setTimeout(function () {
      emitWidthChange("resize");
    }, 150);
  });
  window.addEventListener("orientationchange", function () {
    window.clearTimeout(widthTimer);
    widthTimer = window.setTimeout(function () {
      lastWidth = -1; // force the notification even if the width rounds the same
      emitWidthChange("orientation");
    }, 250);
  });
  Lfc.onWidthChange = function (fn) {
    window.addEventListener("mf:widthchange", function (e) {
      fn(e.detail);
    });
  };

  // Single-flight fetch: rotation/navigation cannot start a second copy while
  // one is in flight, and a completed result is reused for the same tick.
  var inflight = new Map();
  Lfc.once = function (key, factory) {
    if (inflight.has(key)) return inflight.get(key);
    var p = Promise.resolve()
      .then(factory)
      .finally(function () {
        inflight.delete(key);
      });
    inflight.set(key, p);
    return p;
  };
  Lfc.isBusy = function (key) {
    return inflight.has(key);
  };

  /* ----------------------------------------------------------------- MF-9 */
  // Page-scoped state that survives back/forward and reloads.
  var PREFIX = "lfc.mf:";
  Lfc.remember = function (key, value) {
    try {
      sessionStorage.setItem(PREFIX + location.pathname + ":" + key, JSON.stringify(value));
    } catch (_) {}
  };
  Lfc.recall = function (key, fallback) {
    try {
      var raw = sessionStorage.getItem(PREFIX + location.pathname + ":" + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  };
  Lfc.forget = function (key) {
    try {
      sessionStorage.removeItem(PREFIX + location.pathname + ":" + key);
    } catch (_) {}
  };

  /* ---------------------------------------------------------------- MF-10 */
  // Focus-managed sheet/modal. Markup:
  //   <div class="mf-sheet" data-mf-sheet hidden role="dialog" aria-modal="true">
  // The opener is recorded so focus can be returned on close.
  var openStack = [];

  function focusables(container) {
    return Array.prototype.filter.call(
      container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ),
      function (el) {
        return el.offsetParent !== null || el === document.activeElement;
      },
    );
  }

  function lockScroll(on) {
    document.body.classList.toggle("mf-locked", on);
  }

  Lfc.openSheet = function (sheet, opener) {
    if (!sheet) return null;
    if (sheet.dataset.mfOpen === "true") return sheet;
    sheet.hidden = false;
    sheet.dataset.mfOpen = "true";
    var entry = {
      sheet: sheet,
      opener: opener || document.activeElement,
      scrollY: window.scrollY,
    };
    openStack.push(entry);
    lockScroll(true);
    var target = sheet.querySelector("[autofocus]") || focusables(sheet)[0] || sheet;
    if (target === sheet && !sheet.hasAttribute("tabindex")) sheet.tabIndex = -1;
    target.focus();
    return sheet;
  };

  Lfc.closeSheet = function (sheet) {
    if (!openStack.length) return;
    // Closing the top sheet by reference must pop it too, otherwise the stack
    // keeps a hidden entry and a later Escape restores stale focus.
    var idx = sheet
      ? openStack.findIndex(function (x) {
          return x.sheet === sheet;
        })
      : openStack.length - 1;
    if (idx < 0) return;
    var entry = openStack[idx];
    openStack.splice(idx, 1);
    entry.sheet.dataset.mfOpen = "false";
    entry.sheet.hidden = true;
    if (!openStack.length) lockScroll(false);
    if (entry.opener && typeof entry.opener.focus === "function" && document.contains(entry.opener)) {
      entry.opener.focus();
    }
    return entry.sheet;
  };

  Lfc.isSheetOpen = function () {
    return openStack.length > 0;
  };

  document.addEventListener("keydown", function (e) {
    var entry = openStack[openStack.length - 1];
    if (!entry) return;
    if (e.key === "Escape") {
      e.preventDefault();
      Lfc.closeSheet();
      return;
    }
    if (e.key !== "Tab") return;
    var list = focusables(entry.sheet);
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // Clicking the backdrop closes; any [data-mf-close] closes its sheet.
  document.addEventListener("click", function (e) {
    var closer = e.target.closest && e.target.closest("[data-mf-close]");
    if (closer) {
      var host = closer.closest("[data-mf-sheet]");
      e.preventDefault();
      Lfc.closeSheet(host || undefined);
      return;
    }
    if (e.target.classList && e.target.classList.contains("mf-sheet-backdrop")) {
      Lfc.closeSheet();
    }
  });

  /* ----------------------------------------------------------------- MF-4 */
  // Touch/hover capability flags for CSS and page scripts.
  var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)");
  function syncInput() {
    root.classList.toggle("mf-touch", !!(coarse && coarse.matches));
  }
  syncInput();
  if (coarse) {
    if (coarse.addEventListener) coarse.addEventListener("change", syncInput);
    else if (coarse.addListener) coarse.addListener(syncInput);
  }

  // A control whose only label is a title= is unusable on touch: give it an
  // accessible name so screen readers and tap-and-hold both reach it. MF-4/5.
  function labelTitleOnly() {
    document.querySelectorAll("[title]").forEach(function (el) {
      if (el.hasAttribute("aria-label") || el.textContent.trim()) return;
      el.setAttribute("aria-label", el.getAttribute("title"));
    });
  }

  /* ------------------------------------------------------------------ init */
  function init() {
    measureChrome();
    labelTitleOnly();
    // Fill data-label from the table header so .mf-stack can show field names.
    document.querySelectorAll("table.mf-stack").forEach(function (table) {
      var head = Array.prototype.map.call(
        table.querySelectorAll("thead th"),
        function (th) {
          return th.textContent.trim();
        },
      );
      table.querySelectorAll("tbody tr").forEach(function (tr) {
        Array.prototype.forEach.call(tr.children, function (cell, i) {
          if (i > 0 && head[i] && !cell.hasAttribute("data-label")) {
            cell.setAttribute("data-label", head[i]);
          }
        });
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Re-measure chrome once web fonts settle; the reserve would otherwise be a
  // few pixels short and hide the last row behind the bar. MF-12.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(measureChrome).catch(function () {});
  }
  window.addEventListener("load", measureChrome);
})();
