/**
 * DOM tests for the market-context panel. The fixture uses the same element ids
 * and scripts as lfc_terminal_v6.html; no provider or network call is involved.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const scripts = [
  "assets/js/market-context-store.js",
  "assets/js/market-regime-service.js",
  "assets/js/market-context-ui.js",
];

const markup = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;font:14px sans-serif;background:#102c3e;color:#e8f1f5}
  .context-grid{display:grid;gap:12px}
  .context-card{border:1px solid #335;border-radius:10px;padding:12px;min-width:0}
  .context-table{overflow-x:auto}
  .context-table table{width:100%;min-width:540px;border-collapse:collapse}
  .context-table th,.context-table td{white-space:nowrap;padding:4px}
  dl{display:grid;grid-template-columns:1fr auto;gap:4px 10px}
  dd{margin:0;text-align:right}
</style></head><body>
<section class="card" id="ctx"><div class="context-grid" id="marketContextPanel">
  <div class="context-card"><p id="mcRegimeValue">x</p>
    <dl><div><dt>Freshness</dt><dd id="mcRegimeFreshness"></dd></div>
    <div><dt>Updated</dt><dd id="mcRegimeUpdated"></dd></div>
    <div><dt>Source</dt><dd id="mcRegimeSource"></dd></div>
    <div><dt>FII net</dt><dd id="mcFiiNet"></dd></div>
    <div><dt>DII net</dt><dd id="mcDiiNet"></dd></div>
    <div><dt>Index trend</dt><dd id="mcIndexTrend"></dd></div>
    <div><dt>Breadth</dt><dd id="mcBreadth"></dd></div>
    <div><dt>Volatility</dt><dd id="mcVolatility"></dd></div></dl>
    <p id="mcEffect"></p><p id="mcRiskMultiplier"></p><p id="mcConfirmations"></p>
  </div>
  <div class="context-card"><h3>Bulk deals — <span id="mcSymbol">—</span></h3>
    <div class="context-table"><table><thead><tr><th>Date</th><th>Quantity</th><th>Price</th><th>Buyer</th><th>Seller</th><th>Type</th><th>Source</th><th>Freshness</th></tr></thead><tbody id="mcBulkBody"></tbody></table></div>
    <p id="mcBulkEmpty"></p><p id="mcBulkMeta"></p>
  </div>
  <div class="context-card"><h3>Options OI — <span id="mcOiUnderlying">—</span></h3>
    <div class="context-table"><table><thead><tr><th>Expiry</th><th>Strike</th><th>Type</th><th>OI</th><th>OI change</th><th>Volume</th><th>IV</th><th>LTP</th></tr></thead><tbody id="mcOiBody"></tbody></table></div>
    <p id="mcOiEmpty"></p><p id="mcOiMeta"></p>
  </div>
</div></section></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setContent(markup);
  for (const file of scripts) await page.addScriptTag({ path: path.join(root, file) });

  // Mount first, then inspect the empty state: it must be explicit, never a
  // zero or a fabricated value.
  await page.evaluate(() => {
    window.__store = window.LfcMarketContextStore.createStore();
    window.__ui = window.LfcMarketContextUI.mount({ store: window.__store });
  });
  const initial = await page.evaluate(() => ({
    regime: document.getElementById("mcRegimeValue").textContent.trim(),
    freshness: document.getElementById("mcRegimeFreshness").textContent.trim(),
    fii: document.getElementById("mcFiiNet").textContent.trim(),
    empty: !document.getElementById("mcBulkEmpty").hidden,
  }));
  const checks = [];
  checks.push(["initial regime unavailable", initial.regime === "UNAVAILABLE"]);
  checks.push(["initial freshness unavailable", initial.freshness === "UNAVAILABLE"]);
  checks.push(["missing FII renders dash", initial.fii === "—"]);
  checks.push(["bulk empty message visible", initial.empty]);

  const rendered = await page.evaluate(() => {
    const store = window.__store;
    const provider = '<img src=x onerror="window.__xss=1">';
    store.add({
      kind: "MARKET_REGIME", asOf: "2026-11-15T04:28:00Z", provider,
      market: "NSE", regime: "RISK_OFF", fiiNet: -1234567.5, diiNet: 800,
      indexTrend: "DOWN", breadth: 0.31, volatility: 18.2, freshness: "FRESH",
    });
    store.add({
      kind: "BULK_DEAL", asOf: "2026-11-15T04:20:00Z", provider: "Test provider",
      market: "NSE", symbol: "RELIANCE", buyer: "<script>window.__xss=2</script>",
      seller: null, quantity: 120000, price: 1425.5, dealType: "BULK",
      sourceUrl: "https://example.test/bulk",
    });
    window.__ui.setSymbol("RELIANCE");
    store.add({
      kind: "OPTIONS_OI", asOf: "2026-11-15T04:25:00Z", provider: "Test provider",
      market: "NSE", underlying: "RELIANCE", expiry: "2026-11-19", strike: 1450,
      optionType: "PUT", openInterest: null, openInterestChange: -3000,
      volume: 45000, impliedVolatility: null, lastTradedPrice: null,
    });
    return {
      regime: document.getElementById("mcRegimeValue").textContent.trim(),
      freshness: document.getElementById("mcRegimeFreshness").textContent.trim(),
      source: document.getElementById("mcRegimeSource").textContent,
      updated: document.getElementById("mcRegimeUpdated").textContent,
      fii: document.getElementById("mcFiiNet").textContent,
      risk: document.getElementById("mcRiskMultiplier").textContent,
      confirmations: document.getElementById("mcConfirmations").textContent,
      effect: document.getElementById("mcEffect").textContent,
      bulkRows: document.querySelectorAll("#mcBulkBody tr").length,
      buyer: document.querySelector("#mcBulkBody tr td:nth-child(4)").textContent,
      oiCells: Array.from(document.querySelectorAll("#mcOiBody tr td")).map((td) => td.textContent),
      injectedImg: document.querySelectorAll("#marketContextPanel img").length,
      injectedScript: document.querySelectorAll("#marketContextPanel script").length,
      xss: window.__xss || 0,
    };
  });

  checks.push(["RISK_OFF rendered", rendered.regime === "RISK-OFF" || rendered.regime === "RISK_OFF"]);
  checks.push(["freshness rendered", rendered.freshness === "FRESH"]);
  checks.push(["provider text escaped", rendered.source.includes("<img") && rendered.injectedImg === 0]);
  checks.push(["provider text preserved", rendered.source.length > 0]);
  checks.push(["timestamp shown", /2026/.test(rendered.updated) && /IST/.test(rendered.updated)]);
  checks.push(["Indian grouping", rendered.fii.includes("-12,34,567.5")]);
  checks.push(["risk multiplier is 0.5x", rendered.risk === "0.5×"]);
  checks.push(["two confirmations required", rendered.confirmations === "2"]);
  checks.push(["regime reason shown", /Risk-off/i.test(rendered.effect)]);
  checks.push(["one bulk row", rendered.bulkRows === 1]);
  checks.push(["buyer text escaped", rendered.buyer.includes("<script>") && rendered.injectedScript === 0]);
  checks.push(["no script execution", rendered.xss === 0]);
  checks.push(["missing OI dash", rendered.oiCells.filter((c) => c === "—").length >= 3]);
  checks.push(["OI change rendered", rendered.oiCells.includes("-3,000")]);
  checks.push(["OI volume rendered", rendered.oiCells.includes("45,000")]);

  // Mounting twice must not duplicate rows or subscriptions.
  await page.evaluate(() => {
    window.LfcMarketContextUI.mount({ store: window.__store });
    window.__store.add({
      kind: "BULK_DEAL", asOf: "2026-11-15T04:21:00Z", provider: "Test provider",
      market: "NSE", symbol: "RELIANCE", buyer: "Buyer C", seller: "Seller D",
      quantity: 1000, price: 1430, dealType: "BLOCK", sourceUrl: "https://example.test/b2",
    });
  });
  const rowsAfterRemount = await page.locator("#mcBulkBody tr").count();
  checks.push(["no duplicate subscription", rowsAfterRemount === 2]);

  // Mobile widths: the page itself must not overflow; tables scroll in-card.
  const widths = [[360, 740], [375, 667], [390, 844], [414, 896], [768, 1024], [640, 360]];
  for (const [w, h] of widths) {
    await page.setViewportSize({ width: w, height: h });
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    checks.push([`no page overflow at ${w}x${h}`, overflow <= 1]);
  }

  // Visible stale/unavailable state: add a stale record and rerender latest.
  const stale = await page.evaluate(() => {
    window.__store.add({
      kind: "MARKET_REGIME", asOf: "2026-11-15T04:29:00Z", provider: "Test provider",
      market: "NSE", regime: "NEUTRAL", fiiNet: null, diiNet: null,
      indexTrend: "SIDEWAYS", breadth: 0.5, volatility: 15, freshness: "STALE",
    });
    return {
      freshness: document.getElementById("mcRegimeFreshness").textContent,
      fii: document.getElementById("mcFiiNet").textContent,
      effect: document.getElementById("mcEffect").textContent,
      risk: document.getElementById("mcRiskMultiplier").textContent,
    };
  });
  checks.push(["stale freshness visible", stale.freshness === "STALE"]);
  checks.push(["stale keeps missing values as dash", stale.fii === "—"]);
  checks.push(["stale reason explains block", /stale/i.test(stale.effect)]);
  checks.push(["stale risk is zero", stale.risk === "0×"]);
  checks.push(["no page errors", errors.length === 0]);

  await browser.close();
  const failed = checks.filter(([, ok]) => !ok);
  console.log(JSON.stringify({ checks: checks.length, failed: failed.length, failures: failed, errors }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
