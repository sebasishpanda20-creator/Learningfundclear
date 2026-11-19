/* Shared FYERS quote card for the Indian-market tabs.
 *
 * The card is injected after the page heading so every Indian-market page gets
 * the same broker source, symbol mapping and failure states without importing
 * the terminal or duplicating fetch logic.
 */
(function () {
  'use strict';

  const PAGES = new Set(['dashboard', 'performance', 'nifty500', 'scanner', 'setups', 'gex']);
  const page = document.body && document.body.dataset.page;
  if (!PAGES.has(page)) return;
  const Q = window.LfcFyersQuote;
  const main = document.querySelector('main#main');
  if (!main || !Q) return;

  const DEFAULT_SYMBOLS = {
    dashboard: 'NIFTY',
    performance: 'NIFTY',
    nifty500: 'RELIANCE',
    scanner: 'NIFTY',
    setups: 'NIFTY',
    gex: 'NIFTY',
  };
  const source = page === 'gex' ? document.querySelector('#sym') : null;
  const initial = source && source.value ? source.value : DEFAULT_SYMBOLS[page];
  const heading = main.querySelector('h1');
  let block = heading ? heading.closest('.page-heading') : null;
  if (!block && heading) {
    const next = heading.nextElementSibling;
    block = next && next.classList.contains('sub') ? next : heading;
  }
  if (!block) return;

  const host = document.createElement('div');
  host.className = 'fyers-quote';
  block.after(host);

  const card = document.createElement('section');
  card.className = 'card fyers-quote-card';
  card.setAttribute('aria-label', 'FYERS broker quote');

  const head = document.createElement('div');
  head.className = 'fyers-quote-head';
  const titleWrap = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'BROKER QUOTE · FYERS';
  const title = document.createElement('h2');
  title.textContent = 'Broker quote';
  titleWrap.append(eyebrow, title);
  const state = document.createElement('span');
  state.className = 'fyers-quote-state';
  state.dataset.state = 'idle';
  state.textContent = 'CHECKING';
  head.append(titleWrap, state);

  const form = document.createElement('div');
  form.className = 'row fyers-quote-form';
  const field = document.createElement('div');
  const label = document.createElement('label');
  label.htmlFor = 'fyersQuoteSymbol';
  label.textContent = 'Symbol';
  const input = document.createElement('input');
  input.id = 'fyersQuoteSymbol';
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = initial;
  input.setAttribute('aria-label', 'FYERS symbol');
  field.append(label, input);
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Get broker quote';
  form.append(field, button);

  const message = document.createElement('p');
  message.className = 'fyers-quote-message';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  message.textContent = 'Connecting to the FYERS quote route…';

  const stats = document.createElement('div');
  stats.className = 'fyers-quote-stats';
  const values = {};
  for (const [key, caption] of [
    ['ltp', 'Last price'],
    ['change', 'Change'],
    ['asOf', 'Exchange time'],
    ['age', 'Freshness'],
  ]) {
    const item = document.createElement('div');
    const span = document.createElement('span');
    span.textContent = caption;
    const strong = document.createElement('strong');
    strong.textContent = '—';
    item.append(span, strong);
    stats.append(item);
    values[key] = strong;
  }

  const note = document.createElement('p');
  note.className = 'mut';
  note.textContent =
    'Source: FYERS v3 quotes through the signed-in broker session. A quote is market context, not a signal, and stale or timestamp-less values are never treated as live.';

  card.append(head, form, message, stats, note);
  host.append(card);

  let generation = 0;
  let controller = null;

  const money = (value) => Number.isFinite(value)
    ? '₹' + value.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
    : '—';
  const stamp = (value) => Number.isFinite(value)
    ? new Date(value).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'medium',
      }) + ' IST'
    : '—';
  const age = (value) => {
    if (!Number.isFinite(value)) return '—';
    const seconds = Math.max(0, Math.round(value / 1000));
    return seconds < 90 ? seconds + 's old' : Math.floor(seconds / 60) + 'm old';
  };

  function setUnavailable(code, text) {
    state.dataset.state = 'unavailable';
    state.textContent = 'UNAVAILABLE';
    for (const value of Object.values(values)) value.textContent = '—';
    message.replaceChildren(document.createTextNode(text));
    if (code === 'NOT_CONNECTED' || code === 'OWNER_ONLY') {
      const link = document.createElement('a');
      link.href = 'quant-desk.html';
      link.textContent = 'Open Quant desk to connect FYERS';
      message.append(document.createTextNode(' '), link);
    }
  }

  function render(result) {
    card.dataset.state = result.status;
    state.dataset.state = result.status;
    if (result.status === 'unavailable') {
      setUnavailable(result.code, result.message + ' No substitute price is shown.');
      return;
    }
    state.textContent = result.status === 'fresh'
      ? 'FRESH'
      : result.status === 'stale'
        ? 'STALE'
        : 'TIMESTAMP UNVERIFIED';
    values.ltp.textContent = money(result.ltp);
    if (Number.isFinite(result.change) && Number.isFinite(result.changePct)) {
      values.change.textContent =
        (result.change >= 0 ? '+' : '') + result.change.toFixed(2) +
        ' (' + (result.changePct >= 0 ? '+' : '') + result.changePct.toFixed(2) + '%)';
    } else {
      values.change.textContent = '—';
    }
    values.asOf.textContent = stamp(result.asOf);
    values.age.textContent = age(result.ageMs);
    message.textContent = result.status === 'fresh'
      ? 'Fresh broker quote for ' + (result.symbol || input.value) + '.'
      : result.message + ' The price is shown but is not counted as a fresh quote.';
  }

  async function load({ quiet = false } = {}) {
    const id = ++generation;
    if (controller) controller.abort();
    controller = new AbortController();
    const active = controller;
    const timer = window.setTimeout(() => active.abort(), 12000);
    if (!quiet) {
      button.disabled = true;
      message.textContent = 'Requesting FYERS quote…';
    }
    try {
      const result = await Q.fetchQuote(input.value, {
        signal: active.signal,
        now: Date.now(),
      });
      if (id !== generation) return;
      render(result);
    } catch (error) {
      if (id === generation) {
        render({
          status: 'unavailable',
          code: 'CLIENT_ERROR',
          message: error && error.name === 'AbortError'
            ? 'The broker quote timed out. No substitute price is shown.'
            : 'The broker quote client could not complete the request.',
        });
      }
    } finally {
      window.clearTimeout(timer);
      if (id === generation) button.disabled = false;
    }
  }

  button.addEventListener('click', () => load());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      load();
    }
  });
  if (source) {
    source.addEventListener('change', () => {
      input.value = source.value;
      load();
    });
  }
  const timer = window.setInterval(() => {
    if (!document.hidden) load({ quiet: true });
  }, 60000);
  window.addEventListener('pagehide', () => {
    generation += 1;
    if (controller) controller.abort();
    window.clearInterval(timer);
  });

  load();
})();
