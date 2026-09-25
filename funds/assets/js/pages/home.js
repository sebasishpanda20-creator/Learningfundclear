/*!
 * LearningFundClear - home page
 * Shows what the site is, the single most useful comparison it can make from real
 * NAV data (same fund, two plans), and a way into the directory.
 */
(function (global) {
  'use strict';

  var FC = global.FC, ui = FC.ui, el = ui.el, funds = FC.funds, calc = FC.calc;

  var DEMO = { monthly: 5000, years: 10, grossPct: 11 };

  function boot() {
    renderStats();
    renderShowcase();
    renderCategoryLinks();
    wireSearch();
  }

  function renderStats() {
    var host = document.getElementById('hero-stats');
    var meta = funds.meta();
    ui.clear(host);
    [
      { value: ui.trim(meta.schemeCount, 0), label: 'schemes listed' },
      { value: ui.trim(meta.amcCount, 0), label: 'fund houses' },
      { value: ui.trim(meta.pairedFamilies, 0), label: 'funds with both plans' },
      { value: meta.navDate, label: 'latest NAV date' }
    ].forEach(function (stat) {
      host.appendChild(el('div', { class: 'stat' }, [
        el('b', { text: stat.value }),
        el('span', { text: stat.label })
      ]));
    });
  }

  /** The core insight the whole site is built around. */
  function renderShowcase() {
    var host = document.getElementById('showcase');
    ui.clear(host);

    funds.showcaseFamilies(2).forEach(function (family) {
      var direct = family.plans.Direct, regular = family.plans.Regular;
      var gap = funds.planGap(direct, regular);
      var ter = funds.terAssumption(direct);
      var drag = calc.expenseDrag({
        monthly: DEMO.monthly, years: DEMO.years, grossPct: DEMO.grossPct,
        terDirect: ter.directMid, terRegular: ter.regularMid
      });

      var card = el('article', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h3', { text: family.name }),
          el('span', { class: 'badge badge-group', text: family.category })
        ]),
        el('p', { class: 'card-note', text: family.amc + ' · both plans appear in AMFI\'s NAV file, so the NAVs below are real values from ' + funds.meta().navDate + '.' }),
        el('ul', { class: 'kv' }, [
          el('li', null, [
            el('span', { class: 'k' }, [el('span', { class: 'badge badge-direct', text: 'Direct' }), ' NAV']),
            el('span', { class: 'v', text: ui.nav(direct.nav) })
          ]),
          el('li', null, [
            el('span', { class: 'k' }, [el('span', { class: 'badge badge-regular', text: 'Regular' }), ' NAV']),
            el('span', { class: 'v', text: ui.nav(regular.nav) })
          ]),
          el('li', null, [
            el('span', { class: 'k', text: 'Direct plan is ahead by' }),
            el('span', { class: 'v up', text: gap === null ? '—' : ui.pct(gap) })
          ])
        ]),
        el('p', { class: 'card-note', style: { marginTop: '12px' } }, [
          'Illustrative arithmetic: ' + ui.inr(DEMO.monthly, 0) + '/month for ' + DEMO.years + ' years at an assumed '
            + ui.pct(DEMO.grossPct, 1) + ' gross return, with expense ratios assumed at '
            + ui.pct(ter.directMid) + ' (direct) and ' + ui.pct(ter.regularMid) + ' (regular) — ',
          el('span', { class: 'tag-assumed', text: 'assumed, not published data' }),
          '. The gap is ' + ui.inrCompact(drag.extraCost) + '. It is a calculation, not a forecast.'
        ]),
        el('div', { class: 'scheme-foot', style: { marginTop: '12px' } }, [
          el('a', { class: 'btn btn-sm', href: 'compare.html?codes=' + direct.code + ',' + regular.code, text: 'Compare both plans' }),
          el('a', { class: 'btn btn-sm', href: 'calculators.html#drag', text: 'Check the expense gap' })
        ])
      ]);
      host.appendChild(card);
    });
  }

  function renderCategoryLinks() {
    var host = document.getElementById('category-links');
    ui.clear(host);
    var cats = funds.categories().filter(function (c) { return c.schemeCount > 0; })
      .sort(function (a, b) { return b.schemeCount - a.schemeCount; }).slice(0, 10);
    cats.forEach(function (category) {
      host.appendChild(el('a', {
        class: 'chip',
        href: 'funds.html?category=' + encodeURIComponent(category.id),
        text: category.name + ' (' + category.schemeCount + ')'
      }));
    });
  }

  function wireSearch() {
    var form = document.getElementById('quick-search');
    if (!form) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = document.getElementById('quick-search-input').value.trim();
      global.location.href = 'funds.html' + (value ? '?q=' + encodeURIComponent(value) : '');
    });
  }

  ui.ready(boot);
})(window);
