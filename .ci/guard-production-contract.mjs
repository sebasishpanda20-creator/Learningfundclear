import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let failed = 0;

function fail(message) {
  console.error("FAIL " + message);
  failed = 1;
}

function pass(message) {
  console.log("OK   " + message);
}

function requireFile(path) {
  if (!existsSync(path)) fail("missing required file: " + path);
  return existsSync(path);
}

function read(path) {
  if (!requireFile(path)) return "";
  return readFileSync(path, "utf8");
}

function requireText(text, needle, label) {
  if (!text.includes(needle)) fail(label + " missing: " + needle);
}

function countLink(html, href) {
  return [...html.matchAll(/<link[^>]*href="([^"]+)"[^>]*>/g)]
    .filter((m) => m[1] === href).length;
}

function countScript(html, src) {
  return [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)]
    .filter((m) => m[1] === src).length;
}

const canonicalNav = ["dashboard", "performance", "funds", "scanner", "setups", "gex", "admin"];
const pageSpecs = {
  "index.html": "dashboard",
  "performance.html": "performance",
  "scanner.html": "scanner",
  "setups.html": "setups",
  "gex.html": "gex",
  "funds/index.html": "funds",
  "funds/funds.html": "funds",
  "funds/compare.html": "funds",
  "funds/calculators.html": "funds",
  "funds/methodology.html": "funds",
  "funds/legal.html": "funds",
};

for (const [page, expected] of Object.entries(pageSpecs)) {
  const html = read(page);
  if (!html) continue;

  if (!html.includes('name="viewport"')) {
    fail(page + " missing responsive viewport meta");
  }

  const nav = [...html.matchAll(/data-nav="([^"]+)"/g)].map((m) => m[1]);
  const uniqueNav = [...new Set(nav)];
  if (JSON.stringify(uniqueNav) !== JSON.stringify(canonicalNav)) {
    fail(page + " canonical nav mismatch: " + JSON.stringify(uniqueNav));
  }

  if (/data-nav="(?:dash|perf)"/.test(html)) {
    fail(page + " still contains obsolete dash/perf navigation keys");
  }

  const bodyPage = (html.match(/<body[^>]*data-page="([^"]+)"/) || [])[1];
  if (bodyPage !== expected) {
    fail(page + " data-page expected " + expected + ", got " + String(bodyPage));
  }

  const active = [...html.matchAll(/class="[^"]*\bactive\b[^"]*"[^>]*data-nav="([^"]+)"/g)].map((m) => m[1]);
  if (!active.includes(expected)) {
    fail(page + " does not mark " + expected + " active in source HTML");
  }

  const prefix = page.startsWith("funds/") ? "../" : "";
  if (countScript(html, prefix + "assets/js/theme.js") !== 1) {
    fail(page + " must load theme.js exactly once");
  }
  if (countScript(html, prefix + "assets/js/portal-shell.js") !== 1) {
    fail(page + " must load portal-shell.js exactly once");
  }
  if (countLink(html, prefix + "assets/css/portal-shell.css") !== 1) {
    fail(page + " must load portal-shell.css exactly once");
  }

  if (page.startsWith("funds/")) {
    if (!html.includes('data-root="../"')) fail(page + ' must declare data-root="../"');
    if (countLink(html, "../assets/css/tokens.css") !== 1) {
      fail(page + " must load shared tokens exactly once");
    }
  } else {
    if (countLink(html, "assets/css/tokens.css") !== 1) {
      fail(page + " must load shared tokens exactly once");
    }
    if (countLink(html, "assets/css/app.css") !== 1) {
      fail(page + " must load app.css exactly once");
    }
  }

  requireText(html, 'id="logoutBtn"', page + " logout contract");
  requireText(html, 'id="themeToggle"', page + " theme contract");
  requireText(html, "data-lfc-theme-toggle", page + " theme contract");
  requireText(html, 'id="adminBtn"', page + " admin contract");
}

for (const [page, cssPath] of [
  ["scanner.html", "assets/css/scanner.css"],
  ["setups.html", "assets/css/setups.css"],
  ["gex.html", "assets/css/gex.css"],
]) {
  const html = read(page);
  if (/<style>[\s\S]*?<\/style>/.test(html)) {
    fail(page + " contains page-local style block; module styling must stay external");
  }
  const css = read(cssPath);
  requireText(css, "@media (max-width: 767px)", cssPath + " mobile breakpoint");
}

const shellCss = read("assets/css/portal-shell.css");
requireText(shellCss, "@media (max-width: 767px)", "portal shell mobile breakpoint");
requireText(shellCss, ".portal-menu-toggle", "portal shell mobile menu");
requireText(shellCss, ".portal-shell-ready .userbar.is-open", "portal shell mobile open state");


const allHtmlPages = [
  "index.html", "signin.html", "performance.html", "scanner.html", "setups.html", "gex.html",
  "funds/index.html", "funds/funds.html", "funds/compare.html", "funds/calculators.html",
  "funds/methodology.html", "funds/legal.html",
];

for (const page of allHtmlPages) {
  const html = read(page);
  const refs = [
    ...[...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]),
  ];
  for (const raw of refs) {
    if (!raw || raw.startsWith("#") || /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(raw)) continue;
    const clean = raw.split("#")[0].split("?")[0];
    if (!clean) continue;
    if (!/\.(?:html|css|js|json|svg)$/i.test(clean)) continue;
    const target = path.normalize(path.join(path.dirname(page), clean));
    if (!existsSync(target)) fail(page + " local reference does not resolve: " + raw + " -> " + target);
  }
}
pass("local links and assets resolve");

const signin = read("signin.html");
for (const id of ["authPending", "login", "loginUser", "loginPass", "loginBtn"]) {
  if (!signin.includes('id="' + id + '"')) fail("signin.html missing #" + id);
}
if (!signin.includes('id="loginMsg"') && !signin.includes('id="msg"')) fail("signin.html missing login message element");
requireText(signin, "await sb.auth.signOut()", "signin Supabase logout completion");
requireText(signin, "max-width: 460px", "signin centered layout");

const dashboard = read("index.html");
const dashboardIds = [
  "search", "rating", "status", "timeFrame", "watchFilter", "toggleWatch",
  "ideasError", "retryIdeas", "watchHead", "ideasBody", "mobileList", "ideasEmpty",
  "admin", "ticker", "name", "sector", "ratingIn", "statusIn", "entry", "target",
  "stop", "timeIn", "riskReward", "sourceUrl", "summary", "adminNotes", "saveIdea",
  "clearIdea", "symbols", "closeIdea", "exitPrice", "closedAt", "closureReason",
  "closureNote", "closeIdeaBtn", "adminSearch", "adminIdeasBody", "adminEmpty",
  "newUsername", "newDisplayName", "newPassword", "createUser", "usersBody", "auditBody"
];
for (const id of dashboardIds) {
  if (!dashboard.includes('id="' + id + '"')) fail("index.html missing dashboard/admin hook #" + id);
}
requireText(dashboard, "assets/js/dashboard.js", "index dashboard controller");

const performance = read("performance.html");
for (const id of ["perfYear", "closedCount", "positiveCount", "negativeCount", "averageReturn", "performanceBody", "performanceEmpty"]) {
  if (!performance.includes('id="' + id + '"')) fail("performance.html missing #" + id);
}
requireText(performance, "assets/js/performance.js", "performance controller");

const scanner = read("scanner.html");
const scannerIds = [
  "pLeft", "pRight", "days", "tfDaily", "tfWeekly", "tfMonthly", "tfHourly", "tf15",
  "trendFilter", "showTouching", "volFilter", "scanBtn", "watchInput", "saveWatch",
  "importToggle", "addCommodities", "importRow", "importBox", "importFileBtn", "importFile",
  "importReplace", "importMerge", "importDefaults", "stScanned", "stInside", "stTouch",
  "stSkipped", "resultsCard", "resultsBody", "downloadBtn", "chartCard", "chart"
];
for (const id of scannerIds) {
  if (!scanner.includes('id="' + id + '"')) fail("scanner.html missing functional hook #" + id);
}
requireText(scanner, "scanner-logic.js", "scanner legacy calculation dependency");
requireText(scanner, "assets/css/scanner.css", "scanner module stylesheet");

const setups = read("setups.html");
for (const id of ["sigBody", "refreshSigs", "scanList", "scanAdd", "scanAddBtn", "addManual", "riskCard", "paperOpen", "ledgerBody"]) {
  if (!setups.includes('id="' + id + '"')) fail("setups.html missing functional hook #" + id);
}
requireText(setups, "assets/css/setups.css", "setups module stylesheet");

const gex = read("gex.html");
for (const id of ["sym", "exp", "load", "auto", "mkt", "stamp", "stats", "bars", "flip", "chainMeta", "chain"]) {
  if (!gex.includes('id="' + id + '"')) fail("gex.html missing functional hook #" + id);
}
requireText(gex, '<script src="auth-guard.js"></script>', "GEX auth gate");
requireText(gex, "assets/css/gex.css", "GEX module stylesheet");

requireText(read("assets/js/portal-shell.js"), 'signin.html?signout=1', "canonical logout handoff");
requireText(read("assets/js/portal-shell.js"), 'location.hash === "#admin"', "admin active-tab routing");

const tokens = read("assets/css/tokens.css");
const fundCss = read("funds/assets/css/style.css");
const tokenDefs = new Set([...tokens.matchAll(/--(lfc-[\w-]+)\s*:/g)].map((m) => m[1]));
const fundTokenRefs = new Set([...fundCss.matchAll(/var\(--(lfc-[\w-]+)/g)].map((m) => m[1]));
for (const ref of fundTokenRefs) {
  if (!tokenDefs.has(ref)) fail("funds/assets/css/style.css references undefined --" + ref);
}

for (const required of [
  "assets/css/tokens.css", "assets/css/app.css", "assets/css/portal-shell.css",
  "assets/js/theme.js", "assets/js/portal-shell.js", "assets/js/dashboard.js",
  "assets/js/performance.js", "scanner-logic.js", "tools/signal-scan.js",
  "tools/test-signal-guards.js", "tools/test-weekly-line.js",
  "tools/engine/candle.js", "tools/engine/zone.js", "tools/engine/stack.js",
  "tools/engine/pipeline.js", "tools/engine/scoring.js", "tools/engine/gates.js",
  "tools/engine/lifecycle.js",
  ".github/workflows/deploy-pages.yml", ".github/workflows/signal-scan.yml",
  ".github/workflows/scan-watchdog.yml", ".github/workflows/gex-probe.yml",
  ".github/workflows/pre-push-html-guard.yml"
]) {
  requireFile(required);
}

const scanSource = read("tools/signal-scan.js");
requireText(scanSource, 'type: "legacy-pivot"', "Legacy Pivot signal identity");
requireText(scanSource, 'scannerType: "gtf-pro"', "GTF-Pro shadow identity");
requireText(scanSource, 'enabled: process.env.GTF_PRO === "true" || false', "GTF-Pro default-off contract");
requireText(scanSource, "const GTF_PRO_ENABLED = GTF_PRO.enabled", "GTF enablement contract");
requireText(scanSource, "function parseYahoo", "Yahoo data-quality gate");
requireText(scanSource, "function loadRules", "fail-closed rules gate");
requireText(scanSource, "async function post", "signal payload gate");
requireText(scanSource, "s.type,      // scannerType", "scanner-aware dedupe contract");

const legacySource = read("scanner-logic.js");
requireText(legacySource, "function computeZones", "Legacy Pivot computeZones");
requireText(legacySource, "LfcScanner", "Legacy Pivot export");

if (failed) {
  console.error("\nProduction contract FAILED.");
  process.exit(1);
}

pass("canonical portal shell across authenticated pages");
pass("dashboard, performance, scanner, setups and GEX functional hooks");
pass("Mutual Funds shared token dependencies");
pass("Legacy Pivot / GTF-Pro separation and default-off GTF");
pass("data-quality and deployment-critical contracts");
console.log("\nProduction contract OK.");
