import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildHedgePlan,
  serveHedgePlan,
  HEDGE_PLAN_ROUTE,
  HEDGE_SEGMENTS,
  HEDGE_TIMEFRAMES,
} from '../server/hedging-engine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (file) => readFileSync(join(root, file), 'utf8');

const AS_OF = '2026-11-18T06:00:00Z';

const nseInput = (over = {}) => ({
  segment: 'NSE',
  symbol: 'NIFTY',
  timeframe: '15m',
  direction: 'BULLISH',
  spot: 24500,
  premium: 120,
  asOf: AS_OF,
  ...over,
});

function postRequest(body, headers = {}, method = 'POST') {
  return new Request('https://portal.test/api/hedge-plan', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('route and segment constants are the documented ones', () => {
  assert.equal(HEDGE_PLAN_ROUTE, '/api/hedge-plan');
  assert.deepEqual([...HEDGE_SEGMENTS], ['NSE', 'MCX', 'DELTA', 'QUANT', 'JOURNAL']);
  assert.deepEqual([...HEDGE_TIMEFRAMES], ['5m', '15m', '1h', '4h', '1D', '1W', '1M']);
});

test('NSE intraday builds a same-expiry vertical debit spread', () => {
  const { plan } = buildHedgePlan(nseInput({ timeframe: '15m' }));
  assert.equal(plan.tier, 'INTRADAY');
  assert.equal(plan.priceBasis, 'PREMIUM_POINTS');
  assert.equal(plan.basket.product, 'MIS');
  assert.equal(plan.basket.legs.length, 2);
  assert.equal(plan.basket.legs[0].action, 'BUY');
  assert.equal(plan.basket.legs[0].strike, 24500);
  assert.equal(plan.basket.legs[1].action, 'SELL');
  assert.equal(plan.basket.legs[1].strike, 24600);
  assert.equal(plan.basket.legs[1].optionType, 'CE');
  assert.equal(plan.basket.legs[0].expiry, plan.basket.legs[1].expiry);
  assert.equal(plan.hedgeStrike, 24600);
  assert.equal(plan.lotSize, 75);
  assert.equal(plan.strikeStep, 50);
  assert.equal(plan.quantity, 75);
  assert.match(plan.mandatoryRule, /15:15 IST/);
  assert.match(plan.exitRule, /greater than 1/);
  assert.ok(plan.rewardToRisk > 0);
});

test('NSE swing builds a protective collar with the short leg above spot', () => {
  const { plan } = buildHedgePlan(nseInput({ timeframe: '1D' }));
  assert.equal(plan.tier, 'SWING');
  assert.equal(plan.basket.product, 'NRML');
  assert.equal(plan.basket.legs.length, 2);
  assert.equal(plan.basket.legs[0].optionType, 'PE');
  assert.equal(plan.basket.legs[0].strike, 24400);
  assert.equal(plan.basket.legs[0].role, 'protective leg');
  assert.equal(plan.basket.legs[1].optionType, 'CE');
  assert.equal(plan.basket.legs[1].strike, 24650);
  assert.equal(plan.hedgeStrike, 24400);
  assert.match(plan.mandatoryRule, /protective leg must exist/);
});

test('NSE positional builds a single far-month tail shield', () => {
  const swing = buildHedgePlan(nseInput({ timeframe: '1D' })).plan;
  const { plan } = buildHedgePlan(nseInput({ timeframe: '1W' }));
  assert.equal(plan.tier, 'POSITIONAL');
  assert.equal(plan.basket.legs.length, 1);
  assert.equal(plan.basket.legs[0].optionType, 'PE');
  assert.equal(plan.basket.legs[0].strike, 24250);
  assert.ok(new Date(plan.expiry) > new Date(swing.expiry));
  assert.match(plan.mandatoryRule, /tail shield/i);
});

test('NSE expiry is convention-derived and marked unverified unless supplied', () => {
  const derived = buildHedgePlan(nseInput()).plan;
  assert.equal(derived.expiryVerified, false);
  assert.equal(derived.expirySource, 'CONVENTION');
  assert.match(derived.expiryBasis, /Thursday/);
  assert.ok(derived.daysToExpiry >= 0);

  const supplied = buildHedgePlan(nseInput({ expiry: '2026-12-31' })).plan;
  assert.equal(supplied.expiry, '2026-12-31');
  assert.equal(supplied.expiryVerified, true);
  assert.equal(supplied.expirySource, 'INPUT');
});

test('NSE rejects an unknown underlying with a field error', () => {
  assert.throws(() => buildHedgePlan(nseInput({ symbol: 'RELIANCE' })), /Unsupported NSE underlying/);
});

test('MCX reuses the instrument context and never invents a contract expiry', () => {
  const { plan, segment } = buildHedgePlan({
    segment: 'MCX',
    symbol: 'CRUDEOIL',
    timeframe: '1h',
    direction: 'BEARISH',
    spot: 5800,
    asOf: AS_OF,
  });
  assert.equal(segment, 'MCX');
  assert.equal(plan.expiry, null);
  assert.equal(plan.expiryVerified, false);
  assert.ok(plan.unavailable.some((u) => /expiry/i.test(u)));
  assert.equal(plan.basket.legs[0].instrument, 'FUTCOM');
  assert.equal(plan.basket.legs[0].symbol, 'CRUDEOIL');
  assert.equal(plan.lotSize, 100);
  assert.match(plan.mandatoryRule, /Never create a contract or expiry/);
  assert.match(plan.rollRule, /delivery/);
});

test('MCX offers an option overlay only where the contract lists options', () => {
  const withOptions = buildHedgePlan({
    segment: 'MCX',
    symbol: 'GOLD',
    timeframe: '1D',
    direction: 'BULLISH',
    spot: 72000,
    premium: 900,
    expiry: '2026-12-05',
    asOf: AS_OF,
  }).plan;
  assert.equal(withOptions.basket.legs.length, 2);
  assert.equal(withOptions.basket.legs[1].instrument, 'OPTFUT');
  assert.ok(withOptions.hedgeStrike !== null);

  const noOptions = buildHedgePlan({
    segment: 'MCX',
    symbol: 'COPPER',
    timeframe: '1D',
    direction: 'BULLISH',
    spot: 820,
    premium: 9,
    asOf: AS_OF,
  }).plan;
  assert.equal(noOptions.basket.legs.length, 1);
  assert.equal(noOptions.basket.legs[0].instrument, 'FUTCOM');
  assert.equal(noOptions.hedgeStrike, null);
});

test('Delta plan is same-ledger INR settled with the section 115BBH guardrail', () => {
  const { plan } = buildHedgePlan({
    segment: 'DELTA',
    symbol: 'BTC',
    timeframe: '4h',
    direction: 'BULLISH',
    spot: 8500000,
    premium: 42000,
    asOf: AS_OF,
  });
  assert.equal(plan.settlement, 'INR');
  assert.equal(plan.ledger, 'INR');
  assert.match(plan.taxGuardrail, /115BBH/);
  assert.match(plan.taxGuardrail, /194S/);
  assert.match(plan.hedgeLabel, /research only/i);
  assert.equal(plan.basket.product, 'RESEARCH_ONLY');
  assert.equal(plan.basket.legs.length, 2);
  assert.ok(plan.costs.tdsOnSale > 0);
});

test('QUANT and JOURNAL segments build the NSE plan without a second desk', () => {
  for (const segment of ['QUANT', 'JOURNAL']) {
    const out = buildHedgePlan(nseInput({ segment }));
    assert.equal(out.segment, segment);
    assert.equal(out.sourceSegment, 'NSE');
    assert.equal(out.plan.tier, 'INTRADAY');
  }
});

test('invalid input returns 400 JSON naming the offending field', async () => {
  const res = await serveHedgePlan(postRequest({ ...nseInput(), spot: -1 }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'INVALID_INPUT');
  assert.equal(body.field, 'spot');
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('unknown segment and bad JSON return JSON errors, never HTML', async () => {
  const badSegment = await serveHedgePlan(postRequest({ ...nseInput(), segment: 'EQUITY' }));
  assert.equal(badSegment.status, 400);
  assert.equal((await badSegment.json()).field, 'segment');

  const badJson = await serveHedgePlan(postRequest('{not json'));
  assert.equal(badJson.status, 400);
  const body = await badJson.json();
  assert.equal(body.error, 'INVALID_JSON');
  assert.match(badJson.headers.get('content-type'), /application\/json/);
});

test('non-POST methods return 405 with Allow: POST', async () => {
  const res = await serveHedgePlan(postRequest(null, {}, 'GET'));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
  assert.equal((await res.json()).error, 'METHOD_NOT_ALLOWED');
});

test('handler never reads env or config', async () => {
  const trap = new Proxy(
    {},
    {
      get() {
        throw new Error('environment was read');
      },
    },
  );
  const res = await serveHedgePlan(postRequest(nseInput()), trap, trap);
  assert.equal(res.status, 200);
  const source = read('server/hedging-engine.mjs');
  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /import .*(fyers|terminal-gate|delta-account|quant-proxy)/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});

test('every plan is a labelled PLAN_ONLY basket with no order prices', () => {
  const cases = [
    nseInput({ timeframe: '5m' }),
    nseInput({ timeframe: '1h' }),
    nseInput({ timeframe: '4h' }),
    nseInput({ timeframe: '1W' }),
    { segment: 'MCX', symbol: 'GOLD', timeframe: '1D', direction: 'BEARISH', spot: 72000, asOf: AS_OF },
    { segment: 'DELTA', symbol: 'ETH', timeframe: '1h', direction: 'BEARISH', spot: 280000, asOf: AS_OF },
  ];
  for (const input of cases) {
    const out = buildHedgePlan(input);
    assert.equal(out.executionMode, 'PLAN_ONLY');
    assert.equal(out.orderPlacement, 'DISABLED');
    assert.equal(out.plan.basket.executionMode, 'PLAN_ONLY');
    assert.equal(out.plan.basket.orderPlacement, 'DISABLED');
    assert.match(out.plan.basket.label, /never dispatched/);
    for (const leg of out.plan.basket.legs) {
      assert.equal(leg.price, null);
      assert.equal(leg.priceSource, 'unavailable');
      assert.equal(leg.tokens, undefined);
      assert.equal(leg.clientId, undefined);
    }
  }
});

test('response carries no credentials or broker identifiers', async () => {
  const res = await serveHedgePlan(postRequest(nseInput()));
  const text = await res.text();
  assert.doesNotMatch(text, /access_token|refresh_token|client_id|api_key|apikey|secret|authorization|bearer/i);
  assert.equal(res.headers.get('x-hedge-mode'), 'PLAN_ONLY');
});

test('hedge route is wired before the JSON 404 catch-all', () => {
  const worker = read('server/worker.mjs');
  assert.match(worker, /import \{serveHedgePlan\} from '\.\/hedging-engine\.mjs';/);
  const hedgeAt = worker.indexOf("url.pathname==='/api/hedge-plan'");
  const catchAllAt = worker.indexOf("if(url.pathname.startsWith('/api/'))");
  assert.ok(hedgeAt > 0 && catchAllAt > hedgeAt, 'hedge route must precede the /api/ 404 fallback');
  assert.doesNotMatch(worker, /guardTerminal\(request, env, config\)[\s\S]{0,200}hedge-plan/);
});

test('every existing segment page mounts the shared hedge panel', () => {
  const pages = {
    'gex.html': 'NSE',
    'scanner.html': 'MCX',
    'crypto-options.html': 'DELTA',
    'quant-desk.html': 'QUANT',
    'index.html': 'JOURNAL',
  };
  for (const [page, segment] of Object.entries(pages)) {
    const html = read(page);
    assert.match(html, /data-hedge-plan/, `${page} must mount the hedge panel`);
    assert.match(html, new RegExp(`data-segment="${segment}"`), `${page} must name its segment`);
    assert.equal((html.match(/hedge-plan\.css/g) || []).length, 1, `${page} must link the stylesheet once`);
    assert.equal((html.match(/hedge-plan\.js/g) || []).length, 1, `${page} must load the script once`);
  }
});

test('the save action reuses the existing journal and labels its fallback', () => {
  const ui = read('assets/js/hedge-plan.js');
  assert.match(ui, /Save to Journal/);
  assert.match(ui, /Generate Hedge Plan/);
  assert.match(ui, /PLAN ONLY — ORDER DISPATCH DISABLED/);
  assert.match(ui, /from\('ideas'\)\.insert/);
  assert.match(ui, /lfc\.hedgePlans\.v1/);
  assert.match(ui, /this browser only/);
  assert.equal(existsSync(join(root, 'hedging.html')), false, 'no separate hedging desk page');
});

test('no hedging entry was added to the portal navigation', () => {
  const shell = read('assets/js/shell.js');
  assert.doesNotMatch(shell, /hedg/i);
  for (const page of ['index.html', 'gex.html', 'scanner.html', 'nifty500.html', 'crypto-options.html', 'quant-desk.html']) {
    assert.ok(shell.includes(page), `navigation still lists ${page}`);
  }
  assert.ok((shell.match(/\.html"/g) || []).length >= 10, 'existing navigation entries are preserved');
});

test('hedge panel collapses to one column on narrow screens', () => {
  const css = read('assets/css/hedge-plan.css');
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /grid-template-columns: 1fr 1fr/);
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.doesNotMatch(css, /100vw/);
});
