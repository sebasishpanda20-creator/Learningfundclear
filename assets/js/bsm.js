/* Black-Scholes-Merton option pricing.
 *
 * Pure model arithmetic only: no quotes, no chain access, no orders. The caller
 * supplies every market input. Volatility and rate are decimals per year
 * (0.18 = 18%), and daysToExpiry is a positive calendar-day fraction.
 */

export const BSM_DEFAULT_RATE = 0.0685;
const DAYS_PER_YEAR = 365;
const SQRT_2PI = Math.sqrt(2 * Math.PI);

function normalPdf(x) {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/* Abramowitz-Stegun 26.2.17; absolute error is below 1e-7. */
export function normalCdf(x) {
  if (!Number.isFinite(x)) throw new Error('normalCdf requires a finite number');
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const density = normalPdf(x);
  const tail =
    density *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
}

export function blackScholes({
  spot,
  strike,
  daysToExpiry,
  volatility,
  rate = BSM_DEFAULT_RATE,
  type = 'CALL',
} = {}) {
  const side = String(type).toUpperCase();
  if (!Number.isFinite(spot) || spot <= 0) throw new Error('spot must be a positive number');
  if (!Number.isFinite(strike) || strike <= 0) throw new Error('strike must be a positive number');
  if (!Number.isFinite(daysToExpiry) || daysToExpiry <= 0) {
    throw new Error('daysToExpiry must be a positive number');
  }
  if (!Number.isFinite(volatility) || volatility <= 0) {
    throw new Error('volatility must be a positive decimal');
  }
  if (!Number.isFinite(rate) || rate < 0) throw new Error('rate must be zero or a positive decimal');
  if (side !== 'CALL' && side !== 'PUT') throw new Error('type must be CALL or PUT');

  const years = daysToExpiry / DAYS_PER_YEAR;
  const rootT = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * volatility * volatility) * years) / (volatility * rootT);
  const d2 = d1 - volatility * rootT;
  const discount = Math.exp(-rate * years);
  const cdf1 = normalCdf(d1);
  const cdf2 = normalCdf(d2);
  const cdf1Neg = normalCdf(-d1);
  const cdf2Neg = normalCdf(-d2);
  const density = normalPdf(d1);

  const price =
    side === 'CALL'
      ? spot * cdf1 - strike * discount * cdf2
      : strike * discount * cdf2Neg - spot * cdf1Neg;
  const intrinsic = side === 'CALL' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const delta = side === 'CALL' ? cdf1 : cdf1 - 1;
  const gamma = density / (spot * volatility * rootT);
  const thetaAnnual =
    side === 'CALL'
      ? -(spot * density * volatility) / (2 * rootT) - rate * strike * discount * cdf2
      : -(spot * density * volatility) / (2 * rootT) + rate * strike * discount * cdf2Neg;
  const vega = spot * density * rootT;
  const rhoAnnual =
    side === 'CALL'
      ? strike * years * discount * cdf2
      : -strike * years * discount * cdf2Neg;
  const pop = side === 'CALL' ? cdf2 : cdf2Neg;

  return {
    type: side,
    price,
    intrinsic,
    timeValue: price - intrinsic,
    delta,
    gamma,
    thetaPerDay: thetaAnnual / DAYS_PER_YEAR,
    vegaPerPercent: vega / 100,
    rhoPerPercent: rhoAnnual / 100,
    pop,
    d1,
    d2,
    years,
  };
}
