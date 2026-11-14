import test from 'node:test';
import assert from 'node:assert/strict';
import { runDaemonWatch, FAIL_THRESHOLD, alertRecipients } from '../dist/server/daemon-watch.mjs';

function kv() {
  const store = new Map();
  return {
    store,
    async get(k, type) {
      const v = store.get(k);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  };
}

function fakeFetch({ health = 503, resend = 200 } = {}) {
  const calls = { health: 0, resend: 0, payloads: [] };
  const fetcher = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/api/v1/health')) { calls.health++; return new Response('', { status: health }); }
    if (u.includes('api.resend.com')) {
      calls.resend++;
      calls.payloads.push(JSON.parse(init.body));
      return new Response('', { status: resend });
    }
    return new Response('{}', { status: 200 });
  };
  return { calls, fetcher };
}

const base = (namespace, extra = {}) => ({
  QUANT_API_ORIGIN: 'https://daemon.example',
  ALERTS_KV: namespace,
  RESEND_API_KEY: 'fake',
  ALERT_FROM: 'alerts@example.com',
  ALERT_TO: 'ops@example.com',
  ...extra,
});

test('no origin means no probe and no alert', async () => {
  const { calls, fetcher } = fakeFetch();
  const out = await runDaemonWatch({}, fetcher);
  assert.equal(calls.health, 0);
  assert.equal(calls.resend, 0);
  assert.equal(out.probed, false);
});

test('a healthy daemon sends nothing and stores nothing', async () => {
  const namespace = kv();
  const { calls, fetcher } = fakeFetch({ health: 200 });
  const out = await runDaemonWatch(base(namespace), fetcher);
  assert.equal(out.healthy, true);
  assert.equal(calls.resend, 0);
  assert.equal(namespace.store.size, 0);
});

test('one email is sent when the streak reaches the threshold', async () => {
  const namespace = kv();
  const { calls, fetcher } = fakeFetch();
  let out;
  for (let i = 1; i <= FAIL_THRESHOLD; i++) out = await runDaemonWatch(base(namespace), fetcher);
  assert.equal(calls.resend, 1);
  assert.equal(out.alerted, true);
  assert.equal(out.fails, FAIL_THRESHOLD);
  const payload = calls.payloads[0];
  assert.deepEqual(payload.to, ['ops@example.com']);
  assert.match(payload.subject, /unreachable/);
  assert.match(payload.text, /daemon\.example/);
});

test('a continuing outage does not send again', async () => {
  const namespace = kv();
  const { calls, fetcher } = fakeFetch();
  for (let i = 1; i <= FAIL_THRESHOLD + 4; i++) await runDaemonWatch(base(namespace), fetcher);
  assert.equal(calls.resend, 1);
});

test('recovery clears the streak so the next outage alerts again', async () => {
  const namespace = kv();
  const down = fakeFetch();
  for (let i = 1; i <= FAIL_THRESHOLD; i++) await runDaemonWatch(base(namespace), down.fetcher);
  assert.equal(down.calls.resend, 1);

  await runDaemonWatch(base(namespace), fakeFetch({ health: 200 }).fetcher);
  assert.equal(namespace.store.size, 0);

  const second = fakeFetch();
  for (let i = 1; i <= FAIL_THRESHOLD; i++) await runDaemonWatch(base(namespace), second.fetcher);
  assert.equal(second.calls.resend, 1);
});

test('a failed send is retried on the next tick', async () => {
  const namespace = kv();
  const failing = fakeFetch({ resend: 500 });
  for (let i = 1; i <= FAIL_THRESHOLD; i++) await runDaemonWatch(base(namespace), failing.fetcher);
  assert.equal(failing.calls.resend, 1);

  const ok = fakeFetch({ resend: 200 });
  const out = await runDaemonWatch(base(namespace), ok.fetcher);
  assert.equal(ok.calls.resend, 1);
  assert.equal(out.alerted, true);
});

test('an unbound KV still probes but never alerts', async () => {
  const { calls, fetcher } = fakeFetch();
  const out = await runDaemonWatch(
    { QUANT_API_ORIGIN: 'https://daemon.example', RESEND_API_KEY: 'x', ALERT_FROM: 'a@b.c' },
    fetcher
  );
  assert.equal(calls.health, 1);
  assert.equal(calls.resend, 0);
  assert.match(out.reason, /ALERTS_KV/);
});

test('recipients fall back to the sender and accept a comma list', () => {
  assert.deepEqual(alertRecipients({ ALERT_FROM: 'a@b.c' }), ['a@b.c']);
  assert.deepEqual(alertRecipients({ ALERT_TO: 'x@y.z, w@y.z', ALERT_FROM: 'a@b.c' }), ['x@y.z', 'w@y.z']);
});
