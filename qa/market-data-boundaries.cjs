/**
 * Market-data contract tests (no browser, no network).
 *
 * Uses a controlled clock to pin freshness boundaries, future-candle filtering,
 * remaining-history sufficiency and the rule that imported/redated history can
 * never present itself as live. Nothing here calls a provider.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
  }
}

const ctx = { window: {}, console, Date, JSON, Math, Number, Map, Set, Error, isFinite };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("assets/js/market-data.js", "utf8"), ctx);
const MD = ctx.window.LfcMarketData;
ctx.LfcMarketData = MD;
ctx.window.LfcMarketData = MD;
vm.runInContext(fs.readFileSync("assets/js/csv-history.js", "utf8"), ctx);
const CSV = ctx.window.LfcCsvHistory;

const HOUR = 3600;
const DAY = 86400;

function chart(rows, { offset = 19800, tz = "Asia/Kolkata" } = {}) {
  return {
    chart: {
      error: null,
      result: [
        {
          meta: { gmtoffset: offset, exchangeTimezoneName: tz },
          timestamp: rows.map((b) => b.t),
          indicators: {
            quote: [
              {
                open: rows.map((b) => b.o),
                high: rows.map((b) => b.h),
                low: rows.map((b) => b.l),
                close: rows.map((b) => b.c),
                volume: rows.map((b) => b.v ?? 1000),
              },
            ],
          },
        },
      ],
    },
  };
}

function barsBack(count, intervalSec, lastTs) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = lastTs - i * intervalSec;
    const c = 100 + Math.sin(i / 6) * 3 + (count - i) * 0.05;
    out.push({ t, o: c - 0.5, h: c + 1.2, l: c - 1.4, c, v: 900000 + i * 100 });
  }
  return out;
}

// --- freshness boundaries, controlled clock --------------------------------
check("daily freshness exactly at tolerance is accepted, 1s past is stale", () => {
  const now = Date.UTC(2026, 10, 13, 6, 30);
  const atEdge = [{ timestamp: now / 1000 - 4 * DAY }];
  const past = [{ timestamp: now / 1000 - 4 * DAY - 1 }];
  assert.equal(MD.stale(atEdge, "1d", "TCS.NS", now), false);
  assert.equal(MD.stale(past, "1d", "TCS.NS", now), true);
});

check("weekly and monthly tolerances are 14 and 62 days", () => {
  const now = Date.UTC(2026, 10, 13, 6, 30);
  assert.equal(MD.stale([{ timestamp: now / 1000 - 14 * DAY }], "1wk", "TCS.NS", now), false);
  assert.equal(MD.stale([{ timestamp: now / 1000 - 14 * DAY - 1 }], "1wk", "TCS.NS", now), true);
  assert.equal(MD.stale([{ timestamp: now / 1000 - 62 * DAY }], "1mo", "TCS.NS", now), false);
  assert.equal(MD.stale([{ timestamp: now / 1000 - 62 * DAY - 1 }], "1mo", "TCS.NS", now), true);
});

check("in-session 15m tolerance is 2 intervals + 900s, both edges", () => {
  const now = Date.UTC(2026, 10, 11, 6, 30); // Wed 12:00 IST
  assert.equal(MD.stale([{ timestamp: now / 1000 - 2700 }], "15m", "TCS.NS", now), false);
  assert.equal(MD.stale([{ timestamp: now / 1000 - 2701 }], "15m", "TCS.NS", now), true);
});

check("completed-candle boundary: close time +60s must not exceed now", () => {
  const now = Date.UTC(2026, 10, 11, 6, 30);
  const edge = now / 1000 - HOUR - 60; // end + 60s === now -> complete
  const oneSecLate = edge + 1; // end + 60s > now -> future
  const edgeFeed = MD.parseYahoo(chart(barsBack(3, HOUR, edge)), "TCS.NS", "1h", now);
  assert.equal(edgeFeed.bars.length, 3);
  const lateFeed = MD.parseYahoo(chart(barsBack(3, HOUR, oneSecLate)), "TCS.NS", "1h", now);
  assert.equal(lateFeed.bars.length, 2);
  assert.equal(lateFeed.excludedFuture, 1);
  assert.equal(lateFeed.incomplete, lateFeed.excludedFuture);
});

// --- future filtering + remaining-history sufficiency -----------------------
check("future candles are counted and excluded from bars", () => {
  const now = Date.UTC(2026, 10, 11, 6, 30);
  const rows = barsBack(120, HOUR, now / 1000 - 2 * HOUR).concat(
    barsBack(5, HOUR, now / 1000 + 5 * HOUR),
  );
  const feed = MD.parseYahoo(chart(rows), "TCS.NS", "1h", now);
  assert.equal(feed.supplied, 125);
  assert.equal(feed.bars.length, 120);
  assert.equal(feed.excludedFuture, 5);
  assert.equal(feed.bars[0].timestamp > now / 1000, false);
  assert.ok(feed.bars[feed.bars.length - 1].timestamp < now / 1000);
});

check("remaining history after future filtering can be insufficient", () => {
  const now = Date.UTC(2026, 10, 11, 6, 30);
  const rows = barsBack(95, HOUR, now / 1000 - 2 * HOUR).concat(
    barsBack(10, HOUR, now / 1000 + 10 * HOUR),
  );
  const feed = MD.parseYahoo(chart(rows), "TCS.NS", "1h", now);
  assert.equal(feed.bars.length, 95);
  assert.ok(feed.bars.length < 200, "hourly minimum is 200");
  assert.ok(feed.excludedFuture >= 10);
});

check("all-future history is rejected, never returned as an empty success", () => {
  const now = Date.UTC(2026, 10, 11, 6, 30);
  const rows = barsBack(5, HOUR, now / 1000 + 10 * HOUR);
  assert.throws(() => MD.parseYahoo(chart(rows), "TCS.NS", "1h", now), /No valid completed candles/);
});

check("non-live provenance is explicit on every parsed feed", () => {
  const now = Date.UTC(2026, 10, 11, 6, 30);
  const feed = MD.parseYahoo(chart(barsBack(30, HOUR, now / 1000 - 2 * HOUR)), "TCS.NS", "1h", now);
  assert.equal(feed.live, false);
  assert.match(feed.mode, /not live/);
  assert.match(feed.source, /historical/);
  assert.equal(typeof feed.fetchedAt, "number");
  assert.equal(typeof feed.candleAt, "number");
  assert.equal(feed.fetchedAt, now);
  assert.ok(feed.candleAt < feed.fetchedAt);
  assert.equal(feed.timezone, "Asia/Kolkata");
});

// --- imported CSV: redating cannot buy live/current status ------------------
function csvText(rows) {
  return ["symbol,date,open,high,low,close,volume"]
    .concat(rows.map(([d, c]) => `TCS.NS,${d},${c - 1},${c + 1},${c - 1.5},${c},1000`))
    .join("\n");
}
function istDate(ms) {
  return new Date(ms + 19800000).toISOString().slice(0, 10);
}

check("redated demo CSV stays imported and never becomes live", () => {
  const now = Date.UTC(2026, 10, 14, 6, 30);
  // an old 2020 series rewritten with dates up to yesterday
  const rows = [];
  for (let i = 0; i < 120; i++) rows.push([istDate(now - (120 - i) * DAY * 1000), 100 + i * 0.1]);
  const all = CSV.parse(csvText(rows), now);
  const feed = CSV.history(all, "TCS.NS", "1d", now);
  assert.equal(feed.live, false);
  assert.match(feed.mode, /imported/);
  assert.match(feed.mode, /not live/);
  assert.match(feed.source, /Local CSV/);
  assert.equal(feed.supplied, feed.bars.length + feed.excludedFuture);
  assert.equal(JSON.stringify(feed).includes('"live":true'), false);
  assert.ok(!/live feed/i.test(feed.source));
  // a redated file is still a file: it cannot claim the current session
  assert.equal(feed.fetchedAt, now);
  assert.ok(feed.candleAt <= now);
});

check("CSV rejects unsupported intervals instead of pretending coverage", () => {
  const now = Date.UTC(2026, 10, 14, 6, 30);
  const rows = [[istDate(now - DAY * 1000), 100]];
  const all = CSV.parse(csvText(rows), now);
  assert.throws(() => CSV.history(all, "TCS.NS", "1wk", now), /daily candles only/);
});

// --- no hidden probability driving eligibility or sizing -------------------
check("scanner/market sources contain no probability or random sizing input", () => {
  for (const f of ["scanner.html", "assets/js/market-data.js", "assets/js/csv-history.js"]) {
    const src = fs.readFileSync(f, "utf8");
    assert.ok(!/probability|winrate|win-rate|\bodds\b/i.test(src.replace(/probability is not inferred|no probability/gi, "")), "probability token in " + f);
    assert.ok(!/Math\.random/.test(src), "Math.random in " + f);
  }
});

const failed = results.filter((r) => !r.pass);
console.log(JSON.stringify({ checks: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
