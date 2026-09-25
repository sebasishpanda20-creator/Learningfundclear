/*!
 * LearningFundClear - demand-zone scanner logic (EOD)
 * ====================================================
 * Independent pivot-based demand/supply-zone approximation, ported line-for-line
 * from the Python/streamlit reference the owner supplied: a confirmed pivot low
 * (lowest low of pivot_left+pivot_right+1 bars) creates a demand zone spanning
 * [candle low, candle body top]; a confirmed pivot high creates a supply zone
 * spanning [candle body bottom, candle high]. A zone dies the day price CLOSES
 * through it. Trend = EMA 10/20/50 stack. Pure functions: no DOM, no network.
 * scanner.html fetches the EOD bars and renders the results.
 */
(function (global) {
  "use strict";

  /** Exponential moving average over a numeric array (seeded with the first value). */
  function ema(values, span) {
    var k = 2 / (span + 1);
    var out = new Array(values.length);
    var prev = 0;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      prev = i === 0 ? v : v * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function arrayMin(a) { var m = a[0]; for (var i = 1; i < a.length; i++) if (a[i] < m) m = a[i]; return m; }
  function arrayMax(a) { var m = a[0]; for (var i = 1; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }

  /**
   * bars: [{date:"YYYY-MM-DD", open, high, low, close, volume}, ...] oldest first,
   * already cleaned of null rows. Mirrors calculate_zones() from the reference.
   * opts: { pivotLeft, pivotRight, maxZones }
   */
  function computeZones(bars, opts) {
    opts = opts || {};
    var pivotLeft = opts.pivotLeft || 3;
    var pivotRight = opts.pivotRight || 3;
    var maxZones = opts.maxZones || 20;

    if (!bars || bars.length < 100) return null;

    var closes = bars.map(function (b) { return b.close; });
    var lows = bars.map(function (b) { return b.low; });
    var highs = bars.map(function (b) { return b.high; });
    var ema10 = ema(closes, 10);
    var ema20 = ema(closes, 20);
    var ema50 = ema(closes, 50);

    var demand = [];   // newest first, like the reference's insert(0, ...)
    var supply = [];

    for (var i = 0; i < bars.length; i++) {
      // A pivot becomes confirmed only after pivot_right candles have closed.
      var pivotIndex = i - pivotRight;
      if (pivotIndex >= pivotLeft) {
        var start = pivotIndex - pivotLeft;
        var end = pivotIndex + pivotRight + 1;
        var candle = bars[pivotIndex];

        if (lows[pivotIndex] === arrayMin(lows.slice(start, end))) {
          demand.unshift({
            top: Math.max(candle.open, candle.close),
            bottom: candle.low,
            created: bars[i].date,
            pivotIndex: pivotIndex
          });
        }
        if (highs[pivotIndex] === arrayMax(highs.slice(start, end))) {
          supply.unshift({
            top: candle.high,
            bottom: Math.min(candle.open, candle.close),
            created: bars[i].date,
            pivotIndex: pivotIndex
          });
        }
      }

      // Remove zones the latest close has invalidated.
      var c = closes[i];
      demand = demand.filter(function (z) { return c >= z.bottom; });
      supply = supply.filter(function (z) { return c <= z.top; });
      if (demand.length > maxZones) demand.length = maxZones;
      if (supply.length > maxZones) supply.length = maxZones;
    }

    var last = bars[bars.length - 1];
    var close = last.close, high = last.high, low = last.low;

    var insideDemand = demand.some(function (z) { return z.bottom <= close && close <= z.top; });
    var touchingDemand = demand.some(function (z) { return low <= z.top && high >= z.bottom; });
    var insideSupply = supply.some(function (z) { return z.bottom <= close && close <= z.top; });

    var n = closes.length - 1;
    var bullish = ema10[n] > ema20[n] && ema20[n] > ema50[n];
    var bearish = ema10[n] < ema20[n] && ema20[n] < ema50[n];
    var trend = bullish ? "UPTREND" : (bearish ? "DOWNTREND" : "SIDEWAYS");

    var latest = demand[0] || null;

    // 20-day average volume (extra column; the reference suggested it as a filter).
    var avgVol = null;
    if (bars.length >= 20) {
      var vols = bars.slice(-20).map(function (b) { return b.volume || 0; });
      avgVol = vols.reduce(function (a, b) { return a + b; }, 0) / vols.length;
    }

    return {
      price: close,
      trend: trend,
      ema10: ema10, ema20: ema20, ema50: ema50,
      insideDemand: insideDemand,
      touchingDemand: touchingDemand,
      insideSupply: insideSupply,
      demandZones: demand,
      supplyZones: supply,
      demandTop: latest ? latest.top : null,
      demandBottom: latest ? latest.bottom : null,
      zoneCreated: latest ? latest.created : null,
      avgVol20: avgVol,
      lastVol: last.volume
    };
  }

  /** Row-inclusion rule, mirroring the reference's scan loop exactly. */
  function includeRow(result, opts) {
    var include = result.insideDemand;
    if (opts.showTouching) include = include || result.touchingDemand;
    if (opts.trendFilter) include = include && result.trend === "UPTREND";
    return include;
  }

  global.LfcScanner = {
    computeZones: computeZones,
    includeRow: includeRow,
    ema: ema
  };
})(window);
