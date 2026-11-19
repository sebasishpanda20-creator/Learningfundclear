/* Owner-only FYERS configuration and connection status for Administration.
 * The server route never returns the client secret, token or token key. */
(function () {
  'use strict';

  const card = document.getElementById('fyersAdminCard');
  if (!card) return;
  const byId = (id) => document.getElementById(id);
  const button = byId('refreshFyersAdmin');
  const status = byId('fyersAdminStatus');
  const configured = byId('fyersAdminConfigured');
  const connected = byId('fyersAdminConnected');
  const expiry = byId('fyersAdminExpiry');
  const access = byId('fyersAdminAccess');
  const redirect = byId('fyersAdminRedirect');
  const base = (window.LFC_CONFIG && window.LFC_CONFIG.fyersBase) || '/api/fyers';

  const stamp = (value) => value
    ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST'
    : '—';

  function clear() {
    for (const node of [configured, connected, expiry, access]) node.textContent = '—';
    redirect.textContent = '—';
  }

  function unavailable(message) {
    clear();
    status.textContent = message;
  }

  async function headers() {
    try {
      const session = await LfcAuth.client.auth.getSession();
      const token = session && session.data && session.data.session && session.data.session.access_token;
      return token ? { Authorization: 'Bearer ' + token } : {};
    } catch {
      return {};
    }
  }

  async function refresh() {
    button.disabled = true;
    status.textContent = 'Checking FYERS configuration…';
    try {
      const response = await fetch(base + '/config-status', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: await headers(),
      });
      let body = null;
      try { body = await response.json(); } catch { body = null; }

      if (response.status === 401) return unavailable('Portal session expired. Sign in again.');
      if (response.status === 403) return unavailable('FYERS is restricted to the account in FYERS_OWNER_EMAILS.');
      if (response.status === 404) return unavailable('FYERS status route is unavailable on this host (404).');
      if (response.status === 503 && body && body.error === 'FYERS_OWNER_NOT_CONFIGURED') {
        return unavailable('The server has no FYERS_OWNER_EMAILS allowlist configured.');
      }
      if (!response.ok || !body) {
        return unavailable('FYERS status is unavailable (HTTP ' + response.status + ').');
      }

      const isConfigured = body.configured === true;
      const isConnected = body.connected === true;
      configured.textContent = isConfigured ? 'Configured' : 'Not configured';
      connected.textContent = isConnected ? 'Connected' : isConfigured ? 'Not connected' : 'Unavailable';
      const expiryAt = body.expires_at_iso || (body.expires_at ? body.expires_at * 1000 : null);
      expiry.textContent = isConnected ? stamp(expiryAt) : '—';
      access.textContent = isConfigured ? 'Owner allowlist' : 'Unavailable';
      redirect.textContent = body.redirect_uri || 'Not configured';
      status.textContent = 'Checked ' + stamp(Date.now()) + ' · ' + (
        isConnected ? 'owner broker session is connected'
          : isConfigured ? 'ready for owner sign-in'
            : 'server credentials are incomplete'
      ) + '.';
    } catch {
      unavailable('FYERS status request failed (network).');
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener('click', refresh);
  LfcAuth.ready.then((user) => {
    if (user && user.is_admin) refresh();
  });
})();
