/*!
 * FundClear India - compare schemes
 * Pick up to four schemes by AMFI code (?codes=a,b,c,d) and put them side by side.
 * When two of them are the same fund's two plans, that is called out explicitly,
 * because it is the comparison that actually changes what someone pays.
 */
(function (global) {
  'use strict';

  var FC = global.FC, ui = FC.ui, el = ui.el, funds = FC.funds, calc = FC.calc;

  var MAX = 4;
  var DEMO = { monthly: 5000, years: 10, grossPct: 11 };

  var state = { codes: [] };

  function readUrl() {
    var codes = ui.queryList('codes').filter(function (code) { return !!funds.byCode(code); });
    state.codes = codes.slice(0, MAX);
  }

  function writeUrl() {
    ui.setQuery({ codes: state.codes.length ? state.codes.join(',') : '' }, false);
  }

  function selected() {
    return state.codes.map(funds.byCode).filter(Boolean);
  }

  /* ---------------- picker ---------------- */

  function buildPicker() {
    var chips = document.getElementById('picked');
    var search = document.getElementById('pick-search');
    var options = document.getElementById('pick-options');

    function paintChips() {
      ui.clear(chips);
      if (!state.codes.length) {
        chips.appendChild(el('p', { class: 'card-note', text: 'Nothing selected yet. Search above, or start from a suggested pair.' }));
        return;
      }
      selected().forEach(function (scheme) {
        chips.appendChild(el('span', { class: 'chip', 'aria-pressed': 'true' }, [
          scheme.name + ' · ' + scheme.plan,
          el('button', {
            class: 'btn btn-sm', type: 'button', text: '✕',
            'aria-label': 'Remove ' + scheme.name,
            onclick: function () { remove(scheme.code); }
          })
        ]));
      });
    }

    function renderOptions() {
      var query = search.value.trim();
      ui.clear(options);
      if (!query) {
        options.hidden = true;
        return;
      }
      var matches = funds.query({ q: query }).slice(0, 8);
      options.hidden = false;
      if (!matches.length) {
        options.appendChild(el('li', { class: 'card-note', text: 'No scheme matches “' + query + '”.' }));
        return;
      }
      matches.forEach(function (scheme) {
        var already = state.codes.indexOf(scheme.code) !== -1;
        var full = state.codes.length >= MAX && !already;
        options.appendChild(el('li', null, [
          el('button', {
            class: 'btn btn-sm', type: 'button', disabled: full,
            text: scheme.name + ' · ' + scheme.plan + ' · AMFI ' + scheme.code,
            onclick: function () { add(scheme.code); }
          })
        ]));
      });
    }

    function add(code) {
      if (state.codes.indexOf(code) !== -1 || state.codes.length >= MAX) return;
      state.codes.push(code);
      search.value = '';
      writeUrl(); paintChips(); renderOptions(); render();
    }

    function remove(code) {
      state.codes = state.codes.filter(function (c) { return c !== code; });
      writeUrl(); paintChips(); render();
    }

    search.addEventListener('input', ui.debounce(renderOptions, 120));
    search.addEventListener('focus', renderOptions);

    document.getElementById('clear-all').addEventListener('click', function () {
      state.codes = [];
      writeUrl(); paintChips(); render();
    });

    var presets = document.getElementById('presets');
    funds.showcaseFamilies(3).forEach(function (family) {
      presets.appendChild(el('button', {
        class: 'btn btn-sm', type: 'button', text: family.name,
        onclick: function () {
          state.codes = [family.plans.Direct.code, family.plans.Regular.code];
          writeUrl(); paintChips(); render();
        }
      }));
    });

    paintChips();
  }

  /* ---------------- comparison ---------------- */

  function render() {
    var schemes = selected();
    document.getElementById('compare-body').hidden = schemes.length === 0;
    document.getElementById('count').textContent = schemes.length + ' of ' + MAX + ' selected';

    if (!schemes.length) return;

    renderTable(schemes);
    renderPairNote(schemes);
  }

  function renderTable(schemes) {
    var host = document.getElementById('compare-table');
    ui.clear(host);

    var rows = [
      ['Scheme', function (s) { return s.name; }],
      ['Plan', function (s) { return s.plan + ' plan'; }],
      ['Latest NAV', function (s) { return ui.nav(s.nav); }, 'num'],
      ['NAV date', function (s) { return s.date; }],
      ['Category', function (s) { return s.category; }],
      ['Group', function (s) { return s.group; }],
      ['Fund house', function (s) { return s.amc; }],
      ['Option', function (s) { return s.option; }],
      ['AMFI code', function (s) { return s.code; }],
      ['ISIN', function (s) { return s.isin || '—'; }],
      ['Expense ratio (assumed)',
        function (s) {
          var ter = funds.terAssumption(s);
          var band = s.plan === 'Direct' ? ter.direct : ter.regular;
          return ui.pct(band[0]) + ' – ' + ui.pct(band[1]);
        }],
      // The value below is the modelled corpus this plan would have accumulated, not a
      // cost. Labelling it "cost" made the larger (better) number look like the pricier
      // one, which is the opposite of what the row is for.
      ['Modelled value: ₹5,000/month for 10 years at an assumed 11% gross return',
        function (s) {
          var ter = funds.terAssumption(s);
          var drag = calc.expenseDrag({
            monthly: DEMO.monthly, years: DEMO.years, grossPct: DEMO.grossPct,
            terDirect: ter.directMid, terRegular: ter.regularMid
          });
          return ui.inr(s.plan === 'Direct' ? drag.direct.value : drag.regular.value, 0);
        }, 'num']
    ];

    var table = el('table', { class: 'data' });
    table.appendChild(el('thead', null, [
      el('tr', null, [el('th', { text: 'Attribute' })].concat(schemes.map(function (s) {
        return el('th', null, [
          el('a', { href: 'scheme.html?code=' + s.code, text: s.name }),
          el('div', { class: 'badge ' + (s.plan === 'Direct' ? 'badge-direct' : 'badge-regular'), text: s.plan })
        ]);
      })))
    ]));

    var body = el('tbody');
    rows.forEach(function (row, index) {
      var cells = [el('th', { scope: 'row', text: row[0] })];
      schemes.forEach(function (scheme) {
        cells.push(el('td', { class: row[2] === 'num' || index === 2 ? 'num' : 'desc', text: row[1](scheme) }));
      });
      body.appendChild(el('tr', null, cells));
    });
    table.appendChild(body);
    host.appendChild(el('div', { class: 'table-scroll' }, [table]));
  }

  /** If the selection contains both plans of one fund, show what that gap is worth. */
  function renderPairNote(schemes) {
    var host = document.getElementById('pair-note');
    ui.clear(host);
    var pairs = [];
    schemes.forEach(function (scheme) {
      var sibling = funds.siblingPlan(scheme);
      if (!sibling) return;
      var match = schemes.filter(function (s) { return s.code === sibling.code; })[0];
      if (match && scheme.plan === 'Direct') pairs.push({ direct: scheme, regular: match });
    });

    if (!pairs.length) return;
    pairs.forEach(function (pair) {
      var ter = funds.terAssumption(pair.direct);
      var drag = calc.expenseDrag({
        monthly: DEMO.monthly, years: DEMO.years, grossPct: DEMO.grossPct,
        terDirect: ter.directMid, terRegular: ter.regularMid
      });
      host.appendChild(el('div', { class: 'note warn' }, [
        el('strong', { text: 'Both plans of ' + funds.familyName(pair.direct.name) + ' are selected. ' }),
        'The Regular plan NAV is ' + ui.nav(pair.regular.nav) + ' against ' + ui.nav(pair.direct.nav)
          + ' for Direct — a gap of ' + ui.pct(Math.abs(funds.planGap(pair.direct, pair.regular)))
          + '. On the modelled ' + ui.inr(DEMO.monthly, 0) + '/month over ' + DEMO.years + ' years, the assumed expense ratios '
          + '(' + ui.pct(ter.directMid) + ' vs ' + ui.pct(ter.regularMid) + ') account for ' + ui.inr(Math.abs(drag.extraCost), 0)
          + ' of difference. Assumption, not published data; the calculation is not a forecast.'
      ]));
    });
  }

  function boot() {
    readUrl();
    buildPicker();
    render();
    document.getElementById('share').addEventListener('click', function () {
      ui.copy(global.location.href, 'Comparison link copied');
    });
    global.addEventListener('popstate', function () { readUrl(); buildPicker(); render(); });
  }

  ui.ready(boot);
})(window);
