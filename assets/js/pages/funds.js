/*!
 * LearningFundClear India - scheme directory
 * Client-side search across the whole dataset. Filters live in the URL so any view is
 * a link you can send to someone.
 */
(function (global) {
  'use strict';

  var FC = global.FC, ui = FC.ui, el = ui.el, funds = FC.funds;

  var PAGE_SIZE = 25;

  var state = { q: '', group: 'all', category: 'all', amc: 'all', plan: 'all', sort: 'name', shown: PAGE_SIZE };

  function readUrl() {
    state.q = ui.queryOne('q', '');
    state.group = ui.queryOne('group', 'all');
    state.category = ui.queryOne('category', 'all');
    state.amc = ui.queryOne('amc', 'all');
    state.plan = ui.queryOne('plan', 'all');
    state.sort = ui.queryOne('sort', 'name');
    if (!funds.SORTS[state.sort]) state.sort = 'name';
  }

  function writeUrl() {
    ui.setQuery({
      q: state.q, group: state.group === 'all' ? '' : state.group,
      category: state.category === 'all' ? '' : state.category,
      amc: state.amc === 'all' ? '' : state.amc,
      plan: state.plan === 'all' ? '' : state.plan,
      sort: state.sort === 'name' ? '' : state.sort
    }, false);
  }

  function results() {
    return funds.query(state);
  }

  /**
   * Build every control, including the group chips.
   *
   * The chips are rebuilt from scratch on each call rather than being patched in place:
   * patching left two chip sets on screen after a filter change, and a chip built during
   * boot carried a handler that reset the category without updating the URL — so a
   * bookmark of that view reopened a different one. Rebuilding cannot drift from state.
   */
  function buildControls() {
    var search = document.getElementById('q');
    search.value = state.q;

    var groupHost = document.getElementById('group-chips');
    ui.clear(groupHost);
    ['all'].concat(funds.groups()).forEach(function (group) {
      groupHost.appendChild(el('button', {
        class: 'chip', type: 'button', text: group === 'all' ? 'All groups' : group,
        'aria-pressed': String(state.group === group),
        onclick: function () {
          state.group = group;
          state.category = 'all';
          state.shown = PAGE_SIZE;
          writeUrl();
          buildControls();
          render();
        }
      }));
    });

    var category = document.getElementById('category');
    var cats = funds.categories().filter(function (c) { return c.schemeCount > 0; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    ui.clear(category);
    category.appendChild(el('option', { value: 'all', text: 'All categories' }));
    var available = cats.filter(function (c) { return state.group === 'all' || c.group === state.group; });
    available.forEach(function (c) {
      category.appendChild(el('option', { value: c.name, text: c.name + ' (' + c.schemeCount + ')' }));
    });
    /* A category that is not offered under the current group must be dropped, or the
       select would show nothing while the URL still claimed a filter. */
    if (state.category !== 'all' && !available.some(function (c) { return c.name === state.category; })) {
      state.category = 'all';
    }
    category.value = state.category;

    var amc = document.getElementById('amc');
    ui.clear(amc);
    amc.appendChild(el('option', { value: 'all', text: 'All fund houses' }));
    funds.amcs().forEach(function (name) { amc.appendChild(el('option', { value: name, text: name })); });
    amc.value = state.amc;

    var sort = document.getElementById('sort');
    ui.clear(sort);
    Object.keys(funds.SORTS).forEach(function (key) {
      sort.appendChild(el('option', { value: key, text: funds.SORTS[key].label }));
    });
    sort.value = state.sort;
  }

  function render() {
    var list = results();
    var listHost = document.getElementById('results');
    ui.clear(listHost);

    document.getElementById('count').textContent = list.length === 1
      ? '1 scheme' : ui.trim(list.length, 0) + ' schemes';

    var slice = list.slice(0, state.shown);
    slice.forEach(function (scheme) { listHost.appendChild(row(scheme)); });

    var more = document.getElementById('more');
    var remaining = Math.max(0, list.length - state.shown);
    more.hidden = remaining === 0;
    more.textContent = 'Show ' + Math.min(PAGE_SIZE, remaining) + ' more';

    document.getElementById('empty').hidden = list.length > 0;
    document.getElementById('clear').hidden = !(state.q || state.group !== 'all' || state.category !== 'all' || state.amc !== 'all' || state.plan !== 'all');
    document.getElementById('result-summary').textContent = summaryLine(list.length);
  }

  function summaryLine(total) {
    var bits = [];
    if (state.q) bits.push('matching “' + state.q + '”');
    if (state.group !== 'all') bits.push('in ' + state.group);
    if (state.category !== 'all') bits.push('category: ' + state.category);
    if (state.amc !== 'all') bits.push(state.amc);
    if (state.plan !== 'all') bits.push(state.plan + ' plan only');
    return bits.length ? 'Showing ' + total + ' ' + bits.join(' · ') : 'Showing all ' + total + ' schemes';
  }

  function row(scheme) {
    return el('li', { class: 'scheme' }, [
      el('div', { class: 'scheme-top' }, [
        el('div', { class: 'scheme-name' }, [el('a', { href: 'scheme.html?code=' + scheme.code, text: scheme.name })]),
        el('div', { class: 'scheme-nav' }, [
          el('b', { text: ui.nav(scheme.nav) }),
          el('span', { text: 'NAV ' + scheme.date })
        ])
      ]),
      el('div', { class: 'scheme-meta' }, [
        el('span', { class: 'badge ' + (scheme.plan === 'Direct' ? 'badge-direct' : 'badge-regular'), text: scheme.plan }),
        el('span', { text: scheme.category }),
        el('span', { text: scheme.amc }),
        el('span', { text: 'AMFI ' + scheme.code })
      ]),
      el('div', { class: 'scheme-foot' }, [
        el('a', { class: 'btn btn-sm', href: 'scheme.html?code=' + scheme.code, text: 'Details' }),
        el('a', { class: 'btn btn-sm', href: 'compare.html?codes=' + scheme.code, text: 'Compare' })
      ])
    ]);
  }

  function boot() {
    readUrl();
    buildControls();
    render();

    document.getElementById('q').addEventListener('input', ui.debounce(function (event) {
      state.q = event.target.value.trim();
      state.shown = PAGE_SIZE;
      writeUrl();
      render();
    }, 160));

    document.getElementById('category').addEventListener('change', function (event) {
      state.category = event.target.value; state.shown = PAGE_SIZE; writeUrl(); render();
    });
    document.getElementById('amc').addEventListener('change', function (event) {
      state.amc = event.target.value; state.shown = PAGE_SIZE; writeUrl(); render();
    });
    document.getElementById('sort').addEventListener('change', function (event) {
      state.sort = event.target.value; state.shown = PAGE_SIZE; writeUrl(); render();
    });

    var planHost = document.getElementById('plan-chips');
    ['all'].concat(funds.plans()).forEach(function (plan) {
      planHost.appendChild(el('button', {
        class: 'chip', type: 'button', text: plan === 'all' ? 'Both plans' : plan + ' plan',
        'aria-pressed': String(state.plan === plan),
        onclick: function () {
          state.plan = plan; state.shown = PAGE_SIZE;
          planHost.querySelectorAll('.chip').forEach(function (chip) { chip.setAttribute('aria-pressed', 'false'); });
          this.setAttribute('aria-pressed', 'true');
          writeUrl(); render();
        }
      }));
    });

    document.getElementById('more').addEventListener('click', function () {
      state.shown += PAGE_SIZE;
      render();
    });
    document.getElementById('clear').addEventListener('click', function () {
      state = { q: '', group: 'all', category: 'all', amc: 'all', plan: 'all', sort: 'name', shown: PAGE_SIZE };
      global.location.href = global.location.pathname;
    });
  }

  ui.ready(boot);
})(window);
