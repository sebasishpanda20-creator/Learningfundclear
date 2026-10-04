// HTML/JS contract checks for the journal pages.
// With page args: checks only those pages. With no args: checks all journal pages.
import { readFileSync } from "node:fs";

const defaults = [
  "index.html",
  "signin.html",
  "performance.html",
  "scanner.html",
  "setups.html",
  "gex.html",
];
const pages = process.argv.slice(2).length ? process.argv.slice(2) : defaults;

let fail = 0;

for (const page of pages) {
  const html = readFileSync(page, "utf8");

  const anti = html.match(/\$\(\s*["']#/g) || [];
  if (anti.length) {
    console.error(`FAIL ${page}: selector-prefix misuse — $() wraps getElementById, so do not pass #id`);
    fail = 1;
  }

  const seen = new Map();
  for (const script of html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const src = script[1].trim();
    if (!src) continue;
    for (const declaration of src.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
      const name = declaration[1];
      if (seen.has(name)) {
        console.error(`FAIL ${page}: duplicate top-level declaration ${name} in inline scripts`);
        fail = 1;
      }
      seen.set(name, true);
    }
  }

  const defined = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set(
    [...html.matchAll(/\$\(\s*["']([A-Za-z][\w-]*)["']\s*\)/g)].map((m) => m[1])
  );
  const missing = [...used].filter((id) => !defined.has(id));
  if (missing.length) {
    console.error(`FAIL ${page}: $() references undefined element ids: ${missing.join(", ")}`);
    fail = 1;
  }
}

if (fail) {
  console.error("HTML/JS contract violated.");
  process.exit(1);
}
console.log(`HTML/JS contract OK (${pages.length} page(s)).`);
