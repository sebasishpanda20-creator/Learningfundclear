/*!
 * FundClear India - shared browser helpers
 * Plain classic script: works from file://, a static host, or any sub-path.
 * No framework, no build step, no network calls.
 */
(function (global) {
  'use strict';

  var FC = global.FC = global.FC || {};

  /** el('div', { class, text, dataset, onclick }, [children]) - text is always textContent. */
  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key === 'dataset' && typeof value === 'object') Object.assign(node.dataset, value);
        else if (key.slice(0, 2) === 'on' && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : value);
      });
    }
    if (typeof kids === 'string' || typeof kids === 'number') kids = [String(kids)];
    (kids || []).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) return;
      node.appendChild(typeof kid === 'string' || typeof kid === 'number'
        ? document.createTextNode(String(kid)) : kid);
    });
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /* ---------------- currency and numbers ---------------- */

  /** Indian digit grouping: 1,23,456.78 rather than 123,456.78. */
  function inr(value, decimals) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    var places = typeof decimals === 'number' ? decimals : 2;
    return '₹' + Number(value).toLocaleString('en-IN', {
      minimumFractionDigits: places,
      maximumFractionDigits: places
    });
  }

  /** Compact Indian money: crore and lakh, because that is how people here read scale. */
  function inrCompact(value) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    var abs = Math.abs(value), sign = value < 0 ? '-' : '';
    if (abs >= 1e7) return sign + '₹' + trim(abs / 1e7, 2) + ' Cr';
    if (abs >= 1e5) return sign + '₹' + trim(abs / 1e5, 2) + ' L';
    if (abs >= 1e3) return sign + '₹' + trim(abs / 1e3, 1) + 'K';
    return sign + '₹' + trim(abs, 0);
  }

  function trim(value, places) {
    return Number(value).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: places });
  }

  function nav(value) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    return Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  function pct(value, places) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    var places2 = typeof places === 'number' ? places : 2;
    return Number(value).toFixed(places2) + '%';
  }

  /* ---------------- URL state ---------------- */

  function params() {
    return new URLSearchParams(global.location.search);
  }

  function queryOne(name, fallback) {
    var value = params().get(name);
    return value === null || value === '' ? fallback : value;
  }

  function queryNumber(name, fallback, min, max) {
    var value = parseFloat(params().get(name));
    if (!isFinite(value)) return fallback;
    if (typeof min === 'number') value = Math.max(min, value);
    if (typeof max === 'number') value = Math.min(max, value);
    return value;
  }

  function queryList(name) {
    var raw = params().get(name);
    if (!raw) return [];
    return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /** Keep the address bar in step with what is on screen, without history spam. */
  function setQuery(pairs, push) {
    var next = new URLSearchParams(global.location.search);
    Object.keys(pairs).forEach(function (key) {
      var value = pairs[key];
      if (value === null || value === undefined || value === '' || value === false) next.delete(key);
      else next.set(key, String(value));
    });
    var query = next.toString();
    var url = global.location.pathname + (query ? '?' + query : '') + global.location.hash;
    if (push && global.history.pushState) global.history.pushState(null, '', url);
    else if (global.history.replaceState) global.history.replaceState(null, '', url);
  }

  /* ---------------- interaction niceties ---------------- */

  var toastTimer = null;
  function toast(message) {
    var node = document.querySelector('.toast');
    if (!node) {
      node = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('show'); }, 2200);
  }

  function copy(text, message) {
    function done() { toast(message || 'Copied'); }
    if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(done, fallback);
      return;
    }
    fallback();
    function fallback() {
      var area = el('textarea', { style: { position: 'fixed', top: '-1000px' } });
      area.value = text;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); done(); } catch (err) { toast('Copy failed'); }
      document.body.removeChild(area);
    }
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var self = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait || 140);
    };
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  FC.ui = {
    el: el, clear: clear, ready: ready,
    inr: inr, inrCompact: inrCompact, nav: nav, pct: pct, trim: trim,
    params: params, queryOne: queryOne, queryNumber: queryNumber, queryList: queryList, setQuery: setQuery,
    toast: toast, copy: copy, debounce: debounce
  };
})(window);
