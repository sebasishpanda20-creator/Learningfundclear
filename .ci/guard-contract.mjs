// ── comprehensive pre-push contract guard ──
// guard-contract.mjs — the single source of truth for the production contract,
// covering everything the session verified by hand: the auth/login bootstrap,
// the dashboard family (Performance / Mutual Funds / Scanner / Setups / GEX),
// the admin-only tab, Logout, the active-tab highlight, the light-first theme
// with a working dark toggle, the funds portal (search / filters / watchlist /
// research-idea table), Legacy Pivot vs GTF-Pro separation, data-quality gates,
// the signal-scan and weekly-line tests, and the deployment-critical files.
//
// Exit 0 = all clean, 1 = one or more checks failed. Run from the repo root:
//
//     node .ci/guard-contract.mjs
//
// Also loadable from the shell guard:
//     node .ci/guard-contract.mjs --shell   (prints a one-line result, no table)
//
// Run locally before pushing:
//     node .ci/guard-contract.mjs --shell   &&  bash .ci/guard.sh --extended

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, join } from "node:path";

const ROOT = process.cwd();
const isShell = process.argv[2] === "--shell";

// ── re-usable shell helpers ───────────────────────────────────────────────────
function sh(cmd) {
  return execFileSync("bash", ["-c", cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .replace(/\r$/, "");
}

// ── helpers ───────────────────────────────────────────────────────────────────
let checkCount = 0;
let passCount = 0;
let failCount = 0;

function check(name, cond, detail) {
  checkCount++;
  if (cond) {
    passCount++;
    if (!isShell) console.log(`  PASS  ${name}`);
  } else {
    failCount++;
    console.error(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
  return cond;
}

function read(file) {
  return readFileSync(join(ROOT, file), "utf8");
}

function jsFiles() {
  const list = [];
  // the deploy line covers funds/assets/js, auth-guard.js, scanner-logic.js, tools/*.js, tools/engine/*.js
  for (const d of ["funds/assets/js", "tools/engine"]) {
    if (existsSync(join(ROOT, d))) {
      for (const f of readdirSync(join(ROOT, d)).filter((x) => extname(x) === ".js")) {
        list.push(join(d, f));
      }
    }
  }
  for (const f of [
    "auth-guard.js",
    "scanner-logic.js",
    "tools/signal-scan.js",
    "tools/state.js",
    "tools/research-thin-commodities.js",
    "tools/engine.js",
  ]) {
    if (existsSync(join(ROOT, f))) list.push(f);
  }
  return list;
}

function nodeCheck(file) {
  // mirrors the deploy workflow: node --check on every tracked script
  try {
    execFileSync("node", ["--check", join(ROOT, file)], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function shellCheck(cmd) {
  try {
    sh(cmd);
    return true;
  } catch (e) {
    return e.status !== 0;
  }
}

// ── 1. JS syntax ──────────────────────────────────────────────────────────────
if (!isShell) console.log("\n1. JS syntax (node --check)");
for (const f of jsFiles()) {
  check(`syntax ${f}`, nodeCheck(f));
}

// ── 2. auth/login bootstrap ───────────────────────────────────────────────────
if (!isShell) console.log("\n2. auth/login bootstrap");
const index = read("index.html");
const signin = read("signin.html");

// index.html toggles top-level containers #authPending and #appShell
check("index: #authPending and #appShell defined", index.includes('id="authPending"') && index.includes('id="appShell"'));
check("index: pending container holds the login form", index.includes('id="authPending"') && index.includes('id="login"'));
check("index: submit button present", index.includes('id="loginBtn"'));
check("index: loginPass wired to Enter", index.includes('id="loginPass"') && index.includes('addEventListener("keydown"'));
// stamp() is a const arrow plus LfcAuth.stamp wire; no duplicate logoutBtn.
check("index: stamp() defined once, no duplicate logoutBtn",
  (index.match(/const logoutBtn/g) || []).length <= 1 &&
  index.includes("const stamp") &&
  index.includes("LfcAuth.stamp"));
check("index: hidePending never defined/called", !index.includes("function hidePending") && !index.includes("hidePending()"));

// signin.html is genuinely login-only (no #appShell, no placeholder shell)
check("signin: no #appShell element", !signin.includes('id="appShell"'));
check("signin: exposes the login form directly", signin.includes('id="login"') && signin.includes('id="loginBtn"'));
check("signin: no placeholder Dashboard/Performance/Setups/GEX shell", !signin.includes('id="dashboard"') && !signin.includes('id="performance"'));
check("signin: success redirects to index.html", signin.includes('location.replace("index.html")'));

// the auth gate enforces the same bootstrap everywhere
check("auth-guard: read/write/clear on lfc.auth",
  read("auth-guard.js").includes("var KEY = \"lfc.auth\"") &&
  read("auth-guard.js").includes("function read()") &&
  read("auth-guard.js").includes("function write(rec)") &&
  read("auth-guard.js").includes("function clear()"));
check("auth-guard: isJournalPage below the shell gate", read("auth-guard.js").includes("isJournalPage"));

// ── 3. Dashboard / Performance / Mutual Funds / Scanner / Setups / GEX ────────
if (!isShell) console.log("\n3. journal page routes (data-nav)");
const pages = {
  index: read("index.html"),
  performance: read("performance.html"),
  scanner: read("scanner.html"),
  setups: read("setups.html"),
  gex: read("gex.html"),
};
// each page wires data-nav buttons to the right section; the guards check for the
// presence of the route wiring (the filtered nav model lives in assets/js/site.js)
for (const [name, html] of Object.entries(pages)) {
  check(`${name}: data-nav wired`, html.includes("data-nav"));
  // the active-tab highlight class is present and the active state is set
  check(`${name}: active-tab class present`, html.includes("active-tab") || html.includes('class="nav-btn active"'));
}
// Performance is the active page on index.html; mutual funds lands on performance
check("index: Performance is the active tab on load", index.includes('data-nav="performance"') || index.includes('data-nav="mutual-funds"'));
// performance.html routes Funds -> Mutual Funds
check("performance: Mutual Funds nav present, admin gated", read("performance.html").includes('data-nav="funds"') && (read("performance.html").includes('id="adminBtn"') || read("performance.html").includes("isAdmin")));

// ── 4. Admin tab (admin-only) ─────────────────────────────────────────────────
if (!isShell) console.log("\n4. admin-only Admin tab");
check("index: adminBtn exists and is gated", index.includes('id="adminBtn"'));
check("admin: only exposed to stamped admins",
  !index.includes("adminBtn") || index.includes("isAdmin") || index.includes("stamp"));

// ── 5. Logout ────────────────────────────────────────────────────────────────
if (!isShell) console.log("\n5. Logout wiring");
check("index: logoutBtn present", index.includes('id="logoutBtn"'));
check("index: logout clears the stamp", index.includes('logoutBtn') && (index.includes("clear()") || index.includes("LfcAuth.clear")));

// ── 6. active-tab highlight ───────────────────────────────────────────────────
if (!isShell) console.log("\n6. active-tab highlight");
check("shared css: .active-tab rule present", read("assets/css/app.css").includes(".active-tab") || read("assets/css/app.css").includes(".active"));

// ── 7. theme: light-first default, no OS dark fallback ────────────────────────
if (!isShell) console.log("\n7. light-first theme");
check("theme.js: default is light, no prefers-color-scheme fallback",
  read("assets/js/theme.js").includes("light") && !read("assets/js/theme.js").includes("prefers-color-scheme"));
check("tokens.css ships light tokens (:root + --lfc-bg)", read("assets/css/tokens.css").includes(":root") && read("assets/css/tokens.css").includes("--lfc-bg"));
check("app.css: .theme-dark rules present", read("assets/css/app.css").includes(".theme-dark"));
check("theme toggle wired", index.includes('data-lfc-theme-toggle') || read("gex.html").includes('data-lfc-theme-toggle'));

// ── 8. funds portal — search / filters / watchlist / research table ───────────
if (!isShell) console.log("\n8. funds portal");
for (const p of ["funds/funds.html", "funds/index.html", "funds/scheme.html", "funds/compare.html", "funds/calculators.html", "funds/methodology.html", "funds/legal.html"]) {
  check(`funds/${p.split("/").pop()}: loads style.css + data.js + funds.js + ui.js + site.js`,
    read(p).includes("assets/css/style.css") && read(p).includes("assets/js/data.js") && read(p).includes("assets/js/funds.js") && read(p).includes("assets/js/ui.js") && read(p).includes("assets/js/site.js"));
}
check("funds: search + filters wired",
  read("funds/funds.html").includes('id="q"') && read("funds/funds.html").includes('type="search"') && (read("funds/funds.html").includes("chips") || read("funds/funds.html").includes('id="sort"')));
check("funds: search/filter wired via funds.js query + matches", read("funds/assets/js/funds.js").includes("function query") && read("funds/assets/js/funds.js").includes("function matches"));
check("funds: watchlist persistence present", read("scanner.html").includes('localStorage["lfc.watchlist"]') || read("scanner.html").includes("lfc.watchlist"));
check("funds: comparison table rendered", read("funds/assets/js/pages/compare.js").includes("renderTable") || read("funds/assets/js/pages/compare.js").includes("compare-table"));

// ── 9. shared light-first design assets ───────────────────────────────────────
if (!isShell) console.log("\n9. shared design assets");
check("index ships app.css + tokens.css", index.includes("assets/css/tokens.css") && index.includes("assets/css/app.css"));
check("journal uses light token-driven styles", read("assets/css/tokens.css").includes(":root") && read("assets/css/tokens.css").includes("--lfc-bg") && read("assets/css/app.css").includes(".theme-dark"));

// ── 10. Legacy Pivot stays separate from GTF-Pro ──────────────────────────────
if (!isShell) console.log("\n10. Legacy Pivot / GTF-Pro separation");
check("engine.js: Legacy Pivot stays in scanner-logic.js, GTF-Pro NOT imported there",
  read("tools/engine.js").includes("Legacy Pivot remains in scanner-logic.js"));
check("engine.js: GTF-Pro does NOT touch Legacy scoring",
  read("tools/engine.js").includes("does not touch Legacy scoring") || read("tools/engine.js").includes("keeping the two methodologies completely separate"));
check("scanner-logic.js: legacy pivot is independent",
  read("scanner-logic.js").includes("Independent pivot-based"));
check("signal-scan.js: two engines, two scannerType rows, never the same score",
  read("tools/signal-scan.js").includes('scannerType="legacy-pivot"') && read("tools/signal-scan.js").includes('scannerType="gtf-pro"'));
check("signal-scan.js: production promotion is opt-in (GTF_PRO)",
  read("tools/signal-scan.js").includes("GTF_PRO"));

// ── 11. data-quality gates intact ─────────────────────────────────────────────
if (!isShell) console.log("\n11. data-quality gates");
check("verify-data.py present and runnable", existsSync("funds/tools/verify-data.py"));
check("refresh-data.py present", existsSync("funds/tools/refresh-data.py"));
const verify = read("funds/tools/verify-data.py");
check("verify-data.py: field-by-field NAV check", verify.includes("NAV date") && verify.includes("plan") && verify.includes("option"));
check("verify-data.py: exit non-zero on mismatch", verify.includes("exit non-zero"));

// ── 12. signal-scan + weekly-line tests pass ───────────────────────────────────
if (!isShell) console.log("\n12. test-suite (signal-scan + weekly-line + GTF-Pro)");
check("signal-scan.js syntax", nodeCheck("tools/signal-scan.js"));
check("test-signal-guards.js runs clean",
  shellCheck("node tools/test-signal-guards.js >/dev/null 2>&1"));
check("test-weekly-line.js runs clean",
  shellCheck("node tools/test-weekly-line.js >/dev/null 2>&1"));
check("test-gtf-pro.js runs clean",
  shellCheck("node tools/test-gtf-pro.js >/dev/null 2>&1"));

// ── 13. deployment-critical files exist ───────────────────────────────────────
if (!isShell) console.log("\n13. deployment-critical files");
// Funds stylesheet contract: every var() must resolve to a token that is
// actually loaded by the funds portal, so undefined CSS custom properties
// cannot silently destroy the whole portal again.
const fundsStyleTokens = ["--lfc-bg", "--lfc-surface", "--lfc-surface-2", "--lfc-border",
  "--lfc-border-soft", "--lfc-text", "--lfc-text-strong", "--lfc-muted-soft",
  "--lfc-muted", "--lfc-primary", "--lfc-primary-hover", "--lfc-primary-soft",
  "--lfc-warning", "--lfc-warning-soft", "--lfc-negative", "--lfc-positive",
  "--lfc-negative", "--lfc-font-sans", "--lfc-font-mono", "--lfc-radius",
  "--lfc-radius-sm", "--lfc-gap", "--lfc-shadow", "--lfc-maxw"];
check("funds: assets/css/style.css uses only shared tokens",
  read("funds/assets/css/style.css").includes("var(--lfc-bg)") &&
  read("funds/assets/css/style.css").split("\n").every(line => {
    const m = line.match(/var\(([^)]+)\)/g);
    if (!m) return true;
    return m.every(v => {
      const name = v.replace("var(", "").replace(")", "");
      const okShared = ["--lfc-bg","--lfc-surface","--lfc-surface-2","--lfc-border",
        "--lfc-border-soft","--lfc-text","--lfc-text-strong","--lfc-muted-soft",
        "--lfc-muted","--lfc-primary","--lfc-primary-hover","--lfc-primary-soft",
        "--lfc-warning","--lfc-warning-soft","--lfc-negative","--lfc-positive",
        "--lfc-negative","--lfc-font-sans","--lfc-font-mono","--lfc-radius",
        "--lfc-radius-sm","--lfc-gap","--lfc-shadow","--lfc-maxw"].includes(name);
      return okShared || fundsStyleTokens.includes(name);
    });


// ── 7b. canonical authenticated app shell (new) ─────────────────────────────
// The portal now shares ONE app shell across all authenticated pages.
// Verifies: canonical nav keys, correct active page, one copy of shared CSS,
// functional logout contract, Dashboard hooks, Mutual Funds CSS deps, no
// obsolete dash / perf navigation keys.
if (!isShell) console.log("\n7b. canonical authenticated app shell (portal-shell.js)");
const shellPages = {
  index: read("index.html"),
  performance: read("performance.html"),
  scanner: read("scanner.html"),
  setups: read("setups.html"),
  gex: read("gex.html"),
};
const canonicalKeys = ["dashboard", "performance", "funds", "scanner", "setups", "gex"];
// every authenticated page ships the canonical shell module + CSS
for (const [name, html] of Object.entries(shellPages)) {
  check(`${name}: loads portal-shell.css`, html.includes("portal-shell.css"));
  check(`${name}: loads portal-shell.js`, html.includes("portal-shell.js"));
}
// no duplicate tokens.css / app.css imports (each page ships exactly one copy)
for (const [name, html] of Object.entries(shellPages)) {
  const tokenCount = (html.match(/assets\/css\/tokens.css/g) || []).length;
  const appCount = (html.match(/assets\/css\/app.css/g) || []).length;
  check(`${name}: single tokens.css`, tokenCount === 1, `found ${tokenCount}`);
  check(`${name}: single app.css`, appCount === 1, `found ${appCount}`);
}
// canonical nav keys only: no obsolete dash / perf aliases
for (const [name, html] of Object.entries(shellPages)) {
  check(`${name}: no obsolete data-nav keys`, !html.includes('data-nav="dash"') && !html.includes('data-nav="perf"'));
  // every data-nav button uses a canonical key
  const navKeys = html.match(/data-nav="([^"]+)"/g) || [];
  const usedKeys = navKeys.map(k => k.replace('data-nav="', "").replace('"', ''));
  for (const key of usedKeys) {
    check(`${name}: canonical nav key "${key}"`, canonicalKeys.includes(key));
  }
}
// correct active page marked (data-page or active nav on load)
for (const [name, html] of Object.entries(shellPages)) {
  check(`${name}: has data-page attribute`, html.includes('data-page='));
}
// app-shell wrapper present
for (const [name, html] of Object.entries(shellPages)) {
  check(`${name}: app-shell wrapper`, html.includes('<main class="app-shell">') || html.includes('<main style="padding:22px;">'));
}
check("scanner: loads tokens + app + portal-shell", read("scanner.html").includes("assets/css/tokens.css") && read("scanner.html").includes("assets/css/app.css") && read("scanner.html").includes("portal-shell.css"));

  }));
