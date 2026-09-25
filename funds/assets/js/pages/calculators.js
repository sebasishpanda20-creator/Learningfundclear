/*!
 * LearningFundClear - calculators
 * Three arithmetic tools, all driven by FC.calc. Nothing here predicts a return:
 * the expected-return box is yours to set, and the output is labelled as arithmetic.
 */
(function (global) {
  'use strict';

  var FC = global.FC, ui = FC.ui, el = ui.el, funds = FC.funds, calc = FC.calc;

  var DEFAULTS = {
    sipMonthly: 5000, sipYears: 10, sipRate: 11, sipStepUp: 0,
    lumAmount: 100000, lumYears: 10, lumRate: 11,
    dragMonthly: 5000, dragYears: 20, dragGross: 11, dragTerDirect: 0.85, dragTerRegular: 2.0
  };

  function readUrlTo(fields) {
    fields.forEach(function (field) {
      var input = document.getElementById(field.id);
      if (!input) return;
      var value = parseFloat(ui.params().get(field.param));
      input.value = isFinite(value) ? value : DEFAULTS[field.key];
      field.applied = parseFloat(input.value);
    });
  }

  var FIELDS = [
    { id: 'sip-monthly', param: 'sm', key: 'sipMonthly' },
    { id: 'sip-years', param: 'sy', key: 'sipYears' },
    { id: 'sip-rate', param: 'sr', key: 'sipRate' },
    { id: 'sip-stepup', param: 'ss', key: 'sipStepUp' },
    { id: 'lum-amount', param: 'la', key: 'lumAmount' },
    { id: 'lum-years', param: 'ly', key: 'lumYears' },
    { id: 'lum-rate', param: 'lr', key: 'lumRate' },
    { id: 'drag-monthly', param: 'dm', key: 'dragMonthly' },
    { id: 'drag-years', param: 'dy', key: 'dragYears' },
    { id: 'drag-gross', param: 'dg', key: 'dragGross' },
    { id: 'drag-ter-direct', param: 'dtd', key: 'dragTerDirect' },
    { id: 'drag-ter-regular', param: 'dtr', key: 'dragTerRegular' }
  ];

  function value(id) {
    var input = document.getElementById(id);
    return input ? (parseFloat(input.value) || 0) : 0;
  }

  function writeUrl() {
    var pairs = {};
    FIELDS.forEach(function (field) { pairs[field.param] = value(field.id); });
    ui.setQuery(pairs, false);
  }

  /* ---------------- SIP ---------------- */

  function renderSip() {
    var result = calc.sip({
      monthly: value('sip-monthly'), years: value('sip-years'),
      ratePct: value('sip-rate'), stepUpPct: value('sip-stepup')
    });
    var host = document.getElementById('sip-out');
    ui.clear(host);
    host.appendChild(el('div', { class: 'result-split' }, [
      statBox('You invest', ui.inr(result.invested, 0), ui.trim(result.months, 0) + ' monthly instalments'),
      statBox('Illustrative value', ui.inr(result.value, 0), 'at the return you entered'),
      statBox('Difference', ui.inr(result.gain, 0), 'arithmetic, not a promise')
    ]));
    host.appendChild(el('p', { class: 'card-note', style: { marginTop: '10px' } }, [
      'Based on an assumed return of ' + ui.pct(value('sip-rate'), 1) + ' a year, which you typed — LearningFundClear has no view on what any fund will return.'
    ]));
  }

  /* ---------------- lumpsum ---------------- */

  function renderLumpsum() {
    var result = calc.lumpsum({
      amount: value('lum-amount'), years: value('lum-years'), ratePct: value('lum-rate')
    });
    var host = document.getElementById('lum-out');
    ui.clear(host);
    host.appendChild(el('div', { class: 'result-split' }, [
      statBox('You invest', ui.inr(result.invested, 0), 'one-time amount'),
      statBox('Illustrative value', ui.inr(result.value, 0), 'after ' + ui.trim(result.years, 0) + ' years'),
      statBox('Difference', ui.inr(result.gain, 0), 'arithmetic, not a promise')
    ]));
  }

  /* ---------------- expense drag ---------------- */

  function renderDrag() {
    var result = calc.expenseDrag({
      monthly: value('drag-monthly'), years: value('drag-years'), grossPct: value('drag-gross'),
      terDirect: value('drag-ter-direct'), terRegular: value('drag-ter-regular')
    });
    var host = document.getElementById('drag-out');
    ui.clear(host);

    var months = calc.monthsOfContributions(Math.abs(result.extraCost), value('drag-monthly'));
    host.appendChild(el('div', { class: 'result-split' }, [
      statBox('Direct plan', ui.inr(result.direct.value, 0), 'net of ' + ui.pct(result.terDirect) + ' assumed TER'),
      statBox('Regular plan', ui.inr(result.regular.value, 0), 'net of ' + ui.pct(result.terRegular) + ' assumed TER'),
      statBox('Cost of the higher TER', ui.inr(Math.abs(result.extraCost), 0),
        // Whole months only: "144.7 months" is a precision nobody is reading anything into.
        months ? '≈ ' + ui.trim(Math.round(months), 0) + ' months of instalments' : 'arithmetic difference')
    ]));

    host.appendChild(el('ul', { class: 'kv', style: { marginTop: '12px' } }, [
      el('li', null, [el('span', { class: 'k', text: 'Assumed expense-ratio gap' }), el('span', { class: 'v', text: ui.pct(result.terGap) })]),
      el('li', null, [el('span', { class: 'k', text: 'Gross return you entered' }), el('span', { class: 'v', text: ui.pct(result.grossPct, 1) })]),
      el('li', null, [el('span', { class: 'k', text: 'Difference as a share of the direct-plan corpus' }), el('span', { class: 'v', text: ui.pct(Math.abs(result.extraCostShare), 1) })])
    ]));

    host.appendChild(el('p', { class: 'card-note', style: { marginTop: '10px' } }, [
      'This compares one portfolio held two ways. Both plans invest alike; the Regular plan simply pays more out of the same returns. ',
      el('span', { class: 'tag-assumed', text: 'The TER figures are yours to set — LearningFundClear does not publish per-scheme expense ratios.' })
    ]));
  }

  function statBox(label, figure, sub) {
    return el('div', { class: 'result-box' }, [
      el('div', { class: 'result-label', text: label }),
      el('div', { class: 'result-figure', text: figure }),
      el('div', { class: 'result-label', text: sub })
    ]);
  }

  /* ---------------- category defaults ---------------- */

  function buildCategoryDefaults() {
    var select = document.getElementById('drag-category');
    var cats = funds.categories().filter(function (c) { return c.schemeCount > 0; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    select.appendChild(el('option', { value: '', text: 'Choose a category to fill in assumed ratios' }));
    cats.forEach(function (category) {
      select.appendChild(el('option', { value: category.id, text: category.name }));
    });
    select.addEventListener('change', function () {
      var category = funds.categoryById(select.value);
      if (!category) return;
      var assumption = funds.terAssumption(category.name);
      document.getElementById('drag-ter-direct').value = assumption.directMid;
      document.getElementById('drag-ter-regular').value = assumption.regularMid;
      writeUrl(); renderDrag();
      ui.toast('Filled with the assumed range for ' + category.name);
    });
  }

  function renderAll() {
    renderSip();
    renderLumpsum();
    renderDrag();
  }

  function boot() {
    readUrlTo(FIELDS);
    buildCategoryDefaults();

    FIELDS.forEach(function (field) {
      var input = document.getElementById(field.id);
      if (!input) return;
      input.addEventListener('input', function () { writeUrl(); renderAll(); });
    });

    document.getElementById('reset').addEventListener('click', function () {
      FIELDS.forEach(function (field) {
        var input = document.getElementById(field.id);
        if (input) input.value = DEFAULTS[field.key];
      });
      writeUrl(); renderAll();
    });

    document.getElementById('share').addEventListener('click', function () {
      ui.copy(global.location.href, 'Calculator link copied');
    });

    renderAll();
  }

  ui.ready(boot);
})(window);
