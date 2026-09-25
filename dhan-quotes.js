/*
 * dhan-quotes.js — live NSE LTP for the Learning New Things portal.
 *
 * Data path : browser → Supabase Edge Function `dhan-quotes` → api.dhan.co/v2/marketfeed/ohlc
 *             (api.dhan.co sends no CORS headers, so a direct browser call is impossible —
 *              the edge function is the proxy; it is JWT-gated to portal users.)
 *
 * Security ID map: dhan_security_ids.json (built by ideas-v2/tools/build-dhan-ids.py).
 * Credentials    : Dhan access token + client id, stored in localStorage under lnt_dhan_* .
 *                  Token expires every 24h (Dhan/SEBI policy) — the chip will say so.
 *
 * Emits          : document event "dhanquote" with detail = { quotes, at } where quotes is
 *                  { TICKER: { ltp, prevClose, chgPct, ts } }.
 * Exposes        : window.DhanQuotes = { init, refresh, disconnect, quotes, marketOpen, ... }
 *
 * Concurrency    : exactly one refresh chain may exist at a time; concurrent callers share it.
 * This module deliberately knows nothing about the page's tables; the page paints cells.
 */
(function () {
  "use strict";

  var IDS_URL = "dhan_security_ids.json";
  // Supabase Functions invoke URL. Deployed project: chbtjicvbezbiosuouwm.
  var EDGE_URL = "https://chbtjicvbezbiosuouwm.supabase.co/functions/v1/dhan-quotes";
  var LS_TOKEN = "lnt_dhan_token";
  var LS_CLIENT = "lnt_dhan_client_id";
  var LS_POLL = "lnt_dhan_poll_ms";
  var MIN_POLL_MS = 5000;           // Dhan quote APIs: 1 request/second
  var DEFAULT_POLL_MS = 15000;
  var MAX_INSTRUMENTS = 500;        // hard cap well under Dhan's 1000/request

  var ids = null;                   // { TICKER: "securityId" }
  var idToTicker = {};              // inverse map, built once when ids load
  var quotes = {};                  // { TICKER: {ltp, prevClose, chgPct, ts} }
  var unmapped = {};                // ticker -> true (warn once)
  var pollTimer = null;
  var currentChain = null;          // in-flight refresh promise (single-flight)
  var consecutiveErrors = 0;
  var chip = null;
  var opts = { getToken: null, onChange: null, mount: null };
  var lastFetchAt = null;

  // ---------- IST market clock ----------
  function istNow() {
    var now = new Date();
    return new Date(now.getTime() + (now.getTimezoneOffset() + 330) * 60000); // IST = UTC+5:30
  }
  function marketOpen() {
    var d = istNow();
    var day = d.getDay();                 // 0 Sun .. 6 Sat
    var mins = d.getHours() * 60 + d.getMinutes();
    return day >= 1 && day <= 5 && mins >= 555 && mins < 930;   // 09:15–15:30
  }
  // NSE trading holidays are not encoded; on holidays the feed simply returns the
  // last traded prices — harmless at 1 request per 15 s. Extend here if you care.

  // ---------- chip UI ----------
  function ensureChip() {
    if (chip) return chip;
    chip = document.createElement("button");
    chip.id = "dhanChip";
    chip.className = "ghost";
    chip.style.cssText = "font-size:11px;padding:6px 10px;border-radius:8px;cursor:pointer;" +
      "border:1px solid #1f2937;background:transparent;color:#9ca3af;font-weight:600";
    chip.title = "Dhan live prices — click to connect / update credentials";
    chip.addEventListener("click", onChipClick);
    var mount = opts.mount && document.querySelector(opts.mount);
    if (!mount) mount = document.querySelector(".userbar") || document.querySelector("header");
    if (mount) mount.appendChild(chip);
    return chip;
  }
  function setChip(text, color) {
    var c = ensureChip();
    if (!c) return;
    c.textContent = text;
    c.style.color = color || "#9ca3af";
  }
  function chipTime(d) {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function onChipClick() {
    var existing = localStorage.getItem(LS_TOKEN);
    var hint = existing ? "(leave empty to disconnect)" : "";
    var token = window.prompt("Dhan access token " + hint + "\n" +
      "web.dhan.co → My Profile → DhanHQ APIs → Generate Access Token (valid 24h)", existing || "");
    if (token === null) return;                       // cancelled
    if (!token.trim()) {
      disconnect();
      return;
    }
    var clientId = window.prompt("Dhan client-id (numeric, on the same profile page)", localStorage.getItem(LS_CLIENT) || "");
    if (clientId === null) return;
    localStorage.setItem(LS_TOKEN, token.trim());
    localStorage.setItem(LS_CLIENT, clientId.trim());
    setChip("Dhan: connecting…", "#facc15");
    refresh(true);
  }

  function disconnect() {
    memToken = null; memClientId = null;
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_CLIENT);
    stopPolling();
    if (window.Vault) window.Vault.forget();
    quotes = {};
    setChip("Dhan: connect", "#9ca3af");
    emit();
  }

  // In-memory credentials (preferred, set via setCreds by the vault);
  // localStorage is the legacy fallback used when the vault is not in play.
  var memToken = null, memClientId = null;
  function hasCreds() {
    return !!((memToken && memClientId) ||
      (localStorage.getItem(LS_TOKEN) && localStorage.getItem(LS_CLIENT)));
  }
  function activeToken() { return memToken || localStorage.getItem(LS_TOKEN); }
  function activeClientId() { return memClientId || localStorage.getItem(LS_CLIENT); }

  /** Set credentials from memory (e.g. after Vault.unlock). Pass nulls to clear. */
  function setCreds(token, clientId) {
    memToken = token || null;
    memClientId = clientId || null;
    if (memToken) {
      setChip("Dhan: connecting…", "#facc15");
      refresh(true).then(function () {
        if (consecutiveErrors < 3) startPolling();
      });
    } else {
      localStorage.removeItem(LS_TOKEN);
      localStorage.removeItem(LS_CLIENT);
      stopPolling();
      quotes = {};
      setChip("Dhan: connect", "#9ca3af");
      emit();
    }
  }

  // ---------- events / painting ----------
  function emit() {
    try {
      document.dispatchEvent(new CustomEvent("dhanquote", {
        detail: { quotes: quotes, at: lastFetchAt }
      }));
    } catch (e) { /* older browsers */ }
    if (typeof opts.onChange === "function") opts.onChange(quotes, lastFetchAt);
  }

  // ---------- data ----------
  function loadIds() {
    if (ids) return Promise.resolve(ids);
    return fetch(IDS_URL)
      .then(function (r) {
        if (!r.ok) throw new Error("dhan_security_ids.json HTTP " + r.status);
        return r.json();
      })
      .then(function (map) {
        ids = map;
        idToTicker = {};
        Object.keys(map).forEach(function (t) { idToTicker[map[t]] = t; });
        return map;
      })
      .catch(function (err) {
        setChip("Dhan: IDs file missing", "#f87171");
        console.error("[dhan-quotes] could not load security-ID map:", err);
        return null;
      });
  }

  function collectTickers() {
    var tickers = [];
    var seen = {};
    document.querySelectorAll("[data-ltp]").forEach(function (el) {
      var t = (el.getAttribute("data-ltp") || "").trim().toUpperCase();
      if (t && !seen[t]) { seen[t] = true; tickers.push(t); }
    });
    return tickers;
  }

  /*
   * Single-flight refresh: while one chain is in flight every caller shares it.
   * Guards that return early do NOT create a chain.
   */
  function refresh(force) {
    if (currentChain) return currentChain;
    if (!hasCreds()) {
      setChip("Dhan: connect", "#9ca3af");
      return Promise.resolve();
    }
    if (!marketOpen() && !force && lastFetchAt) {
      setChip("Dhan: market closed", "#9ca3af");
      return Promise.resolve();
    }
    setChip("Dhan: fetching…", "#facc15");

    var chain = loadIds()
      .then(function (map) {
        if (!map) return null;                        // IDs file failed; chip already set
        var tickers = collectTickers();
        if (!tickers.length) {
          setChip("Dhan: no tickers on page", "#9ca3af");
          return null;
        }
        var instruments = [];
        tickers.forEach(function (t) {
          if (map[t]) instruments.push(map[t]);
          else if (!unmapped[t]) {
            unmapped[t] = true;
            console.warn("[dhan-quotes] no NSE security ID for ticker:", t);
          }
        });
        if (!instruments.length) {
          setChip("Dhan: tickers unmapped — rerun build-dhan-ids.py", "#f87171");
          return null;
        }
        if (instruments.length > MAX_INSTRUMENTS) instruments = instruments.slice(0, MAX_INSTRUMENTS);

        return Promise.resolve(opts.getToken ? opts.getToken() : null).then(function (jwt) {
          if (!jwt) {                                 // signed out; edge call is JWT-gated
            setChip("Dhan: connect", "#9ca3af");
            return null;
          }
          return callEdge({
            instruments: { NSE_EQ: instruments },
            dhan: { token: activeToken(), clientId: activeClientId() }
          });
        });
      })
      .then(function (payload) {
        if (!payload) return;
        lastFetchAt = new Date();
        consecutiveErrors = 0;
        ingest(payload);
        setChip(marketOpen()
          ? "Dhan: live · " + chipTime(lastFetchAt)
          : "Dhan: last " + chipTime(lastFetchAt) + " · market closed", "#34d399");
        emit();
      })
      .catch(function (err) {
        consecutiveErrors += 1;
        var msg = (err && err.message) || String(err);
        console.error("[dhan-quotes] refresh failed:", msg);
        if (/401|token/i.test(msg)) {
          setChip("Dhan: token expired — reconnect", "#f87171");
          stopPolling();                              // don't hammer with a dead token
        } else if (!lastFetchAt) {
          setChip("Dhan: error — " + msg.slice(0, 42), "#f87171");   // first load failed
        } else if (consecutiveErrors >= 3) {
          setChip("Dhan: error (" + consecutiveErrors + ")", "#f87171");
        }
      })
      .then(function (v) { currentChain = null; return v; },
            function (e) { currentChain = null; throw e; });

    currentChain = chain;
    return chain;
  }

  function callEdge(body) {
    return Promise.resolve(opts.getToken ? opts.getToken() : null).then(function (jwt) {
      return fetch(EDGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": jwt ? ("Bearer " + jwt) : ""
        },
        body: JSON.stringify(body)
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) {
            var e = new Error(j.error || ("HTTP " + r.status));
            e.status = r.status;
            throw e;
          }
          return j;
        });
      });
    });
  }

  function ingest(payload) {
    var data = payload && payload.data;
    if (!data) return;
    Object.keys(data).forEach(function (segment) {         // usually "NSE_EQ"
      var perId = data[segment] || {};
      Object.keys(perId).forEach(function (secId) {
        var row = perId[secId];
        var t = idToTicker[secId];
        if (!t || !row) return;
        var ltp = Number(row.last_price);
        var prev = row.ohlc ? Number(row.ohlc.close) : NaN;
        quotes[t] = {
          ltp: isFinite(ltp) ? ltp : null,
          prevClose: isFinite(prev) ? prev : null,
          chgPct: isFinite(ltp) && isFinite(prev) && prev !== 0
            ? ((ltp - prev) / prev) * 100 : null,
          ts: Date.now()
        };
      });
    });
  }

  // ---------- scheduling ----------
  function pollMs() {
    var n = parseInt(localStorage.getItem(LS_POLL), 10);
    if (!isFinite(n) || n < MIN_POLL_MS) n = DEFAULT_POLL_MS;
    return n;
  }
  function tick() {
    if (marketOpen() || !lastFetchAt) refresh(false);
    else setChip("Dhan: market closed", "#9ca3af");
  }
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(tick, pollMs());
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ---------- public ----------
  function init(options) {
    opts = options || opts;
    ensureChip();
    if (hasCreds()) {
      refresh(true).then(function () {
        if (hasCreds() && consecutiveErrors < 3) startPolling();
      });
    } else {
      setChip("Dhan: connect", "#9ca3af");
    }
    return api;
  }

  var api = {
    init: init,
    refresh: refresh,
    disconnect: disconnect,
    setCreds: setCreds,
    quotes: function () { return quotes; },
    marketOpen: marketOpen,
    _startPolling: startPolling,
    _setPollMs: function (ms) { localStorage.setItem(LS_POLL, String(ms)); startPolling(); }
  };

  window.DhanQuotes = api;
})();
