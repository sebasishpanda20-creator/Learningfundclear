/**
 * Hedge preview — built-portal browser check.
 *
 * Serves the built tree (dist/client), opens the NSE page and proves:
 *   1. the market-data preview states its blocking reason instead of inventing
 *      premiums (this chain publishes last traded price only);
 *   2. the manual hypothetical mode renders payoff rows under its own caption;
 *   3. changing the instrument clears the previous result and its source line.
 *
 * No broker is called and no order is placed. The page's own auth/terminal
 * scripts are outside this check.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const root = path.join(__dirname, '..', 'dist', 'client');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

let server;
let browser;
const checks = [];
function check(name, condition) {
  checks.push({ name, pass: !!condition });
  if (!condition) process.exitCode = 1;
}

async function main() {
  server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;

  browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // Seed an isolated QA session so the portal shell does not redirect to sign-in.
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'qa@portal.local', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
  const session = { access_token: 'test-only-access-token', refresh_token: 'test-only-refresh-token', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user };
  await page.addInitScript(({ session, stamp }) => {
    localStorage.setItem('sb-chbtjicvbezbiosuouwm-auth-token', JSON.stringify(session));
    localStorage.setItem('lfc.auth', JSON.stringify(stamp));
  }, { session, stamp: { u: user.id, n: 'QA account', a: true, t: Date.now() } });
  // Keep the page's own data calls from hanging the check.
  await page.route(/supabase\.co|finance\.yahoo\.com|r\.jina\.ai|api\.mfapi\.in/, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
    if (url.pathname === '/auth/v1/token') return route.fulfill({ json: session });
    if (url.pathname.includes('app_users')) {
      const profile = { ...user, username: 'qa', display_name: 'QA account', is_admin: true, is_active: true };
      const wantsObject = (route.request().headers().accept || '').includes('object');
      return route.fulfill({ json: wantsObject ? profile : [profile] });
    }
    return route.fulfill({ status: 503, json: { error: 'QA fixture unavailable' } });
  });

  await page.goto(origin + '/gex.html');
  const panel = page.locator('[data-hedge-scenario]');
  await panel.locator('button', { hasText: 'Preview hedge scenarios' }).waitFor({ timeout: 15000 });
  check('preview control is present in the built page', true);

  // 1. Market-data preview: no plan yet, so it names the missing input.
  await panel.locator('button', { hasText: 'Preview hedge scenarios' }).click();
  await panel.locator('.hedge-scenario__source').first().waitFor();
  const blockedSource = await panel.locator('.hedge-scenario__source').first().innerText();
  const blockedOutput = await panel.locator('.hedge-scenario__output').first().innerText();
  check('market preview refuses to invent a payoff', blockedOutput === 'Scenario unavailable: check contract, quote and cost data.');
  check('market preview names the missing contract/quote field', /NO_[A-Z_]+/.test(blockedSource));

  // 2. Manual hypothetical mode.
  await panel.locator('summary', { hasText: 'Manual scenario — hypothetical inputs' }).click();
  await panel.getByLabel('Underlying (as you type it)').fill('NIFTY');
  await panel.getByLabel('Expiry (as you type it)').fill('25-DEC-2026');
  await panel.getByLabel('Currency / settlement').fill('INR');
  await panel.getByLabel('Contract multiplier / unit').fill('1');
  await panel.getByLabel('Settlement prices (comma separated)').fill('90, 105, 120');
  await panel.getByLabel('Fees you supply').fill('0');
  const legs = panel.locator('.hedge-scenario__leg');
  await legs.nth(0).getByLabel('Side').selectOption('BUY');
  await legs.nth(0).getByLabel('Instrument').selectOption('CALL');
  await legs.nth(0).getByLabel('Strike (options)').fill('100');
  await legs.nth(0).getByLabel('Premium / price you supply').fill('6');
  await legs.nth(1).getByLabel('Side').selectOption('SELL');
  await legs.nth(1).getByLabel('Instrument').selectOption('CALL');
  await legs.nth(1).getByLabel('Strike (options)').fill('110');
  await legs.nth(1).getByLabel('Premium / price you supply').fill('2');
  await panel.locator('button', { hasText: 'Preview manual scenario' }).click();

  const manualCaption = await panel.locator('.hedge-scenario__caption').innerText();
  const manualRows = await panel.locator('.hedge-scenario__manual .hedge-scenario__output').innerText();
  const manualNote = await panel.locator('.hedge-scenario__manual .hedge-scenario__source').innerText();
  check('manual result uses the hypothetical payoff caption', manualCaption === 'Expiry payoff at supplied prices');
  check('manual payoff rows reach the panel', manualRows === '90: -4.00 INR\n105: 1.00 INR\n120: 6.00 INR');
  check('manual result states it uses no live quote', /No live quote/.test(manualNote));
  check('manual result never claims a maximum loss or expected return', !/maximum loss|expected return/i.test(manualCaption + manualRows + manualNote));

  // 3. Instrument switch retires the result.
  await page.evaluate(() => {
    const select = document.querySelector('#sym');
    if (select.options.length > 1) select.selectedIndex = 1;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const clearedRows = await panel.locator('.hedge-scenario__manual .hedge-scenario__output').innerText();
  check('changing the instrument clears the previous manual result', clearedRows === '');

  await browser.close();
  server.close();
  console.log(JSON.stringify({ checks }, null, 2));
  console.log(`${checks.filter((c) => c.pass).length}/${checks.length} checks passed`);
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  try { await browser?.close(); } catch {}
  try { server?.close(); } catch {}
});
