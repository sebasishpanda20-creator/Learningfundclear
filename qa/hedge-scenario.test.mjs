import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  expiryScenario,
  manualScenario,
  mountHedgeScenario,
  MANUAL_CAPTION,
  MANUAL_SOURCE,
  SCENARIO_LIMITS,
} from '../assets/js/hedge-scenario.js';
import {
  nseScenario,
  mcxScenario,
  deltaScenario,
  createAdapters,
  ScenarioBlocked,
  QUOTE_MAX_AGE_MS,
} from '../assets/js/hedge-scenario-adapters.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');

const BASE = {
  underlying: 'IDX',
  expiry: '2026-12-25',
  currency: 'INR',
  settlement: 'INR',
  fees: 0,
};

const leg = (over = {}) => ({
  underlying: 'IDX',
  expiry: '2026-12-25',
  currency: 'INR',
  settlement: 'INR',
  kind: 'CALL',
  side: 1,
  lots: 1,
  multiplier: 1,
  entry: 6,
  strike: 100,
  ...over,
});

test('acceptance: long 100 call at 6 plus short 110 call at 2 pays -4 / 1 / 6', () => {
  const out = expiryScenario({
    ...BASE,
    legs: [leg({ entry: 6 }), leg({ side: -1, strike: 110, entry: 2 })],
    prices: [90, 105, 120],
  });
  assert.deepEqual(out, [
    { price: 90, pnl: -4 },
    { price: 105, pnl: 1 },
    { price: 120, pnl: 6 },
  ]);
});

test('a long collar carries the base exposure plus both option legs', () => {
  const out = expiryScenario({
    ...BASE,
    legs: [
      leg({ kind: 'LINEAR', entry: 100, strike: undefined }),
      leg({ kind: 'PUT', strike: 90, entry: 2 }),
      leg({ side: -1, kind: 'CALL', strike: 110, entry: 2 }),
    ],
    prices: [80, 100, 120],
  });
  assert.deepEqual(out.map((r) => r.pnl), [-10, 0, 10]);
});

test('a short collar reverses the protection and stays symmetric', () => {
  const out = expiryScenario({
    ...BASE,
    legs: [
      leg({ kind: 'LINEAR', side: -1, entry: 100, strike: undefined }),
      leg({ kind: 'CALL', strike: 110, entry: 2 }),
      leg({ side: -1, kind: 'PUT', strike: 90, entry: 2 }),
    ],
    prices: [80, 100, 120],
  });
  assert.deepEqual(out.map((r) => r.pnl), [10, 0, -10]);
});

test('fees are charged once, in the scenario currency', () => {
  const out = expiryScenario({
    ...BASE,
    fees: 50,
    legs: [leg({ entry: 6 }), leg({ side: -1, strike: 110, entry: 2 })],
    prices: [120],
  });
  assert.equal(out[0].pnl, -44);
});

test('incomplete inputs are rejected', () => {
  const variants = [
    { ...BASE, underlying: '', legs: [leg()], prices: [100] },
    { ...BASE, expiry: '  ', legs: [leg()], prices: [100] },
    { ...BASE, currency: '', legs: [leg()], prices: [100] },
    { ...BASE, settlement: '', legs: [leg()], prices: [100] },
    { ...BASE, legs: [], prices: [100] },
    { ...BASE, legs: [leg()], prices: [] },
    { ...BASE, legs: [leg()], prices: [-1] },
    { ...BASE, legs: [leg()], prices: [100], fees: -1 },
    { ...BASE, legs: [leg()], prices: [100], fees: NaN },
  ];
  for (const input of variants) assert.throws(() => expiryScenario(input), /Incomplete scenario inputs/);
});

test('mismatched and malformed legs are rejected', () => {
  const variants = [
    leg({ underlying: 'OTHER' }),
    leg({ expiry: '2026-01-29' }),
    leg({ currency: 'USD' }),
    leg({ settlement: 'USDT' }),
    leg({ kind: 'FUTURE' }),
    leg({ side: 0 }),
    leg({ lots: 0 }),
    leg({ lots: 1.5 }),
    leg({ multiplier: 0 }),
    leg({ entry: 0 }),
    leg({ kind: 'PUT', strike: undefined }),
    null,
  ];
  for (const bad of variants) {
    assert.throws(() => expiryScenario({ ...BASE, legs: [bad], prices: [100] }), /Invalid or incompatible leg/);
  }
});

test('leg and price counts are capped', () => {
  const manyLegs = Array.from({ length: SCENARIO_LIMITS.maxLegs + 1 }, () => leg());
  assert.throws(() => expiryScenario({ ...BASE, legs: manyLegs, prices: [100] }), /Incomplete scenario inputs/);
  const manyPrices = Array.from({ length: SCENARIO_LIMITS.maxPrices + 1 }, (_, i) => i + 1);
  assert.throws(() => expiryScenario({ ...BASE, legs: [leg()], prices: manyPrices }), /Incomplete scenario inputs/);
});

/* ------------------------------------------------------------------ NSE --- */

const nsePlan = () => ({
  lotSize: 75,
  statutoryCostInr: 120,
  expiry: '25-DEC-2026',
  basket: {
    legs: [
      { action: 'BUY', optionType: 'CE', strike: 24500, lots: 1, quote: 120 },
      { action: 'SELL', optionType: 'CE', strike: 24600, lots: 1, quote: 60 },
    ],
  },
});

const nseCtx = (over = {}) => ({
  symbol: 'NIFTY',
  expiry: '25-DEC-2026',
  plan: nsePlan(),
  bidAsk: false,
  quoteAt: Date.now(),
  now: Date.now(),
  prices: [24400, 24700],
  source: 'NSE option chain',
  ...over,
});

test('NSE reports NO_BID_ASK instead of inventing an option entry', () => {
  assert.throws(() => nseScenario(nseCtx()), (err) => {
    assert.ok(err instanceof ScenarioBlocked);
    assert.equal(err.code, 'NO_BID_ASK');
    assert.match(err.message, /last traded price only/);
    return true;
  });
});

test('NSE requires a generated plan and a verified quote timestamp', () => {
  assert.throws(() => nseScenario(nseCtx({ plan: null })), { code: 'NO_PLAN' });
  assert.throws(() => nseScenario(nseCtx({ expiry: '25/12/2026' })), { code: 'NO_EXPIRY' });
  assert.throws(
    () => nseScenario(nseCtx({ bidAsk: true, quoteAt: Date.now() - QUOTE_MAX_AGE_MS - 1 })),
    { code: 'STALE_QUOTES' },
  );
  assert.throws(() => nseScenario(nseCtx({ bidAsk: true, quoteAt: null })), { code: 'QUOTE_TIMESTAMP_UNAVAILABLE' });
  assert.throws(() => nseScenario(nseCtx({ bidAsk: true, prices: [] })), { code: 'NO_SCENARIO_PRICES' });
});

test('NSE builds a working scenario once verified premiums exist', () => {
  const input = nseScenario(nseCtx({ bidAsk: true }));
  assert.equal(input.currency, 'INR');
  assert.equal(input.settlement, 'INR');
  assert.equal(input.legs[0].kind, 'CALL');
  assert.equal(input.legs[0].multiplier, 75);
  assert.equal(input.legs[1].side, -1);
  const out = expiryScenario(input);
  assert.equal(out.length, 2);
  assert.equal(out[1].pnl, (200 - 120) * 75 - (100 - 60) * 75 - 120);
});

/* ------------------------------------------------------------------ MCX --- */

const mcxContract = (over = {}) => ({
  underlying: 'CRUDEOIL',
  expiry: '2026-12-19',
  kind: 'LINEAR',
  currency: 'INR',
  settlement: 'INR',
  multiplier: 100,
  ...over,
});

test('MCX refuses inverse contracts, mixed expiries and missing settlement', () => {
  const base = { entry: 5800, lots: 1, side: 1, prices: [5700, 5900], fees: 100, quoteAt: Date.now(), now: Date.now() };
  assert.throws(() => mcxScenario({ ...base, contract: null }), { code: 'NO_MCX_CONTRACT' });
  assert.throws(() => mcxScenario({ ...base, contract: mcxContract({ inverse: true }) }), { code: 'INVERSE_CONTRACT_REFUSED' });
  assert.throws(() => mcxScenario({ ...base, contract: mcxContract({ settlement: '' }) }), { code: 'SETTLEMENT_UNVERIFIED' });
  assert.throws(() => mcxScenario({ ...base, contract: mcxContract({ multiplier: 0 }) }), { code: 'MULTIPLIER_UNVERIFIED' });
  assert.throws(() => mcxScenario({ ...base, contract: mcxContract({ kind: 'CALL' }) }), { code: 'NON_LINEAR_UNSUPPORTED' });
  assert.throws(
    () => mcxScenario({ ...base, contract: mcxContract(), plan: { expiry: '2026-12-31' } }),
    { code: 'MIXED_EXPIRY_OR_UNDERLYING' },
  );
});

test('MCX previews a verified linear futures hedge', () => {
  const input = mcxScenario({
    contract: mcxContract(),
    entry: 5800,
    lots: 1,
    side: 1,
    prices: [5700, 5800, 5900],
    fees: 100,
    quoteAt: Date.now(),
    now: Date.now(),
  });
  assert.equal(expiryScenario(input)[2].pnl, 9900);
});

/* ---------------------------------------------------------------- DELTA --- */

test('Delta refuses unverified settlement and non-INR ledgers', () => {
  const base = { entry: 8000000, prices: [8000000], quoteAt: Date.now(), now: Date.now() };
  assert.throws(() => deltaScenario({ ...base, contract: null }), { code: 'NO_DELTA_CONTRACT' });
  assert.throws(
    () => deltaScenario({ ...base, contract: mcxContract({ underlying: 'BTC', currency: 'USDT', settlement: 'USDT' }) }),
    { code: 'SETTLEMENT_MISMATCH' },
  );
});

test('Delta previews a same-ledger INR position', () => {
  const input = deltaScenario({
    contract: mcxContract({ underlying: 'BTC', multiplier: 1 }),
    entry: 8000000,
    prices: [7900000, 8000000, 8100000],
    fees: 500,
    quoteAt: Date.now(),
    now: Date.now(),
  });
  assert.equal(input.currency, 'INR');
  assert.equal(expiryScenario(input)[2].pnl, 99500);
});

test('adapters resolve the segment context again on every preview', async () => {
  let calls = 0;
  const adapters = createAdapters(async (segment) => {
    calls += 1;
    return segment === 'MCX'
      ? { contract: mcxContract({ underlying: calls === 1 ? 'CRUDEOIL' : 'GOLD' }), entry: 5800, prices: [5800], fees: 0, quoteAt: Date.now(), now: Date.now() }
      : { symbol: 'NIFTY', expiry: '25-DEC-2026', plan: nsePlan(), bidAsk: false };
  });
  assert.equal((await adapters.MCX()).underlying, 'CRUDEOIL');
  assert.equal((await adapters.MCX()).underlying, 'GOLD');
  assert.equal(calls, 2);
  await assert.rejects(() => adapters.NSE(), { code: 'NO_BID_ASK' });
});

test('the calculator and adapters never call a broker or place an order', () => {
  for (const file of ['assets/js/hedge-scenario.js', 'assets/js/hedge-scenario-adapters.js']) {
    const src = read(file);
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${file} must not fetch`);
    assert.doesNotMatch(src, /XMLHttpRequest|WebSocket|order_id|placeOrder|orderPlacement:\s*'ENABLED'/);
  }
});

/* ----------------------------------------------------------------- mount -- */

function fakeDoc() {
  const create = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      attributes: {},
      textContent: '',
      className: '',
      disabled: false,
      listeners: {},
      append(...nodes) {
        el.children.push(...nodes);
      },
      setAttribute(key, value) {
        el.attributes[key] = value;
      },
      addEventListener(type, fn) {
        el.listeners[type] = fn;
      },
    };
    return el;
  };
  return { createElement: create };
}

test('the mount previews a scenario and states the failure reason when blocked', async () => {
  const host = { children: [], append(...nodes) { this.children.push(...nodes); } };
  const doc = fakeDoc();
  const input = {
    ...BASE,
    legs: [leg({ entry: 6 }), leg({ side: -1, strike: 110, entry: 2 })],
    prices: [90, 105, 120],
    source: 'test feed',
  };
  const mounted = mountHedgeScenario(host, async () => input, doc);
  assert.equal(mounted.button.textContent, 'Preview hedge scenarios');
  assert.match(mounted.label.textContent, /PLAN ONLY/);
  assert.equal(host.children.length, 5);
  assert.match(mounted.manual.children[0].textContent, /Manual scenario — hypothetical inputs/);

  await mounted.button.listeners.click();
  assert.equal(mounted.output.textContent, '90: -4.00 INR\n105: 1.00 INR\n120: 6.00 INR');
  assert.match(mounted.source.textContent, /test feed/);
  assert.equal(mounted.button.disabled, false);
});

test('manual scenario uses only typed inputs and computes the expiry payoff', () => {
  const input = manualScenario({
    underlying: 'NIFTY',
    expiry: '25-DEC-2026',
    currency: 'INR',
    multiplier: '1',
    prices: '90, 105, 120',
    fees: '0',
    legs: [
      { side: 'BUY', kind: 'CALL', strike: '100', premium: '6', lots: '1' },
      { side: 'SELL', kind: 'CALL', strike: '110', premium: '2', lots: '1' },
    ],
  });
  assert.equal(input.source, MANUAL_SOURCE);
  assert.equal(input.quoteAt, null);
  assert.equal(input.settlement, 'INR');
  assert.deepEqual(expiryScenario(input).map((row) => row.pnl), [-4, 1, 6]);
});

test('manual scenario refuses to invent any unverified figure', () => {
  const base = {
    underlying: 'NIFTY',
    expiry: '25-DEC-2026',
    currency: 'INR',
    multiplier: '75',
    prices: '100',
    fees: '0',
    legs: [{ side: 'BUY', kind: 'CALL', strike: '100', premium: '6', lots: '1' }],
  };
  assert.throws(() => manualScenario({ ...base, underlying: '' }), /Enter the underlying/);
  assert.throws(() => manualScenario({ ...base, expiry: '' }), /Enter the expiry/);
  assert.throws(() => manualScenario({ ...base, multiplier: '' }), /multiplier/);
  assert.throws(() => manualScenario({ ...base, prices: '' }), /settlement price/);
  assert.throws(() => manualScenario({ ...base, fees: '-1' }), /Fees/);
  assert.throws(() => manualScenario({ ...base, legs: [] }), /leg premium/);
  assert.throws(() => manualScenario({ ...base, legs: [{ side: 'BUY', kind: 'CALL', strike: '100', premium: '', lots: '1' }] }), /price you supplied/);
  assert.throws(
    () => manualScenario({ ...base, legs: [{ side: 'BUY', kind: 'PUT', stake: '1', premium: '6', lots: '1' }] }),
    /positive strike/,
  );
  assert.throws(
    () => manualScenario({ ...base, legs: [{ side: 'BUY', kind: 'CALL', strike: '100', premium: '6', lots: '0' }] }),
    /lots must be a whole number/,
  );
});

test('the manual mode shows payoff rows under an explicit hypothetical label', async () => {
  const host = { children: [], append(...nodes) { this.children.push(...nodes); } };
  const mounted = mountHedgeScenario(host, async () => {
    throw new ScenarioBlocked('NO_BID_ASK', 'no verified premium');
  }, fakeDoc());
  const [underlying, expiry, currency, multiplier, prices, fees] = mounted.manual.children[2].children;
  underlying.children[1].value = 'NIFTY';
  expiry.children[1].value = '25-DEC-2026';
  currency.children[1].value = 'INR';
  multiplier.children[1].value = '1';
  prices.children[1].value = '90, 105, 120';
  fees.children[1].value = '0';
  const [first, second] = mounted.legRows;
  first.side.value = 'BUY';
  first.kind.value = 'CALL';
  first.strike.value = '100';
  first.premium.value = '6';
  second.side.value = 'SELL';
  second.kind.value = 'CALL';
  second.strike.value = '110';
  second.premium.value = '2';

  mounted.manualButton.listeners.click();
  assert.equal(mounted.manualLabel.textContent, MANUAL_CAPTION);
  assert.equal(mounted.manualOutput.textContent, '90: -4.00 INR\n105: 1.00 INR\n120: 6.00 INR');
  const text = [mounted.manualLabel.textContent, mounted.manualSource.textContent, mounted.manualOutput.textContent].join(' ');
  assert.doesNotMatch(text, /maximum loss|expected return/i);
  assert.match(mounted.manualSource.textContent, /No live quote/);
  assert.equal(mounted.output.textContent, '', 'manual mode must not paint the market-data result');
});

test('a late result is dropped when the instrument changes mid-request', async () => {
  const host = { children: [], append(...nodes) { this.children.push(...nodes); } };
  const doc = fakeDoc();
  const instrument = doc.createElement('select');
  doc.querySelector = (selector) => (selector === '#sym' ? instrument : null);
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const mounted = mountHedgeScenario(
    host,
    () => pending.then(() => ({ ...BASE, legs: [leg()], prices: [100], source: 'slow feed' })),
    doc,
    { clearOn: ['#sym'] },
  );
  const click = mounted.button.listeners.click();
  instrument.listeners.change();
  release();
  await click;
  assert.equal(mounted.output.textContent, '', 'a retired run must not repaint');
  assert.equal(mounted.source.textContent, '');
  assert.equal(mounted.button.disabled, false);
});

test('a blocked panel keeps the market preview closed while manual mode works', async () => {
  const host = { children: [], append(...nodes) { this.children.push(...nodes); } };
  const mounted = mountHedgeScenario(host, async () => {
    throw new ScenarioBlocked('STALE_QUOTES', 'The last verified quote is older than five minutes.');
  }, fakeDoc());
  await mounted.button.listeners.click();
  assert.match(mounted.source.textContent, /STALE_QUOTES/);
  assert.equal(mounted.output.textContent, 'Scenario unavailable: check contract, quote and cost data.');
  assert.match(mounted.manual.children[0].textContent, /Manual scenario/);
});

test('a blocked adapter shows the generic message plus its reason', async () => {
  const host = { children: [], append(...nodes) { this.children.push(...nodes); } };
  const mounted = mountHedgeScenario(host, async () => {
    throw new ScenarioBlocked('NO_BID_ASK', 'no verified premium');
  }, fakeDoc());
  await mounted.button.listeners.click();
  assert.equal(mounted.output.textContent, 'Scenario unavailable: check contract, quote and cost data.');
  assert.match(mounted.source.textContent, /NO_BID_ASK/);
});

test('the scenario panel is mounted once in each instrument segment', () => {
  for (const page of ['gex.html', 'scanner.html', 'crypto-options.html']) {
    const html = read(page);
    assert.match(html, /data-hedge-scenario/, `${page} must host the scenario panel`);
    assert.equal((html.match(/hedge-scenario\.css/g) || []).length, 1);
    assert.equal((html.match(/hedge-scenario-adapters\.js/g) || []).length, 1);
  }
  assert.doesNotMatch(read('index.html'), /data-hedge-scenario/);
});

test('the scenario panel is usable on a phone-width screen', () => {
  const css = read('assets/css/hedge-scenario.css');
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /white-space: pre-wrap/);
  assert.doesNotMatch(css, /min-width:\s*\d+px/);
});
