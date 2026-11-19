/* Shared hedge-plan component (PLAN ONLY).
 *
 * One mount point per portal segment:
 *   <div data-hedge-plan data-segment="NSE" data-symbol="NIFTY"></div>
 * It renders the "Generate Hedge Plan" control, the "Hedge Plan" panel with the
 * "PLAN ONLY — ORDER DISPATCH DISABLED" badge, and "Save to Journal". Nothing
 * here can place an order: it only POSTs to /api/hedge-plan and renders the
 * template the server returns.
 */
(function () {
  'use strict';

  var TIMEFRAMES = ['5m', '15m', '1h', '4h', '1D', '1W', '1M'];
  var DEFAULT_SYMBOL = { NSE: 'NIFTY', MCX: 'CRUDEOIL', DELTA: 'BTC', QUANT: 'NIFTY', JOURNAL: 'NIFTY' };
  var JOURNAL_TIMEFRAME = { '5m': 'Intraday', '15m': 'Intraday', '1h': 'Intraday', '4h': 'Intraday', '1D': 'Swing 1–3 weeks', '1W': 'Position', '1M': 'Position' };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function money(v) {
    if (v === null || v === undefined || v === '') return '—';
    var n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function points(v) {
    if (v === null || v === undefined || v === '') return '—';
    var n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';
  }

  function field(label, node) {
    var wrap = el('div', 'hedge-plan__field');
    var isControl = node && node.tagName && /^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName);
    // A real <label for> gives every generated control an accessible name.
    var lab = el(isControl ? 'label' : 'span', 'hedge-plan__label', label);
    if (isControl && node.id) lab.htmlFor = node.id;
    wrap.appendChild(lab);
    var value = el('strong', 'hedge-plan__value');
    if (node instanceof Node) value.appendChild(node);
    else value.textContent = node;
    wrap.appendChild(value);
    return wrap;
  }

  function mount(root) {
    var segment = (root.getAttribute('data-segment') || 'NSE').toUpperCase();
    var sourceSelector = root.getAttribute('data-symbol-source');
    var last = null;
    var requestToken = 0;

    var head = el('div', 'hedge-plan__head');
    head.appendChild(el('p', 'eyebrow', 'HEDGE PLAN · MULTI-TIMEFRAME'));
    var title = el('h2', null, 'Hedge Plan');
    head.appendChild(title);
    head.appendChild(el('span', 'hedge-plan__badge', 'PLAN ONLY — ORDER DISPATCH DISABLED'));
    head.appendChild(el('p', 'hedge-plan__note', 'Builds a hedged structure template for the timeframe you pick. It never sends an order, never calls a broker and never changes an account.'));

    var controls = el('div', 'hedge-plan__controls');
    var symbolInput = el('input');
    symbolInput.type = 'text';
    symbolInput.id = 'hedgeSymbol-' + segment.toLowerCase();
    symbolInput.value = root.getAttribute('data-symbol') || DEFAULT_SYMBOL[segment] || 'NIFTY';
    symbolInput.setAttribute('autocomplete', 'off');

    var timeframeSelect = el('select');
    timeframeSelect.id = 'hedgeTimeframe-' + segment.toLowerCase();
    TIMEFRAMES.forEach(function (tf) {
      var opt = el('option', null, tf);
      opt.value = tf;
      if (tf === (root.getAttribute('data-timeframe') || '1D')) opt.selected = true;
      timeframeSelect.appendChild(opt);
    });

    var directionSelect = el('select');
    directionSelect.id = 'hedgeDirection-' + segment.toLowerCase();
    [['BULLISH', 'Bullish / long exposure'], ['BEARISH', 'Bearish / short exposure']].forEach(function (pair) {
      var opt = el('option', null, pair[1]);
      opt.value = pair[0];
      directionSelect.appendChild(opt);
    });

    var spotInput = el('input');
    spotInput.type = 'number';
    spotInput.min = '0';
    spotInput.step = 'any';
    spotInput.id = 'hedgeSpot-' + segment.toLowerCase();
    spotInput.placeholder = 'e.g. 24500';
    spotInput.setAttribute('inputmode', 'decimal');

    var premiumInput = el('input');
    premiumInput.type = 'number';
    premiumInput.step = 'any';
    premiumInput.id = 'hedgePremium-' + segment.toLowerCase();
    premiumInput.placeholder = 'optional, points';

    var expiryInput = el('input');
    expiryInput.type = 'date';
    expiryInput.id = 'hedgeExpiry-' + segment.toLowerCase();

    var lotsInput = el('input');
    lotsInput.type = 'number';
    lotsInput.min = '1';
    lotsInput.step = '1';
    lotsInput.value = '1';
    lotsInput.id = 'hedgeLots-' + segment.toLowerCase();

    controls.appendChild(field('Underlying', symbolInput));
    controls.appendChild(field('Timeframe', timeframeSelect));
    controls.appendChild(field('Exposure', directionSelect));
    controls.appendChild(field('Spot / price', spotInput));
    controls.appendChild(field('Net premium (optional)', premiumInput));
    controls.appendChild(field('Expiry (optional)', expiryInput));
    controls.appendChild(field('Lots', lotsInput));

    var actions = el('div', 'hedge-plan__actions');
    var generate = el('button', 'primary', 'Generate Hedge Plan');
    generate.type = 'button';
    actions.appendChild(generate);
    var saveButton = el('button', 'ghost', 'Save to Journal');
    saveButton.type = 'button';
    saveButton.disabled = true;
    actions.appendChild(saveButton);

    var status = el('p', 'hedge-plan__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    var panel = el('div', 'hedge-plan__panel');
    panel.hidden = true;

    root.appendChild(head);
    root.appendChild(controls);
    root.appendChild(actions);
    root.appendChild(status);
    root.appendChild(panel);

    function readSymbol() {
      if (sourceSelector) {
        var source = document.querySelector(sourceSelector);
        if (source && source.value) return source.value.trim().toUpperCase();
      }
      return symbolInput.value.trim().toUpperCase();
    }

    function render(plan, segmentName) {
      panel.textContent = '';
      var top = el('div', 'hedge-plan__panel-head');
      top.appendChild(el('h3', null, plan.hedgeLabel));
      top.appendChild(el('span', 'hedge-plan__tier', plan.tier + ' · ' + segmentName));
      panel.appendChild(top);

      var spotPriced = plan.priceBasis === 'SPOT';
      var level = function (v) {
        var text = points(v);
        return spotPriced || text === '—' ? text : text + ' pts';
      };
      var grid = el('div', 'hedge-plan__grid');
      grid.appendChild(field('Entry', level(plan.entry)));
      grid.appendChild(field('Stop', level(plan.stopLoss)));
      grid.appendChild(field('Hedge strike', plan.hedgeStrike === null ? '—' : plan.hedgeStrike));
      grid.appendChild(field('Max loss', money(plan.maxLossInr)));
      grid.appendChild(field('Target 1', points(plan.target1)));
      grid.appendChild(field('Target 2', points(plan.target2)));
      grid.appendChild(field('Reward : risk', plan.rewardToRisk === null ? '—' : plan.rewardToRisk + ' : 1'));
      grid.appendChild(field('Statutory cost', money(plan.statutoryCostInr)));
      grid.appendChild(field('Post-cost expectancy', money(plan.postCostExpectancyInr)));
      grid.appendChild(field('Expiry', plan.expiry ? plan.expiry + (plan.expiryVerified ? '' : ' (unverified)') : 'data unavailable'));
      grid.appendChild(field('Days to expiry', plan.daysToExpiry === null ? '—' : plan.daysToExpiry));
      grid.appendChild(field('Lot size · step', plan.lotSize ? plan.lotSize + ' · ' + plan.strikeStep : '—'));
      panel.appendChild(grid);

      panel.appendChild(el('p', 'hedge-plan__rule', plan.mandatoryRule));

      var gate = el('p', 'hedge-plan__gate');
      if (!plan.expectancyGate.computed) gate.textContent = 'Expectancy gate: not computed — ' + (plan.expectancy.note || 'inputs missing.');
      else gate.textContent = (plan.expectancyGate.pass ? 'Expectancy gate PASSED' : 'Expectancy gate FAILED') + ' — ' + plan.expectancyGate.gate + '. ' + plan.expectancyGate.note;
      panel.appendChild(gate);

      var basket = plan.basket;
      panel.appendChild(el('h4', null, basket.label));
      var table = el('table', 'hedge-plan__legs');
      var thead = el('thead');
      var hrow = el('tr');
      ['Action', 'Instrument', 'Symbol', 'Expiry', 'Strike', 'Type', 'Qty', 'Price'].forEach(function (h) {
        hrow.appendChild(el('th', null, h));
      });
      thead.appendChild(hrow);
      table.appendChild(thead);
      var tbody = el('tbody');
      basket.legs.forEach(function (leg) {
        var tr = el('tr');
        [leg.action, leg.instrument, leg.symbol, leg.expiry || '—', leg.strike === null ? '—' : leg.strike, leg.optionType || '—', leg.quantity, leg.price === null ? 'unavailable' : leg.price].forEach(function (v) {
          tr.appendChild(el('td', null, v));
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      panel.appendChild(table);
      panel.appendChild(el('p', 'hedge-plan__note', basket.executionMode + ' / ' + basket.orderPlacement + '. ' + basket.instructions));

      if (plan.unavailable && plan.unavailable.length) {
        var list = el('ul', 'hedge-plan__unavailable');
        plan.unavailable.forEach(function (item) {
          list.appendChild(el('li', null, 'Data unavailable: ' + item));
        });
        panel.appendChild(list);
      }
      if (plan.taxGuardrail) panel.appendChild(el('p', 'hedge-plan__tax', plan.taxGuardrail));
      if (plan.costs && plan.costs.note) panel.appendChild(el('p', 'hedge-plan__note', plan.costs.note));
      panel.hidden = false;
    }

    function save(saved) {
      var plan = saved.plan;
      var request = saved.request;
      var summary = 'Hedge plan (PLAN ONLY, order placement disabled) — ' + plan.hedgeLabel + ' · ' + plan.mandatoryRule + ' · Plan JSON: ' + JSON.stringify(plan.basket);
      var row = {
        ticker: request.symbol,
        name: plan.hedgeLabel,
        rating: 'UNDER REVIEW',
        status: 'MONITORING',
        time_frame: JOURNAL_TIMEFRAME[request.timeframe] || 'Swing 1–3 weeks',
        entry: plan.entry,
        target: plan.target1,
        stop: plan.stopLoss,
        risk_reward: plan.rewardToRisk,
        summary: summary.slice(0, 4000),
        source_url: null,
      };
      var auth = window.LfcAuth;
      if (auth && auth.client) {
        auth.ready.then(function (me) {
          if (!me || !me.is_admin) {
            stashLocally(row);
            return;
          }
          auth.client.from('ideas').insert(row).then(function (res) {
            if (res.error) {
              status.textContent = 'Journal save failed (' + res.error.message + '). Saved in this browser instead.';
              stashLocally(row);
              return;
            }
            status.textContent = 'Saved to your research journal. The plan summary is in the idea summary field.';
          });
        });
        return;
      }
      stashLocally(row);
    }

    function stashLocally(row) {
      try {
        var key = 'lfc.hedgePlans.v1';
        var list = JSON.parse(localStorage.getItem(key) || '[]');
        list.unshift({ savedAt: new Date().toISOString(), row: row });
        localStorage.setItem(key, JSON.stringify(list.slice(0, 50)));
        status.textContent = 'Saved in this browser only — the research journal needs an admin portal session to accept a new idea.';
      } catch (err) {
        status.textContent = 'Could not save the plan in this browser (storage unavailable).';
      }
    }

    generate.addEventListener('click', function () {
      var spot = Number(spotInput.value);
      if (!Number.isFinite(spot) || spot <= 0) {
        status.textContent = 'Enter the current spot or price before generating a plan.';
        return;
      }
      var body = {
        segment: segment,
        symbol: readSymbol(),
        timeframe: timeframeSelect.value,
        direction: directionSelect.value,
        spot: spot,
        lots: Number(lotsInput.value) || 1,
      };
      if (premiumInput.value !== '') body.premium = Number(premiumInput.value);
      if (expiryInput.value) body.expiry = expiryInput.value;

      generate.disabled = true;
      status.textContent = 'Building plan…';
      var token = ++requestToken;
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 10000);
      fetch('/api/hedge-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { res: res, data: data };
          });
        })
        .then(function (out) {
          if (token !== requestToken) return;
          if (!out.res.ok || !out.data.ok) {
            var message = out.data && out.data.message ? out.data.message : 'the plan was rejected';
            status.textContent = 'Cannot build this plan: ' + message;
            return;
          }
          last = { plan: out.data.plan, request: body };
          // Published for the expiry-scenario adapter: it previews this plan's legs.
          window.LfcHedgePlanState = { plan: out.data.plan, request: body, at: Date.now() };
          saveButton.disabled = false;
          status.textContent =
            out.data.executionMode + ' · ' + out.data.orderPlacement + '. Nothing was sent to a broker.';
          render(out.data.plan, out.data.segment);
        })
        .catch(function (err) {
          if (token !== requestToken) return;
          status.textContent =
            err && err.name === 'AbortError'
              ? 'Hedge plan request timed out after 10 seconds. No order was attempted.'
              : 'Hedge plan service is unreachable. No order was attempted.';
        })
        .then(function () {
          clearTimeout(timer);
          generate.disabled = false;
        });
    });

    saveButton.addEventListener('click', function () {
      if (last) save(last);
    });
  }

  function boot() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-hedge-plan]'), mount);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
