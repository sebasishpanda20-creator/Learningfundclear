/* Dashboard journal controller.
 * Restores the research ideas, watchlist and admin contracts without owning
 * authentication or global navigation. index.html passes an authenticated
 * Supabase client and app-user record into init().
 */
(function (global) {
  "use strict";

  var initializedFor = null;

  function init(options) {
    var sb = options && options.sb;
    var me = options && options.user;
    if (!sb || !me || !me.id) throw new Error("LfcDashboard.init requires sb and user");
    if (initializedFor === me.id) return Promise.resolve();
    initializedFor = me.id;

    var $ = function (id) { return document.getElementById(id); };
    var isAdmin = !!me.is_admin;
    var ideas = [];
    var watch = new Set();
    var editing = null;
    var symbols = [];

    var cols = [
      "id", "ticker", "name", "sector", "rating", "status",
      "entry", "target", "stop", "time_frame", "risk_reward",
      "summary", "source_url", "created_at", "updated_at",
      "exit_price", "closed_at", "closure_reason", "closure_note"
    ].join(",");

    function esc(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function money(value) {
      var n = Number(value);
      return Number.isFinite(n)
        ? "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : "—";
    }

    function dateOnly(value) {
      if (!value) return "—";
      return new Intl.DateTimeFormat("en-IN", {
        day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata"
      }).format(new Date(value));
    }

    function dateTime(value) {
      if (!value) return "—";
      return new Intl.DateTimeFormat("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata"
      }).format(new Date(value));
    }

    function syncView() {
      var wantsAdmin = location.hash === "#admin";
      var showAdmin = wantsAdmin && isAdmin;
      var dashboard = $("dashboard");
      var admin = $("admin");
      if (dashboard) dashboard.classList.toggle("hidden", showAdmin);
      if (admin) admin.classList.toggle("hidden", !showAdmin);
      if (wantsAdmin && !isAdmin) history.replaceState({}, "", "index.html");
    }

    function filteredIdeas() {
      var q = ($("search") && $("search").value || "").trim().toLowerCase();
      var rating = $("rating") ? $("rating").value : "";
      var status = $("status") ? $("status").value : "";
      var timeframe = $("timeFrame") ? $("timeFrame").value : "";
      var watchOnly = $("watchFilter") ? $("watchFilter").value : "";

      return ideas.filter(function (idea) {
        var haystack = [idea.ticker, idea.name, idea.sector].join(" ").toLowerCase();
        return (!q || haystack.indexOf(q) !== -1) &&
          (!rating || idea.rating === rating) &&
          (!status || idea.status === status) &&
          (!timeframe || idea.time_frame === timeframe) &&
          (watchOnly !== "1" || watch.has(idea.id));
      });
    }

    function renderIdeas() {
      var body = $("ideasBody");
      var mobile = $("mobileList");
      var empty = $("ideasEmpty");
      if (!body || !mobile || !empty) return;

      var rows = filteredIdeas();
      body.innerHTML = "";
      mobile.innerHTML = "";
      empty.classList.toggle("hidden", rows.length > 0);

      rows.forEach(function (idea) {
        var inWatch = watch.has(String(idea.id));
        var watchHidden = $("watchHead") && $("watchHead").classList.contains("hidden");

        var tr = document.createElement("tr");
        tr.dataset.ideaId = idea.id;
        tr.innerHTML =
          "<td><b>" + esc(idea.ticker) + "</b></td>" +
          "<td>" + esc(idea.name) + "</td>" +
          "<td>" + dateOnly(idea.created_at) + "</td>" +
          "<td>" + esc(idea.sector || "—") + "</td>" +
          "<td data-ltp=\"" + esc(idea.ticker) + "\">—</td>" +
          "<td>" + money(idea.entry) + "</td>" +
          "<td>" + money(idea.target) + "</td>" +
          "<td>" + money(idea.stop) + "</td>" +
          "<td>" + esc(idea.time_frame || "—") + "</td>" +
          "<td><span class=\"chip\">" + esc(idea.status || "—") + "</span></td>" +
          "<td class=\"notes\">" + esc(idea.summary || "—") + "</td>" +
          "<td>" + dateOnly(idea.updated_at) + "</td>" +
          "<td class=\"" + (watchHidden ? "hidden" : "") + "\"><button type=\"button\" data-watch=\"" + idea.id + "\">" +
          (inWatch ? "Unwatch" : "Watch") + "</button></td>";
        body.appendChild(tr);

        var card = document.createElement("article");
        card.className = "idea-card";
        card.dataset.ideaId = idea.id;
        card.innerHTML =
          "<div class=\"idea-card-head\"><h3>" + esc(idea.ticker) +
          "</h3><span class=\"chip\">" + esc(idea.status || "—") + "</span></div>" +
          "<p class=\"muted\">" + esc(idea.name) + " · " + esc(idea.sector || "—") + "</p>" +
          "<p class=\"muted\">Added " + dateOnly(idea.created_at) + " · Updated " + dateOnly(idea.updated_at) + "</p>" +
          "<div class=\"prices\">" +
          "<div><span>LTP</span><b data-ltp=\"" + esc(idea.ticker) + "\">—</b></div>" +
          "<div><span>Observed</span><b>" + money(idea.entry) + "</b></div>" +
          "<div><span>Target</span><b>" + money(idea.target) + "</b></div>" +
          "<div><span>Stop</span><b>" + money(idea.stop) + "</b></div></div>" +
          "<p class=\"muted\">" + esc(idea.time_frame || "—") + "</p>" +
          "<p>" + esc(idea.summary || "—") + "</p>" +
          "<button type=\"button\" data-watch=\"" + idea.id + "\">" +
          (inWatch ? "★ Watching" : "☆ Watch") + "</button>";
        mobile.appendChild(card);
      });
    }

    async function loadIdeas() {
      var result = await sb.from("ideas").select(cols)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (result.error) {
        console.error(result.error);
        if ($("ideasError")) $("ideasError").classList.remove("hidden");
        return;
      }

      if ($("ideasError")) $("ideasError").classList.add("hidden");
      ideas = result.data || [];
      renderIdeas();
      renderAdmin();
      fillClose();
    }

    async function loadWatch() {
      var result = await sb.from("user_watchlist").select("idea_id").eq("user_id", me.id);
      if (result.error) {
        console.error(result.error);
        watch = new Set();
      } else {
        watch = new Set((result.data || []).map(function (row) { return String(row.idea_id); }));
      }
      renderIdeas();
    }

    async function toggleWatch(id) {
      id = String(id);
      var has = watch.has(id);
      var query = has
        ? sb.from("user_watchlist").delete().eq("user_id", me.id).eq("idea_id", id)
        : sb.from("user_watchlist").insert({ user_id: me.id, idea_id: id });
      var result = await query;
      if (result.error) {
        alert(result.error.message);
        return;
      }
      if (has) watch.delete(id); else watch.add(id);
      renderIdeas();
    }

    function fillClose() {
      if (!isAdmin || !$("closeIdea")) return;
      $("closeIdea").innerHTML =
        '<option value="">Select an idea</option>' +
        ideas.filter(function (idea) { return idea.status !== "CLOSED"; })
          .map(function (idea) {
            return '<option value="' + idea.id + '">' + esc(idea.ticker) + " · " + esc(idea.name) + "</option>";
          }).join("");
    }

    async function closeResearch() {
      if (!isAdmin) return;
      var id = $("closeIdea").value;
      var exitPrice = Number($("exitPrice").value);
      var closedAt = $("closedAt").value;
      if (!id || !Number.isFinite(exitPrice) || !closedAt) {
        alert("Select an idea, exit price and closed date");
        return;
      }

      var result = await sb.from("ideas").update({
        status: "CLOSED",
        exit_price: exitPrice,
        closed_at: new Date(closedAt).toISOString(),
        closure_reason: $("closureReason").value,
        closure_note: $("closureNote").value.trim(),
        updated_at: new Date().toISOString()
      }).eq("id", id);

      if (result.error) {
        alert(result.error.message);
        return;
      }

      $("exitPrice").value = "";
      $("closedAt").value = "";
      $("closureNote").value = "";
      await loadIdeas();
    }

    function renderAdmin() {
      if (!isAdmin || !$("adminIdeasBody")) return;
      var q = ($("adminSearch").value || "").toLowerCase();
      var rows = ideas.filter(function (idea) {
        return (String(idea.ticker || "") + " " + String(idea.name || "")).toLowerCase().indexOf(q) !== -1;
      });

      $("adminIdeasBody").innerHTML = "";
      $("adminEmpty").classList.toggle("hidden", rows.length > 0);

      rows.forEach(function (idea) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" + esc(idea.ticker) + "</td>" +
          "<td>" + esc(idea.name) + "</td>" +
          "<td>" + dateOnly(idea.created_at) + "</td>" +
          "<td>" + esc(idea.status || "—") + "</td>" +
          "<td><button type=\"button\" data-edit=\"" + idea.id + "\">Edit</button> " +
          "<button type=\"button\" class=\"danger\" data-delete=\"" + idea.id + "\">Delete</button></td>";
        $("adminIdeasBody").appendChild(tr);
      });
    }

    async function editIdea(id) {
      if (!isAdmin) return;
      var result = await sb.from("ideas").select("*").eq("id", id).single();
      if (result.error) {
        alert(result.error.message);
        return;
      }
      var idea = result.data;
      editing = id;
      ["ticker", "name", "sector"].forEach(function (key) {
        $(key).value = idea[key] || "";
      });
      $("ratingIn").value = idea.rating || "UNDER REVIEW";
      $("statusIn").value = idea.status || "NEW";
      $("entry").value = idea.entry == null ? "" : idea.entry;
      $("target").value = idea.target == null ? "" : idea.target;
      $("stop").value = idea.stop == null ? "" : idea.stop;
      $("timeIn").value = idea.time_frame || "Intraday";
      $("riskReward").value = idea.risk_reward || "";
      $("sourceUrl").value = idea.source_url || "";
      $("summary").value = idea.summary || "";
      $("adminNotes").value = idea.admin_notes || "";
      if (location.hash !== "#admin") location.hash = "admin";
      syncView();
      $("ticker").focus();
    }

    async function deleteIdea(id) {
      if (!isAdmin) return;
      var idea = ideas.find(function (row) { return String(row.id) === String(id); });
      if (!idea) return;
      var typed = prompt("Type " + idea.ticker + " exactly to delete");
      if (!typed || typed.toUpperCase() !== String(idea.ticker).toUpperCase()) return;

      var result = await sb.from("ideas").delete().eq("id", id);
      if (result.error) {
        alert(result.error.message);
        return;
      }
      await sb.from("audit_log").insert({
        user_id: me.id,
        action: "IDEA_DELETE",
        idea_id: id,
        details: { ticker: idea.ticker }
      });
      await loadIdeas();
    }

    async function saveIdea() {
      if (!isAdmin) return;
      var payload = {
        ticker: $("ticker").value.trim().toUpperCase(),
        name: $("name").value.trim(),
        sector: $("sector").value.trim(),
        rating: $("ratingIn").value,
        status: $("statusIn").value,
        entry: $("entry").value ? Number($("entry").value) : null,
        target: $("target").value ? Number($("target").value) : null,
        stop: $("stop").value ? Number($("stop").value) : null,
        time_frame: $("timeIn").value,
        risk_reward: $("riskReward").value.trim(),
        source_url: $("sourceUrl").value.trim(),
        summary: $("summary").value.trim(),
        admin_notes: $("adminNotes").value.trim()
      };

      if (!payload.ticker) {
        alert("Ticker is required");
        return;
      }

      var query = editing
        ? sb.from("ideas").update(Object.assign({}, payload, { updated_at: new Date().toISOString() })).eq("id", editing)
        : sb.from("ideas").insert(payload);

      var result = await query;
      if (result.error) {
        alert(result.error.message);
        return;
      }
      clearForm();
      await loadIdeas();
    }

    function clearForm() {
      editing = null;
      ["ticker", "name", "sector", "entry", "target", "stop", "riskReward", "sourceUrl", "summary", "adminNotes"]
        .forEach(function (id) { if ($(id)) $(id).value = ""; });
      if ($("ratingIn")) $("ratingIn").value = "UNDER REVIEW";
      if ($("statusIn")) $("statusIn").value = "NEW";
      if ($("timeIn")) $("timeIn").value = "Intraday";
    }

    async function loadUsers() {
      if (!isAdmin || !$("usersBody")) return;
      var result = await sb.from("app_users").select("*").order("created_at", { ascending: false });
      if (result.error) {
        console.error(result.error);
        return;
      }
      $("usersBody").innerHTML = (result.data || []).map(function (user) {
        return "<tr><td>" + esc(user.username) + "</td><td>" + esc(user.display_name || "") +
          "</td><td>" + (user.is_admin ? "Yes" : "No") + "</td><td>" +
          (user.is_active ? "Yes" : "No") + "</td><td>" + dateOnly(user.created_at) + "</td></tr>";
      }).join("");
    }

    async function loadAudit() {
      if (!isAdmin || !$("auditBody")) return;
      var result = await sb.from("audit_log")
        .select("*,app_users(username),ideas(ticker)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (result.error) {
        console.error(result.error);
        return;
      }
      $("auditBody").innerHTML = (result.data || []).map(function (row) {
        return "<tr><td>" + dateTime(row.created_at) + "</td><td>" +
          esc(row.app_users && row.app_users.username || "") + "</td><td>" +
          esc(row.action || "") + "</td><td>" +
          esc(row.ideas && row.ideas.ticker || "") + "</td><td>" +
          esc(JSON.stringify(row.details || {})) + "</td></tr>";
      }).join("");
    }

    async function createUser() {
      if (!isAdmin) {
        alert("Admin access is required");
        return;
      }
      var username = $("newUsername").value.trim();
      var displayName = $("newDisplayName").value.trim();
      var password = $("newPassword").value;
      if (!username || !password) {
        alert("Username and password are required");
        return;
      }

      var sessionResult = await sb.auth.getSession();
      var session = sessionResult.data && sessionResult.data.session;
      if (!session || !session.access_token) {
        alert("Your session has expired. Please log in again.");
        return;
      }

      var button = $("createUser");
      var oldText = button.textContent;
      button.disabled = true;
      button.textContent = "Creating…";
      try {
        var result = await sb.functions.invoke("create-user", {
          body: { username: username, display_name: displayName, password: password },
          headers: { Authorization: "Bearer " + session.access_token }
        });
        if (result.error) {
          alert("Create user failed: " + result.error.message);
          return;
        }
        if (result.data && result.data.error) {
          alert("Create user failed: " + result.data.error);
          return;
        }
        $("newUsername").value = "";
        $("newDisplayName").value = "";
        $("newPassword").value = "";
        await loadUsers();
      } finally {
        button.disabled = false;
        button.textContent = oldText;
      }
    }

    async function loadSymbols() {
      try {
        var response = await fetch("india_symbols.json");
        if (!response.ok) throw new Error("india_symbols.json HTTP " + response.status);
        symbols = await response.json();
        if ($("symbols")) {
          $("symbols").innerHTML = symbols.map(function (item) {
            return '<option value="' + esc(item.symbol) + '">' + esc(item.name || "") + "</option>";
          }).join("");
        }
      } catch (error) {
        console.error(error);
      }
    }

    function bindEvents() {
      ["search", "rating", "status", "timeFrame", "watchFilter"].forEach(function (id) {
        if ($(id)) $(id).addEventListener("input", renderIdeas);
      });

      if ($("toggleWatch")) {
        $("toggleWatch").addEventListener("click", function () {
          if ($("watchHead")) $("watchHead").classList.toggle("hidden");
          renderIdeas();
        });
      }
      if ($("retryIdeas")) $("retryIdeas").addEventListener("click", loadIdeas);
      if ($("adminSearch")) $("adminSearch").addEventListener("input", renderAdmin);
      if ($("saveIdea")) $("saveIdea").addEventListener("click", saveIdea);
      if ($("clearIdea")) $("clearIdea").addEventListener("click", clearForm);
      if ($("closeIdeaBtn")) $("closeIdeaBtn").addEventListener("click", closeResearch);
      if ($("createUser")) $("createUser").addEventListener("click", createUser);

      if ($("ticker")) {
        $("ticker").addEventListener("input", function () {
          var value = $("ticker").value.trim().toUpperCase();
          var found = symbols.find(function (item) {
            return String(item.symbol || "").toUpperCase() === value;
          });
          $("name").value = found && found.name || "";
        });
      }

      document.addEventListener("click", function (event) {
        var watchButton = event.target.closest("[data-watch]");
        if (watchButton) {
          toggleWatch(watchButton.dataset.watch);
          return;
        }
        var editButton = event.target.closest("[data-edit]");
        if (editButton) {
          editIdea(editButton.dataset.edit);
          return;
        }
        var deleteButton = event.target.closest("[data-delete]");
        if (deleteButton) deleteIdea(deleteButton.dataset.delete);
      });

      global.addEventListener("hashchange", syncView);
    }

    bindEvents();
    syncView();

    return Promise.all([
      loadIdeas(),
      loadWatch(),
      loadSymbols(),
      isAdmin ? loadUsers() : Promise.resolve(),
      isAdmin ? loadAudit() : Promise.resolve()
    ]).then(function () {
      syncView();
    });
  }

  global.LfcDashboard = { init: init };
})(window);
