const sb = LfcAuth.client,
  me = await LfcAuth.ready,
  isAdmin = !!me.is_admin,
  $ = (id) => document.getElementById(id);
let ideas = [],
  watch = new Set(),
  editing = null,
  period = "weekly",
  symbols = [];
const cols =
  "id,ticker,name,sector,rating,status,entry,target,stop,time_frame,risk_reward,summary,source_url,created_at,updated_at,exit_price,closed_at,closure_reason,closure_note";
const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
const money = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n)
    ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";
};
const dt = (v) =>
  v
    ? new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      }).format(new Date(v))
    : "—";
const dtt = (v) =>
  v
    ? new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
      }).format(new Date(v))
    : "—";
function show(p) {
  const page =
    p === "perf" ? "performance" : p === "admin" ? "admin" : "dashboard";
  document
    .querySelectorAll("#dashboard,#performance,#admin")
    .forEach((el) => el.classList.toggle("hidden", el.id !== page));
  document
    .querySelector(".page-heading")
    .classList.toggle("hidden", page !== "dashboard");
  document
    .querySelector(".overview-grid")
    .classList.toggle("hidden", page !== "dashboard");
}
async function loadIdeas() {
  const { data, error } = await sb
    .from("ideas")
    .select(cols)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) {
    console.error(error);
    document.getElementById("journalError").hidden = false;
    $("ideasError").classList.remove("hidden");
    return;
  }
  document.getElementById("journalError").hidden = true;
  $("ideasError").classList.add("hidden");
  ideas = data || [];
  fillYears();
  renderIdeas();
  renderAdmin();
  fillClose();
  renderPerf();
}
async function loadWatch() {
  const { data } = await sb
    .from("user_watchlist")
    .select("idea_id")
    .eq("user_id", me.id);
  watch = new Set((data || []).map((x) => x.idea_id));
  renderIdeas();
}
function filtered() {
  const q = $("search").value.toLowerCase(),
    r = $("rating").value,
    s = $("status").value,
    t = $("timeFrame").value,
    w = $("watchFilter").value;
  return ideas.filter(
    (x) =>
      (!q || `${x.ticker} ${x.name} ${x.sector}`.toLowerCase().includes(q)) &&
      (!r || x.rating === r) &&
      (!s || x.status === s) &&
      (!t || x.time_frame === t) &&
      (w !== "1" || watch.has(x.id)),
  );
}
function renderIdeas() {
  $("totalIdeas").textContent = ideas.length;
  $("activeIdeas").textContent = ideas.filter(
    (x) => x.status === "ACTIVE",
  ).length;
  $("watchCount").textContent = watch.size;
  $("outcomeCount").textContent = closed().length;
  const rows = filtered(),
    body = $("ideasBody"),
    mobile = $("mobileList");
  body.innerHTML = "";
  mobile.innerHTML = "";
  $("ideasEmpty").classList.toggle("hidden", rows.length > 0);
  rows.forEach((x) => {
    const inW = watch.has(x.id),
      tr = document.createElement("tr");
    tr.dataset.ideaId = x.id;
    tr.innerHTML = `<td><b>${esc(x.ticker)}</b></td><td>${esc(x.name)}</td><td>${dt(x.created_at)}</td><td>${esc(x.sector || "—")}</td><td>${money(x.entry)}</td><td>${money(x.target)}</td><td>${money(x.stop)}</td><td>${esc(x.time_frame || "—")}</td><td><span class="chip">${esc(x.status)}</span></td><td class="notes">${esc(x.summary || "—")}</td><td>${dt(x.updated_at)}</td><td class="${$("watchHead").classList.contains("hidden") ? "hidden" : ""}"><button data-watch="${x.id}">${inW ? "Unwatch" : "Watch"}</button></td>`;
    body.appendChild(tr);
    const c = document.createElement("article");
    c.className = "idea-card";
    c.dataset.ideaId = x.id;
    c.innerHTML = `<h3>${esc(x.ticker)} <span class="chip">${esc(x.status)}</span></h3><p class="muted">${esc(x.name)} · ${esc(x.sector || "—")}</p><p class="muted">Added ${dt(x.created_at)} · Updated ${dt(x.updated_at)}</p><div class="prices"><div><span>Observed</span><b>${money(x.entry)}</b></div><div><span>Target</span><b>${money(x.target)}</b></div><div><span>Stop</span><b>${money(x.stop)}</b></div></div><p class="muted">${esc(x.time_frame || "—")}</p><p>${esc(x.summary || "—")}</p><button data-watch="${x.id}">${inW ? "★ Watching" : "☆ Watch"}</button>`;
    mobile.appendChild(c);
  });
}
async function toggleWatch(id) {
  const has = watch.has(id),
    q = has
      ? sb
          .from("user_watchlist")
          .delete()
          .eq("user_id", me.id)
          .eq("idea_id", id)
      : sb.from("user_watchlist").insert({ user_id: me.id, idea_id: id });
  const { error } = await q;
  if (error) return alert(error.message);
  has ? watch.delete(id) : watch.add(id);
  renderIdeas();
}
function closed() {
  return ideas.filter(
    (x) =>
      x.status === "CLOSED" &&
      Number(x.entry) > 0 &&
      x.exit_price != null &&
      x.closed_at,
  );
}
function ret(x) {
  return ((Number(x.exit_price) - Number(x.entry)) / Number(x.entry)) * 100;
}
function getRows() {
  const y = $("perfYear").value,
    now = new Date(),
    all = closed().filter(
      (x) => y === "all" || new Date(x.closed_at).getFullYear() === +y,
    );
  if (period === "all" || period === "yearly")
    return all.filter(
      (x) =>
        period !== "yearly" ||
        (y === "all"
          ? new Date(x.closed_at).getFullYear() === now.getFullYear()
          : new Date(x.closed_at).getFullYear() === +y),
    );
  if (period === "monthly")
    return all.filter((x) => {
      const d = new Date(x.closed_at);
      return (
        d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
      );
    });
  if (period === "quarterly")
    return all.filter((x) => {
      const d = new Date(x.closed_at);
      return (
        d.getFullYear() === now.getFullYear() &&
        Math.floor(d.getMonth() / 3) === Math.floor(now.getMonth() / 3)
      );
    });
  const start = new Date(now);
  start.setDate(now.getDate() - 7);
  return all.filter((x) => new Date(x.closed_at) >= start);
}
function renderPerf() {
  const rows = getRows(),
    vals = rows.map(ret),
    avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  $("closedCount").textContent = rows.length;
  $("positiveCount").textContent = vals.filter((x) => x > 0).length;
  $("negativeCount").textContent = vals.filter((x) => x < 0).length;
  $("averageReturn").textContent =
    avg == null ? "—" : `${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%`;
  const b = $("performanceBody");
  b.innerHTML = "";
  $("performanceEmpty").classList.toggle("hidden", rows.length > 0);
  rows
    .sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at))
    .forEach((x) => {
      const r = ret(x),
        p = Number(x.exit_price) - Number(x.entry),
        tr = document.createElement("tr");
      tr.innerHTML = `<td>${esc(x.ticker)}</td><td>${money(x.entry)}</td><td>${money(x.exit_price)}</td><td>${dt(x.closed_at)}</td><td class="${r >= 0 ? "positive" : "negative"}">${r >= 0 ? "Positive" : "Negative"}</td><td class="${p >= 0 ? "positive" : "negative"}">${p >= 0 ? "+" : "−"}${money(Math.abs(p))}</td><td class="${r >= 0 ? "positive" : "negative"}">${r >= 0 ? "+" : ""}${r.toFixed(2)}%</td><td>${esc(x.closure_reason || "—")}</td>`;
      b.appendChild(tr);
    });
}
function fillYears() {
  const ys = [
    ...new Set(closed().map((x) => new Date(x.closed_at).getFullYear())),
  ].sort((a, b) => b - a);
  $("perfYear").innerHTML =
    `<option value="all">All years</option>` +
    ys.map((y) => `<option>${y}</option>`).join("");
}
function fillClose() {
  if (!isAdmin) return;
  $("closeIdea").innerHTML =
    `<option value="">Select an idea</option>` +
    ideas
      .filter((x) => x.status !== "CLOSED")
      .map(
        (x) =>
          `<option value="${x.id}">${esc(x.ticker)} · ${esc(x.name)}</option>`,
      )
      .join("");
}
async function closeResearch() {
  const id = $("closeIdea").value,
    p = Number($("exitPrice").value),
    when = $("closedAt").value;
  if (!id || !Number.isFinite(p) || !when)
    return alert("Select an idea, exit price and closed date");
  const { error } = await sb
    .from("ideas")
    .update({
      status: "CLOSED",
      exit_price: p,
      closed_at: new Date(when).toISOString(),
      closure_reason: $("closureReason").value,
      closure_note: $("closureNote").value.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return alert(error.message);
  alert("Research closed and result recorded");
  await loadIdeas();
}
function renderAdmin() {
  if (!isAdmin) return;
  const q = $("adminSearch").value.toLowerCase(),
    b = $("adminIdeasBody");
  b.innerHTML = "";
  const rows = ideas.filter((x) =>
    `${x.ticker} ${x.name}`.toLowerCase().includes(q),
  );
  $("adminEmpty").classList.toggle("hidden", rows.length > 0);
  rows.forEach((x) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(x.ticker)}</td><td>${esc(x.name)}</td><td>${dt(x.created_at)}</td><td>${esc(x.status)}</td><td><button data-edit="${x.id}">Edit</button> <button class="danger" data-delete="${x.id}">Delete</button></td>`;
    b.appendChild(tr);
  });
}
async function editIdea(id) {
  const { data: x, error } = await sb
    .from("ideas")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return alert(error.message);
  editing = id;
  ["ticker", "name", "sector"].forEach((k) => ($(k).value = x[k] || ""));
  $("ratingIn").value = x.rating || "UNDER REVIEW";
  $("statusIn").value = x.status || "NEW";
  $("entry").value = x.entry ?? "";
  $("target").value = x.target ?? "";
  $("stop").value = x.stop ?? "";
  $("timeIn").value = x.time_frame || "Intraday";
  $("riskReward").value = x.risk_reward || "";
  $("sourceUrl").value = x.source_url || "";
  $("summary").value = x.summary || "";
  $("adminNotes").value = x.admin_notes || "";
  show("admin");
}
async function deleteIdea(id) {
  const x = ideas.find((a) => a.id === id);
  if (!x) return;
  const t = prompt(`Type ${x.ticker} exactly to delete`);
  if (t?.toUpperCase() !== x.ticker.toUpperCase()) return;
  const { error } = await sb.from("ideas").delete().eq("id", id);
  if (error) return alert(error.message);
  await sb.from("audit_log").insert({
    user_id: me.id,
    action: "IDEA_DELETE",
    idea_id: id,
    details: { ticker: x.ticker },
  });
  await loadIdeas();
}
async function saveIdea() {
  if (!isAdmin) return;
  const p = {
    ticker: $("ticker").value.trim().toUpperCase(),
    name: $("name").value.trim(),
    sector: $("sector").value.trim(),
    rating: $("ratingIn").value,
    status: $("statusIn").value,
    entry: $("entry").value ? +$("entry").value : null,
    target: $("target").value ? +$("target").value : null,
    stop: $("stop").value ? +$("stop").value : null,
    time_frame: $("timeIn").value,
    risk_reward: $("riskReward").value.trim(),
    source_url: $("sourceUrl").value.trim(),
    summary: $("summary").value.trim(),
    admin_notes: $("adminNotes").value.trim(),
  };
  if (!p.ticker) return alert("Ticker is required");
  let q = editing
    ? sb
        .from("ideas")
        .update({ ...p, updated_at: new Date().toISOString() })
        .eq("id", editing)
    : sb.from("ideas").insert(p);
  const { error } = await q;
  if (error) return alert(error.message);
  editing = null;
  await loadIdeas();
}
function clearForm() {
  editing = null;
  [
    "ticker",
    "name",
    "sector",
    "entry",
    "target",
    "stop",
    "riskReward",
    "sourceUrl",
    "summary",
    "adminNotes",
  ].forEach((id) => ($(id).value = ""));
}
$("saveIdea").onclick = saveIdea;
$("clearIdea").onclick = clearForm;
$("closeIdeaBtn").onclick = closeResearch;
$("adminSearch").oninput = renderAdmin;
$("retryIdeas").onclick = loadIdeas;
$("retryJournal").onclick = loadIdeas;
$("perfYear").onchange = renderPerf;
["search", "rating", "status", "timeFrame", "watchFilter"].forEach(
  (id) => ($(id).oninput = renderIdeas),
);
$("toggleWatch").onclick = () => {
  $("watchHead").classList.toggle("hidden");
  renderIdeas();
};
document.querySelectorAll("[data-period]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll("[data-period]")
        .forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      period = b.dataset.period;
      renderPerf();
    }),
);
document.addEventListener("click", (e) => {
  const w = e.target.closest("[data-watch]");
  if (w) toggleWatch(w.dataset.watch);
  const ed = e.target.closest("[data-edit]");
  if (ed) editIdea(ed.dataset.edit);
  const dl = e.target.closest("[data-delete]");
  if (dl) deleteIdea(dl.dataset.delete);
});
$("ticker").oninput = () => {
  const x = symbols.find(
    (a) =>
      String(a.symbol).toUpperCase() === $("ticker").value.trim().toUpperCase(),
  );
  $("name").value = x?.name || "";
};
async function symbolsLoad() {
  try {
    const r = await fetch("india_symbols.json");
    if (!r.ok) throw new Error("india_symbols.json HTTP " + r.status);
    symbols = await r.json();
    $("symbols").innerHTML = symbols
      .map(
        (x) => `<option value="${esc(x.symbol)}">${esc(x.name || "")}</option>`,
      )
      .join("");
  } catch (e) {
    console.error(e);
  }
}
symbolsLoad();
if (location.hash === "#admin" && isAdmin) location.replace("admin.html");
if (location.hash === "#performance") location.replace("performance.html");
const requested = document.body.dataset.page;
show(
  requested === "performance"
    ? "perf"
    : requested === "admin" && isAdmin
      ? "admin"
      : "dash",
);
if (requested === "admin" && !isAdmin) location.replace("index.html");
await Promise.all([loadIdeas(), loadWatch()]);
if (isAdmin) {
  await Promise.all([loadUsers(), loadAudit()]);
}

async function loadUsers() {
  if (!isAdmin) return;
  const { data } = await sb
    .from("app_users")
    .select("*")
    .order("created_at", { ascending: false });
  $("usersBody").innerHTML = (data || [])
    .map(
      (x) =>
        `<tr><td>${esc(x.username)}</td><td>${esc(x.display_name || "")}</td><td>${x.is_admin ? "Yes" : "No"}</td><td>${x.is_active ? "Yes" : "No"}</td><td>${dt(x.created_at)}</td></tr>`,
    )
    .join("");
}
async function loadAudit() {
  if (!isAdmin) return;
  const { data } = await sb
    .from("audit_log")
    .select("*,app_users(username),ideas(ticker)")
    .order("created_at", { ascending: false })
    .limit(50);
  $("auditBody").innerHTML = (data || [])
    .map(
      (x) =>
        `<tr><td>${dtt(x.created_at)}</td><td>${esc(x.app_users?.username || "")}</td><td>${esc(x.action || "")}</td><td>${esc(x.ideas?.ticker || "")}</td><td>${esc(JSON.stringify(x.details || {}))}</td></tr>`,
    )
    .join("");
}
$("createUser").onclick = async () => {
  if (!isAdmin) return alert("Admin access is required");
  const username = $("newUsername").value.trim(),
    display_name = $("newDisplayName").value.trim(),
    password = $("newPassword").value;
  if (!username || !password)
    return alert("Username and password are required");
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session?.access_token)
    return alert("Your session has expired. Please log in again.");
  const b = $("createUser");
  b.disabled = true;
  const old = b.textContent;
  b.textContent = "Creating…";
  try {
    const { data, error } = await sb.functions.invoke("create-user", {
      body: { username, display_name, password },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error) return alert("Create user failed: " + error.message);
    if (data?.error) return alert("Create user failed: " + data.error);
    alert("User created successfully: " + username);
    $("newUsername").value = "";
    $("newDisplayName").value = "";
    $("newPassword").value = "";
    await loadUsers();
  } finally {
    b.disabled = false;
    b.textContent = old;
  }
};
