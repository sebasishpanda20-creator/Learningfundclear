// The Worker must have real, reviewable source files, not only files that
// appear after a build. These checks fail if the build starts generating them
// again or if the browser/server configuration drifts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('server/config.mjs exists as source and exports the runtime config', () => {
  assert.equal(existsSync(new URL('../server/config.mjs', import.meta.url)), true);
  const source = read('server/config.mjs');
  assert.match(source, /export default config/);
  assert.match(source, /anonKey/);
  assert.doesNotMatch(source, /service_role/);
});

test('browser and server public config agree', () => {
  const browser = read('assets/js/config.js');
  const server = read('server/config.mjs');
  const pick = (text, key) => {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`));
    return m ? m[1] : null;
  };
  for (const key of ['url', 'anonKey', 'storageKey', 'fyersBase']) {
    assert.equal(pick(server, key), pick(browser, key), `${key} differs`);
  }
});

test('server/crypto-engine.js exists and matches the browser engine', () => {
  assert.equal(existsSync(new URL('../server/crypto-engine.js', import.meta.url)), true);
  assert.equal(read('server/crypto-engine.js'), read('assets/js/crypto-desk-engine.js'));
});

test('build copies server source instead of generating config or crypto engine', () => {
  const build = read('scripts/build.mjs');
  assert.doesNotMatch(build, /writeFileSync\('dist\/server\/config\.mjs'/);
  assert.doesNotMatch(build, /copyFileSync\('assets\/js\/crypto-desk-engine\.js'/);
  assert.doesNotMatch(build, /readFileSync/);
  assert.match(build, /cpSync\('server','dist\/server'/);
});

test('shared FYERS dialog requests the NIFTY index contract, not bare NIFTY', () => {
  const source = read('assets/js/fyers-dialog.js');
  assert.match(source, /MARKET_DATA_SYMBOL = 'NSE:NIFTY50-INDEX'/);
  assert.match(source, /\/quote\?symbol=' \+ encodeURIComponent\(MARKET_DATA_SYMBOL\)/);
  assert.doesNotMatch(source, /\/quote\?symbol=NIFTY/);
});

test('server imports resolve to committed files', () => {
  assert.match(read('server/worker.mjs'), /from '\.\/config\.mjs'/);
  assert.match(read('server/email-alerts.mjs'), /import '\.\/crypto-engine\.js'/);
  assert.equal(existsSync(new URL('../server/config.mjs', import.meta.url)), true);
  assert.equal(existsSync(new URL('../server/crypto-engine.js', import.meta.url)), true);
});
