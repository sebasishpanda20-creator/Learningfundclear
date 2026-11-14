import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const storeApi = require('../assets/js/market-context-store.js');
const regime = require('../assets/js/market-regime-service.js');

const NOW = Date.parse('2026-11-15T10:00:00+05:30');

function regimeRecord(over = {}) {
  return {
    kind: 'MARKET_REGIME',
    asOf: '2026-11-15T04:28:00Z',
    provider: 'Test provider',
    market: 'NSE',
    regime: 'RISK_OFF',
    fiiNet: -1200.5,
    diiNet: 800,
    indexTrend: 'DOWN',
    breadth: 0.31,
    volatility: 18.2,
    freshness: 'FRESH',
    ...over,
  };
}
function bulkRecord(over = {}) {
  return {
    kind: 'BULK_DEAL',
    asOf: '2026-11-15T04:20:00Z',
    provider: 'Test provider',
    market: 'NSE',
    symbol: 'RELIANCE',
    buyer: 'Buyer A',
    seller: 'Seller B',
    quantity: 120000,
    price: 1425.5,
    dealType: 'BULK',
    sourceUrl: 'https://example.test/bulk',
    ...over,
  };
}
function oiRecord(over = {}) {
  return {
    kind: 'OPTIONS_OI',
    asOf: '2026-11-15T04:25:00Z',
    provider: 'Test provider',
    market: 'NSE',
    underlying: 'NIFTY',
    expiry: '2026-11-19',
    strike: 24500,
    optionType: 'CALL',
    openInterest: 120000,
    openInterestChange: -3000,
    volume: 45000,
    impliedVolatility: 14.2,
    lastTradedPrice: 120.5,
    ...over,
  };
}

test('valid market-regime record is accepted and frozen', () => {
  const store = storeApi.createStore();
  const out = store.add(regimeRecord());
  assert.equal(out.ok, true);
  assert.equal(out.record.regime, 'RISK_OFF');
  assert.equal(Object.isFrozen(out.record), true);
});

test('missing FII/DII values stay null, not zero', () => {
  const store = storeApi.createStore();
  const out = store.add(regimeRecord({ fiiNet: null, diiNet: null }));
  assert.equal(out.ok, true);
  assert.equal(out.record.fiiNet, null);
  assert.equal(out.record.diiNet, null);
});

test('stale market-regime context yields an unavailable decision', () => {
  const decision = regime.decide(regimeRecord({ freshness: 'STALE' }));
  assert.equal(decision.available, false);
  assert.equal(decision.riskMultiplier, 0);
  assert.equal(decision.requiredConfirmations, 2);
  assert.match(decision.reason, /stale/i);
});

test('malformed bulk-deal records are rejected', () => {
  const store = storeApi.createStore();
  assert.equal(store.add(bulkRecord({ quantity: 0 })).ok, false);
  assert.equal(store.add(bulkRecord({ price: -1 })).ok, false);
  assert.equal(store.add(bulkRecord({ sourceUrl: 'not-a-url' })).ok, false);
  assert.equal(store.add(bulkRecord({ symbol: '' })).ok, false);
  assert.equal(store.add(bulkRecord({ sourceUrl: undefined })).ok, false);
});

test('invalid option type is rejected', () => {
  const store = storeApi.createStore();
  assert.equal(store.add(oiRecord({ optionType: 'STRADDLE' })).ok, false);
});

test('invalid strike is rejected', () => {
  const store = storeApi.createStore();
  assert.equal(store.add(oiRecord({ strike: 0 })).ok, false);
  assert.equal(store.add(oiRecord({ strike: '24500' })).ok, false);
});

test('duplicate context records are rejected by key', () => {
  const store = storeApi.createStore();
  assert.equal(store.add(bulkRecord()).ok, true);
  const duplicate = store.add(bulkRecord());
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors[0], /duplicate/i);
  assert.equal(store.list('BULK_DEAL').length, 1);
});

test('context unavailable never creates a signal', () => {
  const candidate = {
    decision: 'WAIT',
    confirmationCount: 1,
    requiresContext: true,
    strategyVersion: 'test-1',
  };
  const out = regime.apply(candidate, {});
  assert.equal(out.decision, 'WAIT');
  assert.notEqual(out.decision, 'BUY');
  assert.equal(out.status, 'BLOCKED_BY_CONTEXT');
  assert.equal(out.riskMultiplier, 0);
});

test('RISK_OFF cannot turn an invalid setup into a valid one', () => {
  const out = regime.apply(
    { decision: 'BUY', valid: false, confirmationCount: 3, requiresContext: true, strategyVersion: 'test-1' },
    { regime: regimeRecord() },
  );
  assert.equal(out.decision, 'NO_TRADE');
  assert.equal(out.status, 'INVALID_SETUP');
  assert.equal(out.riskMultiplier, 0);
});

test('risk multiplier can reduce but never increase suggested risk', () => {
  const riskOn = regimeRecord({ regime: 'RISK_ON', indexTrend: 'UP', breadth: 0.7 });
  const reduced = regime.apply(
    { decision: 'BUY', confirmationCount: 2, requiresContext: true, riskMultiplier: 0.5, strategyVersion: 'v' },
    { regime: riskOn },
  );
  assert.equal(reduced.riskMultiplier, 0.5);

  const riskOff = regimeRecord();
  const capped = regime.apply(
    { decision: 'BUY', confirmationCount: 2, requiresContext: true, riskMultiplier: 2, strategyVersion: 'v' },
    { regime: riskOff },
  );
  assert.ok(capped.riskMultiplier <= 0.5);
  assert.ok(capped.riskMultiplier <= 1);
});

test('missing OI does not block an independent candle-based setup', () => {
  const out = regime.apply(
    { decision: 'BUY', confirmationCount: 1, requiresContext: false, requiresOI: false, strategyVersion: 'v' },
    {},
  );
  assert.equal(out.decision, 'BUY');
  assert.equal(out.riskMultiplier, 1);
  assert.equal(out.requiredConfirmations, 1);
});

test('missing OI blocks only an OI-dependent rule', () => {
  const out = regime.apply(
    { decision: 'BUY', confirmationCount: 2, requiresContext: true, requiresOI: true, strategyVersion: 'v' },
    { regime: regimeRecord({ regime: 'RISK_ON', indexTrend: 'UP', breadth: 0.7 }) },
  );
  assert.equal(out.decision, 'WAIT');
  assert.equal(out.status, 'OPTIONS_OI_UNAVAILABLE');
  assert.match(out.explanation, /OI/i);
});

test('required confirmations gate a context-dependent candidate', () => {
  const out = regime.apply(
    { decision: 'BUY', confirmationCount: 1, requiresContext: true, strategyVersion: 'v' },
    { regime: regimeRecord() },
  );
  assert.equal(out.decision, 'WAIT');
  assert.equal(out.status, 'AWAITING_CONTEXT_CONFIRMATION');
  assert.equal(out.requiredConfirmations, 2);
});

test('every decision carries regime, effects, freshness and strategy version', () => {
  const out = regime.apply(
    { decision: 'BUY', confirmationCount: 2, requiresContext: true, strategyVersion: 'zones-1.4' },
    { regime: regimeRecord(), oi: oiRecord() },
  );
  assert.equal(out.marketRegime, 'RISK_OFF');
  assert.equal(out.strategyVersion, 'zones-1.4');
  assert.ok(Array.isArray(out.contextEffects) && out.contextEffects.length > 0);
  assert.match(out.contextEffects[0], /Risk-off/);
});

test('subscribers are removed and repeated subscribes do not multiply', () => {
  const store = storeApi.createStore();
  let calls = 0;
  const off = store.subscribe(null, () => { calls += 1; });
  store.add(regimeRecord({ asOf: '2026-11-15T04:20:00Z' }));
  assert.equal(calls, 1);
  off();
  store.add(regimeRecord({ asOf: '2026-11-15T04:22:00Z' }));
  assert.equal(calls, 1);
});
