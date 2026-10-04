// ── HTML/JS contract checks ──
// Exit 0 = clean, 1 = fail. Used by the pre-push guard locally and in CI.
//
//   1. selector-prefix misuse: $("#id")  (getElementById with a # prefix) must be gone
//   2. duplicate const / let / var declarations in inline scripts
//   3. $( "id" ) references to element ids that do not exist in that page

import { readFileSync } from "node:fs";

const pages = [
  "index.html",
  "signin.html",
  "performance.html",
  "scanner.html",
  "setups.html",
  "gex.html",
];

let fail = 0;

for (const page of pages) {
  const html = readFileSync(page, "utf8");

  // 1. selector-prefix misuse
  const anti = html.match(/\$\("#/g) || [];
  if (anti.length) {
    console.error(`FAIL ${page}: selector-prefix misuse — replace ($("#") with $(("`);
    fail = 1;
  }

  // 2. duplicate const / let / var in inline scripts
  const seen = new Map();
  for (const m of html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const src = m[1].trim();
    if (!src) continue;
    for (const d of src.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
      const name = d[1];
      if (seen.has(name)) {
        console.error(`FAIL ${page}: duplicate declaration ${name} in an inline script`);
        fail = 1;
      }
      seen.set(name, true);
    }
  }

  // 3. $( "id" ) references to undefined element ids
  const defined = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([...html.matchAll(/\$\(("|")([a-zA-Z][\w-]*)\1\)/g)].map((m) => m[2]));
  const missing = [...used].filter((id) => !defined.has(id));
  if (missing.length) {
    console.error(`FAIL ${page}: $( "id" ) references undefined elements: ${missing.join(", ")}`);
    fail = 1;
  }
}

if (fail) {
  console.log("HTML/JS contract violated — push blocked.");
  process.exit(1);
}
console.log(`HTML/JS contract OK (${pages.length} pages).`);
