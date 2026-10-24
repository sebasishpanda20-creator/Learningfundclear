const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("../assets/js/trade-plan.js");
const p = { ...R.defaults },
  now = Date.parse("2026-10-23T10:00:00Z");
const input = {
  entry: 100,
  stop: 95,
  target: 120,
  side: "LONG",
  step: 1,
  costPerUnit: 1,
  fixedCost: 0,
};
test("cost-adjusted size, quantity rounding and reward/risk", () => {
  const r = R.size(p, [], input, now);
  assert(r.ok);
  assert.equal(r.qty, 41);
  assert.equal(r.risk, 246);
  assert.equal(r.reward, 779);
  assert(r.risk <= 250);
});
test("capital ceiling limits a very tight stop", () => {
  const r = R.size(
    p,
    [],
    { ...input, stop: 99.99, target: 105, costPerUnit: 0 },
    now,
  );
  assert(r.ok);
  assert.equal(r.qty, 500);
  assert(r.notional <= 50000);
});
test("open commitments consume risk and capital", () => {
  const t = {
    entry: 100,
    stop: 95,
    qty: 80,
    status: "OPEN",
    opened: new Date(now).toISOString(),
    estimatedCosts: 0,
  };
  const r = R.size(p, [t], input, now);
  assert(r.ok);
  assert.equal(r.qty, 16);
  assert(r.risk + 400 <= 500);
});
test("losses exhaust daily headroom even if other trades won", () => {
  const rows = [-500, 1000].map((pnl) => ({
    status: "CLOSED",
    opened: "2026-10-22",
    closedAt: new Date(now).toISOString(),
    pnl,
  }));
  assert(!R.size(p, rows, input, now).ok);
});
test("weekly loss budget works across days and archived losses remain counted", () => {
  const t = {
    status: "CLOSED",
    opened: "2026-10-20",
    closedAt: "2026-10-20",
    pnl: -1000,
    archived: true,
  };
  assert(!R.size(p, [t], input, now).ok);
});
test("whole lot cannot be afforded within risk budget", () =>
  assert(!R.size(p, [], { ...input, step: 75 }, now).ok));
test("wrong side, blank costs, infinity and missing targets fail closed", () => {
  for (const patch of [
    { stop: 101 },
    { target: 90 },
    { costPerUnit: NaN },
    { fixedCost: Infinity },
    { step: 0 },
    { target: NaN },
    { side: "OTHER" },
  ])
    assert(!R.size(p, [], { ...input, ...patch }, now).ok);
});
test("net RR gate rejects costs eroding apparent 2R", () =>
  assert(!R.size(p, [], { ...input, target: 110 }, now).ok));
test("short side and explicit zero costs work", () => {
  const r = R.size(
    p,
    [],
    { ...input, stop: 105, target: 80, costPerUnit: 0 },
    now,
  );
  assert(!r.ok);
  const s = R.size(
    p,
    [],
    { ...input, side: "SHORT", stop: 105, target: 80, costPerUnit: 0 },
    now,
  );
  assert(s.ok);
  assert.equal(s.qty, 50);
});
test("three openings use count limit even after closing", () => {
  const rows = Array.from({ length: 3 }, () => ({
    status: "CLOSED",
    opened: new Date(now).toISOString(),
    closedAt: new Date(now).toISOString(),
    pnl: 1,
  }));
  assert.match(R.size(p, rows, input, now).reason, /count limit/);
});
test("IST midnight and Monday week boundary", () => {
  assert.equal(R.dayKey("2026-10-23T18:30:00Z"), "2026-10-24");
  assert.equal(R.weekKey("2026-10-25T18:29:59Z"), "2026-10-19");
  assert.equal(R.weekKey("2026-10-25T18:30:00Z"), "2026-10-26");
});
test("P&L deducts costs once for both directions", () => {
  assert.equal(
    R.netPnl({ side: "LONG", entry: 100, qty: 10 }, 110, 20).pnl,
    80,
  );
  assert.equal(
    R.netPnl({ side: "SHORT", entry: 100, qty: 10 }, 90, 20).pnl,
    80,
  );
});
test("bad saved plans do not silently reset limits", () => {
  assert.throws(() => R.load({ getItem: () => "{bad" }, "a"));
  assert.throws(() =>
    R.load({ getItem: () => JSON.stringify({ ...p, riskPct: 10 }) }, "a"),
  );
  assert.deepEqual(R.load({ getItem: () => null }, "a"), p);
});
test("invalid legacy exposure blocks new sizing", () =>
  assert(
    !R.size(p, [{ status: "OPEN", entry: 0, stop: 1, qty: 1 }], input, now).ok,
  ));
