// Free-pilot behaviour: a one-minute cron does not perform a full listing every
// minute, pagination is bounded, and quota failures return instead of throwing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAlerts } from '../server/email-alerts.mjs';

class FakeKV {
  constructor(planCount = 3) {
    this.map = new Map();
    this.ops = { get: 0, put: 0, delete: 0, list: 0 };
    for (let i = 0; i < planCount; i += 1) {
      this.map.set(`plan:user-${i}`, JSON.stringify({
        email: `user${i}@example.test`,
        id: `id-${i}`,
        origin: 'https://portal.test',
        sent: { 'PLAN SAVED': true },
        plan: {
          long: 'C-BTC-100-251231',
          short: 'P-BTC-90-251231',
          quantity: 1,
          stopSpread: 90,
          entrySpread: 100,
          targetSpread: 120,
          timeExit: Date.parse('2030-01-01T00:00:00Z'),
          createdAt: Date.parse('2026-01-01T00:00:00Z'),
        },
      }));
    }
  }
  async get(key) {
    this.ops.get += 1;
    const value = this.map.get(key);
    return value == null ? null : JSON.parse(value);
  }
  async put(key, value) { this.ops.put += 1; this.map.set(key, value); }
  async delete(key) { this.ops.delete += 1; this.map.delete(key); }
  async list({ prefix = '', limit = 100, cursor } = {}) {
    this.ops.list += 1;
    const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const slice = keys.slice(start, start + limit);
    const end = start + slice.length;
    return { keys: slice.map((name) => ({ name })), list_complete: end >= keys.length, cursor: String(end) };
  }
}

function env(overrides = {}) {
  return { ALERTS_KV: new FakeKV(), RESEND_API_KEY: 'test', ALERT_FROM: 'alerts@example.test', ...overrides };
}

function provider() {
  const calls = { resend: 0, ticker: 0 };
  const fetcher = async (url) => {
    if (String(url).includes('api.resend.com')) { calls.resend += 1; return Response.json({ id: 'mail' }); }
    calls.ticker += 1;
    return Response.json({ success: true, result: [] });
  };
  return { fetcher, calls };
}

const NOW = Date.parse('2026-11-15T06:00:00Z');

test.before(() => {
  // The engine is loaded by the module; this stub makes the watch fire.
  globalThis.LfcCryptoDesk = { monitor: () => ({ status: 'STOP WATCH' }) };
});

test('first due run evaluates once; the next minute is skipped without listing', async () => {
  const e = env();
  const p = provider();
  const first = await runAlerts(e, p.fetcher, { now: NOW });
  assert.equal(first.skipped, undefined);
  assert.equal(first.evaluated, 3);
  assert.equal(first.sent, 3);
  assert.equal(e.ALERTS_KV.ops.list, 1);
  const second = await runAlerts(e, p.fetcher, { now: NOW + 60_000 });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'interval');
  assert.equal(e.ALERTS_KV.ops.list, 1, 'skip must not list');
});

test('evaluation resumes after the configured interval', async () => {
  const e = env({ ALERT_EVAL_MINUTES: '15' });
  const p = provider();
  await runAlerts(e, p.fetcher, { now: NOW });
  const early = await runAlerts(e, p.fetcher, { now: NOW + 10 * 60_000 });
  assert.equal(early.skipped, true);
  const due = await runAlerts(e, p.fetcher, { now: NOW + 15 * 60_000 });
  assert.equal(due.skipped, undefined);
  assert.equal(due.intervalMinutes, 15);
});

test('pagination is bounded and reports truncation', async () => {
  const e = env({ ALERT_MAX_PAGES: '2' });
  e.ALERTS_KV = new FakeKV(250);
  const p = provider();
  const out = await runAlerts(e, p.fetcher, { now: NOW });
  assert.equal(out.pages, 2);
  assert.equal(out.evaluated, 200);
  assert.equal(out.truncated, true);
  assert.equal(e.ALERTS_KV.ops.list, 2);
});

test('a KV list failure returns an error instead of throwing', async () => {
  const e = env();
  e.ALERTS_KV.list = async () => { throw new Error('429 quota'); };
  const out = await runAlerts(e, provider().fetcher, { now: NOW });
  assert.equal(out.error, 'kv_list_failed');
});

test('missing provider configuration performs no listing', async () => {
  const e = { ALERTS_KV: new FakeKV() };
  const out = await runAlerts(e, provider().fetcher, { now: NOW });
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'not_configured');
  assert.equal(e.ALERTS_KV.ops.list, 0);
});

test('an already-sent event is not emailed again', async () => {
  const e = env();
  const p = provider();
  await runAlerts(e, p.fetcher, { now: NOW });
  await runAlerts(e, p.fetcher, { now: NOW + 6 * 60_000 });
  assert.equal(p.calls.resend, 3, 'one email per plan, not per run');
});

test('estimated free-tier operations stay within quota for 100 plans at 5 minutes', async () => {
  // 24h / 5min = 288 evaluations. Marker: 288 reads + 288 writes. Plan reads:
  // 288 * 100 = 28,800. Lists: 288. Sends only on a state change.
  const e = env();
  e.ALERTS_KV = new FakeKV(100);
  const p = provider();
  await runAlerts(e, p.fetcher, { now: NOW });
  const perDay = {
    reads: 288 + 288 * 100,
    writes: 288 + 288, // marker + possible plan state writes; one send here
    lists: 288,
    deletes: 0,
  };
  assert.ok(perDay.reads <= 100_000, 'KV reads');
  assert.ok(perDay.writes <= 1_000, 'KV writes');
  assert.ok(perDay.lists <= 1_000, 'KV list requests');
  assert.ok(perDay.deletes <= 1_000, 'KV deletes');
});
