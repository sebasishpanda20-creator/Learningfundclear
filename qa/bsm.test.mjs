import test from 'node:test';
import assert from 'node:assert/strict';

import { blackScholes, normalCdf, BSM_DEFAULT_RATE } from '../assets/js/bsm.js';

const close = (actual, expected, tolerance = 1e-5) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (±${tolerance})`);

test('normalCdf is symmetric and matches known values', () => {
  close(normalCdf(0), 0.5);
  close(normalCdf(1.96), 0.975002, 1e-6);
  close(normalCdf(-1.96), 0.024998, 1e-6);
  close(normalCdf(1) + normalCdf(-1), 1);
  assert.throws(() => normalCdf(NaN), /finite/);
});

test('ATM call and put match the zero-rate reference values', () => {
  const call = blackScholes({ spot: 100, strike: 100, daysToExpiry: 365, volatility: 0.2, rate: 0 });
  const put = blackScholes({ spot: 100, strike: 100, daysToExpiry: 365, volatility: 0.2, rate: 0, type: 'PUT' });
  close(call.price, 7.965567, 1e-4);
  close(put.price, 7.965567, 1e-4);
  close(call.delta, 0.539828);
  close(put.delta, -0.460172);
  close(call.gamma, 0.019847);
  close(call.vegaPerPercent, 0.396953, 1e-5);
  close(call.pop, 0.460172);
  close(put.pop, 0.539828);
  assert.ok(call.thetaPerDay < 0);
  assert.ok(put.thetaPerDay < 0);
});

test('put-call parity holds with the default rate', () => {
  const call = blackScholes({ spot: 100, strike: 105, daysToExpiry: 90, volatility: 0.25 });
  const put = blackScholes({ spot: 100, strike: 105, daysToExpiry: 90, volatility: 0.25, type: 'PUT' });
  const discount = Math.exp(-BSM_DEFAULT_RATE * (90 / 365));
  close(call.price - put.price, 100 - 105 * discount);
  close(
    call.rhoPerPercent - put.rhoPerPercent,
    (105 * (90 / 365) * discount) / 100,
    1e-9,
  );
});

test('intrinsic value, time value and probability stay bounded', () => {
  const call = blackScholes({ spot: 120, strike: 100, daysToExpiry: 30, volatility: 0.3, rate: 0 });
  close(call.intrinsic, 20);
  assert.ok(call.timeValue > 0);
  assert.ok(call.pop > 0.5 && call.pop < 1);
  assert.ok(call.delta > 0.5 && call.delta <= 1);
  assert.ok(Number.isFinite(call.gamma) && call.gamma > 0);
});

test('invalid inputs fail closed', () => {
  const base = { spot: 100, strike: 100, daysToExpiry: 30, volatility: 0.2 };
  for (const patch of [
    { spot: 0 },
    { strike: -1 },
    { daysToExpiry: 0 },
    { volatility: 0 },
    { rate: -0.01 },
    { type: 'STRADDLE' },
  ]) {
    assert.throws(() => blackScholes({ ...base, ...patch }), /positive|rate|CALL|PUT|volatility/);
  }
});
