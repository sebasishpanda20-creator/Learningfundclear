/* Research outcome tracker for performance.html */
(function (global) {
  "use strict";

  var initialized = false;

  function init(options) {
    if (initialized) return Promise.resolve();
    initialized = true;

    var sb = options && options.sb;
    if (!sb) throw new Error("LfcPerformance.init requires sb");

    var $ = function (id) { return document.getElementById(id); };
    var ideas = [];
    var period = "weekly";

    function esc(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
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

    function closedIdeas() {
      return ideas.filter(function (idea) {
        return idea.status === "CLOSED" &&
          idea.entry != null && idea.exit_price != null && idea.closed_at;
      });
    }

    function returnPct(idea) {
      var entry = Number(idea.entry);
      var exit = Number(idea.exit_price);
      return entry !== 0 ? ((exit - entry) / entry) * 100 : 0;
    }

    function selectedRows() {
      var now = new Date();
      var selectedYear = $("perfYear") ? $("perfYear").value : "all";
      var rows = closedIdeas();

      if (selectedYear !== "all") {
        rows = rows.filter(function (idea) {
          return new Date(idea.closed_at).getFullYear() === Number(selectedYear);
        });
      }

      if (period === "all") return rows;

      if (period === "yearly") {
        var year = selectedYear === "all" ? now.getFullYear() : Number(selectedYear);
        return rows.filter(function (idea) {
          return new Date(idea.closed_at).getFullYear() === year;
        });
      }

      if (period === "monthly") {
        return rows.filter(function (idea) {
          var d = new Date(idea.closed_at);
          return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        });
      }

      if (period === "quarterly") {
        var q = Math.floor(now.getMonth() / 3);
        return rows.filter(function (idea) {
          var d = new Date(idea.closed_at);
          return d.getFullYear() === now.getFullYear() && Math.floor(d.getMonth() / 3) === q;
        });
      }

      var start = new Date(now);
      start.setDate(now.getDate() - 7);
      return rows.filter(function (idea) {
        return new Date(idea.closed_at) >= start;
      });
    }

    function fillYears() {
      if (!$("perfYear")) return;
      var years = Array.from(new Set(closedIdeas().map(function (idea) {
        return new Date(idea.closed_at).getFullYear();
      }))).sort(function (a, b) { return b - a; });

      $("perfYear").innerHTML = '<option value="all">All years</option>' +
        years.map(function (year) {
          return '<option value="' + year + '">' + year + "</option>";
        }).join("");
    }

    function render() {
      var rows = selectedRows().slice().sort(function (a, b) {
        return new Date(b.closed_at) - new Date(a.closed_at);
      });
      var returns = rows.map(returnPct);
      var avg = returns.length
        ? returns.reduce(function (sum, value) { return sum + value; }, 0) / returns.length
        : null;

      $("closedCount").textContent = rows.length;
      $("positiveCount").textContent = returns.filter(function (value) { return value > 0; }).length;
      $("negativeCount").textContent = returns.filter(function (value) { return value < 0; }).length;
      $("averageReturn").textContent = avg == null ? "—" : (avg >= 0 ? "+" : "") + avg.toFixed(2) + "%";

      var body = $("performanceBody");
      body.innerHTML = "";
      $("performanceEmpty").classList.toggle("hidden", rows.length > 0);

      rows.forEach(function (idea) {
        var pct = returnPct(idea);
        var pnl = Number(idea.exit_price) - Number(idea.entry);
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td><b>" + esc(idea.ticker) + "</b></td>" +
          "<td>" + money(idea.entry) + "</td>" +
          "<td>" + money(idea.exit_price) + "</td>" +
          "<td>" + dateOnly(idea.closed_at) + "</td>" +
          '<td class="' + (pct >= 0 ? "positive" : "negative") + '">' + (pct >= 0 ? "Positive" : "Negative") + "</td>" +
          '<td class="' + (pnl >= 0 ? "positive" : "negative") + '">' + (pnl >= 0 ? "+" : "−") + money(Math.abs(pnl)) + "</td>" +
          '<td class="' + (pct >= 0 ? "positive" : "negative") + '">' + (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%</td>" +
          "<td>" + esc(idea.closure_reason || "—") + "</td>";
        body.appendChild(tr);
      });
    }

    async function load() {
      var result = await sb.from("ideas")
        .select("id,ticker,status,entry,exit_price,closed_at,closure_reason")
        .order("closed_at", { ascending: false });

      if (result.error) {
        console.error(result.error);
        $("performanceEmpty").textContent = "Could not load performance data.";
        $("performanceEmpty").classList.remove("hidden");
        return;
      }

      ideas = result.data || [];
      fillYears();
      render();
    }

    document.querySelectorAll("[data-period]").forEach(function (button) {
      button.addEventListener("click", function () {
        document.querySelectorAll("[data-period]").forEach(function (item) {
          item.classList.remove("active");
        });
        button.classList.add("active");
        period = button.dataset.period;
        render();
      });
    });

    if ($("perfYear")) $("perfYear").addEventListener("change", render);

    return load();
  }

  global.LfcPerformance = { init: init };
})(window);
