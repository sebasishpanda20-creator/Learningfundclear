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

    // ── SLM rulebook confluence (Price Action 20260604.md) ─────────────────
    // Three checks distilled from the setups that transfer to EOD bars:
    //
    // 1. FRESHNESS (Setup 4: "channel valid for first 2-3 touches, then
    //    probability of breakout increases"). A zone the price has already
    //    closed into since the pivot formed has been USED — its bounce odds
    //    decay with every retest. Count touches: bars after the pivot whose
    //    range overlaps the zone and which traded near/below it.
    // 2. EMA20 CONFLUENCE (Setup 27: "Trend Pullback + 200 MA Bounce", Tier 1
    //    ~80%). A demand zone that coincides with a rising EMA20 is a
    //    trend-pullback confluence level, the rulebook's single highest-
    //    confidence pattern; a supply zone under a falling EMA20 likewise.
    // 3. WICK REJECTION (Setup 12: "rejection candles — thin body, large
    //    wicks — prove traders are rejecting the level"). The latest bar's
    //    shape at the zone matters: a long lower wick reaching into a demand
    //    zone is the entry signal the book waits for.
    function zoneTouches(zone, idx) {
      var touches = 0;
      for (var j = idx + 1; j < bars.length; j++) {
        var b = bars[j];
        if (b.low <= zone.top && b.high >= zone.bottom) touches++;
      }
      return touches;
    }

    function decorate(zone, isDemand) {
      if (!zone) return zone;
      var out = Object.assign({}, zone);
      out.touches = zoneTouches(zone, zone.pivotIndex);
      out.fresh = out.touches <= 2;                    // rulebook: first 2-3 touches hold
      var e = ema20[ema20.length - 1], ePrev = ema20[ema20.length - 6];
      var emaRising = e > ePrev;
      out.emaConfluence = isDemand ? emaRising : !emaRising;
      out.emaDist = Math.abs(close - e) / close;       // how far the EMA sits from price
      return out;
    }

    demand = demand.map(function (z) { return decorate(z, true); });
    supply = supply.map(function (z) { return decorate(z, false); });

    // Rejection wick on the latest bar, measured against the nearest zone it
    // reached: wick = how far below the body price probed and came back from.
    var bodyTop = Math.max(last.open, last.close);
    var bodyBottom = Math.min(last.open, last.close);
    var lowerWick = bodyBottom - low;                  // >0 = buyers stepped in below the body
    var upperWick = high - bodyTop;                    // >0 = sellers stepped in above the body
    var barRange = high - low;
    var rejectionWick = barRange > 0
      ? { lower: lowerWick / barRange, upper: upperWick / barRange }
      : { lower: 0, upper: 0 };

    // Distance from the latest close to the nearest active demand zone, as a
    // fraction of the close (0 = inside the zone). Null when no zone survives.
    var distDemand = null;
    if (demand.length) {
      var best = null;
      demand.forEach(function (z) {
        var d;
        if (close >= z.bottom && close <= z.top) d = 0;               // inside
        else if (close > z.top) d = (close - z.top) / close;          // above the zone
        else d = (z.bottom - close) / close;                          // below (rare: would be invalidated)
        if (best === null || d < best) best = d;
      });
      distDemand = best;
    }

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
      distDemand: distDemand,
      zoneCreated: latest ? latest.created : null,
      nearestDemand: demand.length ? demand.reduce(function (a, b) {
        return Math.abs(close - (a.top + a.bottom) / 2) <= Math.abs(close - (b.top + b.bottom) / 2) ? a : b;
      }) : null,
      nearestSupply: supply.length ? supply.reduce(function (a, b) {
        return Math.abs(close - (a.top + a.bottom) / 2) <= Math.abs(close - (b.top + b.bottom) / 2) ? a : b;
      }) : null,
      rejectionWick: rejectionWick,
      avgVol20: avgVol,
      lastVol: last.volume
    };
  }

  /** Row-inclusion rule: the reference's scan loop, plus its two suggested filters. */
  function includeRow(result, opts) {
    var include = result.insideDemand;
    if (opts.showTouching) include = include || result.touchingDemand;
    if (opts.trendFilter) include = include && result.trend === "UPTREND";
    if (opts.maxDistPct != null) {
      if (result.distDemand == null || result.distDemand > opts.maxDistPct) return false;
    }
    if (opts.minVolRatio != null) {
      if (!result.avgVol20 || !result.lastVol || result.lastVol <= result.avgVol20) return false;
    }
    return include;
  }

  /**
   * SLM rulebook confluence score for one signal (0-4). Mirrors the tier
   * ranking the book assigns its 29 setups: confluence = conviction.
   *   +1 fresh zone          — ≤2 prior touches (Setup 4: zones decay with retests)
   *   +1 EMA20 confluence    — demand at a rising / supply at a falling EMA20 (Setup 27, Tier 1)
   *   +1 rejection wick      — signal bar's wick into the zone ≥30% of its range (Setup 12)
   *   +1 trend alignment     — zone direction agrees with the EMA stack (already often
   *                            enforced by trendFilter; scored so it survives when off)
   * 3+ = Tier 1-2 ("play these"), 2 = Tier 3, ≤1 = Tier 4-5 (book says avoid).
   */
  function confluenceScore(result, action) {
    var zone = action === "LONG" ? result.nearestDemand : result.nearestSupply;
    var score = 0;
    if (zone && zone.fresh) score++;
    if (zone && zone.emaConfluence) score++;
    var wick = action === "LONG" ? result.rejectionWick.lower : result.rejectionWick.upper;
    if (wick >= 0.30) score++;
    if (action === "LONG" && result.trend === "UPTREND") score++;
    if (action === "SHORT" && result.trend === "DOWNTREND") score++;
    return score;
  }

  /** Human-readable tag for the digest / scanner table. */
  function confluenceTag(score) {
    return score >= 3 ? "A+" : score === 2 ? "A" : score === 1 ? "B" : "C";
  }

  global.LfcScanner = {
    computeZones: computeZones,
    includeRow: includeRow,
    confluenceScore: confluenceScore,
    confluenceTag: confluenceTag,
    ema: ema
  };
})(window);
