/** Quant desk + dashboard embed failure-status mapping (assets/js/quant-terminal-messages.js).

Both failure-status vocabularies live in one module so the wording is a single
edit, not two. The standalone page (quant-desk.html inline script) and the
dashboard embed (assets/js/quant-embed.js) each expose a thin wrapper that
delegates to window.QUANT_TERMINAL_MESSAGES, so they cannot drift from the
source without one of them still compiling.

These tests assert:
  - the shared messages module contains the exact 401/404/502/503/504/network/
    unknown-code lines for both ticketMessage and proxyMessage;
  - both host wrappers are identical delegating wrappers (so copy/paste drift
    between the standalone page and the dashboard embed is impossible);
  - the standby pill renders the session-rejected line, not the ticket line,
    for a 401 health probe (showReachability), and showTicketFailure renders
    ticket.message || ticketMessage(ticket.status).
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(name) {
  return readFileSync(join(ROOT, name), 'utf8');
}

/** Return the body of the first `function name(status) { ... }` in `source`. */
function functionBody(source, name) {
  const needle = `function ${name}(status)`;
  const start = source.indexOf(needle);
  assert.ok(start >= 0, `cannot find ${needle} in source`);
  const open = source.indexOf('{', start);
  assert.ok(open >= 0, `cannot find { for ${needle}`);
  let depth = 1;
  let i = open + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') depth -= 1;
    i += 1;
  }
  assert.equal(depth, 0, `unbalanced braces in ${name}`);
  return source.slice(open + 1, i - 1);
}

/** The exact strings the mapping is supposed to render. */
const TICKET_LINES = new Map([
  [401, 'Terminal ticket rejected (401) — sign in again'],
  [404, 'Terminal ticket route missing (404) — deploy the Worker route'],
  [503, 'Terminal ticket check unavailable (503) — Supabase could not verify the session'],
  [0, 'Terminal ticket request failed (network)'],
]);
const TICKET_CATCHALL_PREFIX = 'Terminal ticket failed (HTTP ';
const PROXY_LINES = new Map([
  [502, 'Terminal proxy failed (502) — daemon or tunnel unreachable'],
  [503, 'Terminal proxy unavailable (503) — daemon not ready'],
  [504, 'Terminal proxy timed out (504)'],
  [404, 'Terminal proxy route missing (404)'],
  [0, 'Terminal proxy unreachable (network)'],
]);
const PROXY_CATCHALL_PREFIX = 'Terminal proxy failed (HTTP ';

/** Check that `body` contains the expected ticketMessage mapping lines. */
function assertTicketMapping(body) {
  for (const [code, message] of TICKET_LINES) {
    assert.ok(
      body.includes(`"${message}"`) || body.includes(`'${message}'`),
      `ticketMessage missing code ${code}: ${message}`,
    );
  }
  assert.ok(
    body.includes(TICKET_CATCHALL_PREFIX),
    'ticketMessage missing catch-all line',
  );
}

/** Check that `body` contains the expected proxyMessage mapping lines. */
function assertProxyMapping(body) {
  for (const [code, message] of PROXY_LINES) {
    assert.ok(
      body.includes(`"${message}"`) || body.includes(`'${message}'`),
      `proxyMessage missing code ${code}: ${message}`,
    );
  }
  assert.ok(
    body.includes(PROXY_CATCHALL_PREFIX),
    'proxyMessage missing catch-all line',
  );
}

test('shared messages module covers ticket 401, 404, 503, network and unknown codes', () => {
  const body = read('assets/js/quant-terminal-messages.js');
  assertTicketMapping(body);
});

test('shared messages module covers probe 502, 503, 504, 404, network and unknown codes', () => {
  const body = read('assets/js/quant-terminal-messages.js');
  assertProxyMapping(body);
});

test('standalone page and dashboard embed are identical delegating wrappers', () => {
  const pageBody = read('quant-desk.html');
  const embedBody = read('assets/js/quant-embed.js');

  const pageTicket = functionBody(pageBody, 'ticketMessage');
  const embedTicket = functionBody(embedBody, 'ticketMessage');
  const pageProxy = functionBody(pageBody, 'proxyMessage');
  const embedProxy = functionBody(embedBody, 'proxyMessage');

  assert.equal(
    pageTicket,
    embedTicket,
    'ticketMessage wrapper must be identical in quant-desk.html and quant-embed.js',
  );
  assert.equal(
    pageProxy,
    embedProxy,
    'proxyMessage wrapper must be identical in quant-desk.html and quant-embed.js',
  );

  assert.equal(
    pageTicket.trim(),
    'return window.QUANT_TERMINAL_MESSAGES.ticketMessage(status);',
    'ticketMessage wrapper must delegate to the shared module',
  );
  assert.equal(
    pageProxy.trim(),
    'return window.QUANT_TERMINAL_MESSAGES.proxyMessage(status);',
    'proxyMessage wrapper must delegate to the shared module',
  );
});

test('status pill states the unauthorized line for a 401 health probe', () => {
  const body = read('quant-desk.html');
  const start = body.indexOf('function showReachability(result)');
  assert.ok(start >= 0, 'quant-desk.html missing showReachability(result)');
  const block = body.slice(start);
  const unauthOpen = block.indexOf('if (result.unauthorized)');
  assert.ok(unauthOpen >= 0, 'showReachability missing unauthorized branch');
  const msgIdx = block.indexOf('status.textContent =', unauthOpen);
  assert.ok(msgIdx >= 0, 'unauthorized branch missing status.textContent assignment');
  const literalStart = block.indexOf('"', msgIdx);
  assert.ok(literalStart >= 0);
  const literalEnd = block.indexOf('"', literalStart + 1);
  assert.ok(literalEnd >= 0);
  const line = block.slice(literalStart + 1, literalEnd);
  assert.equal(
    line,
    'Terminal session rejected (401) — sign in again',
    'the pill must state the unauthorized line, not the ticket line, for a 401 probe',
  );
});

test('showTicketFailure renders ticket.message || ticketMessage(ticket.status)', () => {
  const body = read('quant-desk.html');
  const start = body.indexOf('function showTicketFailure(ticket)');
  assert.ok(start >= 0, 'quant-desk.html missing showTicketFailure(ticket)');
  const block = body.slice(start);
  assert.match(
    block,
    /status\.textContent = ticket\.message \|\| ticketMessage\(ticket\.status\)/,
    'showTicketFailure must render message || ticketMessage(status)',
  );
});
