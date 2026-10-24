const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../assets/js/market-data.js");
require("../assets/js/quality-scanner.js");
const Q = globalThis.LfcQualityScanner;
const now = Date.UTC(2026, 9, 23, 9, 0),
  fixture = (p) =>
    Array.from({ length: 120 }, (_, i) => ({
      timestamp: now / 1000 - (120 - i) * p,
      open: 100 + i * 0.1,
      close: 100 + i * 0.1 + 0.05,
      high: 101 + i * 0.1,
      low: 99 + i * 0.1,
      volume: 1000000,
    }));
function args() {
  const bars = fixture(900);
  bars.at(-1).close = bars.at(-2).high + 0.1;
  bars.at(-1).high = bars.at(-1).close + 0.1;
  bars.at(-1).volume = 2000000;
  return {
    feed: { bars },
    higher: { bars: fixture(3600) },
    interval: "15m",
    higherInterval: "1h",
    market: "crypto",
    mode: "intraday",
    costBps: 10,
    minTurnover: 100,
    minRvol: 1.2,
    minRR: 2,
  };
}
test("confirmed trend breakout qualifies and costs reduce RR", () => {
  const a = args(),
    r = Q.analyze(a, now);
  assert.equal(r.signal, "Buy setup");
  assert(r.netRR < 3 && r.netRR >= 2);
  assert(r.stop < r.entry && r.entry < r.target);
  assert.equal(
    r.score,
    Object.values(r.parts).reduce((a, b) => a + b, 0),
  );
});
test("missing volume fails closed", () => {
  const a = args();
  a.feed.bars[10].volume = null;
  assert.match(Q.analyze(a, now).reason, /Invalid OHLCV/);
});
test("stale higher timeframe blocks otherwise valid entry", () => {
  const a = args();
  a.higher.bars.forEach((b) => (b.timestamp -= 86400));
  assert.match(Q.analyze(a, now).reason, /too old/);
});
test("incomplete candle rejected", () => {
  const a = args();
  a.feed.bars.forEach((b) => (b.timestamp += 900));
  assert.match(Q.analyze(a, now).reason, /unfinished/);
});
test("crypto gaps and duplicates rejected", () => {
  for (const offset of [-900, -450]) {
    const a = args();
    a.feed.bars[50].timestamp += offset;
    assert.equal(Q.analyze(a, now).signal, "Wait");
  }
});
test("volume and turnover gates are independent", () => {
  const a = args();
  a.minRvol = 3;
  assert.match(Q.analyze(a, now).reason, /Relative volume/);
  a.minRvol = 1.2;
  a.minTurnover = 1e12;
  assert.match(Q.analyze(a, now).reason, /turnover/);
});
test("costs can disqualify setup", () => {
  const a = args();
  a.costBps = 1000;
  assert.match(Q.analyze(a, now).reason, /after estimated costs/);
});
test("trend disagreement blocks setup", () => {
  const a = args();
  a.higher.bars
    .reverse()
    .forEach((b, i) => (b.timestamp = now / 1000 - (120 - i) * 3600));
  assert.match(Q.analyze(a, now).reason, /do not agree/);
});
test("negative settings and malformed data rejected", () => {
  const a = args();
  a.costBps = -1;
  assert.equal(Q.analyze(a, now).signal, "Wait");
  a.costBps = 1;
  a.feed.bars.at(-1).high = 1;
  assert.match(Q.analyze(a, now).reason, /Invalid OHLCV/);
});
test("bearish label is not spot short instruction", () => {
  const a = args();
  for (const f of [a.feed, a.higher])
    for (const b of f.bars) {
      const old = { ...b };
      b.open = 300 - old.open;
      b.close = 300 - old.close;
      b.high = 300 - old.low;
      b.low = 300 - old.high;
    }
  const r = Q.analyze(a, now);
  assert.equal(r.signal, "Bearish / avoid");
  assert(r.stop > r.entry && r.target < r.entry);
});
test("stock relay enforces auth and active profile; validates input before fetch", async () => {
  const { serveStockHistory } = await import("../server/stock-history.mjs"),
    config = { url: "https://test.local", anonKey: "test" };
  let calls = 0;
  const fetcher = async (url) => {
    calls++;
    return Response.json(
      url.includes("/auth/") ? { id: "u" } : [{ is_active: false }],
    );
  };
  const req = (suffix, auth = true) =>
    new Request("https://local/api/stock-history?" + suffix, {
      headers: auth ? { Authorization: "Bearer test" } : {},
    });
  assert.equal(
    (
      await serveStockHistory(
        req("symbol=INFY.NS&interval=1d", false),
        config,
        fetcher,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await serveStockHistory(
        req("symbol=https://evil&interval=1d"),
        config,
        fetcher,
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await serveStockHistory(
        req("symbol=INFY.NS&interval=1d"),
        config,
        fetcher,
      )
    ).status,
    403,
  );
});
test("stock relay never sends portal token to provider and rejects symbol mismatch", async () => {
  const { serveStockHistory } = await import("../server/stock-history.mjs"),
    config = { url: "https://test.local", anonKey: "test" };
  const fetcher = async (url, options) => {
    if (url.includes("/auth/")) return Response.json({ id: "u" });
    if (url.includes("/rest/")) return Response.json([{ is_active: true }]);
    assert.equal(options.headers.Authorization, undefined);
    assert(url.startsWith("https://query1.finance.yahoo.com/"));
    return Response.json({
      chart: { result: [{ meta: { symbol: "WRONG" }, timestamp: [1] }] },
    });
  };
  assert.equal(
    (
      await serveStockHistory(
        new Request(
          "https://local/api/stock-history?symbol=INFY.NS&interval=1d",
          { headers: { Authorization: "Bearer test" } },
        ),
        config,
        fetcher,
      )
    ).status,
    503,
  );
});
