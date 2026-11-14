/* Renders market context into the terminal panel. Provider text is inserted
   with textContent only; numbers use Indian grouping; missing values stay "—". */
(function (root) {
  'use strict';

  var numberFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
  var intFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  var dateFmt = new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata'
  });
  var dayFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

  function fmtNum(v, int) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
    return (int ? intFmt : numberFmt).format(v);
  }
  function fmtDate(v) {
    var t = typeof v === 'number' ? v : Date.parse(String(v));
    return Number.isFinite(t) ? dateFmt.format(new Date(t)) + ' IST' : '—';
  }
  function fmtExpiry(v) {
    var t = typeof v === 'number' ? v : Date.parse(String(v));
    return Number.isFinite(t) ? dayFmt.format(new Date(t)) : '—';
  }
  function text(el, value) {
    if (el) el.textContent = value == null || value === '' ? '—' : String(value);
  }
  function row(cells) {
    var tr = document.createElement('tr');
    cells.forEach(function (value) {
      var td = document.createElement('td');
      if (value && value.nodeType) td.appendChild(value);
      else td.textContent = value == null || value === '' ? '—' : String(value);
      tr.appendChild(td);
    });
    return tr;
  }

  function mount(options) {
    options = options || {};
    var doc = options.document || document;
    var store = options.store || (root.LfcMarketContextStore && root.LfcMarketContextStore.createStore());
    var svc = options.regimeService || root.LfcMarketRegime;
    var panel = doc.getElementById('marketContextPanel');
    if (!panel || !store || !svc) return null;
    if (panel.__lfcContextApi) return panel.__lfcContextApi;

    var el = {
      symbol: doc.getElementById('mcSymbol'),
      oiUnderlying: doc.getElementById('mcOiUnderlying'),
      regime: doc.getElementById('mcRegimeValue'),
      freshness: doc.getElementById('mcRegimeFreshness'),
      updated: doc.getElementById('mcRegimeUpdated'),
      source: doc.getElementById('mcRegimeSource'),
      fii: doc.getElementById('mcFiiNet'),
      dii: doc.getElementById('mcDiiNet'),
      trend: doc.getElementById('mcIndexTrend'),
      breadth: doc.getElementById('mcBreadth'),
      volatility: doc.getElementById('mcVolatility'),
      effect: doc.getElementById('mcEffect'),
      risk: doc.getElementById('mcRiskMultiplier'),
      confirmations: doc.getElementById('mcConfirmations'),
      bulkBody: doc.getElementById('mcBulkBody'),
      bulkEmpty: doc.getElementById('mcBulkEmpty'),
      bulkMeta: doc.getElementById('mcBulkMeta'),
      oiBody: doc.getElementById('mcOiBody'),
      oiEmpty: doc.getElementById('mcOiEmpty'),
      oiMeta: doc.getElementById('mcOiMeta')
    };
    var symbol = options.symbol || null;

    function render() {
      var regime = store.latest('MARKET_REGIME');
      var bulkFilter = symbol ? { subject: symbol } : null;
      var oiFilter = symbol ? { subject: symbol } : null;
      var bulk = store.list('BULK_DEAL', bulkFilter).slice(-10).reverse();
      var oi = store.list('OPTIONS_OI', oiFilter);
      var decision = svc.decide(regime, { normalConfirmations: 1 });

      text(el.symbol, symbol || '—');
      text(el.oiUnderlying, symbol || (oi[0] && oi[0].underlying) || '—');
      if (regime) {
        text(el.regime, regime.regime);
        text(el.freshness, regime.freshness || 'UNAVAILABLE');
        text(el.updated, fmtDate(regime.asOf));
        text(el.source, regime.provider);
        text(el.fii, fmtNum(regime.fiiNet));
        text(el.dii, fmtNum(regime.diiNet));
        text(el.trend, regime.indexTrend || '—');
        text(el.breadth, fmtNum(regime.breadth));
        text(el.volatility, fmtNum(regime.volatility));
      } else {
        ['regime', 'freshness', 'updated', 'source', 'fii', 'dii', 'trend', 'breadth', 'volatility'].forEach(function (k) {
          text(el[k], '—');
        });
        if (el.regime) el.regime.textContent = 'UNAVAILABLE';
        if (el.freshness) el.freshness.textContent = 'UNAVAILABLE';
      }
      text(el.effect, decision.reason);
      text(el.risk, decision.riskMultiplier + '×');
      text(el.confirmations, String(decision.requiredConfirmations));

      if (el.bulkBody) {
        el.bulkBody.replaceChildren();
        bulk.forEach(function (r) {
          var source = document.createElement('a');
          if (/^https?:\/\//i.test(r.sourceUrl || '')) {
            source.href = r.sourceUrl;
            source.target = '_blank';
            source.rel = 'noopener noreferrer';
            source.textContent = 'Source';
          } else {
            source.textContent = '—';
          }
          el.bulkBody.appendChild(row([
            fmtDate(r.asOf),
            fmtNum(r.quantity, true),
            '₹' + fmtNum(r.price),
            r.buyer || 'Buyer unavailable',
            r.seller || 'Seller unavailable',
            r.dealType,
            source,
            root.LfcMarketContextStore.classifyFreshness(r.asOf, 'BULK_DEAL')
          ]));
        });
        if (el.bulkEmpty) el.bulkEmpty.hidden = bulk.length > 0;
        text(el.bulkMeta, bulk.length ? bulk.length + ' record(s) · context only' : '');
      }

      if (el.oiBody) {
        el.oiBody.replaceChildren();
        oi.forEach(function (r) {
          el.oiBody.appendChild(row([
            fmtExpiry(r.expiry),
            fmtNum(r.strike),
            r.optionType,
            fmtNum(r.openInterest, true),
            fmtNum(r.openInterestChange, true),
            fmtNum(r.volume, true),
            fmtNum(r.impliedVolatility),
            fmtNum(r.lastTradedPrice)
          ]));
        });
        if (el.oiEmpty) el.oiEmpty.hidden = oi.length > 0;
        text(el.oiMeta, oi.length ? 'Expiry and source as provided · context only' : '');
      }
    }

    var unsubscribe = store.subscribe(null, render);
    render();
    var api = {
      render: render,
      setSymbol: function (next) {
        symbol = next ? String(next).toUpperCase() : null;
        render();
      },
      destroy: function () {
        unsubscribe();
        delete panel.__lfcContextApi;
      }
    };
    panel.__lfcContextApi = api;
    return api;
  }

  var api = { mount: mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LfcMarketContextUI = api;
})(typeof window !== 'undefined' ? window : globalThis);
