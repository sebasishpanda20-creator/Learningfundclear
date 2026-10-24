(async function () {
  "use strict";
  if (!(await LfcAuth.ready)) return;
  const $ = (id) => document.getElementById(id),
    Q = LfcQualityScanner;
  const defaults = {
    stocks:
      "RELIANCE.NS,HDFCBANK.NS,ICICIBANK.NS,INFY.NS,TCS.NS,LT.NS,SBIN.NS,ITC.NS,BHARTIARTL.NS,TATAMOTORS.NS",
    crypto:
      "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,DOTUSDT,LTCUSDT,BCHUSDT,NEARUSDT,ATOMUSDT,UNIUSDT,AAVEUSDT,TRXUSDT,ETCUSDT,FILUSDT,APTUSDT",
  };
  let generation = 0,
    results = [],
    imported = new Map(),
    controllers = new Set(),
    busy = false;
  const cache = new Map(),
    fmt = (n) =>
      Number.isFinite(n)
        ? n.toLocaleString("en-IN", { maximumFractionDigits: 4 })
        : "—";
  const stamp = (t) =>
    new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST";
  function settings() {
    const market = $("qsMarket").value,
      mode = $("qsMode").value;
    return {
      market,
      mode,
      interval: mode === "intraday" ? "15m" : market === "stocks" ? "1d" : "1h",
      higherInterval:
        mode === "intraday"
          ? market === "stocks"
            ? "1d"
            : "1h"
          : market === "stocks"
            ? "1wk"
            : "1d",
      costBps: Number($("qsCosts").value),
      minTurnover: Number($("qsTurnover").value),
      minRvol: Number($("qsRvol").value),
      minRR: Number($("qsRR").value),
    };
  }
  function stop() {
    generation++;
    for (const c of controllers) c.abort();
    controllers.clear();
    busy = false;
    $("qsRun").disabled = false;
    $("qsCancel").disabled = true;
  }
  function clear() {
    stop();
    results = [];
    render();
    $("qsStatus").textContent = "Settings changed. Run a new scan.";
  }
  function coverage(reset = false) {
    const market = $("qsMarket").value,
      mode = $("qsMode").value;
    if (reset) $("qsWatch").value = defaults[market];
    $("qsSource").options[1].disabled =
      market === "crypto" || mode === "intraday";
    if ($("qsSource").selectedOptions[0].disabled)
      $("qsSource").value = "public";
    $("qsFile").disabled = market !== "stocks" || mode !== "swing";
    const s = settings();
    $("qsCoverage").textContent =
      (market === "stocks"
        ? "Yahoo historical data · may be delayed or unavailable."
        : "Binance public spot data · 20 default pairs; custom USDT pairs supported.") +
      " Entry " +
      s.interval +
      " · higher trend " +
      s.higherInterval +
      ".";
  }
  async function get(url, headers = {}) {
    const c = new AbortController();
    controllers.add(c);
    const timer = setTimeout(() => c.abort(), 40000);
    try {
      const r = await fetch(url, {
        headers,
        signal: c.signal,
        credentials: "omit",
        cache: "no-store",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Source HTTP " + r.status);
      return data;
    } finally {
      clearTimeout(timer);
      controllers.delete(c);
    }
  }
  function weekly(bars) {
    const grouped = new Map();
    for (const b of bars) {
      const d = new Date((b.timestamp + 19800) * 1000);
      const monday =
        Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate() - ((d.getUTCDay() + 6) % 7),
        ) /
          1000 -
        19800;
      let row = grouped.get(monday);
      if (!row) {
        row = { ...b, timestamp: monday };
        grouped.set(monday, row);
      } else {
        row.high = Math.max(row.high, b.high);
        row.low = Math.min(row.low, b.low);
        row.close = b.close;
        row.volume += b.volume;
      }
    }
    return [...grouped.values()].filter(
      (b) => (b.timestamp + 7 * 86400) * 1000 <= Date.now(),
    );
  }
  async function history(symbol, interval, s, id) {
    if ($("qsSource").value === "csv") {
      const f = LfcCsvHistory.history(imported, symbol, "1d");
      if (interval === "1wk") return { ...f, bars: weekly(f.bars) };
      return f;
    }
    const key = [s.market, symbol, interval].join("|"),
      hit = cache.get(key);
    if (hit && Date.now() - hit.at < 60000) return hit.feed;
    let feed;
    if (s.market === "stocks") {
      const {
        data: { session },
      } = await LfcAuth.client.auth.getSession();
      if (!session) throw new Error("Sign in again to scan stocks");
      const response = await get(
        new URL(
          "api/stock-history?symbol=" +
            encodeURIComponent(symbol) +
            "&interval=" +
            interval,
          LfcAuth.base,
        ),
        { Authorization: "Bearer " + session.access_token },
      );
      const data = response.chart;
      const meta = data.chart?.result?.[0]?.meta;
      if (meta?.symbol?.toUpperCase() !== symbol)
        throw new Error("Source returned a different symbol");
      feed = LfcMarketData.parseYahoo(data, symbol, interval);
    } else {
      const raw = await get(
        "https://data-api.binance.vision/api/v3/klines?symbol=" +
          encodeURIComponent(symbol) +
          "&interval=" +
          interval +
          "&limit=201",
      );
      if (!Array.isArray(raw)) throw new Error("No exchange candles");
      const p = { "15m": 900, "1h": 3600, "1d": 86400 }[interval];
      feed = {
        bars: raw
          .map((r) => ({
            timestamp: Number(r[0]) / 1000,
            open: Number(r[1]),
            high: Number(r[2]),
            low: Number(r[3]),
            close: Number(r[4]),
            volume: r[5] == null || r[5] === "" ? NaN : Number(r[5]),
          }))
          .filter((b) => (b.timestamp + p) * 1000 <= Date.now()),
        stale: false,
        gaps: 0,
        discarded: 0,
      };
    }
    if (id === generation) cache.set(key, { feed, at: Date.now() });
    return feed;
  }
  function render() {
    const sorted = results
      .map((r) => ({ ...r, result: r.args ? Q.analyze(r.args) : r.result }))
      .sort(
        (a, b) =>
          b.result.score - a.result.score || a.symbol.localeCompare(b.symbol),
      );
    const qualified = sorted.filter((r) => r.result.signal !== "Wait");
    $("qsSummary").textContent =
      sorted.length +
      " scanned · " +
      qualified.length +
      " qualified · " +
      (sorted.length - qualified.length) +
      " waiting";
    $("qsExport").disabled = !sorted.length;
    const shown = $("qsOnly").checked ? qualified : sorted;
    $("qsResults").replaceChildren();
    for (const { symbol, result: r, args } of shown) {
      const card = document.createElement("article");
      card.className = "qs-result";
      const add = (tag, text) => {
        const e = document.createElement(tag);
        e.textContent = text;
        card.append(e);
        return e;
      };
      add("h3", symbol + " · " + r.signal);
      add("p", r.reason);
      if (r.signal !== "Wait") {
        add("strong", "Score " + r.score + "/100 · net R/R " + fmt(r.netRR));
        add(
          "p",
          "Entry " +
            fmt(r.entry) +
            " · Stop " +
            fmt(r.stop) +
            " · Target " +
            fmt(r.target),
        );
        add(
          "small",
          "Units: " +
            (args.market === "stocks" ? "INR" : "USDT") +
            " · RVOL " +
            fmt(r.rvol) +
            "× · mean turnover " +
            fmt(r.turnover),
        );
        add(
          "small",
          "Score components: trend " +
            r.parts.trend +
            ", confirmation " +
            r.parts.confirmation +
            ", volume " +
            r.parts.volume +
            ", reward/risk " +
            r.parts.rewardRisk,
        );
        add(
          "small",
          "Entry candle opened " +
            stamp(r.candleAt) +
            " · Higher candle " +
            stamp(r.higherAt),
        );
      }
      add(
        "small",
        "Research snapshot · " +
          (args?.market === "stocks" ? "stock history" : "crypto spot history"),
      );
      $("qsResults").append(card);
    }
    if (!shown.length) {
      const p = document.createElement("p");
      p.textContent = sorted.length
        ? "No setups pass the current filters. See waiting results for reasons."
        : "Run a scan to see results.";
      $("qsResults").append(p);
    }
  }
  async function run() {
    if (busy) return;
    clear();
    const s = settings(),
      id = generation;
    const symbols = [
      ...new Set(
        $("qsWatch")
          .value.toUpperCase()
          .split(/[\s,;]+/)
          .filter(Boolean),
      ),
    ];
    const valid =
      s.market === "stocks"
        ? /^[A-Z0-9&._-]+\.(NS|BO)$/
        : /^[A-Z0-9]{2,20}USDT$/;
    if (
      !symbols.length ||
      symbols.length > 30 ||
      symbols.some((x) => !valid.test(x))
    ) {
      $("qsStatus").textContent =
        "Use 1–30 valid symbols for the selected market.";
      return;
    }
    if (
      ["qsRvol", "qsTurnover", "qsCosts", "qsRR"].some(
        (id) => !$(id).value.trim() || !$(id).checkValidity(),
      )
    ) {
      $("qsStatus").textContent =
        "Enter valid volume, turnover, costs and reward/risk settings.";
      return;
    }
    if ($("qsSource").value === "csv" && !imported.size) {
      $("qsStatus").textContent = "Import a daily stock CSV first.";
      return;
    }
    busy = true;
    $("qsRun").disabled = true;
    $("qsCancel").disabled = false;
    let cursor = 0;
    async function worker() {
      while (cursor < symbols.length && id === generation) {
        const symbol = symbols[cursor++];
        try {
          const feed = await history(symbol, s.interval, s, id);
          if (id !== generation) return;
          const higher = await history(symbol, s.higherInterval, s, id);
          if (id !== generation) return;
          const args = { ...s, feed, higher };
          results.push({ symbol, args });
        } catch (e) {
          if (id !== generation) return;
          results.push({
            symbol,
            result: {
              signal: "Wait",
              reason:
                "History unavailable: " +
                (e.name === "AbortError" ? "request timed out" : e.message),
              score: 0,
            },
          });
        }
        render();
        $("qsStatus").textContent =
          "Scanned " + results.length + " of " + symbols.length + "…";
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(3, symbols.length) }, worker),
    );
    if (id !== generation) return;
    busy = false;
    $("qsRun").disabled = false;
    $("qsCancel").disabled = true;
    $("qsStatus").textContent =
      "Scan completed " +
      stamp(Date.now()) +
      ". Snapshot checks refresh every 30 seconds; use Scan to fetch new data. Responses cached for at most 60 seconds.";
  }
  $("qsRun").onclick = run;
  $("qsCancel").onclick = () => {
    stop();
    $("qsStatus").textContent = "Scan cancelled. Partial results shown.";
  };
  $("qsOnly").onchange = render;
  for (const id of [
    "qsMarket",
    "qsMode",
    "qsSource",
    "qsWatch",
    "qsRvol",
    "qsTurnover",
    "qsCosts",
    "qsRR",
  ])
    $(id).addEventListener("input", () => {
      clear();
      if (id === "qsMarket") {
        $("qsTurnover").value =
          $("qsMarket").value === "stocks" ? "10000000" : "1000000";
      }
      coverage(id === "qsMarket");
    });
  $("qsFile").onchange = async () => {
    clear();
    const id = generation;
    imported = new Map();
    const file = $("qsFile").files[0];
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("File must be smaller than 10 MB");
      const data = LfcCsvHistory.parse(await file.text());
      if (id !== generation) return;
      imported = data;
      $("qsSource").value = "csv";
      $("qsWatch").value = [...data.keys()].slice(0, 30).join(",");
      $("qsStatus").textContent =
        "Imported " +
        data.size +
        " symbols. First 30 selected; run the Swing scan.";
    } catch (e) {
      $("qsStatus").textContent = "Import rejected: " + e.message;
    }
  };
  $("qsExport").onclick = () => {
    const data = {
      generatedAt: new Date().toISOString(),
      settings: settings(),
      results: results.map((r) => ({
        symbol: r.symbol,
        ...(r.args ? Q.analyze(r.args) : r.result),
      })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "scanner-results.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const timer = setInterval(() => {
    if (results.length) render();
  }, 30000);
  window.addEventListener("pagehide", () => {
    stop();
    clearInterval(timer);
  });
  coverage(true);
  render();
})();
