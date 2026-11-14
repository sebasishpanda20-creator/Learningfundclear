/**
 * lfc_terminal_v6.html smoke test.
 * Static origin: /api/v1/fyers/* answers 404, which is the "backend absent"
 * state the dialog must report without ever showing a connected session.
 */
const { chromium } = require("playwright");
const { fixture, origin, port } = require("./fixtures.cjs");
const http = require("http");
const fs = require("fs");
const path = require("path");

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "414x896", width: 414, height: 896 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "844x390-landscape", width: 844, height: 390 },
  { name: "1440x900", width: 1440, height: 900 },
];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? "" : detail });
}

(async () => {
  const server = http.createServer((req, res) => {
    let f = path.resolve(".", "." + new URL(req.url, "http://x").pathname);
    if (f.endsWith("/")) f += "index.html";
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain");
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".json") ? "application/json" : "text/html");
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.width < 900, isMobile: vp.width < 900 });
    await fixture(ctx);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push("console: " + m.text().slice(0, 120)); });

    await page.goto(origin + "/lfc_terminal_v6.html", { waitUntil: "load" });
    await page.waitForSelector("#scanRows tr[data-index]", { state: "attached", timeout: 10000 });
    await page.waitForTimeout(400);

    const base = await page.evaluate(() => {
      const d = document.getElementById("fyersModal");
      const toggle = document.querySelector(".mf-topbar .menu-toggle");
      return {
        dialogOpen: !!(d && d.open),
        toggleVisible: !!toggle && toggle.getBoundingClientRect().width > 0,
        overflow: document.documentElement.scrollWidth > innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth,
        journalIdle: !!document.getElementById("saveIdea") === false,
      };
    });
    check(`${vp.name}: no uncaught page errors`, errors.length === 0, errors.join(" | "));
    check(`${vp.name}: dialog closed on load`, base.dialogOpen === false);
    check(`${vp.name}: no horizontal overflow`, base.overflow === false, `scrollWidth ${base.scrollWidth} vs ${base.innerWidth}`);
    check(`${vp.name}: nav toggle ${vp.width <= 900 ? "visible" : "hidden"}`, base.toggleVisible === (vp.width <= 900));

    // Context tab: reachable, explicit unavailable state, no page overflow.
    const contextTab = await page.evaluate(() => {
      const tab = document.querySelector('.tab-rail .tab[data-tab="ctx"]');
      if (!tab) return { found: false };
      tab.click();
      const panel = document.getElementById('ctx');
      const r = tab.getBoundingClientRect();
      return {
        found: true,
        visible: !!panel && !panel.classList.contains('hidden'),
        tabW: Math.round(r.width),
        tabH: Math.round(r.height),
        overflow: document.documentElement.scrollWidth > innerWidth,
        regime: document.getElementById('mcRegimeValue').textContent.trim(),
        freshness: document.getElementById('mcRegimeFreshness').textContent.trim(),
        fii: document.getElementById('mcFiiNet').textContent.trim(),
        effect: document.getElementById('mcEffect').textContent.trim(),
        orderNote: /No order will be placed/.test(panel.textContent),
      };
    });
    check(`${vp.name}: context tab exists and opens`, contextTab.found && contextTab.visible, JSON.stringify({ visible: contextTab.visible }));
    check(`${vp.name}: context tab touch target`, vp.width > 900 || (contextTab.tabW >= 44 && contextTab.tabH >= 44), JSON.stringify({ w: contextTab.tabW, h: contextTab.tabH }));
    check(`${vp.name}: context has no horizontal page overflow`, contextTab.overflow === false);
    check(`${vp.name}: context unavailable is explicit`, contextTab.regime === 'UNAVAILABLE' && contextTab.freshness === 'UNAVAILABLE' && contextTab.fii === '—', JSON.stringify({ regime: contextTab.regime, freshness: contextTab.freshness, fii: contextTab.fii }));
    check(`${vp.name}: context explains effect and no orders`, /confirmation/i.test(contextTab.effect) && contextTab.orderNote, JSON.stringify({ effect: contextTab.effect }));
    await page.evaluate(() => document.querySelector('.tab-rail .tab[data-tab="mkt"]').click());

    // dialog open/close via real clicks where reachable
    await page.evaluate(() => document.getElementById("connectFyersBtn").click());
    await page.waitForTimeout(200);
    const opened = await page.evaluate(() => document.getElementById("fyersModal").open);
    check(`${vp.name}: Connect opens dialog`, opened);
    const dialogState = await page.evaluate(() => ({
      auth: document.getElementById("fyersAuthState").textContent.trim(),
      note: document.getElementById("fyersConfigNote").textContent.trim(),
      loginDisabled: document.getElementById("loginWithFyersBtn").disabled,
    }));
    check(`${vp.name}: backend absent -> not connected`, dialogState.auth !== "connected" && dialogState.loginDisabled === true, JSON.stringify(dialogState));

    await page.locator("#fyersModal [data-fyers-close]").click();
    await page.waitForTimeout(150);
    check(`${vp.name}: close button closes dialog`, await page.evaluate(() => !document.getElementById("fyersModal").open));

    await page.evaluate(() => document.getElementById("connectFyersBtn").click());
    await page.waitForTimeout(150);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    const afterEsc = await page.evaluate(() => ({
      open: document.getElementById("fyersModal").open,
      focus: document.activeElement && document.activeElement.id,
    }));
    check(`${vp.name}: Escape closes and focus returns to Connect`, afterEsc.open === false && afterEsc.focus === "connectFyersBtn", JSON.stringify(afterEsc));

    if (vp.width <= 900) {
      await page.locator(".mf-topbar .menu-toggle").click();
      await page.waitForTimeout(250);
      const drawer = await page.evaluate(() => {
        const side = document.getElementById("portalNav");
        const r = side.getBoundingClientRect();
        const controls = [["Settings", "settingsBtn"], ["Log out", "logoutBtn"], ["Connect FYERS", "connectFyersBtn"]].map(([label, id]) => {
          const el = document.getElementById(id);
          if (!el) return { label, found: false };
          const b = el.getBoundingClientRect();
          const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          return { label, found: true, w: Math.round(b.width), h: Math.round(b.height), inView: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight, hittable: !!hit && (hit === el || el.contains(hit)) };
        });
        return { open: document.body.classList.contains("nav-open"), x: Math.round(r.x), expanded: document.querySelector(".mf-topbar .menu-toggle").getAttribute("aria-expanded"), controls };
      });
      check(`${vp.name}: drawer opens on tap`, drawer.open === true && drawer.x >= 0, JSON.stringify({ x: drawer.x }));
      check(`${vp.name}: aria-expanded true`, drawer.expanded === "true");
      for (const c of drawer.controls) {
        check(`${vp.name}: ${c.label} reachable by touch`, c.found && c.w >= 44 && c.h >= 44 && c.inView && c.hittable, JSON.stringify(c));
      }
      await page.locator("#portalNavOverlay").click({ position: { x: vp.width - 10, y: Math.round(vp.height / 2) } });
      await page.waitForTimeout(200);
      check(`${vp.name}: backdrop closes drawer`, !(await page.evaluate(() => document.body.classList.contains("nav-open"))));
      await page.locator(".mf-topbar .menu-toggle").click();
      await page.waitForTimeout(150);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      const navEsc = await page.evaluate(() => ({
        open: document.body.classList.contains("nav-open"),
        focus: document.activeElement && document.activeElement.className,
      }));
      check(`${vp.name}: Escape closes drawer and returns focus to toggle`, navEsc.open === false && /menu-toggle/.test(navEsc.focus), JSON.stringify(navEsc));
    }

    await ctx.close();
  }

  // A/B through the shipped scan_sl_tp.json (real static payload)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await fixture(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/lfc_terminal_v6.html", { waitUntil: "load" });
  await page.waitForSelector("#scanRows tr[data-index]", { state: "attached", timeout: 10000 });
  await page.locator('.tab-rail .tab[data-tab="scan"]').click();
  await page.waitForSelector("#scanRows tr[data-index]", { state: "visible", timeout: 10000 });
  await page.waitForTimeout(300);
  const scan = await page.evaluate(() => ({
    rows: document.querySelectorAll("#scanRows tr[data-index]").length,
    selected: document.querySelectorAll("#scanRows tr.scanner-row-selected").length,
  }));
  check("scanner rows render", scan.rows === 23, `rows=${scan.rows}`);
  check("first row auto-selected", scan.selected === 1);

  async function panel() {
    return page.evaluate(() => {
      const text = document.getElementById("scanMeta").innerText;
      return { text, lines: text.split("\n").filter(Boolean) };
    });
  }
  await page.locator('#scanRows tr[data-index="4"]').click();
  await page.waitForTimeout(200);
  const a = await panel();
  await page.locator('#scanRows tr[data-index="7"]').click();
  await page.waitForTimeout(200);
  const b = await panel();
  check("row 5 shows RELIANCE with 12 detail lines", /RELIANCE/.test(a.text) && a.lines.length === 12, JSON.stringify(a.lines.slice(0, 3)));
  check("row 8 shows INFY and replaces row 5", /INFY/.test(b.text) && !/RELIANCE/.test(b.text) && b.lines.length === 12);
  check("no uncaught errors during A/B", errors.length === 0, errors.join(" | "));

  await browser.close();
  server.close();

  const failed = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ checks: results.length, failed: failed.length, failures: failed, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
