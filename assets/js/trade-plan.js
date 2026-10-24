/* Paper planning only. All amounts are INR; no broker orders or margin model. */
(function (root) {
  "use strict";
  const defaults = Object.freeze({
    capital: 50000,
    riskPct: 0.5,
    openPct: 1,
    dailyPct: 1,
    weeklyPct: 2,
    minRR: 2,
    maxTrades: 3,
    timeframe: "Intraday",
    markets: "NSE cash equities",
    session: "Verify exchange session and holidays",
    exitRule: "Fixed stop and target",
    notes: "",
  });
  function validate(p) {
    const errors = [];
    if (!Number.isFinite(p.capital) || p.capital <= 0)
      errors.push("Planning capital must be positive.");
    for (const k of ["riskPct", "openPct", "dailyPct", "weeklyPct"])
      if (!Number.isFinite(p[k]) || p[k] <= 0 || p[k] > 100)
        errors.push(k + " must be between 0 and 100%.");
    if (!Number.isFinite(p.minRR) || p.minRR <= 0 || p.minRR > 100)
      errors.push("Minimum net reward/risk must be positive and at most 100.");
    if (!Number.isInteger(p.maxTrades) || p.maxTrades < 1 || p.maxTrades > 100)
      errors.push("Daily trade limit must be an integer from 1 to 100.");
    if (
      p.riskPct > p.openPct ||
      p.openPct > p.dailyPct ||
      p.dailyPct > p.weeklyPct
    )
      errors.push(
        "Use per-trade risk ≤ open risk ≤ daily loss budget ≤ weekly loss budget.",
      );
    for (const k of ["timeframe", "markets", "session", "exitRule"])
      if (typeof p[k] !== "string" || !p[k].trim() || p[k].length > 500)
        errors.push("Complete " + k + ".");
    if (typeof p.notes !== "string" || p.notes.length > 2000)
      errors.push("Notes must be at most 2,000 characters.");
    return errors;
  }
  function load(storage, id) {
    const raw = storage.getItem("lfc.plan." + id);
    if (!raw) return { ...defaults };
    const p = JSON.parse(raw);
    if (!p || validate(p).length)
      throw new Error(
        "Saved plan is invalid. Open Trading plan and save valid limits.",
      );
    return p;
  }
  function dayKey(date) {
    const n = new Date(date).getTime();
    return Number.isFinite(n)
      ? new Date(n + 330 * 60000).toISOString().slice(0, 10)
      : null;
  }
  function weekKey(date) {
    const key = dayKey(date);
    if (!key) return null;
    const d = new Date(key + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  function exposure(trades, now = Date.now()) {
    let openRisk = 0,
      notional = 0,
      dailyLoss = 0,
      weeklyLoss = 0,
      todayCount = 0;
    for (const t of trades) {
      if (t.status === "VOID") continue;
      if (dayKey(t.opened) === dayKey(now)) todayCount++;
      if (t.status === "OPEN") {
        if (![t.entry, t.stop, t.qty].every((x) => Number.isFinite(x) && x > 0))
          throw new Error(
            "An existing paper trade has invalid sizing. Review the ledger first.",
          );
        const costs = t.estimatedCosts ?? 0;
        if (!Number.isFinite(costs) || costs < 0)
          throw new Error("An existing paper trade has invalid costs.");
        openRisk += Math.abs(t.entry - t.stop) * t.qty + costs;
        notional += t.entry * t.qty + costs;
      } else if (t.status === "CLOSED") {
        if (!Number.isFinite(t.pnl) || !dayKey(t.closedAt))
          throw new Error(
            "An existing closed trade has invalid P&L or date. Review the ledger first.",
          );
        const loss = Math.max(0, -t.pnl);
        if (dayKey(t.closedAt) === dayKey(now)) dailyLoss += loss;
        if (weekKey(t.closedAt) === weekKey(now)) weeklyLoss += loss;
      }
    }
    return { openRisk, notional, dailyLoss, weeklyLoss, todayCount };
  }
  function size(p, trades, input, now = Date.now()) {
    const errors = validate(p);
    if (errors.length) return { ok: false, reason: errors.join(" ") };
    const { entry, stop, target, step, costPerUnit, fixedCost, side } = input;
    if (
      ![entry, stop, target, step].every((x) => Number.isFinite(x) && x > 0) ||
      step < 0.00000001 ||
      ![costPerUnit, fixedCost].every((x) => Number.isFinite(x) && x >= 0)
    )
      return {
        ok: false,
        reason:
          "Enter positive entry, stop, target and quantity step; costs cannot be negative.",
      };
    if (
      !["LONG", "SHORT"].includes(side) ||
      (side === "LONG"
        ? stop >= entry || target <= entry
        : stop <= entry || target >= entry)
    )
      return {
        ok: false,
        reason: "Stop and target must be on the correct sides of entry.",
      };
    let e;
    try {
      e = exposure(trades, now);
    } catch (err) {
      return { ok: false, reason: err.message };
    }
    if (e.todayCount >= p.maxTrades)
      return {
        ok: false,
        reason: "Daily paper-trade count limit reached (IST).",
        exposure: e,
      };
    const budget = Math.min(
      (p.capital * p.riskPct) / 100,
      (p.capital * p.openPct) / 100 - e.openRisk,
      (p.capital * p.dailyPct) / 100 - e.dailyLoss - e.openRisk,
      (p.capital * p.weeklyPct) / 100 - e.weeklyLoss - e.openRisk,
    );
    const riskPerUnit = Math.abs(entry - stop) + costPerUnit;
    const cash = p.capital - e.notional;
    const maxQty = Math.min(
      (budget - fixedCost) / riskPerUnit,
      (cash - fixedCost) / (entry + costPerUnit),
    );
    const qty = Math.floor(maxQty / step) * step;
    if (!Number.isFinite(qty) || qty < step)
      return {
        ok: false,
        reason:
          "No size fits the remaining risk/capital budget and quantity step.",
        exposure: e,
      };
    const costs = qty * costPerUnit + fixedCost,
      risk = qty * Math.abs(entry - stop) + costs,
      reward = qty * Math.abs(target - entry) - costs,
      rr = reward / risk;
    if (rr < p.minRR)
      return {
        ok: false,
        reason:
          "Net reward/risk " +
          rr.toFixed(2) +
          " is below your plan minimum " +
          p.minRR +
          ". Keep levels based on the setup.",
        exposure: e,
      };
    return {
      ok: true,
      qty,
      risk,
      reward,
      rr,
      costs,
      notional: qty * entry,
      exposure: e,
    };
  }
  function netPnl(t, exit, costs) {
    if (
      !Number.isFinite(exit) ||
      exit <= 0 ||
      !Number.isFinite(costs) ||
      costs < 0
    )
      throw new Error("Enter a positive exit and non-negative total costs.");
    const gross =
      (t.side === "SHORT" ? t.entry - exit : exit - t.entry) * t.qty;
    return { gross, pnl: Math.round((gross - costs) * 100) / 100 };
  }
  const api = {
    defaults,
    validate,
    load,
    dayKey,
    weekKey,
    exposure,
    size,
    netPnl,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LfcTradePlan = api;
})(typeof window !== "undefined" ? window : globalThis);
