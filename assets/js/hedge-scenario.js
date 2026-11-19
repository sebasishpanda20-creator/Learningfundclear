/* Expiry-scenario calculator for the embedded hedge panels.
 *
 * Pure maths plus a thin mount. No network, no broker, no orders: it answers
 * "what would this leg set be worth at expiry at these settlement prices" and
 * nothing more. It is not a contract selector and does not claim an expectancy,
 * tax outcome or guaranteed loss limit.
 *
 * The market-data preview only runs when an adapter can supply verified quotes.
 * Where it cannot, the same panel offers a manual mode whose every input is
 * typed by the user and whose output is labelled as hypothetical.
 */

const positive = (x) => Number.isFinite(x) && x > 0;

export const SCENARIO_LIMITS = Object.freeze({ maxLegs: 8, maxPrices: 100 });
export const MANUAL_SOURCE = 'Manual scenario — user-supplied hypothetical inputs';
export const MANUAL_CAPTION = 'Expiry payoff at supplied prices';

export function expiryScenario({ underlying, expiry, currency, settlement, legs, prices, fees }) {
  if (
    ![underlying, expiry, currency, settlement].every((x) => typeof x === 'string' && x.trim()) ||
    !Array.isArray(legs) ||
    !legs.length ||
    legs.length > SCENARIO_LIMITS.maxLegs ||
    !Array.isArray(prices) ||
    !prices.length ||
    prices.length > SCENARIO_LIMITS.maxPrices ||
    !prices.every((x) => Number.isFinite(x) && x >= 0) ||
    !Number.isFinite(fees) ||
    fees < 0
  ) {
    throw new Error('Incomplete scenario inputs');
  }
  for (const l of legs) {
    if (
      !l ||
      l.underlying !== underlying ||
      l.expiry !== expiry ||
      l.currency !== currency ||
      l.settlement !== settlement ||
      !['CALL', 'PUT', 'LINEAR'].includes(l.kind) ||
      ![1, -1].includes(l.side) ||
      !Number.isSafeInteger(l.lots) ||
      l.lots < 1 ||
      !positive(l.multiplier) ||
      !positive(l.entry) ||
      (l.kind !== 'LINEAR' && !positive(l.strike))
    ) {
      throw new Error('Invalid or incompatible leg');
    }
  }
  return prices.map((price) => {
    const pnl = legs.reduce((sum, l) => {
      const value =
        l.kind === 'LINEAR' ? price : l.kind === 'CALL' ? Math.max(0, price - l.strike) : Math.max(0, l.strike - price);
      return sum + l.side * l.lots * l.multiplier * (value - l.entry);
    }, -fees);
    if (!Number.isFinite(pnl)) throw new Error('Scenario exceeds numeric limits');
    return { price, pnl };
  });
}

export function formatScenario(results, currency) {
  return results.map(({ price, pnl }) => `${price}: ${pnl.toFixed(2)} ${currency}`).join('\n');
}

/* Builds a scenario from values a user typed. Every figure is required: no
 * LTP, multiplier, settlement or fee is inferred, and the result is never
 * described as a maximum loss or an expected return. */
export function manualScenario(raw) {
  const fail = (message) => {
    throw new Error(message);
  };
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const number = (value) => (value === '' || value === null || value === undefined ? NaN : Number(value));

  const underlying = text(raw.underlying);
  const expiry = text(raw.expiry);
  const currency = (text(raw.currency) || 'INR').toUpperCase();
  if (!underlying) fail('Enter the underlying this hypothetical scenario settles on.');
  if (!expiry) fail('Enter the expiry this hypothetical scenario settles at.');

  const multiplier = number(raw.multiplier);
  if (!positive(multiplier)) fail('Enter the contract multiplier/unit as a positive number.');

  const fees = raw.fees === '' || raw.fees === null || raw.fees === undefined ? 0 : number(raw.fees);
  if (!Number.isFinite(fees) || fees < 0) fail('Fees must be zero or a positive number.');

  const priceList = Array.isArray(raw.prices) ? raw.prices : String(raw.prices ?? '').split(/[,;\s]+/);
  const prices = priceList.map((p) => number(String(p).trim())).filter((p) => Number.isFinite(p) && p >= 0);
  if (!prices.length) fail('Enter at least one settlement price.');
  if (prices.length > SCENARIO_LIMITS.maxPrices) fail(`Enter at most ${SCENARIO_LIMITS.maxPrices} settlement prices.`);

  const rows = (raw.legs || []).filter((row) => row && (text(row.premium) !== '' || text(row.strike) !== ''));
  if (!rows.length) fail('Enter at least one leg premium.');
  if (rows.length > SCENARIO_LIMITS.maxLegs) fail(`Enter at most ${SCENARIO_LIMITS.maxLegs} legs.`);

  const legs = rows.map((row, index) => {
    const n = index + 1;
    const kind = String(row.kind || '').toUpperCase();
    if (!['CALL', 'PUT', 'LINEAR'].includes(kind)) fail(`Leg ${n}: choose call, put or linear.`);
    const sideText = String(row.side || '').toUpperCase();
    if (!['BUY', 'SELL'].includes(sideText)) fail(`Leg ${n}: choose buy or sell.`);
    const lots = number(row.lots);
    if (!Number.isSafeInteger(lots) || lots < 1) fail(`Leg ${n}: lots must be a whole number of at least 1.`);
    const entry = number(row.premium);
    if (!positive(entry)) fail(`Leg ${n}: enter the price you supplied for this leg.`);
    const leg = {
      underlying,
      expiry,
      currency,
      settlement: currency,
      kind,
      side: sideText === 'SELL' ? -1 : 1,
      lots,
      multiplier,
      entry,
    };
    if (kind !== 'LINEAR') {
      const strike = number(row.strike);
      if (!positive(strike)) fail(`Leg ${n}: enter a positive strike for a ${kind.toLowerCase()}.`);
      leg.strike = strike;
    }
    return leg;
  });

  return {
    underlying,
    expiry,
    currency,
    settlement: currency,
    legs,
    prices,
    fees,
    source: MANUAL_SOURCE,
    quoteAt: null,
  };
}

let panelSeq = 0;

function fieldBlock(doc, id, text) {
  const wrap = doc.createElement('div');
  wrap.className = 'hedge-scenario__field';
  const label = doc.createElement('label');
  label.textContent = text;
  label.setAttribute('for', id);
  const input = doc.createElement('input');
  input.id = id;
  input.setAttribute('autocomplete', 'off');
  wrap.append(label, input);
  return { wrap, input };
}

function selectBlock(doc, id, text, choices) {
  const wrap = doc.createElement('div');
  wrap.className = 'hedge-scenario__field';
  const label = doc.createElement('label');
  label.textContent = text;
  label.setAttribute('for', id);
  const select = doc.createElement('select');
  select.id = id;
  for (const [value, labelText] of choices) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = labelText;
    select.append(option);
  }
  wrap.append(label, select);
  return { wrap, select };
}

export function mountHedgeScenario(host, readScenario, doc = globalThis.document, options = {}) {
  const ns = 'hs' + ++panelSeq;
  const create = (tag) => doc.createElement(tag);
  const button = create('button');
  button.type = 'button';
  button.textContent = 'Preview hedge scenarios';
  const label = create('p');
  label.className = 'hedge-scenario__label';
  label.textContent = 'PLAN ONLY — expiry scenarios, not live orders or guaranteed loss limits.';
  const source = create('p');
  source.className = 'hedge-scenario__source';
  const output = create('pre');
  output.className = 'hedge-scenario__output';
  output.setAttribute('aria-live', 'polite');

  /* Settlement prices are operator inputs, never derived from the chain. Only
   * the NSE adapter reads this field; the other segments must not show a
   * control their previews ignore. */
  let marketPricesRow = null;
  let marketPricesNote = null;
  if (options.marketPrices !== false) {
    marketPricesRow = create('div');
    marketPricesRow.className = 'hedge-scenario__fields';
    const marketPricesBlock = fieldBlock(doc, `${ns}-market-prices`, 'Settlement prices for this preview (you supply)');
    const marketPricesInput = marketPricesBlock.input;
    marketPricesInput.setAttribute('data-hedge-market-prices', '');
    marketPricesInput.setAttribute('placeholder', 'e.g. 24000, 24500, 25000');
    marketPricesRow.append(marketPricesBlock.wrap);
    marketPricesNote = create('p');
    marketPricesNote.className = 'hedge-scenario__label hedge-scenario__caption';
    marketPricesNote.textContent =
      'Expiry prices are your inputs, not quotes: nothing is generated or estimated. The market preview stays blocked until you enter at least one.';
  }

  /* A click, or a change of instrument, starts a new run. A slow earlier
   * request can never repaint its result over the newer selection. */
  let run = 0;
  let manualLabel = null;
  let manualSource = null;
  let manualOutput = null;
  const invalidate = () => {
    run += 1;
    output.textContent = '';
    source.textContent = '';
    if (manualLabel) manualLabel.textContent = '';
    if (manualSource) manualSource.textContent = '';
    if (manualOutput) manualOutput.textContent = '';
  };
  if (typeof doc.querySelector === 'function') {
    for (const selector of options.clearOn || []) {
      const watched = doc.querySelector(selector);
      if (watched && typeof watched.addEventListener === 'function') watched.addEventListener('change', invalidate);
    }
  }

  button.addEventListener('click', async () => {
    const ticket = ++run;
    button.disabled = true;
    output.textContent = 'Loading…';
    source.textContent = '';
    try {
      const input = await readScenario();
      if (ticket !== run) return;
      let results;
      if (input.quoteAt && typeof input.quoteAt === 'number') {
        const age = Date.now() - input.quoteAt;
        const QUOTE_MAX_AGE_MS = 5 * 60 * 1000;
        if (age > QUOTE_MAX_AGE_MS) {
          output.textContent = 'Stale reading · refresh to update';
          source.textContent = 'Quote is older than 5 minutes; data may be stale.';
        } else {
          results = expiryScenario(input);
          output.textContent = formatScenario(results, input.currency);
          if (input.source) {
            source.textContent =
              'Source: ' + input.source + (input.quoteAt ? ' · quote ' + input.quoteAt : ' · quote timestamp unavailable');
          }
        }
      } else {
        results = expiryScenario(input);
        output.textContent = formatScenario(results, input.currency);
        if (input.source) {
          source.textContent =
            'Source: ' + input.source + (input.quoteAt ? ' · quote ' + input.quoteAt : ' · quote timestamp unavailable');
        }
      }
    } catch (err) {
      if (ticket !== run) return;
      output.textContent = 'Scenario unavailable: check contract, quote and cost data.';
      if (err && err.code) source.textContent = err.code + ' — ' + err.message;
      else if (err && err.message) source.textContent = err.message;
    } finally {
      // The run may have been retired by an instrument change; the control
      // still becomes usable again, but the stale result is never painted.
      button.disabled = false;
    }
  });

  /* ------------------------------------------------------------- manual --- */
  const manual = create('details');
  manual.className = 'hedge-scenario__manual';
  const summary = create('summary');
  summary.textContent = 'Manual scenario — hypothetical inputs';
  manual.append(summary);

  const note = create('p');
  note.className = 'hedge-scenario__label';
  note.textContent =
    'TYPE EVERY FIGURE. This mode assumes nothing: no last traded price, multiplier, settlement or fee is filled in for you, and none of it is a live quote.';
  manual.append(note);

  const fields = create('div');
  fields.className = 'hedge-scenario__fields';

  const underlyingBlock = fieldBlock(doc, `${ns}-underlying`, 'Underlying (as you type it)');
  const underlyingInput = underlyingBlock.input;
  underlyingInput.setAttribute('placeholder', 'e.g. NIFTY');
  const expiryBlock = fieldBlock(doc, `${ns}-expiry`, 'Expiry (as you type it)');
  const expiryInput = expiryBlock.input;
  expiryInput.setAttribute('placeholder', 'e.g. 25-DEC-2026');
  const currencyBlock = fieldBlock(doc, `${ns}-currency`, 'Currency / settlement');
  const currencyInput = currencyBlock.input;
  currencyInput.value = 'INR';
  const multiplierBlock = fieldBlock(doc, `${ns}-multiplier`, 'Contract multiplier / unit');
  const multiplierInput = multiplierBlock.input;
  multiplierInput.type = 'number';
  multiplierInput.min = '0';
  multiplierInput.step = 'any';
  const pricesBlock = fieldBlock(doc, `${ns}-prices`, 'Settlement prices (comma separated)');
  const pricesInput = pricesBlock.input;
  pricesInput.setAttribute('placeholder', 'e.g. 24000, 24500, 25000');
  const feesBlock = fieldBlock(doc, `${ns}-fees`, 'Fees you supply');
  const feesInput = feesBlock.input;
  feesInput.type = 'number';
  feesInput.min = '0';
  feesInput.step = 'any';
  feesInput.value = '0';
  for (const block of [underlyingBlock, expiryBlock, currencyBlock, multiplierBlock, pricesBlock, feesBlock]) {
    fields.append(block.wrap);
  }
  manual.append(fields);

  const legRows = [1, 2].map((index) => {
    const row = create('div');
    row.className = 'hedge-scenario__leg';
    const heading = create('p');
    heading.className = 'hedge-scenario__label';
    heading.textContent = 'Leg ' + index;
    const sideBlock = selectBlock(doc, `${ns}-side-${index}`, 'Side', [['BUY', 'Buy'], ['SELL', 'Sell']]);
    const kindBlock = selectBlock(doc, `${ns}-kind-${index}`, 'Instrument', [
      ['CALL', 'Call'],
      ['PUT', 'Put'],
      ['LINEAR', 'Linear / futures'],
    ]);
    const strikeBlock = fieldBlock(doc, `${ns}-strike-${index}`, 'Strike (options)');
    const premiumBlock = fieldBlock(doc, `${ns}-premium-${index}`, 'Premium / price you supply');
    const lotsBlock = fieldBlock(doc, `${ns}-lots-${index}`, 'Lots');
    const strike = strikeBlock.input;
    strike.type = 'number';
    strike.min = '0';
    strike.step = 'any';
    const premium = premiumBlock.input;
    premium.type = 'number';
    premium.min = '0';
    premium.step = 'any';
    const lots = lotsBlock.input;
    lots.type = 'number';
    lots.min = '1';
    lots.step = '1';
    lots.value = '1';
    row.append(heading, sideBlock.wrap, kindBlock.wrap, strikeBlock.wrap, premiumBlock.wrap, lotsBlock.wrap);
    const side = sideBlock.select;
    const kind = kindBlock.select;
    manual.append(row);
    return { side, kind, strike, premium, lots };
  });

  const manualButton = create('button');
  manualButton.type = 'button';
  manualButton.textContent = 'Preview manual scenario';
  manualLabel = create('p');
  manualLabel.className = 'hedge-scenario__label hedge-scenario__caption';
  manualSource = create('p');
  manualSource.className = 'hedge-scenario__source';
  manualOutput = create('pre');
  manualOutput.className = 'hedge-scenario__output';
  manualOutput.setAttribute('aria-live', 'polite');
  manual.append(manualButton, manualLabel, manualSource, manualOutput);

  manualButton.addEventListener('click', () => {
    run += 1; // a manual result also retires any in-flight market preview
    try {
      const input = manualScenario({
        underlying: underlyingInput.value,
        expiry: expiryInput.value,
        currency: currencyInput.value,
        multiplier: multiplierInput.value,
        prices: pricesInput.value,
        fees: feesInput.value,
        legs: legRows.map((row) => ({
          side: row.side.value,
          kind: row.kind.value,
          strike: row.strike.value,
          premium: row.premium.value,
          lots: row.lots.value,
        })),
      });
      const results = expiryScenario(input);
      manualLabel.textContent = MANUAL_CAPTION;
      manualOutput.textContent = formatScenario(results, input.currency);
      manualSource.textContent = 'Manual scenario — hypothetical inputs typed above. No live quote, last traded price or source timestamp is used.';
    } catch (err) {
      manualLabel.textContent = '';
      manualOutput.textContent = 'Manual scenario unavailable: ' + (err && err.message ? err.message : 'complete every input.');
      manualSource.textContent = 'Nothing was inferred. Enter every premium, strike, multiplier, settlement price and fee yourself.';
    }
  });

  host.append(...(marketPricesRow ? [marketPricesRow, marketPricesNote] : []), button, label, source, output, manual);
  return { button, label, source, output, manual, manualButton, manualLabel, manualSource, manualOutput, legRows };
}
