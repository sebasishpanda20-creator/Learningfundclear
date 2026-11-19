"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
require("../assets/js/crypto-data.js");
const D = global.LfcCryptoData;
const now = Date.UTC(2026, 10, 19, 12);
const day = 86400000;

function payload() {
  return {
    data: Array.from({ length: 30 }, (_, i) => ({
      value: String(10 + i),
      value_classification: i < 5 ? "Extreme Fear" : "Fear",
      timestamp: String((now - i * day) / 1000),
    })),
  };
}

test("parses the latest 30 daily Fear & Greed readings", () => {
  const m = D.sentiment(payload(), now);
  assert.equal(m.value, 10);
  assert.equal(m.label, "Extreme Fear");
  assert.equal(m.yesterday, 11);
  assert.equal(m.week, 17);
  assert.equal(m.month, 39);
  assert.equal(m.asOf, now);
});

test("rejects missing, malformed, out-of-range and misordered readings", () => {
  assert.throws(() => D.sentiment({ data: [] }, now), /incomplete/);
  for (const bad of [
    { ...payload().data[0], value: "101" },
    { ...payload().data[0], value: "-1" },
    { ...payload().data[0], timestamp: "0" },
  ]) {
    const raw = payload();
    raw.data[0] = bad;
    assert.throws(() => D.sentiment(raw, now), /Invalid/);
  }
  const duplicate = payload();
  duplicate.data[1].timestamp = duplicate.data[0].timestamp;
  assert.throws(() => D.sentiment(duplicate, now), /out of order/);
  const gap = payload();
  gap.data[1].timestamp = String(Number(gap.data[1].timestamp) - 2 * 3600);
  assert.throws(() => D.sentiment(gap, now), /not daily/);
  const future = payload();
  future.data = future.data.map((row) => ({
    ...row,
    timestamp: String(Number(row.timestamp) + (2 * day) / 1000),
  }));
  assert.throws(() => D.sentiment(future, now), /future/);
});

test("derives the label from the value instead of trusting metadata", () => {
  const raw = payload();
  raw.data[0] = { ...raw.data[0], value: "80", value_classification: "Extreme Fear" };
  assert.equal(D.sentiment(raw, now).label, "Extreme Greed");
});
