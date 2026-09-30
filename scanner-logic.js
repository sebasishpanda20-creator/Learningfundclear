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

  /** Simple moving average over a numeric array (Kell uses SMA on daily). */
  function sma(values, span) {
    var out = new Array(values.length);
    var sum = 0;
    for (var i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= span) sum -= values[i - span];
      out[i] = i >= span - 1 ? sum / span : null;
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
    // 20-day average volume — needed by the Kell volume confirmation below.
    var avgVol = null;
    if (bars.length >= 20) {
      var vols = bars.slice(-21, -1).map(function (b) { return b.volume || 0; });
      avgVol = vols.reduce(function (a, b) { return a + b; }, 0) / vols.length;
    }

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
    // 3. PREMIUM / DISCOUNT (book §7.8): where price sits in the recent range.    //    Uptrend → buy in discount; downtrend → sell in premium.    var lookback = bars.slice(-Math.min(bars.length, 60));    var rangeHigh = arrayMax(lookback.map(function (b) { return b.high; }));    var rangeLow = arrayMin(lookback.map(function (b) { return b.low; }));    var rangePos = rangeHigh > rangeLow ? (close - rangeLow) / (rangeHigh - rangeLow) : 0.5;    var rangeZone = rangePos >= 0.7 ? "PREMIUM" : rangePos <= 0.3 ? "DISCOUNT" : "EQUILIBRIUM";    // 4. EQUAL HIGHS / LOWS (book §7.9): stops pile above/below levels touched
    //    twice at nearly the same price — liquidity the book says is a magnet.
    var eqTol = close * 0.0015;                        // "same price" = within 0.15%
    var eqHighs = 0, eqLows = 0;
    for (var ei = 0; ei < bars.length - 1; ei++) {
      for (var ej = ei + 1; ej < bars.length; ej++) {
        if (Math.abs(bars[ei].high - bars[ej].high) <= eqTol) eqHighs++;
        if (Math.abs(bars[ei].low - bars[ej].low) <= eqTol) eqLows++;
      }
    }

    // ── Time-based rulebook concepts (Time_Price_Action_Rulebook.md) ───────
    // The intraday session-clock models (Judas/Asia/London root candles) don't
    // apply to EOD bars — a daily bar has no 09:53. Three modules DO survive
    // the timeframe change:
    //
    // A. OHLC BIAS (Module 34, Rules 300-305): read the last completed candle's
    //    shape — higher close + big body + no rejection wick = bullish bias for
    //    the next bar; mirrored for bearish; doji = neutral. Also the
    //    institutional hint (Rule 305): one-sided large wick = rejection,
    //    wicks both sides = retail chop, avoid.
    var prev = bars[bars.length - 2];
    var prev2 = bars[bars.length - 3];
    var prevBody = Math.abs(prev.close - prev.open);
    var prevRange = prev.high - prev.low;
    var prevBodyPct = prevRange > 0 ? prevBody / prevRange : 0;
    var prevBull = prev.close > prev.open;
    var prevMid = (prev.high + prev.low) / 2;
    var candleBias = "NEUTRAL";
    if (prevBodyPct >= 0.5 && prevBull && prev.close > prev2.close) candleBias = "BULLISH";
    else if (prevBodyPct >= 0.5 && !prevBull && prev.close < prev2.close) candleBias = "BEARISH";
    var prevLowerWick = Math.min(prev.open, prev.close) - prev.low;
    var prevUpperWick = prev.high - Math.max(prev.open, prev.close);
    var twoSidedWick = prevRange > 0 && prevLowerWick / prevRange >= 0.3 && prevUpperWick / prevRange >= 0.3;

    // B. OTE FIBONACCI ZONE (Module 7, Rule 021): after a structure shift, the
    //    0.62-0.79 retracement band of the last impulse leg is the "optimal
    //    trade entry" — where our demand/supply zones most often coincide.
    var ote = null;
    if (swingHigh !== null && swingLow !== null) {
      var legUp = swingHigh - swingLow;
      var fib = function (level) { return swingHigh - legUp * level; }; // retracement from the high
      if (trend === "UPTREND") {
        ote = { low: fib(0.79), high: fib(0.62), dir: "LONG" };   // deep pullback band
      } else if (trend === "DOWNTREND") {
        var legDown = swingHigh - swingLow;
        ote = { low: swingLow + legDown * 0.62, high: swingLow + legDown * 0.79, dir: "SHORT" };
      }
    }
    var inOte = ote ? (close >= ote.low && close <= ote.high) : false;

    // C. ORDERBLOCKER (Module 5, Rule 013): 3+ consecutive candles with large
    //    bodies and short wicks = institutional runway; its origin is the
    //    opposite-side liquidity target the book sizes entries against.
    var orderblocker = false;
    for (var oi = bars.length - 4; oi < bars.length; oi++) {
      if (oi < 1) continue;
      var b = bars[oi], r = b.high - b.low;
      var body = Math.abs(b.close - b.open);
      if (r > 0 && body / r >= 0.65) { orderblocker = true; break; }
    }

    // ── Oliver Kell layer (Oliver_Kell_Price_Action_Rulebook.md) ───────────
    // Kell trades growth stocks on DAILY bars with EMA 10/20 + SMA 50/200,
    // volume confirmation, and a named cycle of setups. Three of his rules
    // translate to EOD bars directly and are mechanically testable:
    //
    // A. 200/50 SMA TREND FILTER (Rule 03): the long-term magnets. Price above
    //    a rising 200-SMA is his definition of a tradable uptrend.
    var n = closes.length - 1;
    var sma50 = sma(closes, 50);
    var sma200 = sma(closes, 200);
    var s50 = sma50[n], s200 = sma200[n];
    var above200 = s200 != null && close > s200;
    var above50 = s50 != null && close > s50;
    // Slope reference: ideally 20 bars back, but a 200-SMA only exists from bar
    // 199 onward, so on shorter histories fall back to the earliest legal sample
    // rather than silently reporting a flat 200-SMA.
    var s200Ref = null;
    for (var back = 20; back >= 5; back--) {
      if (n - back >= 0 && sma200[n - back] != null) { s200Ref = sma200[n - back]; break; }
    }
    var sma200Rising = s200 != null && s200Ref != null && s200 > s200Ref;

    // B. VOLUME CONFIRMATION (Rule 02): "Bull snorts" — heavy volume marks
    //    institutional participation. Kell wants breakout volume 50%+ above
    //    average; we compare the signal bar to the trailing 20-bar mean.
    var volumeConfirm = !!(avgVol && last.volume && last.volume >= avgVol * 1.5);

    // C. EMA CROSSBACK (Rule 12, his 65%+ setup): price is in an uptrend above
    //    the 10/20 EMA, pulls back to TOUCH that EMA, and closes back above it
    //    (no close below = support held). This is the precise mechanical form
    //    of the loose "EMA20 confluence" idea (which only checked slope).
    var e10 = ema10[n], e20 = ema20[n];
    var touchTol = close * 0.006;                     // "touches" = within 0.6%
    var touchedEma = (Math.abs(low - e10) <= touchTol) || (Math.abs(low - e20) <= touchTol)
      || (low <= Math.max(e10, e20) && close >= Math.min(e10, e20));
    var emaCrossback = !!(close > e10 && close > e20 && touchedEma && trend === "UPTREND");

    // D. BASE N' BREAK (Rule 15, 60-70%): a tight base (<=4% range over the last
    //    15 bars) sitting near the recent high, then a close above the base top
    //    on confirming volume. Kell: "volume drying up during consolidation,
    //    breakout bar closes above base top on volume".
    var baseNBreak = false, baseRange = null, baseTop = null;
    if (bars.length >= 25) {
      var base = bars.slice(-16, -1);                 // 15 completed bars
      baseTop = arrayMax(base.map(function (x) { return x.high; }));
      var baseLow = arrayMin(base.map(function (x) { return x.low; }));
      baseRange = baseTop > 0 ? (baseTop - baseLow) / baseTop : 1;
      var nearHigh = baseTop >= arrayMax(highs.slice(-40)) * 0.97;
      baseNBreak = !!(baseRange <= 0.04 && nearHigh && close > baseTop && volumeConfirm && above50);
    }

    // Distance from the latest close to the nearest active demand zone, as a
    // fraction of the close (0 = inside the zone). Null when no zone survives.
    // ── Time-Price Squaring layer (TimePriceSquaring_Rulebook.md) ──────────
    // The spine of this book is astrological — planetary longitude compared
    // against a price converted to zodiac degrees — and that cannot be computed
    // from OHLC bars (there is no ephemeris in a browser). But five of its
    // modules DO reduce to arithmetic, so they are computed and then MEASURED
    // by tools/research-thin-commodities.js before anything scores them.
    //
    // A. SQUARE OF 9 (Rules 73-78): the spiral grid maps price onto a circle
    //    because one full 360° turn costs +2 on the square root of price —
    //    degree = sqrt(price) × 180 mod 360. Price sits on a 45° harmonic of
    //    that grid when the degree is within a few degrees of a multiple of 45.
    var s9Deg = ((Math.sqrt(close) * 180) % 360 + 360) % 360;
    var s9Off = Math.abs(s9Deg - Math.round(s9Deg / 45) * 45);
    var squareOf9 = s9Off <= 6;                       // within 6° of a harmonic

    // B. C.E. / EIGHTHS (Rules 06-08): the book's first conversion, price × 8
    //    mod 360. Its lattice is every 45° — i.e. every 45/8 = 5.625 price
    //    points — so "at a level" means the degree sits near a multiple of 45.
    var ceDeg = ((close * 8) % 360 + 360) % 360;
    var circleEighths = Math.abs(ceDeg - Math.round(ceDeg / 45) * 45) <= 6;

    // C. GANN 1×1 ANGLE (Rules 24-26): a line of 1 price unit per bar drawn
    //    from the last MAJOR swing extreme. "1 unit" is meaningless for a ₹50
    //    stock and a ₹50,000 one, so the unit here is the 20-bar average range
    //    (the scaling that keeps the angle's meaning constant). Price on the
    //    correct side of that line from the low = uptrend intact.
    var win90len = Math.min(bars.length, 90);
    var win90 = bars.slice(-win90len);
    var majorLow = Infinity, majorHigh = -Infinity, majorLowIdx = -1, majorHighIdx = -1;
    for (var mi = 0; mi < win90.length; mi++) {
      if (win90[mi].low <= majorLow) { majorLow = win90[mi].low; majorLowIdx = bars.length - win90len + mi; }
      if (win90[mi].high >= majorHigh) { majorHigh = win90[mi].high; majorHighIdx = bars.length - win90len + mi; }
    }
    var atr20 = null;
    if (bars.length >= 21) {
      var trs = bars.slice(-21, -1).map(function (x) { return x.high - x.low; });
      atr20 = trs.reduce(function (a, b) { return a + b; }, 0) / trs.length;
    }
    var barsSinceLow = bars.length - 1 - majorLowIdx;
    var barsSinceHigh = bars.length - 1 - majorHighIdx;
    var gann1x1Up = !!(atr20 && barsSinceLow >= 5 && close > majorLow + atr20 * barsSinceLow);
    var gann1x1Down = !!(atr20 && barsSinceHigh >= 5 && close < majorHigh - atr20 * barsSinceHigh);

    // D. TIME SQUARING (Rules 17-18): count bars forward from the major swing
    //    and mark the natural cycle counts the book lists (22 = Mercury 90°,
    //    56 = Venus 90°, plus the 30/45/60/90/120/144/180/270/360 family).
    //    Within ±3 bars of one of them is a "squared time" date.
    var timeSquares = [22, 30, 45, 56, 60, 90, 120, 144, 180, 270, 360];
    function nearTimeSquare(nb) {
      for (var ti = 0; ti < timeSquares.length; ti++) if (Math.abs(nb - timeSquares[ti]) <= 3) return true;
      return false;
    }
    var timeSquareLow = nearTimeSquare(barsSinceLow);
    var timeSquareHigh = nearTimeSquare(barsSinceHigh);

    // E. NARROW-RANGE REVERSAL (Rule 72): a doji-sized bar on above-average
    //    volume, straight after 2-3 bars of new highs, is the book's short
    //    trigger at resistance (mirrored at lows for longs).
    var avgRange20 = null;
    if (bars.length >= 21) {
      var rngs = bars.slice(-21, -1).map(function (x) { return x.high - x.low; });
      avgRange20 = rngs.reduce(function (a, b) { return a + b; }, 0) / rngs.length;
    }
    var smallBar = !!(avgRange20 && barRange > 0 && barRange <= avgRange20 * 0.6);
    var volAbove20 = !!(avgVol && last.volume && last.volume > avgVol);
    var highsFresh = bars.length >= 24 && arrayMax(highs.slice(-4, -1)) >= arrayMax(highs.slice(-24, -4));
    var lowsFresh = bars.length >= 24 && arrayMin(lows.slice(-4, -1)) <= arrayMin(lows.slice(-24, -4));
    var narrowRangeShort = smallBar && volAbove20 && highsFresh;
    var narrowRangeLong = smallBar && volAbove20 && lowsFresh;

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
      // Time-based concepts:
      candleBias: candleBias,           // BULLISH | BEARISH | NEUTRAL (Module 34, last closed bar)
      twoSidedWick: twoSidedWick,       // retail chop warning (Rule 305)
      ote: ote,                         // optimal-trade-entry fib band or null
      inOte: inOte,                     // price currently inside the OTE band
      orderblocker: orderblocker,       // large-body candle in last 4 bars (Module 5)
      // Oliver Kell concepts:
      sma50: s50,
      sma200: s200,
      above200: above200,               // price above the 200-SMA (Rule 03 long-term filter)
      sma200Rising: sma200Rising,
      volumeConfirm: volumeConfirm,     // signal bar >= 1.5x trailing 20-bar volume (Rule 02)
      emaCrossback: emaCrossback,       // pullback touched 10/20 EMA and closed back above (Rule 12)
      baseNBreak: baseNBreak,           // tight base + close above base top on volume (Rule 15)
      baseRange: baseRange,             // base height as a fraction of its top (null if n/a)
      avgVol20: avgVol,
      // Time-Price Squaring layer (TimePriceSquaring_Rulebook.md) — candidates,
      // measured by tools/research-thin-commodities.js; none score yet.
      squareOf9: squareOf9,                 // price within 6° of a Square-of-9 45° harmonic
      s9Deg: s9Deg,
      circleEighths: circleEighths,         // price near the C.E./45° eight-lattice (Rules 06/08)
      gann1x1Up: gann1x1Up,
      gann1x1Down: gann1x1Down,             // right side of an ATR-scaled 1×1 from the major swing
      barsSinceMajorLow: barsSinceLow,
      barsSinceMajorHigh: barsSinceHigh,
      timeSquareLow: timeSquareLow,
      timeSquareHigh: timeSquareHigh,       // major swing sits on a Gann cycle count (Rules 17/18)
      narrowRangeLong: narrowRangeLong,
      narrowRangeShort: narrowRangeShort,   // doji-at-extreme on volume (Rule 72)
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
   * Confluence score, 0-6 — MEASURED, not theorised.
   *
   * Five rulebooks' worth of candidate conditions were scored in one sum until
   * tools/research-thin-commodities.js could bucket real signals by it. On a
   * small first sample (4,245 signals, 60 NIFTY 500 names) the sum was FLAT,
   * so the score was cut back to only the per-component winners. VALIDATED on
   * the full board (30,456 signals, 420 symbols): the buckets now separate
   * monotonically —
   *
   *   conf 0-1  10,697 sig · 36% · +0.08R   (−0.11R vs board)
   *   conf 2    13,702 sig · 40% · +0.19R   (board)
   *   conf 3-4   6,038 sig · 45% · +0.36R   (+0.17R)
   *   conf 5-6      19 sig · 59% · +0.76R   (+0.58R)
   *   board    30,456 sig · 40% · +0.19R
   *
   * Per-component Δ EV on the full board (fires vs does not, direction-aware):
   *   above 200-SMA +0.16R → +2 · CHoCH +0.10R → +2 · EMA crossback +0.13R → +1
   *   base n' break +0.01R (n=6, kept at +1 pending sample)
   *   Everything else measured noise: BoS Δ−0.00 (the earlier −0.24 was sample
   *   noise), FVG +0.03, volume +0.04, fresh zone −0.02, wick −0.00, bias −0.04,
   *   ema20 slope −0.03, discount/premium +0.04.
   *   Time-Price-Squaring layer (fifth rulebook), all NOISE or worse:
   *   Square of 9 Δ−0.00 (n=8,284) · C.E. eighths Δ−0.00 (n=8,321) ·
   *   time squares Δ+0.02 (n=14,116) · Gann 1×1 Δ−0.76 HURT (n=23) ·
   *   narrow-range reversal Δ+0.31 but n=5. The astrology-adjacent modules
   *   earn nothing; none score.
   *
   * Flags stay computed for display and future re-measurement; they just no
   * longer move the score. Re-measure with:
   *   node tools/research-thin-commodities.js <symbols...>
   */
  function confluenceScore(result, action) {
    var score = 0;
    var long = action === "LONG";
    // 200-SMA trend filter (Kell Rule 03) — the strongest measured factor.
    if (long && result.above200 && result.sma200Rising) score += 2;
    if (!long && !result.above200 && !result.sma200Rising) score += 2;
    // A fresh change of character: the measured-best bucket, and the opposite of
    // what the SMC book predicted (it calls BoS the continuation edge).
    if (result.structureEvent === "CHoCH") score += 2;
    // Kell's named pullback setup (Rule 12, "65%+ with volume").
    if (result.emaCrossback) score += 1;
    // Kell's Base n' Break (Rule 15) — fires rarely, kept pending a bigger sample.
    if (result.baseNBreak) score += 1;
    return score;
  }

  /** Human-readable tag over the measured 0-6 scale. */
  function confluenceTag(score) {
    return score >= 5 ? "A+" : score >= 3 ? "A" : score === 2 ? "B" : "C";
  }

  global.LfcScanner = {
    computeZones: computeZones,
    includeRow: includeRow,
    confluenceScore: confluenceScore,
    confluenceTag: confluenceTag,
    ema: ema
  };
})(window);
