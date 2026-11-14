/**
 * Integrated data propagation (browser, intercepted provider).
 *
 * Segment under test:
 *   provider payload -> parseYahoo -> localStorage bar store
 *     -> scanner rows -> chart canvas -> setup details -> Setups prefill
 *
 * The provider is INTERCEPTED; this demonstrates propagation, not a live feed.
 * Missing segments are reported explicitly in `segments`.
 */
const { chromium } = require("playwright");
const { fixture, origin, port } = require("./fixtures.cjs");
const http = require("http");
const fs = require("fs");
const path = require("path");

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, error: String(e.message || e).slice(0, 300) });
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const DAY = 86400;
const todayUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
const KEY = "lfc.bars.v2.TCS.NS.1d.730d";

function shape(bump = 0) {
  const a = [];
  for (let i = 0; i < 100; i++) a.push(220 - i * 1.1 + Math.sin(i / 3) * 0.6);
  for (let i = 0; i < 22; i++) a.push(110 + Math.sin(i / 2) * 0.5);
  for (let i = 0; i < 8; i++) a.push(110 + i * 1.4);
  for (let i = 0; i < 10; i++) a.push(121.2 - i * 1.3);
  return a.map((c) => c + bump);
}
function bars(bump) {
  const a = shape(bump);
  let last = null;
  return a.map((c, i) => {
    const o = last == null ? c : last;
    last = c;
    return { t: (todayUtc - DAY * 1000) / 1000 - (a.length - 1 - i) * DAY, o, h: Math.max(o, c) * 1.008, l: Math.min(o, c) * 0.992, c, v: 900000 + i };
  });
}
function chart(bs) {
  return { chart: { error: null, result: [{ meta: { gmtoffset: 19800, exchangeTimezoneName: "Asia/Kolkata" }, timestamp: bs.map((b) => b.t), indicators: { quote: [{ open: bs.map((b) => b.o), high: bs.map((b) => b.h), low: bs.map((b) => b.l), close: bs.map((b) => b.c), volume: bs.map((b) => b.v) }] } }] } };
}

(async () => {
  const server = http.createServer((req, res) => {
    let f = path.resolve(".", "." + new URL(req.url, "http://x").pathname);
    if (f.endsWith("/")) f += "index.html";
    if (!fs.existsSync(f)) { res.statusCode = 404; return res.end("nf"); }
    res.setHeader("Content-Type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html");
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await fixture(ctx);

  let version = 1;
  const requests = [];
  await ctx.route("**/api/market/**", async (route) => {
    const u = new URL(route.request().url());
    requests.push({ symbol: u.searchParams.get("symbol"), interval: u.searchParams.get("interval"), version });
    await route.fulfill({ status: 200, json: chart(bars(version === 1 ? 0 : 10)) });
  });

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(origin + "/scanner.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("html.auth-ready");
  await page.evaluate(() => {
    document.getElementById("watchInput").value = "TCS.NS";
    document.getElementById("historySource").value = "yahoo";
    document.getElementById("forceRefresh").checked = false;
    Object.keys(localStorage)
      .filter((k) => k.startsWith("lfc.bars.") || k === "lfc.scan.settings")
      .forEach((k) => localStorage.removeItem(k));
  });

  async function scan() {
    await page.locator("#scanBtn").click();
    await page.waitForFunction(() => !document.getElementById("scanBtn").disabled && document.querySelectorAll("#resultsBody tr[data-row]").length > 0, null, { timeout: 30000 });
    await page.waitForTimeout(200);
  }
  async function sheet() {
    await page.locator('#resultsBody tr[data-row="0"]').click();
    await page.waitForTimeout(200);
    return page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#setupFields dt")].map((dt, i) => [dt.textContent.trim(), document.querySelectorAll("#setupFields dd")[i].innerText.replace(/\s+/g, " ").trim()])));
  }
  async function closeSheet() { await page.keyboard.press("Escape"); await page.waitForTimeout(100); }
  const cache = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), KEY);

  // 1. provider -> store
  await scan();
  const firstSheet = await sheet();
  await closeSheet();
  const c1 = await cache();
  const out = { requests, firstSheet, store: {}, segments: {} };

  check("provider payload is written to the shared bar store", () => {
    assert(c1, "no cache entry at " + KEY);
    eq(c1.version, 2, "cache version");
    assert(typeof c1.saved === "number" && c1.saved > 0, "saved timestamp");
    assert(c1.data && Array.isArray(c1.data.bars), "cached bars");
    assert(c1.data.bars.length >= 100, "cached bar count " + (c1.data.bars || []).length);
    assert(/Yahoo historical/.test(c1.data.source), c1.data.source);
    assert(/not live/.test(c1.data.mode), c1.data.mode);
  });

  check("stored provenance matches what the details sheet shows", () => {
    eq(firstSheet["Data source"], c1.data.source, "source");
    eq(firstSheet["Data mode"], c1.data.mode, "mode");
    eq(Number(firstSheet["Candles used"].match(/\d+/)[0]), c1.data.bars.length, "used bars");
    assert(firstSheet["History integrity"].startsWith(c1.data.supplied + " supplied"), firstSheet["History integrity"]);
  });

  await page.locator('#resultsBody tr[data-row="0"] button[data-chart]').click();
  await page.waitForTimeout(200);
  const chart1 = await page.evaluate(() => ({
    title: document.getElementById("chartTitle").textContent.trim(),
    hash: document.getElementById("chart").toDataURL().slice(-80),
    visible: document.getElementById("chartCard").style.display !== "none",
  }));
  check("chart uses the selected row and is not blank", () => {
    assert(chart1.visible, "chart hidden");
    assert(/TCS\.NS/.test(chart1.title), chart1.title);
    assert(chart1.hash.length > 10, "canvas empty");
  });

  // 2. second scan must reuse the store (no provider call)
  const before = requests.length;
  await scan();
  const cachedSheet = await sheet();
  await closeSheet();
  const c2 = await cache();
  out.store = { first: c1.saved, second: c2.saved, requests: requests.length };
  check("second scan reuses the store instead of refetching", () => {
    eq(requests.length, before, "provider requests on cached scan");
    eq(c2.saved, c1.saved, "cache rewritten on hit");
    assert(/cached$/.test(cachedSheet["Data freshness"]), cachedSheet["Data freshness"]);
  });

  // 3. refresh replaces the store and every consumer sees the update
  version = 2;
  await page.evaluate(() => { document.getElementById("forceRefresh").checked = true; });
  await scan();
  const refreshed = await sheet();
  await closeSheet();
  const c3 = await cache();
  await page.locator('#resultsBody tr[data-row="0"] button[data-chart]').click();
  await page.waitForTimeout(200);
  const chart2 = await page.evaluate(() => document.getElementById("chart").toDataURL().slice(-80));
  const p1 = Number(firstSheet.Price.replace(/[^\d.]/g, ""));
  const p2 = Number(refreshed.Price.replace(/[^\d.]/g, ""));
  out.refresh = { p1, p2, savedBefore: c1.saved, savedAfter: c3.saved, chartChanged: chart1.hash !== chart2 };

  check("forced refresh replaces the store with provider v2", () => {
    assert(c3.saved > c1.saved, "cache not replaced");
    eq(requests.length, before + 1, "provider calls for refresh");
    assert(c3.data.bars[c3.data.bars.length - 1].close > c1.data.bars[c1.data.bars.length - 1].close, "refresh did not change closes");
  });
  check("details and chart follow the refreshed data", () => {
    assert(p2 > p1, `price did not rise (${p1} -> ${p2})`);
    assert(chart1.hash !== chart2, "chart did not redraw after refresh");
    assert(refreshed["Data freshness"].includes("fetched"), refreshed["Data freshness"]);
  });

  // 4. scanner -> Setups prefill
  const gtf = refreshed["GTF setup"].match(/entry ([\d.]+) · stop ([\d.]+) · target ([\d.]+)/);
  assert(gtf, "no GTF levels to draft");
  await page.locator('#resultsBody tr[data-row="0"]').click();
  await page.waitForTimeout(150);
  await Promise.all([page.waitForURL(/setups\.html/), page.locator("#setupPlan").click()]);
  await page.waitForSelector("html.auth-ready");
  const prefill = await page.evaluate(() => ({
    sym: document.getElementById("mSym").value,
    entry: document.getElementById("mEntry").value,
    stop: document.getElementById("mStop").value,
    target: document.getElementById("mTarget").value,
    note: document.getElementById("mNote").value,
    msg: document.getElementById("msg").textContent.trim(),
  }));
  out.prefill = prefill;
  check("setup levels reach the Setups draft without a broker call", () => {
    eq(prefill.sym, "TCS.NS");
    eq(Number(prefill.entry), Number(gtf[1]), "entry");
    eq(Number(prefill.stop), Number(gtf[2]), "stop");
    eq(Number(prefill.target), Number(gtf[3]), "target");
    assert(/Draft from scanner/.test(prefill.note), prefill.note);
    assert(/nothing is sent to a broker/i.test(prefill.msg), prefill.msg);
  });

  out.segments = {
    provider_to_parse: "demonstrated (intercepted provider)",
    parse_to_store: "demonstrated (localStorage lfc.bars.v2.*)",
    store_to_scanner: "demonstrated (rows + details sheet)",
    store_to_chart: "demonstrated (canvas redraw on refresh)",
    strategy_to_details: "demonstrated (Setups prefill query)",
    store_to_other_pages: "NOT PRESENT — no page other than scanner.html reads lfc.bars.v2.*",
    server_shared_store: "NOT PRESENT — no /api/v1/bars or database persistence for bars",
    streaming_updates: "NOT PRESENT — polling/refresh only, no WebSocket/SSE",
    real_provider: "NOT RUN — intercepted response; live route requires a portal session",
  };
  out.pageErrors = pageErrors;

  const failed = results.filter((r) => !r.pass);
  out.checks = results.length;
  out.failed = failed.length;
  out.failures = failed;
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  server.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.log(JSON.stringify({ fatal: String((e && e.stack) || e), checks: results.length, failed: results.filter((r) => !r.pass).length + 1 }, null, 2));
  process.exit(1);
});
