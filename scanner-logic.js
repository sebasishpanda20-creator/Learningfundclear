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

    // ── SMC rulebook concepts (SMC_Trading_Rulebook.md) ────────────────────
    //
    // 1. MARKET STRUCTURE / BoS-CHoCH (book §1-2): swing highs/lows from the
    //    same pivots that build our zones. A BODY CLOSE beyond the last swing
    //    in the trend direction = BoS (continuation, book: "not a reversal");
    //    a body close beyond it AGAINST the trend = CHoCH (character change).
    //    Wick-only breaks are explicitly NOT structure ("fake BoS = inducement").
    var swingHigh = null, swingLow = null;             // most recent confirmed pivots
    for (var si = bars.length - 1 - pivotRight; si >= pivotLeft; si--) {
      if (swingHigh === null && highs[si] === arrayMax(highs.slice(si - pivotLeft, si + pivotRight + 1))) swingHigh = bars[si].high;
      if (swingLow === null && lows[si] === arrayMin(lows.slice(si - pivotLeft, si + pivotRight + 1))) swingLow = bars[si].low;
      if (swingHigh !== null && swingLow !== null) break;
    }
    var structureEvent = "NONE";
    if (swingHigh !== null && swingLow !== null) {
      var bodyBreakUp = bodyTop > swingHigh;           // body close above last swing high
      var bodyBreakDown = bodyBottom < swingLow;       // body close below last swing low
      if (bodyBreakUp && bodyBreakDown) structureEvent = "WHIPSAW";
      else if (bodyBreakUp) structureEvent = trend === "UPTREND" ? "BoS" : "CHoCH";
      else if (bodyBreakDown) structureEvent = trend === "DOWNTREND" ? "BoS" : "CHoCH";
    }

    // 2. FVG / IMBALANCE (book §6): three consecutive candles where candle i's
    //    body gaps past candle i-2's body — institutions moved too fast. The    //    most RECENT unmitigated gap (price hasn't closed back through it)    //    is the magnet the book says will be revisited.    var fvg = null;    for (var fi = bars.length - 1; fi >= 2; fi--) {      var c3 = bars[fi], c1 = bars[fi - 2];      var top3 = Math.max(c3.open, c3.close), bot3 = Math.min(c3.open, c3.close);      var top1 = Math.max(c1.open, c1.close), bot1 = Math.min(c1.open, c1.close);      if (bot3 > top1) {                               // bullish gap (price gapped up)        if (close < bot3) { fvg = { bottom: top1, top: bot3, dir: "BULL", date: bars[fi - 1].date }; break; }      } else if (top3 < bot1) {                        // bearish gap        if (close > top3) { fvg = { bottom: top3, top: bot1, dir: "BEAR", date: bars[fi - 1].date }; break; }      }    }
    // 3. PREMIUM / DISCOUNT (book §7.8): where price sits in the recent range.    //    Uptrend → buy in discount; downtrend → sell in premium.    var lookback = bars.slice(-Math.min(bars.length, 60));    var rangeHigh = arrayMax(lookback.map(function (b) { return b.high; }));    var rangeLow = arrayMin(lookback.map(function (b) { return b.low; }));    var rangePos = rangeHigh > rangeLow ? (close - rangeLow) / (rangeHigh - rangeLow) : 0.5;    var rangeZone = rangePos >= 0.7 ? "PREMIUM" : rangePos <= 0.3 ? "DISCOUNT" : "EQUILIBRIUM";
    // 4. EQUAL HIGHS / LOWS (book §7.9): stops pile above/below levels touched    //    twice at nearly the same price — liquidity the book says is a magnet.    var eqTol = close * 0.0015;                        // "same price" = within 0.15%    var eqHighs = 0, eqLows = 0;    for (var ei = 0; ei < bars.length - 1; ei++) {      for (var ej = ei + 1; ej < bars.length; ej++) {        if (Math.abs(bars[ei].high - bars[ej].high) <= eqTol) eqHighs++;        if (Math.abs(bars[ei].low - bars[ej].low) <= eqTol) eqLows++;      }    }

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
      // SMC concepts:
      structureEvent: structureEvent,   // BoS | CHoCH | WHIPSAW | NONE (body-close confirmed)
      swingHigh: swingHigh,
      swingLow: swingLow,
      fvg: fvg,                         // unmitigated 3-candle imbalance or null
      rangeZone: rangeZone,             // PREMIUM | DISCOUNT | EQUILIBRIUM (60-bar range)
      rangePos: rangePos,               // 0 = range low, 1 = range high
      eqHighs: eqHighs,                 // equal-high pairs nearby = buy-side liquidity
      eqLows: eqLows,                   // equal-low pairs = sell-side liquidity
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
   * Confluence score for one signal, 0-6. PA-rulebook points (0-4):
   *   +1 fresh zone (≤2 touches, Setup 4) · +1 EMA20 confluence (Setup 27)
   *   +1 rejection wick ≥30% of bar range (Setup 12) · +1 trend alignment.
   * SMC-rulebook points (book §10.3: "minimum acceptable: 3 confluences"):
   *   +1 structure agree — BoS in the trade's direction, or no opposing CHoCH
   *   +1 FVG confluence — an unmitigated gap sits behind the entry (institutional
   *     footprint) in the trade's direction, or price is in the right half of the
   *     range (LONG from DISCOUNT / SHORT from PREMIUM, book §7.8)
   * 4+ = the book's "ideal"; 3 = minimum acceptable; ≤2 = stand aside.
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
    // SMC: structure — a body-close BoS in our direction, or at least no fresh
    // CHoCH against us. A WHIPSAW (both sides broken) earns nothing.
    if (result.structureEvent === "BoS") score++;
    else if (result.structureEvent !== "CHoCH") score += 0; // NONE/WHIPSAW neutral
    // SMC: location + imbalance. LONG wants a bull FVG overhead-unmitigated below
    // price (dip to fill it) or a discount read; SHORT mirrors it.
    if (action === "LONG") {
      if (result.fvg && result.fvg.dir === "BULL") score++;
      else if (result.rangeZone === "DISCOUNT") score++;
    } else {
      if (result.fvg && result.fvg.dir === "BEAR") score++;
      else if (result.rangeZone === "PREMIUM") score++;
    }
    return score;
  }

  /** Human-readable tag: A+ = the book's "ideal" (4+), C = stand aside. */
  function confluenceTag(score) {
    return score >= 4 ? "A+" : score === 3 ? "A" : score === 2 ? "B" : "C";
  }

  global.LfcScanner = {
    computeZones: computeZones,
    includeRow: includeRow,
    confluenceScore: confluenceScore,
    confluenceTag: confluenceTag,
    ema: ema
  };
})(window);
