/**
 * Render keep-alive (server/keep-warm.mjs).
 *
 * Render's free plan suspends an idle web service after ~15 minutes, and the
 * next request then waits ~50s for a cold start — which the desk renders as
 * "Terminal unreachable". The Worker already runs an every-minute cron for
 * alerts, so the same tick polls the daemon's health endpoint and never leaves
 * the instance idle. No third-party monitor account is required.
 *
 * Kept in its own module (rather than inline in worker.mjs) so it can be tested
 * without pulling in the Worker's bundler-only imports.
 */

const NGROK_SPLASH_PREFIX = 'learningfundclear-portal';

export function daemonOrigin(env) {
  return String((env && env.QUANT_API_ORIGIN) || '').trim().replace(/\/+$/, '');
}

/**
 * Probe the daemon once. Returns true when a request was actually attempted and
 * answered, false when the origin is unset or the probe threw. A failure here
 * never propagates: the desk's own health probe stays the source of truth, and
 * a cold or restarting instance must not fail the scheduled job.
 */
export async function keepDaemonWarm(env, fetcher = fetch) {
  const origin = daemonOrigin(env);
  if (!/^https?:\/\//i.test(origin)) return false;

  const headers = {};
  // A free ngrok origin answers its browser-warning splash without this header.
  if (/\.ngrok-free\.(dev|app)$/i.test(origin)) {
    headers['ngrok-skip-browser-warning'] = NGROK_SPLASH_PREFIX;
  }

  try {
    const response = await fetcher(origin + '/api/v1/health', {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    return response.ok === true;
  } catch {
    return false;
  }
}
