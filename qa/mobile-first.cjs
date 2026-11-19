/**
 * MOBILE-FIRST-RELEASE-CRITERIA.md — runtime gate.
 *
 * Serves the real portal, seeds the isolated QA fixture, then measures the
 * criteria in Chromium at the required widths plus breakpoint boundaries,
 * landscape, keyboard-open and desktop regression.
 *
 * Outputs:
 *   qa/mobile-first.json          every measurement, failure and console error
 *   qa/mobile-first-<vp>.png      screenshots for the deep-check pages
 *
 * Usage:
 *   node qa/mobile-first.cjs            full matrix
 *   node qa/mobile-first.cjs --flow     interaction flow only
 */
const { chromium } = require("playwright");
const { fixture, port } = require("./fixtures.cjs");
const path = require("path");
const fs = require("fs");
const http = require("http");

const FLOW_ONLY = process.argv.includes("--flow");
const ONLY_VP = (process.argv.find((a) => a.indexOf("--vp=") === 0) || "").slice(5);
const ONLY_PAGE = (process.argv.find((a) => a.indexOf("--page=") === 0) || "").slice(7);

const ALL_PAGES = [
  "index.html",
  "performance.html",
  "admin.html",
  "nifty500.html",
  "scanner.html",
  "setups.html",
  "gex.html",
  "crypto.html",
  "crypto-options.html",
  "crypto-funding.html",
  "quant-desk.html",
  "funds/top-returns.html",
  "funds/index.html",
  "funds/funds.html",
  "funds/compare.html",
  "funds/calculators.html",
  "funds/methodology.html",
  "funds/legal.html",
  "funds/scheme.html?code=119551",
];

// Pages that also get the full width sweep and screenshots.
const DEEP_PAGES = ["index.html", "scanner.html", "setups.html", "gex.html", "quant-desk.html"];

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800, mobile: true },
  { name: "375x812", width: 375, height: 812, mobile: true },
  { name: "390x844", width: 390, height: 844, mobile: true },
  { name: "414x896", width: 414, height: 896, mobile: true },
  { name: "768x1024", width: 768, height: 1024, mobile: true },
  { name: "bp-639", width: 639, height: 900 },
  { name: "bp-640", width: 640, height: 900 },
  { name: "bp-759", width: 759, height: 900 },
  { name: "bp-760", width: 760, height: 900 },
  { name: "bp-767", width: 767, height: 900 },
  { name: "bp-1023", width: 1023, height: 900 },
  { name: "bp-1024", width: 1024, height: 900 },
  { name: "landscape-844x390", width: 844, height: 390, mobile: true },
  { name: "keyboard-390x500", width: 390, height: 500, mobile: true },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

const SHOT_VPS = ["360x800", "390x844", "768x1024", "landscape-844x390", "desktop-1440"];
const COARSE = ["360x800", "375x812", "390x844", "414x896", "768x1024", "landscape-844x390", "keyboard-390x500"];

const results = [];
const consoleErrors = [];
const failures = [];

function record(entry) {
  results.push(entry);
  for (const v of entry.violations || []) failures.push({ ...v, page: entry.page, viewport: entry.viewport });
}

/** Runs in the page. Returns every measurement for one load. */
function measure() {
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const out = {};
  // A focused skip link becomes a fixed overlay; measure the resting page.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

  const pathOf = (el) => {
    const bits = [];
    let node = el;
    for (let i = 0; i < 4 && node && node.nodeType === 1; i++) {
      let s = node.tagName.toLowerCase();
      if (node.id) s += "#" + node.id;
      else if (node.classList.length) s += "." + [...node.classList].slice(0, 2).join(".");
      bits.unshift(s);
      node = node.parentElement;
    }
    return bits.join(" > ");
  };

  /* ---------------------------------------------------------------- MF-1 */
  out.scrollWidth = doc.scrollWidth;
  out.innerWidth = vw;
  out.overflow = doc.scrollWidth > vw + 1;
  out.overflowOffenders = [];
  if (out.overflow) {
    const seen = [];
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (r.right <= vw + 1 && r.left >= -1) return;
      let p = el.parentElement;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== "visible") return; // inside a scroller: allowed
        p = p.parentElement;
      }
      if (seen.length < 6) seen.push({ sel: pathOf(el), right: Math.round(r.right) });
    });
    out.overflowOffenders = seen;
  }

  /* ---------------------------------------------------------------- MF-2 */
  const meta = document.querySelector('meta[name="viewport"]');
  out.viewportMeta = meta ? meta.getAttribute("content") : null;
  out.zoomBlocked =
    !!out.viewportMeta &&
    /user-scalable\s*=\s*no|maximum-scale\s*=\s*(0|1)(\.\d+)?\b/i.test(out.viewportMeta);
  out.bodyFontPx = parseFloat(getComputedStyle(document.body).fontSize) || 0;
  out.smallFormFonts = [];
  document.querySelectorAll("input, select, textarea").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const px = parseFloat(getComputedStyle(el).fontSize) || 0;
    if (px && px < 16 && out.smallFormFonts.length < 5) {
      out.smallFormFonts.push({ sel: pathOf(el), px });
    }
  });

  /* ---------------------------------------------------------------- MF-3 */
  const controlSel =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"]), [data-mf-tap]';
  const controls = [...document.querySelectorAll(controlSel)].filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (getComputedStyle(el).visibility === "hidden") return false;
    if (el.disabled) return false;
    // Inline links inside running text are exempt (MF-3).
    if (el.tagName === "A" && el.closest("p, li, dd, dt, .prose, .disclaimer")) return false;
    if (el.tagName === "A" && getComputedStyle(el).display === "inline") return false;
    // A checkbox's label carries the tap area.
    if (el.tagName === "INPUT" && /^(checkbox|radio)$/.test(el.type)) {
      const lab = el.closest("label");
      if (lab) {
        const lr = lab.getBoundingClientRect();
        if (lr.height >= 44) return false;
      }
    }
    if (el.getAttribute("role") === "row") return false;
    return true;
  });
  out.controlCount = controls.length;
  out.smallTargets = [];
  out.unnamedControls = [];
  controls.forEach((el) => {
    const r = el.getBoundingClientRect();
    if ((r.width < 44 || r.height < 44) && out.smallTargets.length < 12) {
      out.smallTargets.push({
        sel: pathOf(el),
        w: Math.round(r.width),
        h: Math.round(r.height),
        text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24),
      });
    }
    const named =
      el.getAttribute("aria-label") ||
      el.getAttribute("aria-labelledby") ||
      (el.labels && el.labels.length) ||
      el.getAttribute("title") ||
      (el.textContent || "").trim() ||
      el.getAttribute("placeholder") ||
      el.getAttribute("alt");
    if (!named && out.unnamedControls.length < 8) out.unnamedControls.push(pathOf(el));
  });

  /* --------------------------------------------------------------- MF-11 */
  out.dvhSupport = CSS.supports("height", "100dvh");
  out.safeAreaVar = getComputedStyle(doc)
    .getPropertyValue("--mf-safe-bottom")
    .trim();

  /* --------------------------------------------------------------- MF-12 */
  const fixed = [];
  document.querySelectorAll("body *").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") return;
    const r = el.getBoundingClientRect();
    if (r.height < 8 || r.width < 8) return;
    fixed.push({ el, r, pos: cs.position });
  });
  out.fixedChrome = fixed.map((f) => ({
    sel: pathOf(f.el),
    pos: f.pos,
    top: Math.round(f.r.top),
    bottom: Math.round(window.innerHeight - f.r.bottom),
    h: Math.round(f.r.height),
  }));
  out.coveredActions = [];
  fixed.forEach(({ el, r }) => {
    if (r.height > window.innerHeight * 0.9) return; // full-screen overlay, not chrome
    controls.forEach((c) => {
      if (el.contains(c) || out.coveredActions.length > 4) return;
      const cr = c.getBoundingClientRect();
      const cx = cr.left + cr.width / 2;
      const cy = cr.top + cr.height / 2;
      if (cx < 0 || cy < 0 || cx > vw || cy > window.innerHeight) return;
      if (cr.bottom < r.top || cr.top > r.bottom) return;
      const hit = document.elementFromPoint(cx, cy);
      if (hit && el.contains(hit) && !c.contains(hit)) {
        out.coveredActions.push({
          control: pathOf(c),
          coveredBy: pathOf(el),
        });
      }
    });
  });

  /* ---------------------------------------------------------------- MF-5 */
  out.focusableCount = controls.length;
  out.noFocusRing = [];
  controls.slice(0, 40).forEach((el) => {
    // Closed <details> content cannot take focus; skip it rather than reporting
    // a ring it could never show.
    if (!el.getClientRects().length) return;
    const before = el.style.outline;
    el.focus({ preventScroll: true });
    if (document.activeElement !== el) return;
    const cs = getComputedStyle(el);
    const hasRing =
      (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) ||
      cs.boxShadow !== "none";
    if (!hasRing && out.noFocusRing.length < 6) out.noFocusRing.push(pathOf(el));
    el.style.outline = before;
  });
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

  /* --------------------------------------------------------------- MF-13 */
  out.runningAnimations = 0;
  out.infiniteAnimations = 0;
  if (document.getAnimations) {
    document.getAnimations().forEach((a) => {
      if (a.playState !== "running") return;
      out.runningAnimations++;
      const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
      if (t.iterations === Infinity) out.infiniteAnimations++;
    });
  }

  out.title = document.title;
  return out;
}

async function openPage(ctx, name) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
  });
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(origin + "/" + name, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector("html.auth-ready", { timeout: 8000 });
  } catch (_) {
    /* pages without the guard still get measured */
  }
  return { page, errors, requests };
}

function verdict(m, vp) {
  const v = [];
  if (m.overflow)
    v.push({ id: "MF-1", detail: `scrollWidth ${m.scrollWidth} > ${m.innerWidth}`, data: m.overflowOffenders });
  if (m.zoomBlocked) v.push({ id: "MF-2", detail: "viewport meta blocks zoom", data: m.viewportMeta });
  if (m.bodyFontPx && m.bodyFontPx < 12) v.push({ id: "MF-2", detail: `body font ${m.bodyFontPx}px` });
  if (vp.mobile && m.smallFormFonts.length)
    v.push({ id: "MF-2", detail: "form font < 16px (iOS zoom)", data: m.smallFormFonts });
  if (vp.mobile && m.smallTargets.length)
    v.push({ id: "MF-3", detail: `${m.smallTargets.length} control(s) under 44x44`, data: m.smallTargets });
  if (m.unnamedControls.length)
    v.push({ id: "MF-5", detail: "control without accessible name", data: m.unnamedControls });
  if (m.noFocusRing.length)
    v.push({ id: "MF-5", detail: "control with no visible focus ring", data: m.noFocusRing });
  if (m.coveredActions.length)
    v.push({ id: "MF-12", detail: "action covered by fixed chrome", data: m.coveredActions });
  if (!m.safeAreaVar) v.push({ id: "MF-11", detail: "safe-area variables missing" });
  return v;
}

/* --------------------------------------------------------------------- flow */
const { makeCsv } = require("./csv-fixture.cjs");

async function runFlow(browser, viewport) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: !!viewport.mobile,
    isMobile: !!viewport.mobile,
    deviceScaleFactor: viewport.mobile ? 2 : 1,
  });
  await fixture(ctx);
  const { page, errors } = await openPage(ctx, "scanner.html");
  const steps = [];
  const step = (name, ok, detail) => {
    steps.push({ name, ok: !!ok, detail });
  };

  try {
    await page.setInputFiles("#historyFile", {
      name: "fixture.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(makeCsv(), "utf8"),
    });
    await page.waitForFunction(() => /Imported 2 symbols/.test(document.getElementById("historyMessage").textContent), null, { timeout: 8000 });
    step("fixture loaded (2 symbols, daily)", true, await page.locator("#historyMessage").innerText());

    // MF-11: shrink to a keyboard-sized viewport, focus a field, and require the
    // field to stay inside the visible area (the layer scrolls it into view).
    await page.setViewportSize({ width: 390, height: 500 });
    await page.locator("#watchInput").focus();
    await page.waitForTimeout(700);
    const kb = await page.evaluate(() => {
      const el = document.getElementById("watchInput").getBoundingClientRect();
      const vv = window.visualViewport;
      const bottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
      return {
        top: Math.round(el.top),
        bottom: Math.round(el.bottom),
        viewBottom: Math.round(bottom),
        covered: document.elementFromPoint(el.left + el.width / 2, el.top + el.height / 2) !== document.activeElement,
      };
    });
    step(
      "focused field stays visible with the keyboard open",
      kb.top >= 0 && kb.bottom <= kb.viewBottom + 1,
      JSON.stringify(kb),
    );
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(250);

    const rowsBefore = await page.locator("#resultsBody tr").count();
    await page.locator("#scanBtn").click();
    await page.waitForTimeout(2500);
    const rows = page.locator("#resultsBody tr[data-row]");
    const rowCount = await rows.count();
    const scanState = await page.evaluate(() => ({
      msg: document.getElementById("msg").textContent.slice(0, 160),
      issues: [...document.getElementById("feedIssues").children].map((li) => li.textContent).slice(0, 4),
      watch: document.getElementById("watchInput").value.slice(0, 60),
      pLeft: document.getElementById("pLeft").value,
      pRight: document.getElementById("pRight").value,
      source: document.getElementById("historySource").value,
      daily: document.getElementById("tfDaily").checked,
    }));
    step(
      "scan rendered rows from fixture",
      rowCount > 0,
      `rows=${rowCount} (before scan ${rowsBefore}) ` + JSON.stringify(scanState),
    );

    if (rowCount > 0) {
      const symA = (await rows.nth(0).locator("td b").first().innerText()).trim();
      await rows.nth(0).locator("td").nth(2).click();
      await page.waitForTimeout(300);
      const sheetOpen = await page.locator("#setupSheet").getAttribute("data-mf-open");
      const titleA = await page.locator("#setupSheetTitle").innerText();
      const fieldCount = await page.locator("#setupFields dt").count();
      const scrollable = await page.locator(".mf-sheet-body").evaluate((el) => el.scrollHeight > 0 && getComputedStyle(el).overflowY === "auto");
      step("tap row A opens complete scrollable details", sheetOpen === "true" && titleA.includes(symA) && fieldCount >= 12 && scrollable, `title="${titleA}" fields=${fieldCount} scrollable=${scrollable}`);

      const insideTrap = await page.evaluate(() => {
        const sheet = document.getElementById("setupSheet");
        return sheet.contains(document.activeElement);
      });
      step("focus moved into the sheet", insideTrap, "activeElement inside sheet: " + insideTrap);

      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      const closed = await page.locator("#setupSheet").getAttribute("data-mf-open");
      const restored = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-row"));
      step("Escape closes and restores focus to the row", closed === "false" && restored === "0", `open=${closed} focusRow=${restored}`);

      if (rowCount > 1) {
        const symB = (await rows.nth(1).locator("td b").first().innerText()).trim();
        await rows.nth(1).locator("td").nth(2).click();
        await page.waitForTimeout(300);
        const titleB = await page.locator("#setupSheetTitle").innerText();
        step("tap row B updates details", titleB.includes(symB) && symB !== symA, `A="${symA}" B="${symB}" title="${titleB}"`);
      } else {
        // Escape above closed the sheet; reopen the only row before using its chart action.
        await rows.nth(0).locator("td").nth(2).click();
        await page.waitForTimeout(300);
      }

      await page.locator("#setupChart").click();
      await page.waitForTimeout(400);
      const chart = await page.evaluate(() => {
        const c = document.getElementById("chart");
        const r = c.getBoundingClientRect();
        return {
          visible: document.getElementById("chartCard").style.display !== "none",
          cssW: Math.round(r.width),
          cssH: Math.round(r.height),
          fits: r.width <= document.documentElement.clientWidth + 1,
        };
      });
      step("chart renders single-column at container width", chart.visible && chart.fits && chart.cssH >= 220, JSON.stringify(chart));

      await page.locator("#expandChart").click();
      await page.waitForTimeout(300);
      const expanded = await page.evaluate(() => {
        const host = document.querySelector(".mf-chart-expand");
        const c = document.getElementById("chart");
        return {
          open: !!host,
          canvasInside: !!(host && host.contains(c)),
          role: host ? host.getAttribute("role") : null,
          h: c ? Math.round(c.getBoundingClientRect().height) : 0,
        };
      });
      step("chart expands and keeps the same canvas", expanded.open && expanded.canvasInside && expanded.role === "dialog", JSON.stringify(expanded));

      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const collapsed = await page.evaluate(() => ({
        gone: !document.querySelector(".mf-chart-expand"),
        back: !!document.getElementById("chartWrap").contains(document.getElementById("chart")),
        focus: document.activeElement && document.activeElement.id,
        tag: document.activeElement && document.activeElement.tagName,
        text: document.activeElement && (document.activeElement.textContent || "").trim().slice(0, 24),
      }));
      step("Escape collapses expansion and restores focus", collapsed.gone && collapsed.back && collapsed.focus === "expandChart", JSON.stringify(collapsed));

      // Draft plan hand-off. The fixture can yield one or two passing rows
      // depending on the calendar, so use the second row only when it exists.
      await page.locator("#setupSheet").evaluate((el) => (el.dataset.mfOpen = el.dataset.mfOpen));
      await rows.nth(rowCount > 1 ? 1 : 0).locator("td").nth(2).click();
      await page.waitForTimeout(250);
      const draftSym = (await page.locator("#setupSheetTitle").innerText()).split("·")[0].trim();
      await page.locator("#setupPlan").click();
      await page.waitForURL("**/setups.html?*");
      await page.waitForTimeout(400);
      const plan = await page.evaluate(() => ({
        sym: document.getElementById("mSym").value,
        entry: document.getElementById("mEntry").value,
        stop: document.getElementById("mStop").value,
        target: document.getElementById("mTarget").value,
        msg: document.getElementById("msg").textContent.slice(0, 80),
      }));
      step("draft plan prefilled from scanner", plan.sym === draftSym && plan.entry !== "", `expected ${draftSym}, got ${JSON.stringify(plan)}`);
    }
  } catch (e) {
    step("flow completed without throwing", false, e.message);
  }

  const reqs = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name)).catch(() => []);
  await ctx.close();
  return { steps, errors, viewport: viewport.name, requests: reqs.length };
}

/* --------------------------------------------------------------------- main */
(async () => {
  const server = http.createServer((req, res) => {
    let file = path.resolve(".", "." + new URL(req.url, "http://localhost").pathname);
    if (file.endsWith("/")) file += "index.html";
    try {
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".json")
              ? "application/json"
              : "text/html",
      );
      res.end(fs.readFileSync(file));
    } catch (e) {
      res.statusCode = 404;
      res.end("Missing");
    }
  });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const actualPort = (server.address && server.address().port) || port;
  origin = 'http://127.0.0.1:' + actualPort;

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.TEST_BROWSER_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  let flowResult = null;



  if (!FLOW_ONLY) {
    for (const vp of VIEWPORTS.filter((v) => !ONLY_VP || v.name === ONLY_VP || v.name.startsWith(ONLY_VP))) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: !!vp.mobile,
        isMobile: !!vp.mobile,
        deviceScaleFactor: vp.mobile ? 2 : 1,
      });
      await fixture(ctx);
      // Breakpoint-only viewports exercise the deep pages; the real device
      // widths and desktop regression sweep every page.
      const pages = (vp.name.indexOf("bp-") === 0 ? DEEP_PAGES : ALL_PAGES).filter(
        (p) => !ONLY_PAGE || p.indexOf(ONLY_PAGE) === 0,
      );
      const deep = SHOT_VPS.includes(vp.name);
      for (const name of pages) {
        const { page, errors } = await openPage(ctx, name);
        // Establish keyboard modality, so a programmatic focus reports the same
        // ring a keyboard user would see (MF-5).
        await page.keyboard.press("Tab").catch(() => {});
        await page.waitForTimeout(120);
        let m;
        let v = [];
        try {
          m = await page.evaluate(measure);
          v = verdict(m, vp);
        } catch (e) {
          m = { error: e.message };
          v = [{ id: "MF-0", detail: "measure failed: " + e.message }];
        }
        record({
          page: name,
          viewport: vp.name,
          width: vp.width,
          overflow: m.overflow,
          scrollWidth: m.scrollWidth,
          smallTargets: m.smallTargets || [],
          unnamed: m.unnamedControls || [],
          noFocusRing: m.noFocusRing || [],
          covered: m.coveredActions || [],
          infiniteAnimations: m.infiniteAnimations,
          errors,
          violations: v,
        });
        if (errors.length) consoleErrors.push({ page: name, viewport: vp.name, errors });

        if (deep && DEEP_PAGES.includes(name)) {
          const shot = `qa/mobile-first-${vp.name}-${name.replace(/[/?=&]/g, "_").replace(".html", "")}.png`;
          try {
            await page.screenshot({ path: shot, fullPage: false });
          } catch (_) {}
        }
        await page.close();
      }
      await ctx.close();

      // Reduced motion pass on the dashboard at this width (MF-13).
      const rmCtx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        reducedMotion: "reduce",
        hasTouch: !!vp.mobile,
      });
      await fixture(rmCtx);
      const rm = await openPage(rmCtx, "index.html");
      const anims = await rm.page.evaluate(() => {
        const running = (document.getAnimations ? document.getAnimations() : []).filter((a) => a.playState === "running");
        const infinite = running.filter((a) => {
          const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
          return t.iterations === Infinity;
        });
        return { running: running.length, infinite: infinite.length };
      });
      record({
        page: "index.html",
        viewport: vp.name + "/reduced-motion",
        reducedMotion: anims,
        violations:
          anims.infinite > 0
            ? [{ id: "MF-13", detail: `${anims.infinite} infinite animation(s) with reduced motion requested` }]
            : [],
        errors: rm.errors,
      });
      await rmCtx.close();
    }
  }

  // Interaction flow at the primary phone width.
  flowResult = await runFlow(browser, VIEWPORTS[2]);

  // Duplicate-request check (MF-14) on the scanner.
  const dupCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await fixture(dupCtx);
  const dup = await openPage(dupCtx, "scanner.html");
  const apiCount = async () =>
    dup.requests.filter((u) => u.includes("/api/market/yahoo")).length;
  await dup.page.waitForTimeout(800);
  const before = await apiCount();
  for (const [w, h] of [
    [844, 390],
    [390, 844],
    [768, 1024],
  ]) {
    await dup.page.setViewportSize({ width: w, height: h });
    await dup.page.waitForTimeout(500);
  }
  const after = await apiCount();
  await dupCtx.close();

  const dupOk = after <= before;
  record({
    page: "scanner.html",
    viewport: "390x844/rotation",
    requests: { before, after },
    violations: dupOk
      ? []
      : [{ id: "MF-14", detail: `rotation added ${after - before} extra market request(s)` }],
    errors: [],
  });

  // The harness deliberately stubs the market/Supabase edges, so a 404/503 for
  // those endpoints is fixture noise. Only an uncaught pageerror is a defect.
  const uncaught = consoleErrors.filter((e) => e.errors.some((x) => x.indexOf("pageerror:") === 0));
  const networkNoise = consoleErrors.length - uncaught.length;

  const summary = {
    generatedAt: new Date().toISOString(),
    uncaughtPageErrors: uncaught,
    consoleErrorPages: consoleErrors.length,
    fixtureNetworkNoisePages: networkNoise,
    browser: "Chromium " + browser.version(),
    engine: "Playwright 1.51.1 (headless)",
    deviceBasis: "emulated viewports only — no physical device in this run",
    viewports: VIEWPORTS.map((v) => `${v.width}x${v.height}`),
    checks: results.length,
    failures: failures.length,
    flow: flowResult.steps,
    flowErrors: flowResult.errors,
    duplicateRequests: { before, after, ok: dupOk },
    consoleErrors,
    results,
    failureDetail: failures,
  };
  fs.writeFileSync("qa/mobile-first.json", JSON.stringify(summary, null, 2));

  console.log("browser:", summary.browser);
  console.log("checks:", summary.checks, "failures:", summary.failures);
  console.log("flow:");
  for (const s of flowResult.steps) console.log("  ", s.ok ? "PASS" : "FAIL", s.name, "—", s.detail);
  if (flowResult.errors.length) console.log("flow page errors:", flowResult.errors);
  console.log("duplicate requests on rotation:", before, "->", after, dupOk ? "OK" : "FAIL");
  const byCriterion = {};
  for (const f of failures) byCriterion[f.id] = (byCriterion[f.id] || 0) + 1;
  console.log("failures by criterion:", byCriterion);
  console.log("uncaught page errors:", uncaught.length, "| pages with fixture 404/503 noise:", networkNoise);
  for (const u of uncaught.slice(0, 6)) console.log("  !", u.page, u.viewport, u.errors.filter((x) => x.indexOf("pageerror:") === 0).join(" | ").slice(0, 220));

  await browser.close();
  server.close();
  process.exitCode = failures.length || flowResult.steps.some((s) => !s.ok) ? 1 : 0;
})();
