/*!
 * LearningFundClear India - page shell
 * Active-nav marking, the live data strip, footer year, and the compliance strings
 * that must appear on every page.
 */
(function (global) {
  'use strict';

  var FC = global.FC = global.FC || {};
  var ui = FC.ui;

  /** Shown on every page. Keep the wording intact: it is the compliance layer. */
  var RISK_LINE = 'LearningFundClear is not a SEBI-registered research analyst or investment adviser, and nothing here is '
    + 'a recommendation to buy or sell any scheme. Mutual fund investments are subject to market risks; read all '
    + 'scheme-related documents carefully. Past performance does not indicate future results.';

  function markActiveNav() {
    var here = global.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.site-nav a').forEach(function (link) {
      if (link.getAttribute('href') === here) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  /** Fill every [data-*] placeholder with the real figures from the data file. */
  function fillDataStrip() {
    var meta = FC.funds.meta();
    document.querySelectorAll('[data-year]').forEach(function (node) {
      node.textContent = String(new Date().getFullYear());
    });
    var values = {
      'data-nav-date': meta.navDate || '—',
      'data-scheme-count': ui.trim(meta.schemeCount, 0),
      'data-amc-count': ui.trim(meta.amcCount, 0),
      'data-category-count': ui.trim(meta.categoryCount, 0),
      'data-pair-count': ui.trim(meta.pairedFamilies, 0),
      'data-source': meta.source,
      'data-fetched-at': meta.fetchedAt,
      'data-risk-line': RISK_LINE
    };
    Object.keys(values).forEach(function (attribute) {
      document.querySelectorAll('[' + attribute + ']').forEach(function (node) {
        node.textContent = values[attribute];
      });
    });
  }

  function boot() {
    markActiveNav();
    fillDataStrip();
  }

  ui.ready(boot);

  FC.site = { RISK_LINE: RISK_LINE };
})(window);
