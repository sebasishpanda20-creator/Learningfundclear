/**
 * Scanner acceptance (browser, intercepted provider).
 *
 * Ownership of the endpoint under test: scanner.html -> yahooUrl() ->
 * /api/market/yahoo -> server/worker.mjs:31 -> market-proxy.mjs
 * serveMarketYahoo() -> query1/query2.finance.yahoo.com. Here the route is
 * answered by this script's fixture: an INTERCEPTED response, not a live feed.
 *
 * Coverage: the page's own fetch path, the 12 original setup fields plus the
 * provenance fields, numeric zone/GTF consistency, every supported timeframe,
 * future-candle accounting, A/B isolation, chart selection and late arrivals.
 * Exits non-zero when any check fails so the guard can gate on it.
 */
const { chromium } = require("playwright");
const { fixture, port } = require("./fixtures.cjs");
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
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

const DAY = 86400;
const nowSec = Math.floor(Date.now() / 1000);
const todayUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());

function series(shape, { lastTs, step, volume = (i) => 900000 + i * 500 } = {}) {
  const out = [];
  let last = null;
  shape.forEach((c, i) => {
    const o = last == null ? c : last;
    const h = Math.max(o, c) * 1.008;
    const l = Math.min(o, c) * 0.992;
    out.push({ t: lastTs - (shape.length - 1 - i) * step, o, h, l, c, v: volume(i) });
    last = c;
  });
  return out;
}

const TF_FEED = {};
function chartJson(bars) {
  return {
    chart: {
      error: null,
      result: [
        {
          meta: { gmtoffset: 19800, exchangeTimezoneName: "Asia/Kolkata" },
          timestamp: bars.map((b) => b.t),
          indicators: {
            quote: [
              {
                open: bars.map((b) => b.o),
                high: bars.map((b) => b.h),
                low: bars.map((b) => b.l),
                close: bars.map((b) => b.c),
                volume: bars.map((b) => b.v),
              },
            ],
          },
        },
      ],
    },
  };
}

function baseShape(start, step, base) {
  const a = [];
  for (let i = 0; i < 100; i++) a.push(start - i * step + Math.sin(i / 3) * 0.6);
  for (let i = 0; i < 22; i++) a.push(base + Math.sin(i / 2) * 0.5);
  for (let i = 0; i < 8; i++) a.push(base + i * 1.4);
  for (let i = 0; i < 10; i++) a.push(base + 11.2 - i * 1.3);
  return a;
}
function extend(shape, n) {
  const a = shape.slice();
  while (a.length < n) a.push(a[a.length - 1] + Math.sin(a.length / 2.5) * 0.5);
  return a;
}

const A_SHAPE = baseShape(220, 1.1, 110);
const B_SHAPE = baseShape(520, 2.2, 300);

// A pattern that ends with the rally/pullback, for every timeframe length.
function tfShape(n) {
  const out = [];
  const base = 110;
  const start = base + (n - 40) * 0.8;
  for (let i = 0; i < n - 40; i++) out.push(start - i * 0.8 + Math.sin(i / 3) * 0.6);
  for (let i = 0; i < 22; i++) out.push(base + Math.sin(i / 2) * 0.5);
  for (let i = 0; i < 8; i++) out.push(base + i * 1.4);
  for (let i = 0; i < 10; i++) out.push(base + 11.2 - i * 1.3);
  return out;
}
const LONG = tfShape(245);

const FEED = {
  "API1.NS": { interval: "1d", bars: series(A_SHAPE, { lastTs: (todayUtc - DAY * 1000) / 1000, step: DAY }) },
  // volumes null -> the volume column must render an em dash, never A's value
  "API2.NS": { interval: "1d", bars: series(B_SHAPE, { lastTs: (todayUtc - DAY * 1000) / 1000, step: DAY, volume: () => null }), delay: 350 },
  "STALE.NS": { interval: "1d", bars: series(A_SHAPE, { lastTs: (todayUtc - DAY * 13 * 1000) / 1000, step: DAY }) },
  // 139 completed + 1 future bar that parseYahoo must drop as incomplete
  "FUTURE.NS": {
    interval: "1d",
    bars: series(A_SHAPE.slice(0, 139), { lastTs: (todayUtc - DAY * 1000) / 1000, step: DAY }).concat([
      { t: (todayUtc + DAY * 1000) / 1000, o: 130, h: 131, l: 129, c: 130.5, v: 1000 },
    ]),
  },
  // one bar with high < low -> discarded 1 -> scan must reject the symbol
  "BAD.NS": { interval: "1d", bars: series(A_SHAPE, { lastTs: (todayUtc - DAY * 1000) / 1000, step: DAY }), corrupt: true },
};

// one symbol, every supported timeframe, each fresh with enough completed bars
TF_FEED["1d"] = series(LONG, { lastTs: (todayUtc - DAY * 1000) / 1000, step: DAY });
TF_FEED["1wk"] = series(LONG, { lastTs: (todayUtc - 10 * DAY * 1000) / 1000, step: 7 * DAY });
TF_FEED["1mo"] = series(LONG, { lastTs: (todayUtc - 60 * DAY * 1000) / 1000, step: 30 * DAY });
TF_FEED["1h"] = series(LONG, { lastTs: nowSec - 2 * 3600, step: 3600 });
TF_FEED["15m"] = series(LONG, { lastTs: nowSec - 1800, step: 900 });

const FIELD_NAMES = [
  "Symbol",
  "Timeframe",
  "Price",
  "Trend",
  "Demand zone",
  "Position",
  "Distance to zone",
  "Zone created",
  "Volume vs 20d",
  "GTF setup",
  "GTF zone (base candle)",
  "Candles used",
  "Data freshness",
  "Data source",
  "Data mode",
  "Candle as-of",
  "Fetched at",
  "Market timezone",
  "History integrity",
  "Future candles",
];
const LEGACY_FIELDS = FIELD_NAMES.filter((n) => !n.startsWith("GTF zone") && !["Data source","Data mode","Candle as-of","Fetched at","Market timezone","History integrity","Future candles"].includes(n));
const MIN_BARS = { Daily: 100, Weekly: 60, Monthly: 50, Hourly: 200, "15m (MIS)": 200 };

function num(text) {
  const m = String(text).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

(async () => {
  const server = http.createServer((req, res) => {
    let f = path.resolve(".", "." + new URL(req.url, "http://x").pathname);
    if (f.endsWith("/")) f += "index.html";
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".json") ? "application/json" : "text/html");
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const actualPort = (server.address && server.address().port) || port;
  origin = 'http://127.0.0.1:' + actualPort;

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await fixture(ctx);

  const requests = [];
  await ctx.route("**/api/market/**", async (route) => {
    const u = new URL(route.request().url());
    const symbol = u.searchParams.get("symbol") || "";
    const interval = u.searchParams.get("interval") || "1d";
    requests.push({ symbol, interval, status: 200 });
    if (symbol === "TF.NS") {
      if (!TF_FEED[interval]) return route.fulfill({ status: 404, json: { error: "no timeframe fixture" } });
      return route.fulfill({ status: 200, json: chartJson(TF_FEED[interval]) });
    }
    const feed = FEED[symbol];
    if (!feed) return route.fulfill({ status: 404, json: { error: "no fixture" } });
    const bars = feed.corrupt ? feed.bars.map((b, i) => (i === 70 ? { ...b, h: b.l - 1 } : b)) : feed.bars;
    if (feed.delay) await new Promise((r) => setTimeout(r, feed.delay));
    await new Promise((r) => setTimeout(r, 5));
    return route.fulfill({ status: 200, json: chartJson(bars) });
  });

  const page = await ctx.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 140)); });

  await page.goto(origin + "/scanner.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("html.auth-ready", { timeout: 10000 });

  const out = { requests, scan: {}, sheet: {}, timeframes: {}, ab: {}, chart: {}, future: {}, outOfOrder: {} };

  async function setTimeframes(list) {
    await page.evaluate((tfs) => {
      const ids = { Daily: "tfDaily", Weekly: "tfWeekly", Monthly: "tfMonthly", Hourly: "tfHourly", "15m (MIS)": "tf15" };
      for (const label of Object.keys(ids)) document.getElementById(ids[label]).checked = tfs.includes(label);
      document.getElementById("historySource").value = "yahoo";
      localStorage.removeItem("lfc.scan.settings");
    }, list);
  }
  async function scanWatch(symbols, tfs) {
    await setTimeframes(tfs);
    await page.evaluate((s) => { document.getElementById("watchInput").value = s; }, symbols);
    await page.locator("#scanBtn").click();
    await page.waitForFunction(() => !document.getElementById("scanBtn").disabled, null, { timeout: 40000 });
    await page.waitForFunction(
      () => document.getElementById("resultsCard").style.display !== "none" && document.querySelectorAll("#resultsBody tr[data-row]").length > 0,
      null,
      { timeout: 20000 },
    );
    await page.waitForTimeout(250);
  }
  async function rows() {
    return page.evaluate(() =>
      [...document.querySelectorAll("#resultsBody tr[data-row]")].map((tr) => ({
        row: tr.getAttribute("data-row"),
        sym: tr.cells[0].innerText.split("\n")[0].trim(),
        tf: tr.cells[1].innerText.trim(),
        price: tr.cells[2].innerText.trim(),
        vol: tr.cells[8].innerText.trim(),
        gtf: tr.cells[9].innerText.trim(),
      })),
    );
  }
  async function sheetFields() {
    return page.evaluate(() =>
      [...document.querySelectorAll("#setupFields dt")].map((dt, i) => [
        dt.textContent.trim(),
        document.querySelectorAll("#setupFields dd")[i].innerText.replace(/\s+/g, " ").trim(),
      ]),
    );
  }
  async function openRow(idx) {
    await page.locator(`#resultsBody tr[data-row="${idx}"]`).click();
    await page.waitForTimeout(180);
    const fields = await sheetFields();
    const title = (await page.locator("#setupSheetTitle").textContent()).trim();
    const note = (await page.locator("#setupNote").textContent()).trim();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    return { title, note, fields, map: Object.fromEntries(fields) };
  }

  // --- main daily scan over 5 fixtures -------------------------------------
  await scanWatch("API1.NS, API2.NS, STALE.NS, FUTURE.NS, BAD.NS", ["Daily"]);
  out.scan.rows = await rows();
  out.scan.issues = await page.evaluate(() => [...document.querySelectorAll("#feedIssues li")].map((li) => li.textContent));
  out.scan.scanned = await page.evaluate(() => document.getElementById("stScanned").textContent.trim());
  out.scan.skipped = await page.evaluate(() => document.getElementById("stSkipped").textContent.trim());

  check("daily fixtures produce accepted rows", () => {
    assert(out.scan.rows.length >= 3, "expected >=3 accepted rows, got " + out.scan.rows.length);
    assert(out.scan.rows.some((r) => r.sym === "API1.NS"));
    assert(out.scan.rows.some((r) => r.sym === "API2.NS"));
  });

  const aOpen = await openRow(0);
  const bFirst = await openRow(1);
  const bSecond = await openRow(1);
  out.sheet.a = aOpen;
  out.sheet.b = bFirst;
  out.ab = {
    bStable: bFirst.fields.every(([k, v]) => bSecond.map[k] === v),
    bChanged: bFirst.fields.filter(([k, v]) => bSecond.map[k] !== v).map(([k]) => k),
    independentlyFetched: bFirst.map["Data source"] === aOpen.map["Data source"],
  };

  check("setup sheet keeps the 12 original fields", () => {
    const names = aOpen.fields.map(([k]) => k);
    for (const f of LEGACY_FIELDS) assert(names.includes(f), "missing original field " + f);
    eq(LEGACY_FIELDS.length, 12, "original field count");
  });
  check("setup sheet exposes the full 19-field provenance contract", () => {
    eq(aOpen.fields.length, FIELD_NAMES.length, "field count");
    eq(aOpen.fields.map(([k]) => k).join("|"), FIELD_NAMES.join("|"), "field order");
  });
  check("no original field regressed to an empty value", () => {
    for (const [k, v] of aOpen.fields.slice(0, 12)) assert(v && v !== "—" || k === "Volume vs 20d", `${k} is empty`);
  });
  check("B row is stable after opening A (no cross-row leakage)", () => {
    assert(out.ab.bStable, "fields changed: " + out.ab.bChanged.join(","));
  });

  // --- provenance contract --------------------------------------------------
  check("source names a historical provider and says it may be delayed", () => {
    assert(/Yahoo historical/i.test(aOpen.map["Data source"]), "source: " + aOpen.map["Data source"]);
    assert(/may be delayed/i.test(aOpen.map["Data source"]));
  });
  check("mode is historical and explicitly not live", () => {
    assert(/historical/i.test(aOpen.map["Data mode"]), aOpen.map["Data mode"]);
    assert(/not live/i.test(aOpen.map["Data mode"]), "mode must not imply live");
  });
  check("candle as-of, fetchedAt and timezone are present and distinct", () => {
    assert(/IST$/.test(aOpen.map["Candle as-of"]), aOpen.map["Candle as-of"]);
    assert(/IST$/.test(aOpen.map["Fetched at"]), aOpen.map["Fetched at"]);
    eq(aOpen.map["Market timezone"], "Asia/Kolkata");
    assert(aOpen.map["Candle as-of"] !== aOpen.map["Fetched at"], "candle time must not equal fetch time");
  });
  check("history integrity reports supplied/used/discarded/future/gaps consistently", () => {
    const m = aOpen.map["History integrity"].match(/(\d+) supplied · (\d+) used · (\d+) discarded · (\d+) future · (\d+) gaps/);
    assert(m, "integrity text: " + aOpen.map["History integrity"]);
    const supplied = +m[1], used = +m[2], discarded = +m[3], future = +m[4], gaps = +m[5];
    eq(used, num(aOpen.map["Candles used"]), "used bars");
    eq(supplied, used + discarded + future, "supplied = used + discarded + future");
    eq(gaps, 0, "no intraday gaps for a daily feed");
    eq(aOpen.map["Future candles"], "None excluded");
  });

  // --- numeric consistency --------------------------------------------------
  check("zone numbers are ordered and match price/position semantics", () => {
    const z = aOpen.map["Demand zone"].match(/([\d.]+) – ([\d.]+)/);
    assert(z, "zone: " + aOpen.map["Demand zone"]);
    const low = +z[1], high = +z[2], price = num(aOpen.map["Price"]);
    assert(low < high, "zone low < high");
    const pos = aOpen.map["Position"];
    if (pos === "INSIDE") {
      assert(price >= low - 0.01 && price <= high + 0.01, `price ${price} not inside ${low}-${high}`);
      eq(aOpen.map["Distance to zone"], "in zone");
    }
    if (aOpen.map["Distance to zone"] === "in zone") {
      assert(price >= low - 0.01 && price <= high + 0.01, "in-zone distance requires price in zone");
    }
  });
  check("GTF entry/stop/target are consistent with its own base-candle zone", () => {
    const g = aOpen.map["GTF setup"];
    if (g === "—") return;
    const m = g.match(/entry ([\d.]+) · stop ([\d.]+) · target ([\d.]+)/);
    assert(m, "gtf: " + g);
    const entry = +m[1], stop = +m[2], target = +m[3];
    const z = aOpen.map["GTF zone (base candle)"].match(/([\d.]+) – ([\d.]+)/);
    assert(z, "gtf zone: " + aOpen.map["GTF zone (base candle)"]);
    const distal = +z[1], proximal = +z[2];
    assert(distal < proximal, `zone ${distal}-${proximal}`);
    assert(Math.abs(entry - proximal) < 0.011, `entry ${entry} must equal base-candle proximal ${proximal}`);
    assert(stop < distal, `stop ${stop} must sit below distal ${distal}`);
    assert(target > entry, `target ${target} must sit above entry ${entry}`);
    const height = proximal - distal;
    const multiple = (target - proximal) / height;
    assert(Math.abs(multiple - Math.round(multiple)) < 0.02, `target multiple ${multiple} is not an integer zone multiple`);
    assert(multiple >= 1 && multiple <= 5, `target multiple ${multiple}`);
    const ratio = (target - entry) / (entry - stop);
    assert(ratio >= 1 && ratio <= 5, "reward/risk " + ratio);
    assert(/min 100 daily/.test(aOpen.map["Candles used"]), aOpen.map["Candles used"]);
  });
  check("sheet record matches the selected table row", () => {
    const row = out.scan.rows[0];
    eq(aOpen.map.Symbol, row.sym);
    eq(aOpen.map.Timeframe, row.tf);
    eq(num(aOpen.map.Price), num(row.price), "price");
  });

  async function chartState() {
    return page.evaluate(() => {
      const c = document.getElementById("chart");
      return {
        title: document.getElementById("chartTitle").textContent.trim(),
        hash: c.toDataURL().slice(-80),
        visible: document.getElementById("chartCard").style.display !== "none",
      };
    });
  }
  await page.locator(`#resultsBody tr[data-row="${out.scan.rows[0].row}"] button[data-chart]`).click();
  await page.waitForTimeout(150);
  const chartA = await chartState();
  await page.locator(`#resultsBody tr[data-row="${out.scan.rows[1].row}"] button[data-chart]`).click();
  await page.waitForTimeout(150);
  const chartB = await chartState();
  out.chart = { a: chartA, b: chartB };
  check("chart redraws for a different selected record", () => {
    assert(chartA.visible && chartB.visible, "chart hidden");
    assert(chartA.hash !== chartB.hash, "canvas did not change between symbols");
    assert(/API1\.NS/.test(chartA.title) && /API2\.NS/.test(chartB.title), "chart title lost the symbol");
  });

  // --- future-candle accounting on the page --------------------------------
  const futureIdx = out.scan.rows.findIndex((r) => r.sym === "FUTURE.NS");
  if (futureIdx >= 0) {
    const f = await openRow(futureIdx);
    out.future = { fields: f.map, note: f.note };
    check("future candles are excluded and visibly explained", () => {
      const m = f.map["History integrity"].match(/(\d+) supplied · (\d+) used · (\d+) discarded · (\d+) future · (\d+) gaps/);
      assert(m, f.map["History integrity"]);
      assert(+m[4] >= 1, "expected at least one future candle");
      assert(/excluded/i.test(f.map["Future candles"]), f.map["Future candles"]);
      assert(/after the current time/i.test(f.map["Future candles"]));
      eq(num(f.map["Candles used"]), +m[2], "used count");
    });
    check("setup note says historical candles are not a live feed", () => {
      assert(/not a live feed/i.test(f.note), f.note);
    });
  } else {
    check("FUTURE.NS accepted with a future candle", () => { throw new Error("FUTURE.NS missing; issues: " + out.scan.issues.join(" | ")); });
  }

  check("stale and corrupt fixtures stay rejected with reasons", () => {
    assert(!out.scan.rows.some((r) => r.sym === "STALE.NS"), "stale row accepted");
    assert(!out.scan.rows.some((r) => r.sym === "BAD.NS"), "corrupt row accepted");
    assert(out.scan.issues.some((t) => t.includes("STALE.NS")), "no stale reason");
    assert(out.scan.issues.some((t) => t.includes("BAD.NS")), "no corrupt reason");
  });

  // --- every supported timeframe -------------------------------------------
  await scanWatch("TF.NS", ["Daily", "Weekly", "Monthly", "Hourly", "15m (MIS)"]);
  const tfRows = await rows();
  out.timeframes.rows = tfRows;
  out.timeframes.requested = requests.filter((r) => r.symbol === "TF.NS").map((r) => r.interval);

  check("all five supported timeframes are requested and accepted", () => {
    eq(new Set(tfRows.map((r) => r.tf)).size, 5, "distinct accepted timeframes: " + tfRows.map((r) => r.tf).join(","));
    for (const label of Object.keys(MIN_BARS)) {
      assert(tfRows.some((r) => r.tf === label), "missing accepted row for " + label);
    }
    eq(new Set(requests.filter((r) => r.symbol === "TF.NS").map((r) => r.interval)).size, 5, "distinct intervals requested");
  });

  const tfSheets = {};
  for (let i = 0; i < tfRows.length; i++) {
    const s = await openRow(Number(tfRows[i].row));
    tfSheets[tfRows[i].tf] = s.map;
  }
  out.timeframes.sheets = tfSheets;
  check("each timeframe sheet states its own minimum bar requirement", () => {
    for (const [label, min] of Object.entries(MIN_BARS)) {
      const map = tfSheets[label];
      assert(map, "no sheet for " + label);
      assert(new RegExp("min " + min + " ").test(map["Candles used"]), `${label}: ${map["Candles used"]}`);
      assert(/not live/i.test(map["Data mode"]), `${label} mode: ${map["Data mode"]}`);
      assert(num(map["Candles used"]) >= min, `${label} used < min`);
    }
  });
  check("intraday sheets report their own timezone and non-live mode", () => {
    for (const label of ["Hourly", "15m (MIS)"]) {
      eq(tfSheets[label]["Market timezone"], "Asia/Kolkata");
      assert(/historical/i.test(tfSheets[label]["Data source"]));
    }
  });

  // --- chart selection follows the clicked row -----------------------------
  const tfTitles = [];
  for (const r of tfRows.slice(0, 2)) {
    await page.locator(`#resultsBody tr[data-row="${r.row}"] button[data-chart]`).click();
    await page.waitForTimeout(150);
    tfTitles.push((await chartState()).title);
  }
  out.timeframes.chartTitles = tfTitles;
  check("chart title follows the selected timeframe", () => {
    assert(tfTitles[0] !== tfTitles[1], "title did not change with timeframe");
    assert(tfTitles[0].includes(tfRows[0].tf) && tfTitles[1].includes(tfRows[1].tf), tfTitles.join(" | "));
    assert(/TF\.NS/.test(tfTitles[0]) && /TF\.NS/.test(tfTitles[1]));
  });

  // --- late arrival must not steal an explicit selection --------------------
  await scanWatch("API1.NS, API2.NS", ["Daily"]);
  const late = await page.evaluate(() => document.querySelector('#resultsBody tr[data-row="0"]').cells[0].innerText.split("\n")[0].trim());
  await page.locator('#resultsBody tr[data-row="0"]').click();
  await page.waitForTimeout(150);
  const midTitle = (await page.locator("#setupSheetTitle").textContent()).trim();
  await page.waitForFunction(() => document.querySelectorAll("#resultsBody tr[data-row]").length >= 2, null, { timeout: 20000 });
  const afterLate = (await page.locator("#setupSheetTitle").textContent()).trim();
  await page.keyboard.press("Escape");
  out.outOfOrder = { late, midTitle, afterLate };
  check("a late-arriving row does not replace the open selection", () => {
    assert(midTitle.includes(late), "selection lost: " + midTitle);
    eq(afterLate, midTitle, "selection changed by late arrival");
  });

  out.pageErrors = pageErrors;
  out.consoleErrors = consoleErrors;
  out.requests = requests;
  const failed = results.filter((r) => !r.pass);
  out.checks = results.length;
  out.failed = failed.length;
  out.failures = failed;
  console.log(JSON.stringify(out, null, 2));

  await browser.close();
  server.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.log(JSON.stringify({ fatal: String(e && e.stack || e), checks: results.length, failed: results.filter((r) => !r.pass).length + 1 }, null, 2));
  process.exit(1);
});
