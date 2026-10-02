// ── LearningFundClear theme toggle ─────────────────────────────────────────
// Light is the production default. Darkness is an explicitly opt-in layer.
// Persistence: localStorage["lfc.theme"] (values: "light" | "dark").
// New users ALWAYS start in LIGHT. Dark is only activated after the user
// explicitly chooses it (or restores an existing saved "dark" preference).
(function () {
  "use strict";
  var STORAGE_KEY = "lfc.theme";
  function getStored() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function setStored(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
  }
  // New users (or users with no saved preference) are LIGHT. Only an explicit
  // saved "dark" value is honoured — never the OS preference.
  function getPreferredDark() {
    var stored = getStored();
    if (stored === "dark") return true;
    if (stored === "light") return false;
    return false; // force LIGHT for brand-new users
  }
  function applyTheme(dark) {
    var root = document.documentElement;
    if (dark) root.classList.add("theme-dark"); else root.classList.remove("theme-dark");
  }
  function syncToggleButton() {
    var btn = document.querySelector("[data-lfc-theme-toggle]");
    if (!btn) return;
    var isDark = document.documentElement.classList.contains("theme-dark");
    btn.setAttribute("aria-pressed", isDark ? "true" : "false");
    btn.textContent = isDark ? "☀️ Light" : "🌙 Dark";
  }
  function init() {
    var prefersDark = getPreferredDark();
    applyTheme(prefersDark);
    syncToggleButton();
    var btn = document.querySelector("[data-lfc-theme-toggle]");
    if (btn) {
      btn.addEventListener("click", function () {
        var nowDark = !document.documentElement.classList.contains("theme-dark");
        applyTheme(nowDark);
        setStored(nowDark ? "dark" : "light");
        syncToggleButton();
      });
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
