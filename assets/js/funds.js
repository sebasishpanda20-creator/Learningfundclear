/*!
 * LearningFundClear India - data access layer
 *
 * Everything the pages know about schemes comes through here, and everything here
 * comes from the one generated file (assets/js/data.js, built by tools/refresh-data.py).
 * Keep it that way: no page should reach into window.LEARNINGFUNDCLEAR directly.
 */
(function (global) {
  'use strict';

  var FC = global.FC = global.FC || {};
  var DATA = global.LEARNINGFUNDCLEAR;
  var ui = FC.ui;

  function meta() { return DATA.meta; }
  function all() { return DATA.schemes; }
  function groups() { return DATA.groups; }
  function categories() { return DATA.categories; }
  function plans() { return DATA.plans; }

  function byCode(code) {
    var wanted = String(code);
    for (var i = 0; i < DATA.schemes.length; i++) {
      if (DATA.schemes[i].code === wanted) return DATA.schemes[i];
    }
    return null;
  }

  function byId(id) {
    var key = String(id);
    for (var i = 0; i < DATA.schemes.length; i++) {
      if (DATA.schemes[i].id === key) return DATA.schemes[i];
    }
    return null;
  }

  function categoryById(id) {
    var key = String(id);
    for (var i = 0; i < DATA.categories.length; i++) {
      if (DATA.categories[i].id === key) return DATA.categories[i];
    }
    return null;
  }

  function categoryByName(name) {
    for (var i = 0; i < DATA.categories.length; i++) {
      if (DATA.categories[i].name === name) return DATA.categories[i];
    }
    return null;
  }

  function amcs() {
    var seen = {}, list = [];
    DATA.schemes.forEach(function (s) {
      if (!seen[s.amc]) { seen[s.amc] = true; list.push(s.amc); }
    });
    return list.sort();
  }

  /* ---------------- plan families ---------------- */

  /** AMFI sometimes appends "- Direct Plan"; strip it to get the fund's own name. */
  function familyName(schemeName) {
    return String(schemeName).replace(/\s*-\s*(Direct|Regular)\s*Plan.*$/i, '').trim();
  }

  function familyKey(scheme) {
    return scheme.amc + ' || ' + familyName(scheme.name);
  }

  /** The other plan of the same fund, when AMFI lists both. */
  function siblingPlan(scheme) {
    var key = familyKey(scheme);
    return all().filter(function (other) {
      return other.code !== scheme.code && familyKey(other) === key && other.plan !== scheme.plan;
    })[0] || null;
  }

  /** NAV difference between the two plans of one fund, as a percentage. */
  function planGap(direct, regular) {
    if (!direct || !regular || !regular.nav) return null;
    return ((direct.nav - regular.nav) / regular.nav) * 100;
  }

  /** Fund families that list both plans - the basis of every comparison here. */
  function pairedFamilies() {
    var map = {};
    all().forEach(function (s) {
      var key = familyKey(s);
      map[key] = map[key] || { key: key, amc: s.amc, name: familyName(s.name), category: s.category, group: s.group, plans: {} };
      map[key].plans[s.plan] = s;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .filter(function (f) { return f.plans.Direct && f.plans.Regular; });
  }

  /* ---------------- expense ratio assumptions ---------------- */

  /**
   * TER is NOT in the data file. AMFI publishes no machine-readable TER feed, so the
   * site ships an illustrative industry range per category and marks it as an
   * assumption wherever it appears. Never present these numbers as facts.
   */
  function terAssumption(schemeOrCategory) {
    var category = typeof schemeOrCategory === 'string'
      ? categoryByName(schemeOrCategory)
      : categoryByName(schemeOrCategory && schemeOrCategory.category);
    if (!category) {
      return { direct: [0.5, 1.2], regular: [1.5, 2.5], directMid: 0.85, regularMid: 2.0, assumed: true, category: 'Unknown' };
    }
    var d = category.terDirect, r = category.terRegular;
    return {
      category: category.name,
      group: category.group,
      direct: d,
      regular: r,
      directMid: round2((d[0] + d[1]) / 2),
      regularMid: round2((r[0] + r[1]) / 2),
      assumed: true
    };
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /* ---------------- search, filter, sort ---------------- */

  var SORTS = {
    name: { label: 'Fund name (A–Z)', fn: function (a, b) { return a.name.localeCompare(b.name); } },
    amc: { label: 'Fund house (A–Z)', fn: function (a, b) { return a.amc.localeCompare(b.amc) || a.name.localeCompare(b.name); } },
    'nav-high': { label: 'NAV: highest first', fn: function (a, b) { return b.nav - a.nav; } },
    'nav-low': { label: 'NAV: lowest first', fn: function (a, b) { return a.nav - b.nav; } },
    category: { label: 'Category (A–Z)', fn: function (a, b) { return a.category.localeCompare(b.category) || a.name.localeCompare(b.name); } }
  };

  function matches(scheme, filters) {
    if (filters.group && filters.group !== 'all' && scheme.group !== filters.group) return false;
    if (filters.category && filters.category !== 'all' && scheme.category !== filters.category) return false;
    if (filters.amc && filters.amc !== 'all' && scheme.amc !== filters.amc) return false;
    if (filters.plan && filters.plan !== 'all' && scheme.plan !== filters.plan) return false;
    if (filters.q) {
      var haystack = [scheme.name, scheme.amc, scheme.category, scheme.code, scheme.isin || ''].join(' ').toLowerCase();
      if (haystack.indexOf(filters.q.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function query(filters) {
    var f = filters || {};
    var sort = (SORTS[f.sort] || SORTS.name).fn;
    return all().filter(function (s) { return matches(s, f); }).sort(sort);
  }

  /** Same-category peers, useful on a scheme page. */
  function peers(scheme, limit, excludeAmc) {
    return all().filter(function (s) {
      return s.category === scheme.category && s.code !== scheme.code &&
        (!excludeAmc || s.amc !== scheme.amc) && s.plan === scheme.plan;
    }).slice(0, limit || 5);
  }

  /** A handful of well-known dual-plan funds, for the home page feature. */
  function showcaseFamilies(limit) {
    var preferred = ['Flexi Cap Fund', 'Large Cap Fund', 'Mid Cap Fund', 'Small Cap Fund', 'Index Funds - Equity Funds'];
    var families = pairedFamilies();
    var picked = [];
    preferred.forEach(function (category) {
      families.forEach(function (f) {
        if (picked.length >= (limit || 3)) return;
        if (f.category === category && !picked.some(function (p) { return p.name === f.name; })) picked.push(f);
      });
    });
    if (picked.length < (limit || 3)) {
      families.forEach(function (f) {
        if (picked.length < (limit || 3) && !picked.some(function (p) { return p.name === f.name; })) picked.push(f);
      });
    }
    return picked.slice(0, limit || 3);
  }

  FC.funds = {
    SORTS: SORTS,
    meta: meta, all: all, groups: groups, categories: categories, plans: plans,
    byCode: byCode, byId: byId, categoryById: categoryById, categoryByName: categoryByName, amcs: amcs,
    familyName: familyName, familyKey: familyKey, siblingPlan: siblingPlan, planGap: planGap,
    pairedFamilies: pairedFamilies, terAssumption: terAssumption,
    query: query, peers: peers, showcaseFamilies: showcaseFamilies
  };

  void ui;
})(window);
