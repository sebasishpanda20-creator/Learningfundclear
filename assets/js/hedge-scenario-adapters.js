/* Segment adapters for the expiry-scenario calculator.
 *
 * Each adapter resolves the segment's live context on every call, verifies the
 * contract identity (underlying, expiry, currency, settlement, multiplier) and
 * the quote's provenance, and either returns a scenario input or throws a
 * ScenarioBlocked with the exact missing/refused field. Nothing is invented:
 * when the portal's verified source cannot supply a required figure the panel
 * says so instead of previewing a made-up payoff.
 */

import { mountHedgeScenario } from './hedge-scenario.js';

export const QUOTE_MAX_AGE_MS = 5 * 60 * 1000;

export class ScenarioBlocked extends Error {
  constructor(code, reason, extra = {}) {
    super(reason);
    this.name = 'ScenarioBlocked';
    this.code = code;
    this.reason = reason;
    Object.assign(this, extra);
  }
}

// Sources hand back either epoch milliseconds or an ISO 8601 string; both are
// normalised before the freshness comparison.
export function normalizeQuoteAt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

function nseFill(ctx, leg) {
  const strike = Number(leg.strike);
  const optionType = leg.optionType === 'CE' || leg.optionType === 'PE' ? leg.optionType : null;
  const quote = ctx.quotes && optionType ? ctx.quotes[`${strike}:${optionType}`] : null;
  const side = leg.action === 'SELL' ? 'bid' : 'ask';
  const value = quote ? quote[side] : null;
  if (!(Number.isFinite(value) && value > 0)) {
    throw new ScenarioBlocked(
      'NO_BID_ASK',
      `The NSE chain has no verified ${side} for ${strike} ${optionType || 'leg'}; the preview will not fall back to last traded price.`,
    );
  }
  return value;
}

function requireFresh(ctx) {
  const quoteAt = normalizeQuoteAt(ctx.quoteAt);
  if (!Number.isFinite(quoteAt)) {
    throw new ScenarioBlocked('QUOTE_TIMESTAMP_UNAVAILABLE', 'The quote has no source timestamp, so its freshness cannot be verified.');
  }
  const age = ctx.now - quoteAt;
  if (!Number.isFinite(age) || age < -60000 || age > QUOTE_MAX_AGE_MS) {
    throw new ScenarioBlocked('STALE_QUOTES', 'The last verified quote is older than five minutes; refresh the segment data.');
  }
}

function requirePrices(prices) {
  if (!Array.isArray(prices) || !prices.length) {
    throw new ScenarioBlocked('NO_SCENARIO_PRICES', 'Enter or source at least one settlement price before previewing.');
  }
  return prices;
}

// Segment-specific reasons for a missing contract. The generic fallback keeps
// the existing NO_<SEGMENT>_CONTRACT code for any future adapter.
const MISSING_CONTRACT = {
  MCX: [
    'NO_MCX_CONTRACT',
    'No MCX contract metadata or quote is available in this portal; the commodity watchlist is a Yahoo global-futures proxy, not an MCX contract.',
  ],
  DELTA: [
    'NO_INR_SETTLED_CONTRACT',
    'No verified INR-settled Delta contract metadata is available for this panel.',
  ],
};

function contractIdentity(contract, segment) {
  if (!contract) {
    const [code, reason] = MISSING_CONTRACT[segment] || [
      `NO_${segment}_CONTRACT`,
      'No verified contract metadata is available for this panel.',
    ];
    throw new ScenarioBlocked(code, reason);
  }
  if (!['LINEAR', 'CALL', 'PUT'].includes(contract.kind)) {
    throw new ScenarioBlocked('UNSUPPORTED_INSTRUMENT_KIND', 'Only linear, call and put instruments with a verified contract spec are supported.');
  }
  if (segment !== 'NSE' && contract.kind !== 'LINEAR') {
    throw new ScenarioBlocked('NON_LINEAR_UNSUPPORTED', `${segment} scenarios accept verified linear instruments only.`);
  }
  if (contract.inverse === true) {
    throw new ScenarioBlocked('INVERSE_CONTRACT_REFUSED', 'Inverse contracts are not modelled; this desk refuses to approximate their settlement.');
  }
  if (typeof contract.settlement !== 'string' || !contract.settlement.trim()) {
    throw new ScenarioBlocked('SETTLEMENT_UNVERIFIED', 'The contract settlement asset is not published by the source and is never inferred from the ticker.');
  }
  if (typeof contract.currency !== 'string' || !contract.currency.trim()) {
    throw new ScenarioBlocked('CURRENCY_UNVERIFIED', 'The contract currency is missing from the verified metadata.');
  }
  if (!(Number.isFinite(contract.multiplier) && contract.multiplier > 0)) {
    throw new ScenarioBlocked('MULTIPLIER_UNVERIFIED', 'The contract multiplier/unit is not verified for this instrument.');
  }
  return contract;
}

function assertSameContract(contract, legs) {
  for (const leg of legs) {
    if (leg.underlying !== contract.underlying || leg.expiry !== contract.expiry) {
      throw new ScenarioBlocked('MIXED_EXPIRY_OR_UNDERLYING', 'Every leg must share one underlying and one expiry.');
    }
    if (leg.currency !== contract.currency || leg.settlement !== contract.settlement) {
      throw new ScenarioBlocked('SETTLEMENT_MISMATCH', 'Every leg must settle in the same asset and currency.');
    }
    if (leg.multiplier !== contract.multiplier) {
      throw new ScenarioBlocked('MULTIPLIER_MISMATCH', 'Every leg must use the same verified multiplier.');
    }
  }
}

/* The plans this portal can produce carry strikes and sides but no verified
 * premiums, so a leg is only usable when its quote is explicitly present. */
function legFromPlan(leg, contract, currency, settlement) {
  const kind = leg.optionType === 'CE' ? 'CALL' : leg.optionType === 'PE' ? 'PUT' : 'LINEAR';
  const quote = leg.quote;
  if (!(Number.isFinite(quote) && quote > 0)) {
    throw new ScenarioBlocked(
      'NO_VERIFIED_PREMIUM',
      'The plan has no verified entry premium for every leg; the preview will not invent one.',
    );
  }
  return {
    underlying: contract.underlying,
    expiry: contract.expiry,
    currency,
    settlement,
    kind,
    side: leg.action === 'SELL' ? -1 : 1,
    lots: Number.isSafeInteger(leg.lots) && leg.lots > 0 ? leg.lots : 1,
    multiplier: contract.multiplier,
    entry: quote,
    ...(kind === 'LINEAR' ? {} : { strike: Number(leg.strike) }),
  };
}

export function nseScenario(ctx) {
  if (!ctx || typeof ctx.symbol !== 'string' || !ctx.symbol.trim()) {
    throw new ScenarioBlocked('NO_CONTRACT', 'Select an NSE underlying and expiry first.');
  }
  if (typeof ctx.expiry !== 'string' || !/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(ctx.expiry)) {
    throw new ScenarioBlocked('NO_EXPIRY', 'The selected expiry is not an exchange-format date (DD-MMM-YYYY).');
  }
  if (!ctx.plan || !Array.isArray(ctx.plan.basket?.legs) || !ctx.plan.basket.legs.length) {
    throw new ScenarioBlocked('NO_PLAN', 'Generate a hedge plan in this panel first; the preview simulates that plan\'s legs.');
  }
  if (ctx.chain && (ctx.chain.symbol !== ctx.symbol || ctx.chain.expiry !== ctx.expiry)) {
    throw new ScenarioBlocked('CHAIN_MISMATCH', 'The loaded option chain does not match the selected underlying and expiry.');
  }
  const contract = contractIdentity(
    {
      underlying: ctx.symbol,
      expiry: ctx.expiry,
      kind: ctx.plan.basket.legs[0].optionType ? (ctx.plan.basket.legs[0].optionType === 'CE' ? 'CALL' : 'PUT') : 'LINEAR',
      currency: 'INR',
      settlement: 'INR',
      multiplier: ctx.plan.lotSize,
    },
    'NSE',
  );
  const legs = ctx.plan.basket.legs.map((leg) =>
    legFromPlan({ ...leg, quote: nseFill(ctx, leg) }, contract, 'INR', 'INR'),
  );
  requireFresh(ctx);
  assertSameContract(contract, legs);
  return {
    underlying: contract.underlying,
    expiry: contract.expiry,
    currency: 'INR',
    settlement: 'INR',
    legs,
    prices: requirePrices(ctx.prices),
    fees: Number.isFinite(ctx.fees) && ctx.fees >= 0 ? ctx.fees : Number(ctx.plan.statutoryCostInr) || 0,
    source: ctx.source || 'NSE option chain',
    quoteAt: Number.isFinite(normalizeQuoteAt(ctx.quoteAt)) ? new Date(normalizeQuoteAt(ctx.quoteAt)).toISOString() : null,
  };
}

export function mcxScenario(ctx) {
  const contract = contractIdentity(ctx && ctx.contract, 'MCX');
  if (typeof contract.expiry !== 'string' || !contract.expiry) {
    throw new ScenarioBlocked('NO_EXPIRY', 'The MCX contract expiry is not published by the source.');
  }
  if (ctx.plan && ctx.plan.expiry && ctx.plan.expiry !== contract.expiry) {
    throw new ScenarioBlocked('MIXED_EXPIRY_OR_UNDERLYING', 'The plan and the quoted contract have different expiries.');
  }
  requireFresh(ctx);
  const extra = (ctx.legs || []).map((leg) => legFromPlan(leg, contract, contract.currency, contract.settlement));
  const base = legFromPlan(
    {
      action: ctx.side === -1 ? 'SELL' : 'BUY',
      lots: ctx.lots || 1,
      quote: ctx.entry,
      optionType: null,
    },
    contract,
    contract.currency,
    contract.settlement,
  );
  const legs = [base, ...extra];
  assertSameContract(contract, legs);
  return {
    underlying: contract.underlying,
    expiry: contract.expiry,
    currency: contract.currency,
    settlement: contract.settlement,
    legs,
    prices: requirePrices(ctx.prices),
    fees: Number.isFinite(ctx.fees) && ctx.fees >= 0 ? ctx.fees : 0,
    source: ctx.source || 'MCX contract feed',
    quoteAt: Number.isFinite(normalizeQuoteAt(ctx.quoteAt)) ? new Date(normalizeQuoteAt(ctx.quoteAt)).toISOString() : null,
  };
}

export function deltaScenario(ctx) {
  const contract = contractIdentity(ctx && ctx.contract, 'DELTA');
  if (typeof contract.expiry !== 'string' || !contract.expiry) {
    throw new ScenarioBlocked('NO_EXPIRY', 'The Delta contract expiry is not published by the source.');
  }
  if (contract.currency !== 'INR' || contract.settlement !== 'INR') {
    throw new ScenarioBlocked('SETTLEMENT_MISMATCH', 'Delta hedge legs must be same-ledger and INR-settled; this contract is not.');
  }
  requireFresh(ctx);
  const legs = [legFromPlan({ action: ctx.side === -1 ? 'SELL' : 'BUY', lots: ctx.lots || 1, quote: ctx.entry, optionType: null }, contract, contract.currency, contract.settlement), ...(ctx.legs || []).map((leg) => legFromPlan(leg, contract, contract.currency, contract.settlement))];
  assertSameContract(contract, legs);
  return {
    underlying: contract.underlying,
    expiry: contract.expiry,
    currency: contract.currency,
    settlement: contract.settlement,
    legs,
    prices: requirePrices(ctx.prices),
    fees: Number.isFinite(ctx.fees) && ctx.fees >= 0 ? ctx.fees : 0,
    source: ctx.source || 'Delta India exchange feed',
    quoteAt: Number.isFinite(normalizeQuoteAt(ctx.quoteAt)) ? new Date(normalizeQuoteAt(ctx.quoteAt)).toISOString() : null,
  };
}

/* --------------------------------------------------------------- page reads */

function text(doc, id) {
  const node = doc.getElementById(id);
  return node ? (node.value !== undefined && node.tagName !== 'DIV' ? node.value : node.textContent) : '';
}

// Settlement prices are typed by the operator in the panel; they are never
// synthesised from the chain, spot or any model.
function operatorPrices(doc) {
  const node = typeof doc.querySelector === 'function' ? doc.querySelector('[data-hedge-market-prices]') : null;
  return String((node && node.value) || '')
    .split(/[,;\s]+/)
    .filter((value) => value.trim())
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

export function readNseContext(doc = document, win = window) {
  const state = win.LfcHedgePlanState;
  const chain = win.LfcNseChain && Array.isArray(win.LfcNseChain.rows) ? win.LfcNseChain : null;
  const quotes = {};
  if (chain) {
    for (const row of chain.rows) {
      for (const [optionType, side] of [['CE', row.ce], ['PE', row.pe]]) {
        if (!side) continue;
        const bid = Number(side.bid);
        const ask = Number(side.ask);
        if (Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0) {
          quotes[`${row.strike}:${optionType}`] = { bid, ask };
        }
      }
    }
  }
  const selectedSymbol = String(text(doc, 'sym') || '').trim();
  const selectedExpiry = String(text(doc, 'exp') || '').trim();
  // The selectors identify what the user asked for. If the expiry selector has
  // not been populated (for example after a failed chain load), the loaded
  // chain's expiry is the only usable value; a mismatch still blocks below.
  const expirySelected = /^\d{2}-[A-Za-z]{3}-\d{4}$/.test(selectedExpiry);
  return {
    symbol: selectedSymbol || String((chain && chain.symbol) || '').trim(),
    expiry: expirySelected ? selectedExpiry : String((chain && chain.expiry) || '').trim(),
    plan: state && state.plan ? state.plan : null,
    quoteAt: chain && Number.isFinite(chain.fetchedAt) ? chain.fetchedAt : null,
    now: Date.now(),
    quotes,
    chain: chain ? { symbol: chain.symbol, expiry: chain.expiry } : null,
    prices: operatorPrices(doc),
    source: chain ? 'NSE option chain (relay bid/ask)' : 'NSE option chain (not loaded)',
  };
}

export function readMcxContext(doc = document, win = window) {
  const raw = String(text(doc, 'watchInput') || '').trim();
  const first = raw.split(/[,;\s]+/)[0] || '';
  const state = win.LfcHedgePlanState;
  return {
    symbol: first,
    market: /(^|=F$)/.test(first) ? 'GLOBAL_PROXY' : 'UNKNOWN',
    contract: null, // no MCX contract metadata is present in this portal
    plan: state && state.plan ? state.plan : null,
    quoteAt: null,
    now: Date.now(),
    prices: [],
    source: 'scanner watchlist',
  };
}

export function readDeltaContext(_doc = document, win = window) {
  let saved = null;
  try {
    saved = JSON.parse(win.sessionStorage.getItem('lfc.crypto.plan') || 'null');
  } catch {
    saved = null;
  }
  return {
    contract: null, // the desk never publishes settlement asset or multiplier
    plan: saved,
    quoteAt: saved && Number.isFinite(saved.quoteAt) ? saved.quoteAt : null,
    now: Date.now(),
    prices: [],
    source: 'Delta India exchange feed',
  };
}

export function createAdapters(readContext) {
  return {
    NSE: async () => nseScenario(await readContext('NSE')),
    MCX: async () => mcxScenario(await readContext('MCX')),
    DELTA: async () => deltaScenario(await readContext('DELTA')),
  };
}

const READERS = { NSE: readNseContext, MCX: readMcxContext, DELTA: readDeltaContext };

// Selecting another instrument or expiry retires the result on screen.
const CLEAR_ON = { NSE: ['#sym', '#exp'], MCX: ['#watchInput'], DELTA: [] };

export const adapters = createAdapters((segment) => READERS[segment]());

export function mountAll(doc = document) {
  const mounted = [];
  for (const host of doc.querySelectorAll('[data-hedge-scenario]')) {
    const segment = (host.getAttribute('data-segment') || '').toUpperCase();
    const adapter = adapters[segment];
    if (!adapter) continue;
    mountHedgeScenario(host, () => adapter(), doc, {
      clearOn: CLEAR_ON[segment] || [],
      marketPrices: segment === 'NSE',
    });
    mounted.push(segment);
  }
  return mounted;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountAll());
  else mountAll();
}
