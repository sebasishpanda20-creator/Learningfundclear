(function () {
  const root = LfcAuth.base,
    page = document.body.dataset.page,
    route = (path) => new URL(path, root).href;
  const icons = {
    dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    performance: "M4 20V10 M10 20V4 M16 20v-8 M22 20H2",
    scanner: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6 M7 10h6 M10 7v6",
    setups: "M4 5h16v16H4z M8 3v4 M16 3v4 M8 12h8 M8 16h5",
    gex: "M3 12h4l3-7 4 14 3-7h4",
    crypto: "M3 12h4l3-7 4 14 3-7h4",
    funds: "M3 9l9-6 9 6 M5 10v8 M12 10v8 M19 10v8 M3 21h18",
    admin: "M12 3l8 4v5c0 5-8 9-8 9s-8-4-8-9V7z",
  };
  const nav = [
    ["dashboard", "Dashboard", "index.html"],
    ["performance", "Performance", "performance.html"],
    ["scanner", "Demand scanner", "scanner.html"],
    ["setups", "Setups & paper trades", "setups.html"],
    ["crypto", "Crypto markets", "crypto.html"],
    ["gex", "Options overview", "gex.html"],
    ["funds", "Mutual funds", "funds/top-returns.html"],
    ["admin", "Administration", "admin.html"],
  ];
  const svg = (key) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[key]}"/></svg>`;
  const aside = document.createElement("aside");
  aside.className = "sidebar";
  aside.id = "portalNav";
  aside.innerHTML = `<a class="portal-brand" href="${route("index.html")}"><span class="brand-mark">${svg("gex")}</span><span>Learning<span class="brand-clear">FundClear</span><small>RESEARCH WORKSPACE</small></span></a><p class="nav-caption">WORKSPACE</p><nav aria-label="Primary navigation">${nav.map(([key, title, path]) => `<a ${key === "admin" ? 'id="adminNav" hidden' : ""} ${key === page ? 'aria-current="page"' : ""} href="${route(path)}">${svg(key)}<span>${title}</span>${key === page ? "<i></i>" : ""}</a>`).join("")}</nav><div class="sidebar-bottom"><div class="privacy-note">${svg("admin")}<span>Private research<br><small>Your space to think clearly</small></span></div><button data-lfc-theme-toggle aria-pressed="false">Dark appearance</button><button id="logoutBtn">Sign out <span aria-hidden="true">↗</span></button></div>`;
  const top = document.createElement("div");
  top.className = "topbar";
  top.innerHTML = `<button class="menu-toggle" aria-label="Open navigation" aria-controls="portalNav" aria-expanded="false">☰</button><div class="breadcrumb">Workspace <span>/</span> <strong>${nav.find((n) => n[0] === page)?.[1] || "Research"}</strong></div><div class="profile"><span class="private-badge">Private portal</span><span class="avatar" aria-hidden="true">U</span><span id="userDisplay">Research account</span></div>`;
  const overlay = document.createElement("button");
  overlay.className = "nav-overlay";
  overlay.setAttribute("aria-label", "Close navigation");
  overlay.hidden = true;
  document.body.prepend(aside, top, overlay);
  const skip = document.createElement("a");
  skip.className = "skip";
  skip.href = "#main";
  skip.textContent = "Skip to content";
  document.body.prepend(skip);
  const menu = top.querySelector(".menu-toggle");
  function close() {
    document.body.classList.remove("nav-open");
    overlay.hidden = true;
    menu.setAttribute("aria-expanded", "false");
    menu.focus();
  }
  menu.onclick = () => {
    const open = !document.body.classList.contains("nav-open");
    document.body.classList.toggle("nav-open", open);
    overlay.hidden = !open;
    menu.setAttribute("aria-expanded", String(open));
    if (open) aside.querySelector("a").focus();
  };
  overlay.onclick = close;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("nav-open"))
      close();
    if (e.key === "Tab" && document.body.classList.contains("nav-open")) {
      const list = [...aside.querySelectorAll("a,button")].filter(
        (x) => !x.hidden && x.offsetParent !== null,
      );
      if (e.shiftKey && document.activeElement === list[0]) {
        e.preventDefault();
        list.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === list.at(-1)) {
        e.preventDefault();
        list[0].focus();
      }
    }
  });
  document.getElementById("logoutBtn").onclick = () => {
    document.getElementById("logoutBtn").disabled = true;
    LfcAuth.logout();
  };
  if (page === "funds") {
    const tabs = document.createElement("nav");
    tabs.className = "fund-tabs";
    tabs.setAttribute("aria-label", "Mutual fund pages");
    const here = location.pathname.split("/").filter(Boolean).pop().replace(/\.html$/, "") + ".html";
    tabs.innerHTML = [
      ["top-returns.html", "Top Return Funds"],
      ["index.html", "Overview"],
      ["funds.html", "All schemes"],
      ["compare.html", "Compare"],
      ["calculators.html", "Calculators"],
      ["methodology.html", "Methodology"],
      ["legal.html", "Legal & privacy"],
    ]
      .map(
        ([path, label]) =>
          `<a href="${path}" ${path === here ? 'aria-current="page"' : ""}>${label}</a>`,
      )
      .join("");
    document.querySelector("main")?.prepend(tabs);
  }
  document.querySelectorAll('.msg,[id$="Empty"],#ideasError').forEach((x) => {
    x.setAttribute("role", "status");
    x.setAttribute("aria-live", "polite");
  });
  document.querySelectorAll("input,select,textarea").forEach((el) => {
    if (
      el.labels?.length ||
      el.hasAttribute("aria-label") ||
      el.type === "hidden"
    )
      return;
    el.setAttribute(
      "aria-label",
      el.placeholder || el.id.replace(/([A-Z])/g, " $1"),
    );
  });
  LfcAuth.ready.then((user) => {
    if (!user) return;
    document.getElementById("userDisplay").textContent =
      user.display_name || user.username;
    top.querySelector(".avatar").textContent = (
      user.display_name ||
      user.username ||
      "U"
    )
      .slice(0, 1)
      .toUpperCase();
    document.getElementById("adminNav").hidden = !user.is_admin;
  });
})();
