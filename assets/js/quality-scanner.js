/* Deterministic completed-candle research rules. Scores are not probabilities. */
(function (root) {
  "use strict";
  const seconds = { "15m": 900, "1h": 3600, "1d": 86400, "1wk": 604800 };
  const ema = (bars, n) =>
    bars.reduce(
      (v, b, i) => (i ? v + ((b.close - v) * 2) / (n + 1) : b.close),
      0,
    );
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  function validate(feed, interval, market, now) {
    const bars = feed?.bars,
      p = seconds[interval];
    if (!p || !Array.isArray(bars) || bars.length < 100)
      return "At least 100 completed candles required on both timeframes";
    if (feed.stale || feed.gaps || feed.discarded)
      return "Source reports stale, missing or invalid candles";
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i],
        prior = bars[i - 1];
      if (
        !["timestamp", "open", "high", "low", "close", "volume"].every((k) =>
          Number.isFinite(b[k]),
        ) ||
        b.timestamp <= 0 ||
        b.low <= 0 ||
        b.volume < 0 ||
        b.low > Math.min(b.open, b.close) ||
        b.high < Math.max(b.open, b.close, b.low)
      )
        return "Invalid OHLCV history";
      if (prior) {
        const gap = b.timestamp - prior.timestamp;
        if (gap <= 0) return "Duplicate or unordered candles";
        if (market === "crypto" && gap !== p)
          return "Crypto history has missing candles";
        if (
          market === "stocks" &&
          p < 86400 &&
          new Date((b.timestamp + 19800) * 1000).toISOString().slice(0, 10) ===
            new Date((prior.timestamp + 19800) * 1000)
              .toISOString()
              .slice(0, 10) &&
          gap !== p
        )
          return "Stock history has intraday gaps";
      }
      const end =
        market === "stocks" && interval === "1d"
          ? root.LfcMarketData.endTime(b.timestamp, interval, "TEST.NS", {})
          : b.timestamp + p;
      if (end * 1000 > now)
        return "History contains an unfinished or future candle";
    }
    const last = bars.at(-1),
      age = now / 1000 - last.timestamp;
    const maxAge =
      market === "crypto"
        ? p * 2 + 60
        : p < 86400
          ? p * 2 + 120
          : interval === "1wk"
            ? 14 * 86400
            : 4 * 86400;
    if (age > maxAge) return "Latest completed candle is too old";
    return null;
  }
  function analyze(
    {
      feed,
      higher,
      interval,
      higherInterval,
      market,
      mode,
      costBps = 30,
      minTurnover = 0,
      minRvol = 1.2,
      minRR = 2,
    },
    now = Date.now(),
  ) {
    const waiting = (reason) => ({
      signal: "Wait",
      reason,
      score: 0,
      entry: null,
      stop: null,
      target: null,
    });
    if (
      !["stocks", "crypto"].includes(market) ||
      !["intraday", "swing"].includes(mode) ||
      ![costBps, minTurnover, minRvol, minRR].every(Number.isFinite) ||
      costBps < 0 ||
      minTurnover < 0 ||
      minRvol < 1 ||
      minRR < 1
    )
      return waiting("Invalid scanner settings");
    const error =
      validate(feed, interval, market, now) ||
      validate(higher, higherInterval, market, now);
    if (error) return waiting(error);
    if (market === "stocks" && mode === "intraday") {
      const d = new Date(now + 19800000),
        m = d.getUTCHours() * 60 + d.getUTCMinutes();
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || m < 555 || m >= 930)
        return waiting("Outside regular Indian equity hours");
    }
    const bars = feed.bars,
      last = bars.at(-1),
      prior = bars.slice(-21, -1),
      fast = ema(bars, 20),
      slow = ema(bars, 50),
      hf = ema(higher.bars, 20),
      hs = ema(higher.bars, 50),
      hl = higher.bars.at(-1).close;
    const direction =
      last.close > fast && fast > slow && hl > hf && hf > hs
        ? 1
        : last.close < fast && fast < slow && hl < hf && hf < hs
          ? -1
          : 0;
    if (!direction)
      return waiting(
        "Entry and higher-timeframe EMA20/EMA50 trends do not agree",
      );
    const av = mean(prior.map((b) => b.volume)),
      rvol = av > 0 ? last.volume / av : 0,
      turnover = mean(prior.map((b) => b.close * b.volume));
    if (rvol < minRvol)
      return waiting(
        "Relative volume below " + minRvol.toFixed(1) + "× prior 20 candles",
      );
    if (turnover < minTurnover)
      return waiting("Average turnover below your minimum");
    const atr = mean(
      bars.slice(-14).map((b, i) => {
        const p = bars[bars.length - 15 + i];
        return Math.max(
          b.high - b.low,
          Math.abs(b.high - p.close),
          Math.abs(b.low - p.close),
        );
      }),
    );
    if (!(atr > 0)) return waiting("No usable price movement");
    const top = Math.max(...prior.map((b) => b.high)),
      bottom = Math.min(...prior.map((b) => b.low));
    const breakout = direction === 1 ? last.close > top : last.close < bottom;
    const priorEma = ema(bars.slice(0, -1), 20);
    const pullback =
      direction === 1
        ? last.low <= priorEma &&
          last.close > priorEma &&
          last.close > last.open
        : last.high >= priorEma &&
          last.close < priorEma &&
          last.close < last.open;
    if (!breakout && !pullback)
      return waiting(
        "No completed 20-candle breakout or EMA20 pullback confirmation",
      );
    if (Math.abs(last.close - fast) > 2.5 * atr)
      return waiting("Price extended more than 2.5 ATR from EMA20");
    const entry = last.close,
      stop =
        direction === 1
          ? Math.min(last.low, entry - atr)
          : Math.max(last.high, entry + atr),
      risk = Math.abs(entry - stop);
    let target = entry + direction * 3 * risk;
    if (!breakout) {
      target =
        direction === 1 ? Math.min(target, top) : Math.max(target, bottom);
    }
    const cost = (entry * costBps) / 10000,
      netRR = (direction * (target - entry) - cost) / (risk + cost);
    if (stop <= 0 || target <= 0 || netRR < minRR)
      return waiting(
        "Insufficient room for " +
          minRR.toFixed(1) +
          "× reward/risk after estimated costs",
      );
    const parts = {
      trend: 30,
      confirmation: 25,
      volume: Math.min(20, Math.round(rvol * 10)),
      rewardRisk: Math.min(25, Math.round(netRR * 8)),
    };
    return {
      signal: direction === 1 ? "Buy setup" : "Bearish / avoid",
      reason:
        (breakout ? "20-candle breakout" : "EMA20 pullback") +
        " · trends agree · completed candles",
      score: Object.values(parts).reduce((a, b) => a + b, 0),
      parts,
      entry,
      stop,
      target,
      netRR,
      rvol,
      turnover,
      costBps,
      candleAt: last.timestamp * 1000,
      higherAt: higher.bars.at(-1).timestamp * 1000,
      direction,
    };
  }
  root.LfcQualityScanner = { analyze, validate, ema };
})(typeof window !== "undefined" ? window : globalThis);
