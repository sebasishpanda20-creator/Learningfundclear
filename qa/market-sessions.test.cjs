"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
require("../assets/js/market-sessions.js");

const S = global.LfcMarketSessions;
const venue = (id) => S.VENUES.find((item) => item.id === id);
const at = (iso) => new Date(iso);

test("New York and London sessions follow their daylight-saving clocks", () => {
  assert.equal(S.statusFor(venue("new-york"), at("2026-11-19T14:45:00Z")).open, true, "09:45 EST");
  assert.equal(S.statusFor(venue("new-york"), at("2026-11-19T14:29:00Z")).open, false, "09:29 EST");
  assert.equal(S.statusFor(venue("new-york"), at("2026-07-16T13:45:00Z")).open, true, "09:45 EDT");
  assert.equal(S.statusFor(venue("london"), at("2026-11-19T08:00:00Z")).open, true, "08:00 GMT");
  assert.equal(S.statusFor(venue("london"), at("2026-07-16T07:00:00Z")).open, true, "08:00 BST");
});

test("Tokyo lunch break and Mumbai hours are respected", () => {
  assert.equal(S.statusFor(venue("tokyo"), at("2026-11-19T00:30:00Z")).open, true, "09:30 JST");
  assert.equal(S.statusFor(venue("tokyo"), at("2026-11-19T03:00:00Z")).open, false, "12:00 JST lunch");
  assert.equal(S.statusFor(venue("tokyo"), at("2026-11-19T03:30:00Z")).open, true, "12:30 JST");
  assert.equal(S.statusFor(venue("mumbai"), at("2026-11-19T03:45:00Z")).open, true, "09:15 IST");
  assert.equal(S.statusFor(venue("mumbai"), at("2026-11-19T10:00:00Z")).open, false, "15:30 IST");
});

test("weekends close traditional venues while crypto stays 24/7", () => {
  const saturday = at("2026-11-21T12:00:00Z");
  for (const id of ["new-york", "london", "tokyo", "mumbai"]) {
    assert.equal(S.statusFor(venue(id), saturday).open, false, id);
  }
  assert.equal(S.statusFor(venue("crypto"), saturday).open, true);
  assert.match(venue("crypto").hours, /24\/7/);
});

test("the clock uses fixed schedules and never fetches live status", () => {
  const src = readFileSync(join(__dirname, "..", "assets", "js", "market-sessions.js"), "utf8");
  assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  for (const id of ["new-york", "london", "tokyo", "mumbai"]) {
    assert.ok(venue(id).zone.includes("/"), id + " has an IANA zone");
  }
});
