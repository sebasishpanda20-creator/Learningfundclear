/* LearningFundClear canonical application shell.
 * Navigation, active-tab state, mobile menu and logout live here so pages
 * cannot drift into separate portal implementations.
 */
(function () {
  "use strict";

  var NAV = [
    ["dashboard", "Dashboard", "index.html"],
    ["performance", "Performance", "performance.html"],
    ["funds", "Mutual Funds", "funds/index.html"],
    ["scanner", "Scanner", "scanner.html"],
    ["setups", "Setups", "setups.html"],
    ["gex", "GEX", "gex.html"]
  ];

  function currentPage() {
    if (location.hash === "#admin") return "admin";
    var explicit = document.body && document.body.dataset.page;
    if (explicit) return explicit;
    var p = (location.pathname || "").toLowerCase();
    if (p.indexOf("/funds/") !== -1) return "funds";
    if (p.endsWith("/performance.html")) return "performance";
    if (p.endsWith("/scanner.html")) return "scanner";
    if (p.endsWith("/setups.html")) return "setups";
    if (p.endsWith("/gex.html")) return "gex";
    return "dashboard";
  }

  function rootPrefix() {
    return (document.body && document.body.dataset.root) || "";
  }

  function authRecord() {
    try {
      return window.LfcAuth && LfcAuth.current ? LfcAuth.current() : null;
    } catch (e) {
      return null;
    }
  }

  function normalizeLegacyKeys(userbar) {
    userbar.querySelectorAll("[data-nav='dash']").forEach(function (el) {
      el.dataset.nav = "dashboard";
    });
    userbar.querySelectorAll("[data-nav='perf']").forEach(function (el) {
      el.dataset.nav = "performance";
    });
  }

  function navButton(userbar, key, label) {
    var matches = Array.prototype.slice.call(userbar.querySelectorAll("[data-nav='" + key + "']"));
    var el = matches.shift();
    matches.forEach(function (duplicate) { duplicate.remove(); });
    if (!el) {
      el = document.createElement("button");
      el.type = "button";
      el.className = "nav-btn";
      el.dataset.nav = key;
    }
    el.textContent = label;
    el.removeAttribute("onclick");
    return el;
  }

  function go(route) {
    location.href = rootPrefix() + route;
  }

  function wireNavigation(userbar) {
    normalizeLegacyKeys(userbar);

    var page = currentPage();
    var ordered = [];

    NAV.forEach(function (item) {
      var el = navButton(userbar, item[0], item[1]);
      el.classList.toggle("active", item[0] === page);
      if (item[0] === page) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");

      el.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        go(item[2]);
      }, true);

      ordered.push(el);
    });

    var admin = navButton(userbar, "admin", "Admin");
    admin.id = "adminBtn";
    var rec = authRecord();
    admin.classList.toggle("hidden", !(rec && rec.a));
    admin.classList.toggle("active", page === "admin");
    admin.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      var now = authRecord();
      if (now && now.a) go("index.html#admin");
    }, true);

    var theme = userbar.querySelector("[data-lfc-theme-toggle]") || document.getElementById("themeToggle");
    if (!theme) {
      theme = document.createElement("button");
      theme.type = "button";
      theme.className = "nav-btn";
      theme.id = "themeToggle";
      theme.setAttribute("data-lfc-theme-toggle", "");
      theme.setAttribute("aria-pressed", "false");
      theme.textContent = "🌙 Dark";
    }
    theme.removeAttribute("style");

    var logout = document.getElementById("logoutBtn");
    if (!logout || !userbar.contains(logout)) {
      logout = document.createElement("button");
      logout.type = "button";
      logout.className = "nav-btn";
      logout.id = "logoutBtn";
      logout.textContent = "Logout";
    }
    logout.removeAttribute("style");
    logout.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        if (window.LfcAuth && LfcAuth.clear) LfcAuth.clear();
        localStorage.removeItem("lfc.auth");
      } catch (e) {}
      location.replace(rootPrefix() + "signin.html?signout=1");
    }, true);

    ordered.forEach(function (el) { userbar.appendChild(el); });
    userbar.appendChild(admin);
    userbar.appendChild(theme);
    userbar.appendChild(logout);

    var userDisplay = document.getElementById("userDisplay");
    var user = authRecord();
    if (userDisplay && user && (user.n || user.u)) {
      userDisplay.textContent = user.n || user.u;
    }

    function syncActiveState() {
      var activePage = currentPage();
      userbar.querySelectorAll("[data-nav]").forEach(function (btn) {
        var active = btn.getAttribute("data-nav") === activePage;
        btn.classList.toggle("active", active);
        if (active) btn.setAttribute("aria-current", "page");
        else btn.removeAttribute("aria-current");
      });
    }

    window.addEventListener("hashchange", syncActiveState);
    syncActiveState();
  }

  function wireMobileMenu(header, userbar) {
    var toggle = header.querySelector(".portal-menu-toggle");
    if (!userbar.id) userbar.id = "portalNav";

    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "portal-menu-toggle";
      toggle.setAttribute("aria-label", "Open navigation");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", userbar.id);
      toggle.innerHTML = '<span aria-hidden="true">☰</span><span>Menu</span>';
      header.insertBefore(toggle, userbar);
    }

    function setOpen(open) {
      userbar.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    }

    toggle.addEventListener("click", function () {
      setOpen(!userbar.classList.contains("is-open"));
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setOpen(false);
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 1100) setOpen(false);
    });
  }

  function init() {
    var header = document.querySelector("header");
    var userbar = document.querySelector(".userbar");
    if (!header || !userbar) return;
    wireNavigation(userbar);
    wireMobileMenu(header, userbar);
    document.documentElement.classList.add("portal-shell-ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();