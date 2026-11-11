/*!
 * LearningFundClear - canonical authenticated app shell (JS)
 * =====================================================================
 * One shared shell for every authenticated journal page (index, performance,
 * scanner, setups, gex). The shell owns:
 *
 *   1. The canonical primary navigation bar (dashboard | performance | funds |
 *      scanner | setups | gex | admin) with correct active-tab marking.
 *   2. The shared header brand and user display.
 *   3. Theme toggle (panels with data-lfc-theme-toggle).
 *   4. Logout contract, standardised on every page:
 *        - disable the Logout button while running
 *        - window.LfcAuth.clear()
 *        - await sb.auth.signOut() (where this page has a Supabase client)
 *        - location.replace("signin.html")
 *   5. Mobile navigation: below 880px the full nav collapses; clicking a nav
 *      item navigates while keeping the header compact.
 *
 * Pages must:
 *   - include this script AFTER auth-guard.js (auth-guard.js resolves first so
 *     the shell does not flash unauthenticated content)
 *   - set data-page="<canonical key>" on <html> for the active-tab test
 *   - keep their own page-specific content inside <main class="app-shell">
 *
 * Canonical nav keys (no dash / perf aliases anymore):
 *   dashboard | performance | funds | scanner | setups | gex | admin
 * ─────────────────────────────────────────────────────────────────────────── */
"use strict";

(function () {
  const ROOT = window.__LFC_ROOT__ || "";

  // Canonical primary nav keys. Admin is NOT a nav key; it is a hidden button
  // wired separately by the page itself.
  const NAV_KEYS = ["dashboard", "performance", "funds", "scanner", "setups", "gex"];

  const $ = (id) => document.getElementById(id);
  const html = document.documentElement;
  const main = document.querySelector("main.app-shell") || document.querySelector("main");

  // --- Mobile menu ----------------------------------------------------------
  let mobileOpen = false;
  const mobileBtn = document.getElementById("mobileMenuBtn");
  const mobileMenu = document.getElementById("mobileNav");

  function openMobile() {
    if (!mobileMenu) return;
    mobileOpen = true;
    mobileMenu.classList.remove("hidden");
    document.querySelectorAll("[data-nav]").forEach((b) => (b.style.display = "none"));
    if (mobileBtn) mobileBtn.setAttribute("aria-expanded", "true");
  }

  function closeMobile() {
    if (!mobileMenu) return;
    mobileOpen = false;
    mobileMenu.classList.add("hidden");
    document.querySelectorAll("[data-nav]").forEach((b) => (b.style.display = ""));
    if (mobileBtn) mobileBtn.setAttribute("aria-expanded", "false");
  }

  function toggleMobile() {
    if (mobileOpen) closeMobile(); else openMobile();
  }

  if (mobileBtn && mobileMenu) {
    mobileBtn.addEventListener("click", toggleMobile);
    // Close on a nav click inside the menu (keep it compact).
    mobileMenu.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-nav]");
      if (nav) closeMobile();
    });
  }

  // --- Active-tab wiring ---------------------------------------------------
  function setActiveNav(page) {
    document.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.nav === page);
    });
  }

  // --- Logout contract (canonical) ------------------------------------------
  const logoutBtn = $("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true;
      logoutBtn.classList.add("logging-out");
      try {
        if (window.LfcAuth) LfcAuth.clear();
        if (window.sb && typeof window.sb.auth?.signOut === "function") {
          await window.sb.auth.signOut();
        }
      } catch (err) {
        console.error("Logout error:", err);
      } finally {
        // clean login-only state; Back must not restore the private page
        window.location.replace("signin.html");
      }
    });
  }

  // --- Theme toggle wiring (pages own the button; shell keeps behaviour) ----
  const themeBtns = document.querySelectorAll("[data-lfc-theme-toggle]");
  themeBtns.forEach((btn) => {
    if (btn.dataset.lfcThemeWired === "1") return;
    btn.dataset.lfcThemeWired = "1";
    btn.addEventListener("click", () => {
      const root = document.documentElement;
      const nowDark = root.classList.toggle("theme-dark");
      try { localStorage.setItem("lfc.theme", nowDark ? "dark" : "light"); } catch (e) {}
      // update the label on this button
      const darkClass = document.documentElement.classList.contains("theme-dark");
      btn.setAttribute("aria-pressed", darkClass ? "true" : "false");
      btn.textContent = darkClass ? "☀️ Light" : "🌙 Dark";
    });
  });

  // --- One data-nav navigation system ---------------------------------------
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.nav;

      // Page anchors: navigate within the shell; update active tab.
      const routes = {
        dashboard: "index.html",
        performance: "performance.html",
        funds: "funds/index.html",
        scanner: "scanner.html",
        setups: "setups.html",
        gex: "gex.html",
      };

      if (routes[page]) {
        // On mobile, collapse the menu before leaving.
        if (mobileOpen) closeMobile();
        if (page === "admin") {
          // admin is authorised per-page; the page decides whether to open it
          if (window.LfcAuth && LfcAuth.current && LfcAuth.current().a) {
            location.href = "index.html#admin";
          }
          return;
        }
        location.href = routes[page];
      }

      // Update the active tab for the current page.
      if (main) {
        setActiveNav(page);
      }
    });
  });

  // --- Page title / active marking ------------------------------------------
  function setPageTitle(page) {
    const titles = {
      dashboard: "LearningFundClear · Research Dashboard",
      performance: "Performance — LearningFundClear",
      funds: "Mutual Funds — LearningFundClear",
      scanner: "Demand Zone Scanner — LearningFundClear",
      setups: "Setups — LearningFundClear",
      gex: "GEX / Option Chain — LearningFundClear",
    };
    document.title = titles[page] || document.title;
  }

  // Determine the active page from the URL, respecting the shell.
  function resolveActivePage() {
    const path = location.pathname.split("/").pop() || "index.html";
    if (path === "index.html") return "dashboard";
    if (path === "performance.html") return "performance";
    if (path === "funds/index.html") return "funds";
    if (path === "scanner.html") return "scanner";
    if (path === "setups.html") return "setups";
    if (path === "gex.html") return "gex";
    // Fall back to data-page if the page keeps a canonical marker.
    const marker = document.documentElement.dataset.page;
    if (marker) return marker;
    return "dashboard";
  }

  function boot() {
    const page = resolveActivePage();
    setPageTitle(page);

    if (mobileMenu) mobileMenu.classList.add("hidden");

    // --- Admin visibility (only for authorised admin users) -----------------
    const adminBtn = $("adminBtn");
    try {
      const rec = window.LfcAuth && LfcAuth.current();
      if (adminBtn) adminBtn.classList.toggle("hidden", !(rec && rec.a));
    } catch (e) {
      if (adminBtn) adminBtn.classList.add("hidden");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
