/* One FYERS connection dialog shared by the global sidebar and the terminal.
 *
 * Browser code never sees an FYERS token or app secret. The dialog only calls
 * the owner-gated same-origin routes with the portal session.
 */
(function () {
  'use strict';

  if (window.LfcFyersDialog) return;

  const FYERS_BASE = (window.LFC_CONFIG && window.LFC_CONFIG.fyersBase) || '/api/fyers';
  const MARKET_DATA_SYMBOL = 'NSE:NIFTY50-INDEX';
  const REASONS = {
    provider_refused: 'FYERS refused the login.',
    missing_code: 'The provider redirect carried no authorization code.',
    invalid_state: 'The login state was missing or expired. Start again.',
    not_configured: 'The server is not configured for FYERS.',
    token_exchange_failed: 'The token exchange failed. No credentials were stored.',
    storage_failed: 'The server could not store the session securely. No credentials were kept.',
    login_failed: 'FYERS login did not complete.',
  };

  const EMPTY_CFG = Object.freeze({ configured: false, connected: false, redirectUri: null, expiresAt: null });
  let dialog = null;
  let els = null;
  let refreshPromise = null;
  let cfg = EMPTY_CFG;

  function ensureStyles() {
    if (document.querySelector('link[data-lfc-fyers-dialog]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('assets/css/fyers-dialog.css', LfcAuth.base).href;
    link.dataset.lfcFyersDialog = 'true';
    document.head.append(link);
  }

  function build() {
    if (dialog) return;
    ensureStyles();
    dialog = document.createElement('dialog');
    dialog.className = 'fyers-dialog';
    dialog.id = 'fyersModal';
    dialog.setAttribute('aria-labelledby', 'fyersModalTitle');
    dialog.innerHTML = `
      <div class="fyers-head">
        <h2 id="fyersModalTitle">Connect FYERS</h2>
        <button type="button" class="fyers-close" data-fyers-close aria-label="Close connection dialog">✕</button>
      </div>
      <div class="fyers-body">
        <p class="fyers-note">Broker login runs on this server. The app secret and access token never reach this page.</p>
        <p id="fyersConfigNote" class="fyers-note" role="status">Checking server configuration…</p>
        <ol class="fyers-steps">
          <li>Create a NON-TRADING app at <a href="https://myapi.fyers.in" target="_blank" rel="noopener noreferrer">myapi.fyers.in</a>.</li>
          <li>Register this redirect URI on that app:
            <span class="fyers-uri"><code id="fyersRedirectUri">not configured</code><button type="button" id="copyCallbackBtn" class="fyers-copy">Copy</button></span>
          </li>
          <li>Set <code>FYERS_CLIENT_ID</code>, <code>FYERS_SECRET_ID</code> and <code>FYERS_REDIRECT_URI</code> in the server environment, then restart the proxy.</li>
        </ol>
        <div class="fyers-state">
          <p><span class="fyers-label">Authentication</span> <strong id="fyersAuthState">signed out</strong></p>
          <p><span class="fyers-label">Market data</span> <strong id="fyersDataState">not requested</strong></p>
          <p id="fyersExpiry" class="fyers-note"></p>
        </div>
        <p id="fyersError" class="fyers-error" role="alert" hidden></p>
        <div class="fyers-actions">
          <button type="button" id="loginWithFyersBtn" class="button primary">Log in with FYERS</button>
          <button type="button" id="disconnectFyersBtn" class="button secondary" hidden>Disconnect</button>
        </div>
        <p class="fyers-note">Disconnect clears this server session and asks FYERS to revoke this app's token. Refresh needs your account PIN, so it is not implemented: sign in again after the daily 06:30 IST expiry.</p>
      </div>`;
    document.body.append(dialog);

    const byId = (id) => document.getElementById(id);
    els = {
      close: dialog.querySelector('[data-fyers-close]'),
      copy: byId('copyCallbackBtn'),
      note: byId('fyersConfigNote'),
      redirect: byId('fyersRedirectUri'),
      auth: byId('fyersAuthState'),
      data: byId('fyersDataState'),
      expiry: byId('fyersExpiry'),
      error: byId('fyersError'),
      login: byId('loginWithFyersBtn'),
      disconnect: byId('disconnectFyersBtn'),
    };

    els.close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    els.copy.addEventListener('click', async () => {
      const text = els.redirect.textContent;
      if (!text || text === 'not configured') return;
      try {
        await navigator.clipboard.writeText(text);
        els.copy.textContent = 'Copied';
        setTimeout(() => { els.copy.textContent = 'Copy'; }, 1600);
      } catch {
        showError('Could not copy automatically; select the URI and copy it manually.');
      }
    });
    els.login.addEventListener('click', login);
    els.disconnect.addEventListener('click', disconnect);
  }

  function showError(message) {
    if (!els) return;
    els.error.textContent = message || '';
    els.error.hidden = !message;
  }

  function setAuth(text, dataText) {
    if (!els) return;
    els.auth.textContent = text;
    if (dataText) els.data.textContent = dataText;
  }

  async function authHeaders() {
    try {
      const session = await LfcAuth.client.auth.getSession();
      const token = session && session.data && session.data.session && session.data.session.access_token;
      return token ? { Authorization: 'Bearer ' + token } : {};
    } catch {
      return {};
    }
  }

  async function api(path, options) {
    const opts = Object.assign({ cache: 'no-store', credentials: 'same-origin' }, options || {});
    opts.headers = Object.assign({}, opts.headers || {}, await authHeaders());
    const response = await fetch(FYERS_BASE + path, opts);
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  }

  function render() {
    if (!els) return;
    els.note.textContent = cfg.configured
      ? 'Server configured. Continue with broker login.'
      : 'Server is missing FYERS_CLIENT_ID / FYERS_SECRET_ID / FYERS_REDIRECT_URI.';
    els.redirect.textContent = cfg.redirectUri || 'not configured';
    els.copy.disabled = !cfg.redirectUri;
    els.login.disabled = !cfg.configured;
    els.login.hidden = cfg.connected;
    els.disconnect.hidden = !cfg.connected;
    els.expiry.textContent = cfg.expiresAt
      ? 'Token expires ' + new Date(cfg.expiresAt * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST.'
      : '';
  }

  async function refresh() {
    if (!els) return;
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const result = await api('/config-status');
      if (!result.ok || !result.body) {
        cfg = EMPTY_CFG;
        const expired = result.status === 401;
        const restricted = result.status === 403;
        setAuth(expired ? 'signed out' : restricted ? 'restricted' : 'unavailable', 'unavailable');
        els.note.textContent = expired
          ? 'Portal session expired. Sign in again.'
          : restricted
            ? 'FYERS is restricted to the portal owner. Sign in with that account.'
            : result.body && result.body.error === 'FYERS_OWNER_NOT_CONFIGURED'
              ? 'The server owner allowlist is not configured. Set FYERS_OWNER_EMAILS.'
              : 'Server backend unavailable on this origin (' + result.status + '). FYERS login is inactive.';
        els.login.disabled = true;
        els.login.hidden = false;
        els.disconnect.hidden = true;
        els.copy.disabled = true;
        els.redirect.textContent = 'not configured';
        return;
      }
      cfg = {
        configured: !!(result.body.configured && result.body.connected !== undefined),
        connected: !!result.body.connected,
        redirectUri: result.body.redirect_uri || null,
        expiresAt: result.body.expires_at || null,
      };
      setAuth(cfg.connected ? 'connected' : cfg.configured ? 'signed out' : 'unavailable');
      render();
      if (cfg.connected) await loadQuote();
      else els.data.textContent = 'not requested';
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function loadQuote() {
    els.data.textContent = 'requesting…';
    const result = await api('/quote?symbol=' + encodeURIComponent(MARKET_DATA_SYMBOL));
    if (result.ok && result.body && typeof result.body.ltp === 'number') {
      els.data.textContent = 'NIFTY 50 ₹' + result.body.ltp + ' · as of ' + (result.body.as_of || 'provider time unavailable');
    } else {
      els.data.textContent = result.status === 401 ? 'unavailable (session expired)' : 'unavailable';
    }
  }

  async function login() {
    build();
    showError('');
    els.login.disabled = true;
    try {
      const current = new URL(location.href);
      current.searchParams.delete('fyers');
      current.searchParams.delete('reason');
      const returnTo = current.pathname + current.search + current.hash;
      const result = await api('/login?return=' + encodeURIComponent(returnTo));
      if (!result.ok || !result.body || !result.body.login_url) {
        showError('Could not start FYERS login (HTTP ' + result.status + ').');
        return;
      }
      location.assign(result.body.login_url);
    } finally {
      els.login.disabled = false;
    }
  }

  async function disconnect() {
    build();
    els.disconnect.disabled = true;
    showError('');
    try {
      const result = await api('/disconnect', { method: 'POST' });
      if (!result.ok) showError('Disconnect failed (HTTP ' + result.status + ').');
      await refresh();
    } finally {
      els.disconnect.disabled = false;
    }
  }

  function readOutcome() {
    const params = new URLSearchParams(location.search);
    const outcome = params.get('fyers');
    if (!outcome) return null;
    const reason = params.get('reason');
    params.delete('fyers');
    params.delete('reason');
    const search = params.toString();
    history.replaceState(null, '', location.pathname + (search ? '?' + search : '') + location.hash);
    return { outcome, reason };
  }

  async function open(outcome) {
    build();
    if (!dialog.open) dialog.showModal();
    await refresh();
    if (outcome && outcome.outcome === 'error') {
      showError(REASONS[outcome.reason] || REASONS.login_failed);
    }
  }

  function close() {
    if (dialog && dialog.open) dialog.close();
  }

  function bindTriggers() {
    if (window.__lfcFyersTriggersBound) return;
    window.__lfcFyersTriggersBound = true;
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-fyers-open]');
      if (!trigger) return;
      event.preventDefault();
      open();
    });
    const outcome = readOutcome();
    if (outcome) open(outcome);
  }

  window.LfcFyersDialog = { open };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindTriggers, { once: true });
  } else {
    bindTriggers();
  }
})();
