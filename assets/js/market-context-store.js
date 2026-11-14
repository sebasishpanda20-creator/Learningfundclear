/* Market-context records: validated, immutable, separate from candles and
   strategy inputs. Missing values stay null; no synthetic context is created. */
(function (root) {
  'use strict';

  var KINDS = {
    MARKET_REGIME: 'MARKET_REGIME',
    BULK_DEAL: 'BULK_DEAL',
    FII_DII: 'FII_DII',
    OPTIONS_OI: 'OPTIONS_OI'
  };
  var REGIMES = ['RISK_ON', 'NEUTRAL', 'RISK_OFF', 'UNAVAILABLE'];
  var TRENDS = ['UP', 'DOWN', 'SIDEWAYS'];
  var FRESHNESS = ['FRESH', 'STALE', 'UNAVAILABLE'];
  var OPTION_TYPES = ['CALL', 'PUT'];

  function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
  function numOrNull(v) { return v === null || v === undefined ? null : (isNum(v) ? v : NaN); }
  function text(v) { return typeof v === 'string' && v.trim() ? v.trim() : null; }
  function timeOf(v) {
    if (isNum(v)) return v > 0 ? v : NaN;
    if (typeof v === 'string' && v.trim()) {
      var parsed = Date.parse(v);
      return Number.isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
  }
  function validUrl(v) {
    if (typeof v !== 'string') return false;
    try { var u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:'; } catch (e) { return false; }
  }
  function push(errors, field, message) { errors.push(field + ': ' + message); }

  function validateRegime(r, errors) {
    if (!timeOf(r.asOf)) push(errors, 'asOf', 'required timestamp');
    if (!text(r.provider)) push(errors, 'provider', 'required');
    if (!text(r.market)) push(errors, 'market', 'required');
    if (REGIMES.indexOf(r.regime) < 0) push(errors, 'regime', 'must be RISK_ON, NEUTRAL, RISK_OFF or UNAVAILABLE');
    if (r.fiiNet !== null && r.fiiNet !== undefined && !isNum(r.fiiNet)) push(errors, 'fiiNet', 'number or null');
    if (r.diiNet !== null && r.diiNet !== undefined && !isNum(r.diiNet)) push(errors, 'diiNet', 'number or null');
    if (r.indexTrend !== null && r.indexTrend !== undefined && TRENDS.indexOf(r.indexTrend) < 0) push(errors, 'indexTrend', 'UP, DOWN, SIDEWAYS or null');
    if (r.breadth !== null && r.breadth !== undefined && (!isNum(r.breadth) || r.breadth < 0)) push(errors, 'breadth', 'non-negative number or null');
    if (r.volatility !== null && r.volatility !== undefined && (!isNum(r.volatility) || r.volatility < 0)) push(errors, 'volatility', 'non-negative number or null');
    if (FRESHNESS.indexOf(r.freshness) < 0) push(errors, 'freshness', 'FRESH, STALE or UNAVAILABLE');
  }

  function validateBulk(r, errors) {
    if (!timeOf(r.asOf)) push(errors, 'asOf', 'required timestamp');
    if (!text(r.provider)) push(errors, 'provider', 'required');
    if (!text(r.market)) push(errors, 'market', 'required');
    if (!text(r.symbol)) push(errors, 'symbol', 'required');
    if (!isNum(r.quantity) || r.quantity <= 0) push(errors, 'quantity', 'positive number');
    if (!isNum(r.price) || r.price <= 0) push(errors, 'price', 'positive number');
    if (!text(r.dealType)) push(errors, 'dealType', 'required (BULK, BLOCK or another defined type)');
    if (!validUrl(r.sourceUrl)) push(errors, 'sourceUrl', 'http(s) URL required');
    if (r.buyer !== null && r.buyer !== undefined && typeof r.buyer !== 'string') push(errors, 'buyer', 'text or null');
    if (r.seller !== null && r.seller !== undefined && typeof r.seller !== 'string') push(errors, 'seller', 'text or null');
  }

  function validateOi(r, errors) {
    if (!timeOf(r.asOf)) push(errors, 'asOf', 'required timestamp');
    if (!text(r.provider)) push(errors, 'provider', 'required');
    if (!text(r.market)) push(errors, 'market', 'required');
    if (!text(r.underlying)) push(errors, 'underlying', 'required');
    if (!timeOf(r.expiry)) push(errors, 'expiry', 'required expiry');
    if (!isNum(r.strike) || r.strike <= 0) push(errors, 'strike', 'positive number');
    if (OPTION_TYPES.indexOf(r.optionType) < 0) push(errors, 'optionType', 'CALL or PUT');
    ['openInterest', 'openInterestChange', 'volume', 'impliedVolatility', 'lastTradedPrice'].forEach(function (k) {
      var v = r[k];
      if (v !== null && v !== undefined && !isNum(v)) push(errors, k, 'number or null');
      if (k === 'openInterest' && isNum(v) && v < 0) push(errors, k, 'cannot be negative');
      if (k === 'volume' && isNum(v) && v < 0) push(errors, k, 'cannot be negative');
      if ((k === 'impliedVolatility' || k === 'lastTradedPrice') && isNum(v) && v < 0) push(errors, k, 'cannot be negative');
    });
  }

  function validateFiiDii(r, errors) {
    if (!timeOf(r.asOf)) push(errors, 'asOf', 'required timestamp');
    if (!text(r.provider)) push(errors, 'provider', 'required');
    if (!text(r.market)) push(errors, 'market', 'required');
    if (r.fiiNet !== null && r.fiiNet !== undefined && !isNum(r.fiiNet)) push(errors, 'fiiNet', 'number or null');
    if (r.diiNet !== null && r.diiNet !== undefined && !isNum(r.diiNet)) push(errors, 'diiNet', 'number or null');
    if (r.freshness !== null && r.freshness !== undefined && FRESHNESS.indexOf(r.freshness) < 0) push(errors, 'freshness', 'FRESH, STALE or UNAVAILABLE');
  }

  function validate(kind, record) {
    var errors = [];
    if (!record || typeof record !== 'object') return { ok: false, errors: ['record must be an object'] };
    if (Object.keys(KINDS).indexOf(kind) < 0) return { ok: false, errors: ['unknown kind: ' + kind] };
    if (kind === KINDS.MARKET_REGIME) validateRegime(record, errors);
    else if (kind === KINDS.BULK_DEAL) validateBulk(record, errors);
    else if (kind === KINDS.OPTIONS_OI) validateOi(record, errors);
    else if (kind === KINDS.FII_DII) validateFiiDii(record, errors);
    if (errors.length) return { ok: false, errors: errors };
    var copy = {};
    Object.keys(record).forEach(function (k) {
      var v = record[k];
      if (v === undefined) v = null;
      copy[k] = v;
    });
    copy.kind = kind;
    return { ok: true, errors: [], value: Object.freeze(copy) };
  }

  function subjectOf(record) {
    if (record.kind === KINDS.MARKET_REGIME) return record.market;
    if (record.kind === KINDS.BULK_DEAL) return record.symbol;
    if (record.kind === KINDS.OPTIONS_OI) return record.underlying;
    return record.market;
  }

  function keyOf(record) {
    return [record.kind, record.provider, record.market, subjectOf(record), String(record.asOf)].join('|');
  }

  // Freshness is derived from the record timestamp, never guessed or zeroed.
  function classifyFreshness(asOf, kind, now) {
    var t = timeOf(asOf);
    if (!Number.isFinite(t)) return 'UNAVAILABLE';
    var age = (now || Date.now()) - t;
    if (age < -5 * 60 * 1000) return 'UNAVAILABLE';
    var limit = kind === KINDS.MARKET_REGIME ? 30 * 60 * 1000 : kind === KINDS.OPTIONS_OI ? 30 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return age <= limit ? 'FRESH' : 'STALE';
  }

  function createStore() {
    var records = new Map();
    var listeners = [];

    function matches(record, filter) {
      if (!filter) return true;
      if (filter.kind && record.kind !== filter.kind) return false;
      if (filter.market && record.market !== filter.market) return false;
      if (filter.subject && subjectOf(record) !== filter.subject) return false;
      return true;
    }
    function notify(record) {
      listeners.slice().forEach(function (l) {
        if (!matches(record, l.filter)) return;
        try { l.cb(record); } catch (e) { /* a bad subscriber must not break the store */ }
      });
    }
    function add(record) {
      var checked = validate(record && record.kind, record);
      if (!checked.ok) return { ok: false, errors: checked.errors };
      var key = keyOf(checked.value);
      if (records.has(key)) return { ok: false, errors: ['duplicate context record: ' + key] };
      records.set(key, checked.value);
      notify(checked.value);
      return { ok: true, record: checked.value };
    }
    function list(kind, filter) {
      var out = [];
      records.forEach(function (r) { if ((!kind || r.kind === kind) && matches(r, filter)) out.push(r); });
      return out.sort(function (a, b) { return timeOf(a.asOf) - timeOf(b.asOf); });
    }
    function latest(kind, filter) {
      var rows = list(kind, filter);
      return rows.length ? rows[rows.length - 1] : null;
    }
    function subscribe(filter, cb) {
      if (typeof filter === 'function') { cb = filter; filter = null; }
      if (typeof cb !== 'function') throw new Error('subscribe requires a callback');
      var entry = { filter: filter || null, cb: cb };
      listeners.push(entry);
      return function () {
        var at = listeners.indexOf(entry);
        if (at >= 0) listeners.splice(at, 1);
      };
    }
    function clear() { records.clear(); }
    return { add: add, list: list, latest: latest, subscribe: subscribe, clear: clear, keyOf: keyOf };
  }

  var api = {
    KINDS: KINDS,
    REGIMES: REGIMES,
    validate: validate,
    classifyFreshness: classifyFreshness,
    subjectOf: subjectOf,
    createStore: createStore
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LfcMarketContextStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
