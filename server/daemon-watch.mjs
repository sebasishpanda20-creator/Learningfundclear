/**
 * Daemon health watchdog (server/daemon-watch.mjs).
 *
 * Rides the same every-minute cron as the crypto email watch: one health probe
 * per tick keeps the Render free instance from idling and, when the daemon
 * answers with a non-2xx or the fetch throws, counts the failure in KV.
 * FAIL_THRESHOLD consecutive failures send one Resend email for that outage;
 * the streak resets on the first healthy probe, so a later outage alerts again.
 * One email per outage is deliberate - a daemon down for a day must not produce
 * 1,440 messages.
 *
 * Everything is best-effort: an unbound KV, a failed send or a KV error must
 * never break the cron or the keep-alive probe.
 */
import { daemonOrigin, keepDaemonWarm } from './keep-warm.mjs';

export const FAIL_THRESHOLD = 5;
export const STATE_KEY = 'daemon:health';

export function alertRecipients(env) {
  return String((env && (env.ALERT_TO || env.ALERT_FROM)) || '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
}

function alertReady(env, recipients) {
  return Boolean(env && env.ALERTS_KV && env.RESEND_API_KEY && env.ALERT_FROM && recipients.length);
}

async function readState(kv) {
  try {
    return (await kv.get(STATE_KEY, 'json')) || null;
  } catch {
    return null;
  }
}

async function writeState(kv, state) {
  try {
    await kv.put(STATE_KEY, JSON.stringify(state));
  } catch {
    /* retry on the next tick */
  }
}

async function clearState(kv) {
  try {
    await kv.delete(STATE_KEY);
  } catch {
    /* ignore */
  }
}

export function alertSubject(state) {
  return 'LearningFundClear · quant daemon unreachable (' + state.fails + ' failed checks)';
}

export function alertText(origin, state) {
  return [
    'The quant desk daemon is not answering its health probe.',
    '',
    'Origin:               ' + origin,
    'Consecutive failures: ' + state.fails + ' (one probe per minute)',
    'First failure:        ' + state.firstFailAt,
    'Latest failure:       ' + state.lastFailAt,
    '',
    'The terminal panel on the portal is unreachable until this clears.',
    'Likely causes, in order:',
    '  1. The Render free instance crashed or is stuck cold-starting (check its logs).',
    '  2. The service URL changed, so QUANT_API_ORIGIN in wrangler.jsonc is stale.',
    '  3. The daemon refuses to boot because a required secret is missing.',
    '',
    'You will not get another email for this outage. The next alert comes only',
    'after the daemon answers again and then fails ' + FAIL_THRESHOLD + ' more times.',
  ].join('\n');
}

export async function sendDownAlert(env, fetcher, origin, state) {
  const recipients = alertRecipients(env);
  if (!alertReady(env, recipients)) return false;
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json',
        // One idempotency key per outage: if Resend accepted a send whose
        // response we lost, the next tick cannot duplicate it.
        'Idempotency-Key': 'daemon-down-' + (state.firstFailAt || state.lastFailAt),
      },
      body: JSON.stringify({
        from: env.ALERT_FROM,
        to: recipients,
        subject: alertSubject(state),
        text: alertText(origin, state),
      }),
      signal: AbortSignal.timeout(12000),
    });
    return response.ok === true;
  } catch {
    return false;
  }
}

export async function runDaemonWatch(env, fetcher = fetch, now = Date.now()) {
  const origin = daemonOrigin(env);
  if (!origin) return { probed: false, healthy: null, alerted: false, reason: 'QUANT_API_ORIGIN is not set' };

  const healthy = await keepDaemonWarm(env, fetcher);
  if (!env || !env.ALERTS_KV) {
    return { probed: true, healthy, alerted: false, reason: 'ALERTS_KV is not bound' };
  }

  if (healthy) {
    if (await readState(env.ALERTS_KV)) await clearState(env.ALERTS_KV);
    return { probed: true, healthy: true, alerted: false, fails: 0 };
  }

  const previous = (await readState(env.ALERTS_KV)) || {};
  const state = {
    fails: (Number(previous.fails) || 0) + 1,
    firstFailAt: previous.firstFailAt || new Date(now).toISOString(),
    lastFailAt: new Date(now).toISOString(),
    alertedAt: previous.alertedAt || null,
  };

  if (state.fails < FAIL_THRESHOLD || state.alertedAt) {
    await writeState(env.ALERTS_KV, state);
    return { probed: true, healthy: false, alerted: false, fails: state.fails };
  }

  const sent = await sendDownAlert(env, fetcher, origin, state);
  if (sent) state.alertedAt = new Date(now).toISOString();
  await writeState(env.ALERTS_KV, state);
  return { probed: true, healthy: false, alerted: sent, fails: state.fails };
}
