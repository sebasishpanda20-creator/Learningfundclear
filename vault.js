/*
 * vault.js — per-user encrypted broker-credential vault for the Learning New Things portal.
 *
 * Security model (defence in depth):
 *   - The Dhan access token NEVER leaves the browser in plaintext after entry.
 *   - In the browser it lives only in a JS variable (and, if the user opts in,
 *     in localStorage encrypted with a device key — not on any server).
 *   - Supabase stores only AES-GCM ciphertext. The encryption key is derived
 *     (PBKDF2-SHA256, 310k iterations) from the user's vault passphrase; no
 *     server-side key exists, so a database leak yields unusable blobs.
 *   - Row-level security (migration: alerts-vault-migration.sql) restricts the
 *     user_broker_keys row to its owner.
 *
 * NOTE: run the migration once before using, or save() will fail with a
 * relation-not-found error.
 *
 * Exposes window.Vault = { load, save, forget, getToken, hasCreds, isRemembered }
 */
(function () {
  "use strict";

  var PBKDF2_ITERATIONS = 310000;
  var LS_PASS = "lnt_vault_pass";        // remembered passphrase (device-only, opt-in)
  var LS_BROKER = "lnt_vault_broker_id"; // remembered non-secret client-id

  var sb = null;          // Supabase client, injected via init()
  var plainToken = null;  // decrypted token, memory only
  var clientId = null;    // Dhan numeric client-id
  var broker = "dhan";

  function b64(buf) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  }
  function unb64(s) {
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  function deriveKey(passphrase, saltBuf) {
    return crypto.subtle
      .importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: saltBuf, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
          base,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        );
      });
  }

  function encrypt(key, plaintext) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle
      .encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(plaintext))
      .then(function (ct) { return { iv: b64(iv), ct: b64(ct) }; });
  }

  function decrypt(key, ivB64, ctB64) {
    return crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(unb64(ivB64)) },
      key,
      unb64(ctB64)
    ).then(function (pt) { return new TextDecoder().decode(pt); });
  }

  function row() {
    return sb.from("user_broker_keys").select("*").eq("broker", broker).maybeSingle();
  }

  function init(supabaseClient) {
    sb = supabaseClient;
    // restore remembered session (device-only)
    var p = localStorage.getItem(LS_PASS);
    var c = localStorage.getItem(LS_BROKER);
    if (p && c) {
      clientId = c;
      return unlock(p).then(function (ok) { return api; });
    }
    return Promise.resolve(api);
  }

  /** Decrypt the stored row with a passphrase; caches the token in memory. */
  function unlock(passphrase) {
    return row().then(function ({ data, error }) {
      if (error || !data || !data.ciphertext) return false;
      return deriveKey(passphrase, new Uint8Array(unb64(data.salt)))
        .then(function (key) { return decrypt(key, data.iv, data.ciphertext); })
        .then(function (token) {
          plainToken = token;
          clientId = data.client_id;
          return true;
        })
        .catch(function () { return false; });   // wrong passphrase
    });
  }

  /** Encrypt + upsert credentials under a passphrase (chosen or existing). */
  function save(passphrase, token, newClientId) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    return deriveKey(passphrase, salt)
      .then(function (key) { return encrypt(key, token); })
      .then(function (enc) {
        var payload = {
          broker: broker,
          client_id: newClientId,
          ciphertext: enc.ct,
          iv: enc.iv,
          salt: b64(salt),
          updated_at: new Date().toISOString()
        };
        return sb.from("user_broker_keys").upsert(payload, { onConflict: "user_id" });
      })
      .then(function ({ error }) {
        if (error) throw error;
        plainToken = token;
        clientId = newClientId;
        return true;
      });
  }

  /** Remove the stored row and every local trace. */
  function forget() {
    return sb.from("user_broker_keys").delete().eq("broker", broker)
      .then(function () {
        plainToken = null; clientId = null;
        localStorage.removeItem(LS_PASS);
        localStorage.removeItem(LS_BROKER);
        return true;
      });
  }

  function remember(passphrase) {
    localStorage.setItem(LS_PASS, passphrase);
    localStorage.setItem(LS_BROKER, clientId || "");
  }

  function isRemembered() { return !!localStorage.getItem(LS_PASS); }

  var api = {
    init: init,
    unlock: unlock,
    save: save,
    forget: forget,
    remember: remember,
    isRemembered: isRemembered,
    getToken: function () { return plainToken; },
    getClientId: function () { return clientId; },
    hasCreds: function () { return !!plainToken && !!clientId; }
  };

  window.Vault = api;
})();
