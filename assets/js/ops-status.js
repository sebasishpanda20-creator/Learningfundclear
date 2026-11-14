/* Stack status card.
 *
 * The watchdog runs on the laptop, so ops/status.json is not reachable from a
 * browser. Each pass it upserts one row into Supabase (ops_status, id = 1) and
 * this module renders that row: last check, uptime and restart count.
 *
 * The row is readable by any signed-in user (RLS: select for authenticated);
 * only the watchdog's service-role key can write it.
 */
(function () {
  "use strict";

  var box = document.querySelector("[data-ops-status]");
  if (!box) return;

  var el = {
    state: box.querySelector("[data-ops-state]"),
    checked: box.querySelector("[data-ops-checked]"),
    uptime: box.querySelector("[data-ops-uptime]"),
    restarts: box.querySelector("[data-ops-restarts]"),
    detail: box.querySelector("[data-ops-detail]"),
  };

  // Warn in the UI if the row has gone stale (the watchdog posts every minute).
  var STALE_MS = 5 * 60 * 1000;

  function duration(ms) {
    if (!isFinite(ms) || ms < 0) return "—";
    var minutes = Math.floor(ms / 60000);
    if (minutes < 1) return "under a minute";
    var hours = Math.floor(minutes / 60);
    var days = Math.floor(hours / 24);
    if (days > 0) return days + "d " + (hours % 24) + "h";
    if (hours > 0) return hours + "h " + (minutes % 60) + "m";
    return minutes + "m";
  }

  function paint(row) {
    var online = row.status === "ONLINE";
    var checkedAt = row.checked_at ? Date.parse(row.checked_at) : NaN;
    var age = isFinite(checkedAt) ? Date.now() - checkedAt : NaN;
    var stale = isFinite(age) && age > STALE_MS;

    if (el.state) {
      el.state.textContent = stale ? "Stale" : online ? "Online" : "Offline";
      el.state.dataset.state = !stale && online ? "online" : "offline";
    }
    if (el.checked) {
      el.checked.textContent = isFinite(age) ? duration(age) + " ago" : "—";
      el.checked.dataset.state = stale ? "offline" : "online";
    }
    if (el.uptime) {
      el.uptime.textContent = row.online_since
        ? duration(Date.now() - Date.parse(row.online_since))
        : "—";
    }
    if (el.restarts) {
      el.restarts.textContent = row.restarts_last_hour == null ? "—" : String(row.restarts_last_hour);
    }
    if (el.detail) {
      var bits = [
        "daemon " + (row.daemon_up ? "up" : "down"),
        "tunnel " + (row.domain_up ? "up" : "down"),
      ];
      if (row.agent_count != null) {
        bits.push("agent" + (row.agent_count === 1 ? "" : "s") + ": " + row.agent_count);
      }
      if (row.host) bits.push("host " + row.host);
      el.detail.textContent = bits.join(" · ");
    }
  }

  async function load() {
    if (!window.LfcAuth || !window.LfcAuth.client) return;
    try {
      await window.LfcAuth.ready;
    } catch (e) {
      return;
    }
    var result = await window.LfcAuth.client
      .from("ops_status")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (result.error || !result.data) {
      if (el.state) {
        el.state.textContent = "No data";
        el.state.dataset.state = "offline";
      }
      return;
    }
    paint(result.data);
  }

  load();
  window.setInterval(load, 60000);
})();
