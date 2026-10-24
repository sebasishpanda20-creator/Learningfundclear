const user = await LfcAuth.ready;
if (user) {
  const $ = (id) => document.getElementById(id),
    keys = Object.keys(LfcTradePlan.defaults),
    numeric = keys.filter((k) => typeof LfcTradePlan.defaults[k] === "number");
  const status = $("planStatus");
  let saved;
  function summary(p) {
    $("planSummary").textContent =
      `Practice budgets: ₹${((p.capital * p.riskPct) / 100).toFixed(2)} per trade; ₹${((p.capital * p.openPct) / 100).toFixed(2)} total open risk; ₹${((p.capital * p.dailyPct) / 100).toFixed(2)} daily; ₹${((p.capital * p.weeklyPct) / 100).toFixed(2)} weekly. Capital is a manual planning amount, not your live broker balance.`;
  }
  try {
    saved = LfcTradePlan.load(localStorage, user.id);
  } catch (e) {
    status.textContent = e.message;
    saved = { ...LfcTradePlan.defaults };
  }
  keys.forEach((k) => ($(k).value = saved[k]));
  summary(saved);
  $("planForm").onsubmit = (e) => {
    e.preventDefault();
    const p = Object.fromEntries(
      keys.map((k) => [
        k,
        numeric.includes(k) ? Number($(k).value) : $(k).value.trim(),
      ]),
    );
    const errors = LfcTradePlan.validate(p);
    if (errors.length) {
      status.textContent = errors.join(" ");
      return;
    }
    try {
      localStorage.setItem("lfc.plan." + user.id, JSON.stringify(p));
      saved = p;
      summary(p);
      status.textContent = "Plan saved for this account in this browser.";
    } catch {
      status.textContent =
        "Could not save: browser storage is unavailable or full. Your plan was not updated.";
    }
  };
  $("exportPlan").onclick = () => {
    try {
      const p = LfcTradePlan.load(localStorage, user.id);
      const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              { version: 1, exportedAt: new Date().toISOString(), plan: p },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "LearningFundClear-trading-plan.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      status.textContent = e.message;
    }
  };
}
