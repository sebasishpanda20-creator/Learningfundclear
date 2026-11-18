// Multi-timeframe hedging, PLAN ONLY.
//
// This module never places an order, never reads env/config, never touches the
// broker or the Quant daemon and never writes account state. It turns a small,
// fully validated input set into a hedge *template*: which legs a hedged
// structure would need, what the statutory cost would be at a supplied
// premium, and whether a conservative local expectancy gate passes. Anything
// it cannot know (IV, live premiums, exchange-confirmed expiry, broker-verified
// charge sheet) is returned as null and named in plan.unavailable instead of
// being guessed.

export const HEDGE_PLAN_ROUTE = '/api/hedge-plan';

export const HEDGE_SEGMENTS = Object.freeze([
  'NSE',
  'MCX',
  'DELTA',
  'QUANT',
  'JOURNAL',
]);

export const HEDGE_TIMEFRAMES = Object.freeze([
  '5m',
  '15m',
  '1h',
  '4h',
  '1D',
  '1W',
  '1M',
]);

const DIRECTIONS = Object.freeze(['BULLISH', 'BEARISH']);
const MAX_BODY_BYTES = 16384;

// Tier by timeframe. Intraday = same-expiry vertical debit spread, swing =
// protective collar, positional = far-month tail shield.
const NSE_TIERS = Object.freeze({
  '5m': 'INTRADAY',
  '15m': 'INTRADAY',
  '1h': 'INTRADAY',
  '4h': 'SWING',
  '1D': 'SWING',
  '1W': 'POSITIONAL',
  '1M': 'POSITIONAL',
});

// Lot size / strike step / expiry convention per index. These are contract
// specifications, not market data; the expiry date itself is still reported as
// unverified unless the caller supplies one.
const NSE_INDEX = Object.freeze({
  NIFTY: { label: 'NIFTY 50', exchange: 'NSE', lot: 75, step: 50, expiryWeekday: 4, weekly: true, basis: 'weekly Thursday expiry' },
  BANKNIFTY: { label: 'BANK NIFTY', exchange: 'NSE', lot: 35, step: 100, expiryWeekday: 3, weekly: false, basis: 'monthly last-Wednesday expiry' },
  FINNIFTY: { label: 'FIN NIFTY', exchange: 'NSE', lot: 65, step: 50, expiryWeekday: 2, weekly: false, basis: 'monthly last-Tuesday expiry' },
  MIDCPNIFTY: { label: 'MIDCAP NIFTY', exchange: 'NSE', lot: 120, step: 25, expiryWeekday: 1, weekly: false, basis: 'monthly last-Monday expiry' },
  SENSEX: { label: 'SENSEX', exchange: 'BSE', lot: 20, step: 100, expiryWeekday: 5, weekly: true, basis: 'weekly Friday expiry' },
});

// MCX contract specs. hasOptions=false means only the futures hedge is offered:
// the desk never fabricates an option contract that is not listed.
const MCX_CONTRACTS = Object.freeze({
  GOLD: { label: 'GOLD', lot: 1000, unit: 'g', step: 100, hasOptions: true },
  GOLDM: { label: 'GOLD MINI', lot: 100, unit: 'g', step: 100, hasOptions: true },
  SILVER: { label: 'SILVER', lot: 30, unit: 'kg', step: 1000, hasOptions: true },
  SILVERM: { label: 'SILVER MINI', lot: 5, unit: 'kg', step: 1000, hasOptions: false },
  CRUDEOIL: { label: 'CRUDE OIL', lot: 100, unit: 'bbl', step: 50, hasOptions: true },
  NATURALGAS: { label: 'NATURAL GAS', lot: 1250, unit: 'mmBtu', step: 5, hasOptions: true },
  COPPER: { label: 'COPPER', lot: 2500, unit: 'kg', step: 5, hasOptions: false },
  ZINC: { label: 'ZINC', lot: 5000, unit: 'kg', step: 5, hasOptions: false },
  ALUMINIUM: { label: 'ALUMINIUM', lot: 5000, unit: 'kg', step: 5, hasOptions: false },
});

const DELTA_ASSETS = Object.freeze({
  BTC: { label: 'Bitcoin', ledger: 'INR' },
  ETH: { label: 'Ethereum', ledger: 'INR' },
  SOL: { label: 'Solana', ledger: 'INR' },
  XAUT: { label: 'Tether Gold', ledger: 'INR' },
});

// Named assumptions. Every number below is a modelling rule, not market data,
// and is echoed in plan.assumptions so a reviewer can see exactly what was
// assumed when a figure is derived.
export const HEDGE_ASSUMPTIONS = Object.freeze({
  version: 'LOCAL_CONSERVATIVE_V1',
  debitStopPct: 0.5,
  stopPctOfSpot: 0.01,
  slippagePctOfTurnover: 0.005,
  rewardR1: 1.5,
  rewardR2: 3,
  minRewardToRisk: 1.5,
  parityWinRate: 0.5,
});

// Indicative charge sheet. ratesVerified=false is deliberately surfaced: the
// desk will not claim broker-verified statutory rates it has not fetched.
const RATE_SHEET = Object.freeze({
  version: 'LOCAL_V1_INDICATIVE',
  verified: false,
  NSE_OPTIONS: { sttSell: 0.000625, exchange: 0.0003503, sebi: 0.000001, stampBuy: 0.00003, brokeragePct: 0.0003, brokerageCap: 20, gst: 0.18 },
  NSE_FUTURES: { sttSell: 0.000125, exchange: 0.0000173, sebi: 0.000001, stampBuy: 0.00002, brokeragePct: 0.0003, brokerageCap: 20, gst: 0.18 },
  MCX_OPTIONS: { sttSell: 0.0005, exchange: 0.000418, sebi: 0.000001, stampBuy: 0.00003, brokeragePct: 0.0003, brokerageCap: 20, gst: 0.18 },
  MCX_FUTURES: { sttSell: 0.0001, exchange: 0.000026, sebi: 0.000001, stampBuy: 0.00002, brokeragePct: 0.0003, brokerageCap: 20, gst: 0.18 },
  DELTA: { takerFee: 0.0005, gst: 0.18, tdsSell: 0.01 },
});

class InputError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'InputError';
    this.field = field;
  }
}

const r2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

function isoDate(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function addDays(d, n) {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function utcMidnight(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Next occurrence of a weekday, at least one day ahead.
function nextWeekday(from, weekday) {
  const base = utcMidnight(from);
  const delta = (weekday - base.getUTCDay() + 7) % 7;
  return addDays(base, delta === 0 ? 7 : delta);
}

// Last occurrence of a weekday in the given month.
function lastWeekdayOfMonth(year, month, weekday) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const back = (last.getUTCDay() - weekday + 7) % 7;
  return addDays(last, -back);
}

function daysTo(asOf, expiryIso) {
  if (!expiryIso) return null;
  const target = new Date(`${expiryIso}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target - utcMidnight(asOf)) / 86400000);
}

// Stop and targets for a spot-priced exposure, from the named assumptions.
function spotLevels(entry, dir) {
  const risk = entry * HEDGE_ASSUMPTIONS.stopPctOfSpot;
  const sign = dir === 'BULLISH' ? -1 : 1;
  return {
    stopLoss: r2(entry + sign * risk),
    target1: r2(entry - sign * HEDGE_ASSUMPTIONS.rewardR1 * risk),
    target2: r2(entry - sign * HEDGE_ASSUMPTIONS.rewardR2 * risk),
  };
}

// One expiry descriptor for every segment: verified only when the caller
// supplied the date, CONVENTION when derived, UNAVAILABLE when unknown.
function expiryMeta(expiry, source, basis) {
  const present = expiry !== null && expiry !== undefined;
  return {
    expiry: present ? expiry : null,
    expiryVerified: present && source === 'INPUT',
    expirySource: present ? source : 'UNAVAILABLE',
    expiryBasis: basis,
  };
}

// A plan-only leg template: no price, no order id, no broker field.
function leg({ action, instrument, symbol, expiry, strike = null, optionType = null, lotSize = null, lots, quantity, role }) {
  return {
    action,
    instrument,
    symbol,
    expiry,
    strike,
    optionType,
    lotSize,
    lots,
    quantity,
    orderType: 'LIMIT',
    price: null,
    priceSource: 'unavailable',
    role,
  };
}

function parseAsOf(value) {
  if (value === undefined || value === null || value === '') return new Date();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new InputError('asOf', 'asOf must be an ISO date or timestamp.');
  return d;
}

function parseExpiry(value, asOf) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InputError('expiry', 'expiry must be a YYYY-MM-DD date.');
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new InputError('expiry', 'expiry is not a real calendar date.');
  if (d < utcMidnight(asOf)) throw new InputError('expiry', 'expiry is already in the past.');
  return value;
}

function requireSymbol(table, raw, segmentLabel) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new InputError('symbol', `symbol is required for a ${segmentLabel} hedge plan.`);
  }
  const key = raw.trim().toUpperCase();
  if (!table[key]) {
    throw new InputError(
      'symbol',
      `Unsupported ${segmentLabel} underlying "${raw.trim()}". Supported: ${Object.keys(table).join(', ')}.`,
    );
  }
  return key;
}

// ---------------------------------------------------------------- charges ---

function optionChargeLines(rate, price, qty, side) {
  const turnover = price * qty;
  const brokerage = Math.min(rate.brokerageCap, turnover * rate.brokeragePct);
  const stt = side === 'SELL' ? turnover * rate.sttSell : 0;
  const exchange = turnover * rate.exchange;
  const sebi = turnover * rate.sebi;
  const stamp = side === 'BUY' ? turnover * rate.stampBuy : 0;
  const gst = (brokerage + exchange + sebi) * rate.gst;
  return { turnover, brokerage, stt, exchange, sebi, stamp, gst, slippage: turnover * HEDGE_ASSUMPTIONS.slippagePctOfTurnover };
}

function sumLines(lines) {
  const total = { brokerage: 0, stt: 0, exchange: 0, sebi: 0, stamp: 0, gst: 0, slippage: 0 };
  for (const line of lines) {
    for (const key of Object.keys(total)) total[key] += line[key] || 0;
  }
  let gross = 0;
  for (const key of Object.keys(total)) gross += total[key];
  return {
    brokerage: r2(total.brokerage),
    stt: r2(total.stt),
    exchange: r2(total.exchange),
    sebi: r2(total.sebi),
    stamp: r2(total.stamp),
    gst: r2(total.gst),
    slippage: r2(total.slippage),
    total: r2(gross),
  };
}

function exchangeCosts(segment, kind, price, qty) {
  const rate = RATE_SHEET[`${segment}_${kind}`];
  const lines = [
    optionChargeLines(rate, price, qty, 'BUY'),
    optionChargeLines(rate, price, qty, 'SELL'),
  ];
  const breakdown = sumLines(lines);
  return {
    ...breakdown,
    rateSheet: RATE_SHEET.version,
    ratesVerified: RATE_SHEET.verified,
    basis: 'round trip at the supplied premium (entry and exit modelled at the same price)',
    note: 'Indicative statutory and brokerage charges. Verify the broker contract note before acting.',
  };
}

function deltaCosts(price, qty) {
  const rate = RATE_SHEET.DELTA;
  const turnover = price * qty;
  const fee = turnover * rate.takerFee * 2;
  const gst = fee * rate.gst;
  const slippage = turnover * HEDGE_ASSUMPTIONS.slippagePctOfTurnover;
  const tds = turnover * rate.tdsSell;
  return {
    brokerage: 0,
    stt: 0,
    exchange: r2(fee),
    sebi: 0,
    stamp: 0,
    gst: r2(gst),
    slippage: r2(slippage),
    total: r2(fee + gst + slippage),
    tdsOnSale: r2(tds),
    rateSheet: RATE_SHEET.version,
    ratesVerified: RATE_SHEET.verified,
    basis: 'round trip at the supplied premium, INR-settled same-ledger VDA pair',
    note: 'TDS under section 194S is withheld from sale proceeds and reported separately; it is not a fee.',
  };
}

// ------------------------------------------------------------- expectancy ---

const NO_EXPECTANCY = Object.freeze({
  model: 'PARITY_50_50',
  note: 'Not computed: a premium is required.',
  grossExpectancyInr: null,
  frictionInr: null,
  postCostExpectancyInr: null,
});

function expectancy({ maxLossInr, rewardInr, costInr }) {
  const gross = (rewardInr - maxLossInr) * HEDGE_ASSUMPTIONS.parityWinRate;
  const post = gross - (costInr || 0);
  return {
    model: 'PARITY_50_50',
    note: 'Parity expectancy assumes an even chance of hitting target 1 or the stop. It is a cost filter, not a probability, forecast or win rate.',
    grossExpectancyInr: r2(gross),
    frictionInr: r2(costInr),
    postCostExpectancyInr: r2(post),
  };
}

function expectancyGate({ expectancyInr, rewardToRisk }) {
  const checks = [
    { name: 'postCostExpectancyPositive', pass: isNum(expectancyInr) && expectancyInr > 0 },
    { name: 'rewardToRiskAtLeastMin', pass: isNum(rewardToRisk) && rewardToRisk >= HEDGE_ASSUMPTIONS.minRewardToRisk },
  ];
  const computed = isNum(expectancyInr) && isNum(rewardToRisk);
  return {
    gate: HEDGE_ASSUMPTIONS.version,
    computed,
    pass: computed && checks.every((c) => c.pass),
    checks,
    note: 'Conservative local gate: the plan must clear a positive post-cost parity expectancy and reward/risk of at least 1.5. No validated profitability model exists for this desk.',
  };
}

// -------------------------------------------------------------------- NSE ---

function nseExpiry(asOf, inst, tier, supplied) {
  if (supplied) return { expiry: supplied, source: 'INPUT', basis: 'supplied by the caller' };
  const basis = `${inst.label} ${inst.basis}; confirm against the exchange holiday calendar`;
  if (tier !== 'POSITIONAL' && inst.weekly) {
    return { expiry: isoDate(nextWeekday(asOf, inst.expiryWeekday)), source: 'CONVENTION', basis };
  }
  const base = utcMidnight(asOf);
  let candidate = lastWeekdayOfMonth(base.getUTCFullYear(), base.getUTCMonth(), inst.expiryWeekday);
  if (candidate <= base) {
    candidate = lastWeekdayOfMonth(base.getUTCFullYear(), base.getUTCMonth() + 1, inst.expiryWeekday);
  }
  if (tier === 'POSITIONAL') {
    candidate = lastWeekdayOfMonth(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, inst.expiryWeekday);
  }
  return { expiry: isoDate(candidate), source: 'CONVENTION', basis };
}

function buildNsePlan(input) {
  const asOf = input.asOf;
  const inst = NSE_INDEX[input.symbol];
  const tier = NSE_TIERS[input.timeframe];
  const step = inst.step;
  const atm = roundToStep(input.spot, step);
  const dir = input.direction;
  const lots = input.lots || 1;
  const qty = lots * inst.lot;
  const unavailable = [];
  const derived = nseExpiry(asOf, inst, tier, input.expiry);
  const { expiry, expiryVerified, expirySource, expiryBasis } = expiryMeta(derived.expiry, derived.source, derived.basis);
  const dte = daysTo(asOf, expiry);

  let hedgeLabel;
  let optionType;
  let shortOptionType = null;
  let longStrike;
  let shortStrike = null;
  let hedgeStrike;
  let product;
  let priceBasis;
  let entry;
  let stopLoss;
  let target1;
  let target2;
  let maxLossInr = null;
  let rewardInr = null;
  let mandatoryRule;
  let exitRule;

  if (tier === 'INTRADAY') {
    hedgeLabel = 'Intraday same-expiry vertical debit spread';
    product = 'MIS';
    priceBasis = 'PREMIUM_POINTS';
    optionType = dir === 'BULLISH' ? 'CE' : 'PE';
    longStrike = atm;
    shortStrike = dir === 'BULLISH' ? atm + 2 * step : atm - 2 * step;
    hedgeStrike = shortStrike;
    mandatoryRule = 'Square off every leg before 15:15 IST. An intraday hedge is never carried into the close.';
    exitRule = 'Exit or roll while days-to-expiry is greater than 1; never hold an expiring hedge.';
    entry = input.premium;
    if (entry === null) {
      unavailable.push('net debit premium (NSE option quote)');
      stopLoss = null;
      target1 = null;
      target2 = null;
    } else {
      const risk = entry * HEDGE_ASSUMPTIONS.debitStopPct;
      stopLoss = r2(entry - risk);
      target1 = r2(entry + HEDGE_ASSUMPTIONS.rewardR1 * risk);
      target2 = r2(entry + HEDGE_ASSUMPTIONS.rewardR2 * risk);
      maxLossInr = r2(entry * qty);
      rewardInr = r2((target1 - entry) * qty);
    }
  } else {
    // Both protective structures are spot-priced and share their stop and
    // targets; only the strike width and the max-loss derivation differ.
    const collar = tier === 'SWING';
    const width = collar ? 2 : 5;
    hedgeLabel = collar ? 'Swing protective collar' : 'Positional far-month tail shield';
    product = 'NRML';
    priceBasis = 'SPOT';
    optionType = dir === 'BULLISH' ? 'PE' : 'CE';
    longStrike = dir === 'BULLISH' ? atm - width * step : atm + width * step;
    shortStrike = collar ? (dir === 'BULLISH' ? atm + 3 * step : atm - 3 * step) : null;
    // The financing leg is the opposite option: a bullish collar sells a call.
    shortOptionType = collar ? (dir === 'BULLISH' ? 'CE' : 'PE') : null;
    hedgeStrike = longStrike;
    mandatoryRule = collar
      ? 'Exit or roll while days-to-expiry is greater than 1. The protective leg must exist before the short leg is sold.'
      : 'The tail shield is a protective overlay, not a directional trade. Roll it before DTE 1 in the far month.';
    exitRule = collar
      ? 'Roll the collar at DTE 1 or earlier; do not let either leg expire.'
      : 'Roll the tail at DTE 1 or earlier; never carry a tail leg into expiry week.';
    entry = input.spot;
    ({ stopLoss, target1, target2 } = spotLevels(entry, dir));
    rewardInr = r2(Math.abs(target1 - entry) * qty);
    if (input.premium === null) {
      unavailable.push(collar ? 'net collar premium or credit (NSE option quotes)' : 'tail-shield premium (NSE option quote)');
      maxLossInr = null;
    } else if (collar) {
      maxLossInr = r2(Math.max(0, 2 * step + input.premium) * qty);
    } else {
      maxLossInr = r2(Math.abs(input.premium) * qty);
    }
  }

  const costs = input.premium === null
    ? null
    : exchangeCosts('NSE', 'OPTIONS', Math.abs(input.premium), qty);
  if (costs === null) unavailable.push('statutory cost estimate (premium required)');

  const costInr = costs ? costs.total : null;
  const rewardToRisk = isNum(maxLossInr) && maxLossInr > 0 && isNum(rewardInr)
    ? r2(rewardInr / maxLossInr)
    : null;
  const exp = maxLossInr === null || rewardInr === null ? NO_EXPECTANCY : expectancy({ maxLossInr, rewardInr, costInr });

  const instrument = inst.exchange === 'BSE' ? 'OPTIDX-BSE' : 'OPTIDX-NSE';
  const legs = [
    leg({
      action: 'BUY',
      instrument,
      symbol: input.symbol,
      expiry,
      strike: longStrike,
      optionType,
      lotSize: inst.lot,
      lots,
      quantity: qty,
      role: tier === 'INTRADAY' ? 'hedge leg' : 'protective leg',
    }),
  ];
  if (shortStrike !== null) {
    legs.push(
      leg({
        action: 'SELL',
        instrument,
        symbol: input.symbol,
        expiry,
        strike: shortStrike,
        optionType: shortOptionType || optionType,
        lotSize: inst.lot,
        lots,
        quantity: qty,
        role: 'financing leg',
      }),
    );
  }

  return {
    tier,
    hedgeLabel,
    priceBasis,
    entry: r2(entry),
    stopLoss,
    hedgeStrike,
    maxLossInr,
    target1,
    target2,
    rewardToRisk,
    mandatoryRule,
    statutoryCostInr: costInr,
    postCostExpectancyInr: exp.postCostExpectancyInr,
    expiry,
    expiryVerified,
    expirySource,
    expiryBasis,
    daysToExpiry: dte,
    lotSize: inst.lot,
    strikeStep: step,
    atmStrike: atm,
    lots,
    quantity: qty,
    exitRule,
    unavailable,
    costs,
    expectancy: exp,
    expectancyGate: expectancyGate({ expectancyInr: exp.postCostExpectancyInr, rewardToRisk }),
    assumptions: { ...HEDGE_ASSUMPTIONS },
    basket: {
      executionMode: 'PLAN_ONLY',
      orderPlacement: 'DISABLED',
      product,
      label: 'FYERS-compatible hedge basket template — reference only, never dispatched',
      legs,
      instructions: 'Place manually only after independent verification of spot, IV, premium, margin and expiry. This object is never sent to a broker.',
    },
  };
}

// -------------------------------------------------------------------- MCX ---

function buildMcxPlan(input) {
  const asOf = input.asOf;
  const inst = MCX_CONTRACTS[input.symbol];
  const tier = NSE_TIERS[input.timeframe];
  const lots = input.lots || 1;
  const qty = lots * inst.lot;
  const dir = input.direction;
  const unavailable = [];
  const { expiry, expiryVerified, expirySource, expiryBasis } = expiryMeta(
    parseExpiry(input.expiry, asOf),
    'INPUT',
    'MCX monthly contract; the exchange-published expiry date is authoritative',
  );
  const dte = daysTo(asOf, expiry);
  if (expiry === null) unavailable.push('exchange-published MCX contract expiry date');

  const optionsAllowed = inst.hasOptions && tier !== 'INTRADAY' && input.premium !== null;
  const hedgeLabel = optionsAllowed
    ? `${tier === 'POSITIONAL' ? 'Positional' : 'Swing'} protective option overlay on the MCX futures exposure`
    : 'Futures hedge on the existing MCX instrument context';

  const entry = input.spot;
  const { stopLoss, target1, target2 } = spotLevels(entry, dir);

  let maxLossInr = r2(Math.abs(entry - stopLoss) * qty);
  let rewardInr = r2(Math.abs(target1 - entry) * qty);
  let hedgeStrike = null;

  if (optionsAllowed) {
    const step = inst.step;
    const atm = roundToStep(entry, step);
    hedgeStrike = dir === 'BULLISH' ? atm - 2 * step : atm + 2 * step;
    maxLossInr = r2(Math.abs(input.premium) * qty);
  } else if (inst.hasOptions && input.premium === null) {
    unavailable.push('option premium (MCX option quote) — futures hedge template used instead');
  }

  const costs = input.premium !== null && optionsAllowed
    ? exchangeCosts('MCX', 'OPTIONS', Math.abs(input.premium), qty)
    : exchangeCosts('MCX', 'FUTURES', entry, qty);

  const rewardToRisk = maxLossInr > 0 ? r2(rewardInr / maxLossInr) : null;
  const exp = expectancy({ maxLossInr, rewardInr, costInr: costs.total });

  const legs = [
    leg({
      action: dir === 'BULLISH' ? 'BUY' : 'SELL',
      instrument: 'FUTCOM',
      symbol: input.symbol,
      expiry,
      lotSize: inst.lot,
      lots,
      quantity: qty,
      role: 'futures hedge',
    }),
  ];
  if (optionsAllowed) {
    legs.push(
      leg({
        action: 'BUY',
        instrument: 'OPTFUT',
        symbol: input.symbol,
        expiry,
        strike: hedgeStrike,
        optionType: dir === 'BULLISH' ? 'PE' : 'CE',
        lotSize: inst.lot,
        lots,
        quantity: qty,
        role: 'protective option',
      }),
    );
  }

  return {
    tier,
    hedgeLabel,
    priceBasis: 'SPOT',
    entry: r2(entry),
    stopLoss,
    hedgeStrike,
    maxLossInr,
    target1,
    target2,
    rewardToRisk,
    mandatoryRule: 'Only hedge the MCX instrument already loaded in the scanner. Never create a contract or expiry the exchange has not published.',
    statutoryCostInr: costs.total,
    postCostExpectancyInr: exp.postCostExpectancyInr,
    expiry,
    expiryVerified,
    expirySource,
    expiryBasis,
    daysToExpiry: dte,
    lotSize: inst.lot,
    strikeStep: inst.step,
    atmStrike: optionsAllowed ? roundToStep(entry, inst.step) : null,
    lots,
    quantity: qty,
    exitRule: 'Roll to the next month before the exchange-published expiry; MCX contracts are never carried into delivery. Square off intraday hedges before the non-agri session close at 23:30 IST (agri at 17:00 IST).',
    rollRule: 'Roll on the expiry-week Monday or earlier; never hold a contract into its delivery/expiry day.',
    unavailable,
    costs,
    expectancy: exp,
    expectancyGate: expectancyGate({ expectancyInr: exp.postCostExpectancyInr, rewardToRisk }),
    assumptions: { ...HEDGE_ASSUMPTIONS },
    basket: {
      executionMode: 'PLAN_ONLY',
      orderPlacement: 'DISABLED',
      product: tier === 'INTRADAY' ? 'MIS' : 'NRML',
      label: 'FYERS-compatible MCX hedge basket template — reference only, never dispatched',
      legs,
      instructions: 'Place manually only after verifying the contract, expiry and margin on the exchange. This object is never sent to a broker.',
    },
  };
}

// ------------------------------------------------------------------ DELTA ---

function buildDeltaPlan(input) {
  const asOf = input.asOf;
  const asset = DELTA_ASSETS[input.symbol];
  const lots = input.lots || 1;
  const qty = lots;
  const dir = input.direction;
  const unavailable = ['Delta contract multiplier (verify on the exchange contract specification)'];
  if (input.premium === null) unavailable.push('option premium (Delta India quote)');
  const { expiry, expiryVerified, expirySource, expiryBasis } = expiryMeta(
    parseExpiry(input.expiry, asOf),
    'INPUT',
    'Delta exchange contract calendar',
  );
  if (expiry === null) unavailable.push('Delta contract expiry');

  const entry = input.spot;
  const { stopLoss, target1, target2 } = spotLevels(entry, dir);

  const maxLossInr = input.premium === null ? null : r2(Math.abs(input.premium) * qty);
  const rewardInr = r2(Math.abs(target1 - entry) * qty);
  const costs = input.premium === null ? null : deltaCosts(Math.abs(input.premium), qty);
  const costInr = costs ? costs.total : null;
  const rewardToRisk = isNum(maxLossInr) && maxLossInr > 0 ? r2(rewardInr / maxLossInr) : null;
  const exp = maxLossInr === null ? NO_EXPECTANCY : expectancy({ maxLossInr, rewardInr, costInr });

  return {
    tier: NSE_TIERS[input.timeframe],
    hedgeLabel: 'Same-ledger INR-settled VDA hedge pair (research only)',
    priceBasis: 'SPOT',
    entry: r2(entry),
    stopLoss,
    hedgeStrike: null,
    maxLossInr,
    target1,
    target2,
    rewardToRisk,
    mandatoryRule: 'Both legs must settle in INR on the same Delta ledger. This is a research pair, never an executable order.',
    statutoryCostInr: costInr,
    postCostExpectancyInr: exp.postCostExpectancyInr,
    expiry,
    expiryVerified,
    expirySource,
    expiryBasis,
    daysToExpiry: daysTo(asOf, expiry),
    lotSize: null,
    strikeStep: null,
    atmStrike: null,
    lots,
    quantity: qty,
    settlement: 'INR',
    ledger: asset.ledger,
    taxGuardrail: 'Section 115BBH: VDA gains are taxed at 30% flat plus cess, and a loss on one VDA cannot be set off against another VDA or against other income. Section 194S TDS of 1% applies to sale proceeds. Hedging does not change this treatment.',
    exitRule: 'Close or roll both legs together; a hedge leg left alone becomes a naked directional position.',
    unavailable,
    costs,
    expectancy: exp,
    expectancyGate: expectancyGate({ expectancyInr: exp.postCostExpectancyInr, rewardToRisk }),
    assumptions: { ...HEDGE_ASSUMPTIONS },
    basket: {
      executionMode: 'PLAN_ONLY',
      orderPlacement: 'DISABLED',
      product: 'RESEARCH_ONLY',
      label: 'Same-ledger INR-settled Delta hedge pair template — reference only, never dispatched',
      legs: [
        leg({
          action: dir === 'BULLISH' ? 'BUY' : 'SELL',
          instrument: 'VDA_PERP_OR_OPTION',
          symbol: input.symbol,
          expiry,
          lots,
          quantity: qty,
          role: 'primary leg',
        }),
        leg({
          action: dir === 'BULLISH' ? 'SELL' : 'BUY',
          instrument: 'VDA_PERP_OR_OPTION',
          symbol: input.symbol,
          expiry,
          lots,
          quantity: qty,
          role: 'hedge leg',
        }),
      ],
      instructions: 'Both legs are same-ledger and INR-settled. Nothing here is routed to Delta; place only after independent verification.',
    },
  };
}

// ------------------------------------------------------------- validation ---

function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new InputError('body', 'Request body must be a JSON object.');
  }
  if (typeof body.segment !== 'string' || !HEDGE_SEGMENTS.includes(body.segment.toUpperCase())) {
    throw new InputError('segment', `segment must be one of ${HEDGE_SEGMENTS.join(', ')}.`);
  }
  const segment = body.segment.toUpperCase();
  if (typeof body.timeframe !== 'string' || !HEDGE_TIMEFRAMES.includes(body.timeframe)) {
    throw new InputError('timeframe', `timeframe must be one of ${HEDGE_TIMEFRAMES.join(', ')}.`);
  }
  if (typeof body.direction !== 'string' || !DIRECTIONS.includes(body.direction.toUpperCase())) {
    throw new InputError('direction', 'direction must be BULLISH or BEARISH.');
  }
  const spot = Number(body.spot);
  if (!isNum(spot) || spot <= 0) {
    throw new InputError('spot', 'spot must be a positive number.');
  }
  if (body.premium !== undefined && body.premium !== null && body.premium !== '') {
    const premium = Number(body.premium);
    if (!isNum(premium) || premium === 0) throw new InputError('premium', 'premium must be a non-zero number of points per unit.');
  }
  if (body.lots !== undefined && body.lots !== null && body.lots !== '') {
    const lots = Number(body.lots);
    if (!Number.isInteger(lots) || lots < 1 || lots > 10000) throw new InputError('lots', 'lots must be an integer between 1 and 10000.');
  }

  return {
    segment,
    timeframe: body.timeframe,
    direction: body.direction.toUpperCase(),
    symbol: body.symbol,
    spot,
    premium: body.premium === undefined || body.premium === null || body.premium === '' ? null : Number(body.premium),
    lots: body.lots === undefined || body.lots === null || body.lots === '' ? 1 : Number(body.lots),
    expiry: body.expiry,
    asOf: parseAsOf(body.asOf),
  };
}

// ---------------------------------------------------------------- builders ---

export function buildHedgePlan(body) {
  const input = validate(body);
  const root = input.segment === 'QUANT' || input.segment === 'JOURNAL' ? 'NSE' : input.segment;

  let plan;
  if (root === 'NSE') {
    input.symbol = requireSymbol(NSE_INDEX, input.symbol, 'NSE');
    plan = buildNsePlan(input);
  } else if (root === 'MCX') {
    input.symbol = requireSymbol(MCX_CONTRACTS, input.symbol, 'MCX');
    plan = buildMcxPlan(input);
  } else {
    input.symbol = requireSymbol(DELTA_ASSETS, input.symbol, 'Delta');
    plan = buildDeltaPlan(input);
  }

  return {
    ok: true,
    segment: input.segment,
    sourceSegment: root,
    executionMode: 'PLAN_ONLY',
    orderPlacement: 'DISABLED',
    generatedAt: new Date().toISOString(),
    plan,
    disclaimer:
      'Plan-only research output. No order was placed, no broker was called, and no account state was changed. Prices, IV and expiries not supplied by the caller are reported as unavailable rather than estimated.',
  };
}

// ------------------------------------------------------------------ route ---

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-hedge-mode': 'PLAN_ONLY',
};

function jsonResponse(payload, status, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...jsonHeaders, ...extra },
  });
}

export async function serveHedgePlan(request) {
  if (request.method !== 'POST') {
    return jsonResponse(
      { ok: false, error: 'METHOD_NOT_ALLOWED', message: 'Use POST for hedge plans.' },
      405,
      { allow: 'POST' },
    );
  }
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return jsonResponse(
      { ok: false, error: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.' },
      415,
    );
  }
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonResponse(
      { ok: false, error: 'PAYLOAD_TOO_LARGE', message: `Body must be ${MAX_BODY_BYTES} bytes or fewer.` },
      413,
    );
  }

  let text;
  try {
    text = await request.text();
  } catch {
    return jsonResponse({ ok: false, error: 'INVALID_BODY', message: 'Request body could not be read.' }, 400);
  }
  if (text.length > MAX_BODY_BYTES) {
    return jsonResponse(
      { ok: false, error: 'PAYLOAD_TOO_LARGE', message: `Body must be ${MAX_BODY_BYTES} bytes or fewer.` },
      413,
    );
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonResponse({ ok: false, error: 'INVALID_JSON', message: 'Request body must be valid JSON.' }, 400);
  }

  try {
    return jsonResponse(buildHedgePlan(body), 200);
  } catch (err) {
    if (err instanceof InputError) {
      return jsonResponse({ ok: false, error: 'INVALID_INPUT', field: err.field, message: err.message }, 400);
    }
    // Deliberately generic: no stack, config or environment detail leaves here.
    return jsonResponse({ ok: false, error: 'PLAN_FAILED', message: 'The hedge plan could not be generated.' }, 500);
  }
}
