/**
 * OPEN_TERMINAL switch (server/terminal-gate.mjs).
 *
 * OPEN_TERMINAL=1 drops the dashboard-session gate on /quant-terminal so the
 * Worker serves the daemon-hosted terminal to anonymous visitors. The default
 * (unset) must keep denying them, so the switch is genuinely reversible.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { terminalGateOpen, guardTerminal } from '../server/terminal-gate.mjs';

// Never contacted while the gate is open; a closed gate with a cookie would use it.
const CFG = { url: 'https://supabase.test.invalid', anonKey: 'anon-key-for-tests' };

function embedRequest(headers = {}) {
  return new Request('https://learningfundclear.test/quant-terminal/', {
    headers: { 'sec-fetch-dest': 'iframe', ...headers },
  });
}

test('switch is off unless the variable holds a truthy value', () => {
  for (const env of [undefined, {}, { OPEN_TERMINAL: '' }, { OPEN_TERMINAL: '0' }, { OPEN_TERMINAL: 'false' }]) {
    assert.equal(terminalGateOpen(env), false, `expected off for ${JSON.stringify(env)}`);
  }
  for (const value of ['1', 'true', 'TRUE', ' yes ', 'on']) {
    assert.equal(terminalGateOpen({ OPEN_TERMINAL: value }), true, `expected on for ${value}`);
  }
});

test('open gate serves an anonymous embed without consulting Supabase', async () => {
  const response = await guardTerminal(embedRequest(), { OPEN_TERMINAL: 'true' }, CFG);
  assert.equal(response, null);
});

test('closed gate still refuses an anonymous embed', async () => {
  const response = await guardTerminal(embedRequest(), {}, CFG);
  assert.ok(response, 'an anonymous embed must not reach the daemon');
  assert.equal(response.status, 401);
});
