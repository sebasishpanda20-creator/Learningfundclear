(function () {
  const root = LfcAuth.base,
    page = document.body.dataset.page,
    route = (path) => new URL(path, root).href;
  const icons = {
    dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    performance: "M4 20V10 M10 20V4 M16 20v-8 M22 20H2",
    nifty500: "M4 20V10 M10 20V4 M16 20v-8 M22 20H2",
    "market-scanner": "M3 17l6-7 4 4 8-10 M3 21h18",
    "index-scanner": "M3 17l6-7 4 4 8-10 M3 21h18",
    scanner: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6 M7 10h6 M10 7v6",
    "trading-plan": "M4 3h16v18H4z M8 8h8 M8 12h8 M8 16h5",
    setups: "M4 5h16v16H4z M8 3v4 M16 3v4 M8 12h8 M8 16h5",
    gex: "M3 12h4l3-7 4 14 3-7h4",
    crypto: "M3 12h4l3-7 4 14 3-7h4",
    "crypto-options": "M3 12h4l3-7 4 14 3-7h4",
    "crypto-funding": "M4 6h16 M4 12h16 M4 18h16",
    funds: "M3 9l9-6 9 6 M5 10v8 M12 10v8 M19 10v8 M3 21h18",
    account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 21v-2a8 8 0 0 1 16 0v2",
    admin: "M12 3l8 4v5c0 5-8 9-8 9s-8-4-8-9V7z",
    approvals: "M4 4h16v16H4z M7 12l3 3 6-7",
  };
  const nav = [
    ["dashboard", "Dashboard", "index.html"],
    ["performance", "Performance", "performance.html"],
    ["nifty500", "Nifty 500 stocks", "nifty500.html"],
    ["market-scanner", "Stock & crypto scanner", "market-scanner.html"],
    ["scanner", "Demand scanner", "scanner.html"],
    ["index-scanner", "Index scanner", "index-scanner.html"],
    ["trading-plan", "Trading plan", "trading-plan.html"],
    ["setups", "Setups & paper trades", "setups.html"],
    ["crypto", "Crypto markets", "crypto.html"],
    ["crypto-options", "Crypto options desk", "crypto-options.html"],
    ["crypto-funding", "Crypto funding desk", "crypto-funding.html"],
    ["gex", "Options overview", "gex.html"],
    ["funds", "Mutual funds", "funds/top-returns.html"],
    ["admin", "Administration", "admin.html"],
    ["approvals", "Approvals", "approvals.html"],
    ["account", "My account", "account.html"],
  ];
  const navGroups = [
    ["OVERVIEW",["dashboard","performance"]],
    ["MARKET INTELLIGENCE",["nifty500","market-scanner","scanner","index-scanner","crypto","crypto-options","crypto-funding","gex"]],
    ["WORKSPACE & FUNDS",["trading-plan","setups","funds"]],
    ["ACCOUNT & ACCESS",["admin","approvals","account"]],
  ];
  const navByKey = new Map(nav.map((entry) => [entry[0], entry]));
  const navLink = (entry) => {
    const [key,title,path] = entry;
    return `<a ${key === "admin" || key === "approvals" ? `id="${key}Nav" hidden` : ""} ${key===page?'aria-current="page"':""} href="${route(path)}">${svg(key)}<span>${title}</span>${key===page?"<i></i>":""}</a>`;
  };
  const groupedNav = navGroups.map(([heading,keys]) =>
    `<div class="nav-group"><p class="nav-group-title">${heading}</p>${keys.map(k=>navLink(navByKey.get(k))).join("")}</div>`).join("");
  const svg = (key) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[key]}"/></svg>`;
  const aside = document.createElement("aside");
  aside.className = "sidebar";
  aside.id = "portalNav";
  aside.innerHTML = `<a class="portal-brand" href="${route("index.html")}"><span class="brand-mark">${svg("gex")}</span><span>Learning<span class="brand-clear">FundClear</span><small>RESEARCH WORKSPACE</small></span></a><nav aria-label="Primary navigation">${groupedNav}</nav><div class="sidebar-bottom"><div class="privacy-note">${svg("admin")}<span>Private research<br><small>Your space to think clearly</small></span></div><button data-lfc-theme-toggle aria-pressed="false">Dark appearance</button><button id="logoutBtn">Sign out <span aria-hidden="true">↗</span></button></div>`;
  const top = document.createElement("div");
  top.className = "topbar";
  top.innerHTML = `<button class="menu-toggle" aria-label="Open navigation" aria-controls="portalNav" aria-expanded="false">☰</button><div class="breadcrumb"><span class="portal-breadcrumb-home">Workspace</span> <span>/</span> <strong>${nav.find((n) => n[0] === page)?.[1] || "Research"}</strong></div><div class="topbar-actions"><button id="lfcQuickNavOpen" class="quick-search-trigger" type="button" aria-keyshortcuts="Control+K Meta+K" aria-label="Search and jump to any page">⌕ <span class="quick-search-label">Search workspace</span><kbd class="shortcut-key">Ctrl K</kbd></button><button class="topbar-theme" data-lfc-theme-toggle aria-label="Toggle color theme" aria-pressed="false" title="Switch light and dark appearance">◐</button><div class="profile"><span class="private-badge">Research only</span><span class="avatar" aria-hidden="true">U</span><span id="userDisplay">Research account</span></div></div>`;
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
  // Accessible global quick navigation: Ctrl/Cmd+K, keyboard filtering and escape.
  // Commands are navigation only; no quote, order, or account actions are triggered.
  const palette = document.createElement("div");
  palette.id="lfcCommandOverlay";palette.className="lfc-command-overlay";palette.hidden=true;
  palette.innerHTML=`<div class="lfc-command-box" role="dialog" aria-modal="true" aria-label="Quick navigation">
    <div class="lfc-command-head"><span aria-hidden="true">⌕</span><input id="lfcCommandQuery" type="search" autocomplete="off" placeholder="Search pages, scanners, and tools" aria-label="Search workspace pages"><button id="lfcCommandClose" type="button" aria-label="Close quick navigation">×</button></div>
    <div id="lfcCommandResults" class="lfc-command-list" role="list"></div>
    <p class="lfc-command-foot">↑ ↓ Navigate &nbsp;·&nbsp; Enter Open &nbsp;·&nbsp; Esc Close</p></div>`;
  document.body.append(palette);
  const commandInput=palette.querySelector("#lfcCommandQuery"),commandList=palette.querySelector("#lfcCommandResults");
  const cmdClose=palette.querySelector("#lfcCommandClose");
  let allowedCommands=nav.filter(([key])=>key!=="admin"&&key!=="approvals"),highlightIndex=0,previousFocus=null;
  function visibleCommandLinks(){return [...commandList.querySelectorAll("a:not([hidden])")];}
  function highlightCommand(index){
    const links=visibleCommandLinks();if(!links.length)return;
    highlightIndex=(index+links.length)%links.length;
    links.forEach((link,i)=>{link.dataset.highlighted=String(i===highlightIndex);});
    links[highlightIndex].scrollIntoView({block:"nearest"});
  }
  function renderCommands(){
    const term=commandInput.value.trim().toLocaleLowerCase();
    const matched=allowedCommands.filter(([,title,path])=>
      title.toLocaleLowerCase().includes(term)||path.toLocaleLowerCase().includes(term)).slice(0,16);
    commandList.replaceChildren();
    if(!matched.length){const empty=document.createElement("p");empty.className="lfc-command-empty";empty.textContent="No matching pages. Try “scanner”, “crypto”, or “funds”.";commandList.append(empty);}
    for(const [key,title,path] of matched){
      const link=document.createElement("a");link.className="lfc-command-item";link.href=route(path);
      const label=document.createElement("span"),arrow=document.createElement("span");
      label.textContent=title;arrow.textContent="↗";arrow.setAttribute("aria-hidden","true");
      link.append(label,arrow);commandList.append(link);
    }
    highlightIndex=0;highlightCommand(0);
  }
  function openCommands(){
    if(!palette.hidden)return;
    previousFocus=document.activeElement;palette.hidden=false;commandInput.value="";
    renderCommands();commandInput.focus();
  }
  function closeCommands(){
    if(palette.hidden)return;
    palette.hidden=true;(previousFocus?.isConnected?previousFocus:top.querySelector("#lfcQuickNavOpen")).focus();
  }
  top.querySelector("#lfcQuickNavOpen").addEventListener("click",openCommands);
  cmdClose.addEventListener("click",closeCommands);
  palette.addEventListener("pointerdown",event=>{if(event.target===palette)closeCommands();});
  commandInput.addEventListener("input",renderCommands);
  palette.addEventListener("keydown",event=>{
    if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();highlightCommand(highlightIndex+(event.key==="ArrowDown"?1:-1));}
    if(event.key==="Enter"&&document.activeElement===commandInput){const picked=visibleCommandLinks()[highlightIndex];if(picked){event.preventDefault();picked.click();}}
    if(event.key==="Tab"){
      const list=[commandInput,cmdClose,...visibleCommandLinks()];
      if(event.shiftKey&&document.activeElement===list[0]){event.preventDefault();list.at(-1).focus();}
      else if(!event.shiftKey&&document.activeElement===list.at(-1)){event.preventDefault();list[0].focus();}
    }
  });
  document.addEventListener("keydown",event=>{
    const target=event.target;
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();palette.hidden?openCommands():closeCommands();return;}
    if(event.key==="Escape"&&!palette.hidden){event.preventDefault();closeCommands();return;}
    if(event.key==="/"&&palette.hidden&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&
       !target.closest("input,textarea,select,[contenteditable]")){event.preventDefault();openCommands();}
  });
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
    document.getElementById("approvalsNav").hidden = !user.is_admin;
    if(user.is_admin)allowedCommands=nav;
    if(!palette.hidden)renderCommands();
  });
})();
