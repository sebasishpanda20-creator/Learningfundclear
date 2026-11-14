"use strict";
/**
 * Quant desk interaction suite (qa/quant-desk-flows.cjs).
 *
 * Covers the behaviours the page-audit cannot see, at desktop and mobile widths:
 *   - gated proxy mode: ticket exchange, health probe, online pill, origin label,
 *     full-screen link target and framed terminal URL
 *   - terminal outage then recovery on Reload (pill flips, frame re-pointed)
 *   - denied terminal ticket and an unauthorised health probe both ask for sign-in
 *   - ungated direct-origin mode (no proxy path configured)
 *   - unconfigured terminal (empty url + proxy): fallback shown, controls hidden
 *   - no horizontal overflow and no page errors in any state
 *
 * window.QUANT_TERMINAL is supplied per scenario by intercepting the config
 * script, so the suite never depends on the real tunnel hostname.
 */
const { chromium } = require("playwright");
const { fixture, origin, port } = require("./fixtures.cjs");
const fs = require("fs");
const path = require("path");
const http = require("http");
const assert = require("node:assert/strict");

const GATED_CONFIG = 'window.QUANT_TERMINAL={url:"https://quant.test.invalid",proxy:"/quant-terminal"};';
const UNGATED_CONFIG = 'window.QUANT_TERMINAL={url:"https://quant.test.invalid"};';
const UNCONFIGURED_CONFIG = 'window.QUANT_TERMINAL={url:"",proxy:""};';
const TERMINAL_HTML = "<!doctype html><title>Quant terminal</title><p>terminal stub</p>";

const server = http.createServer((req, res) => {
  try {
    const file = path.resolve(".", "." + new URL(req.url, origin).pathname);
    res.setHeader(
      "Content-Type",
      file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html",
    );
    res.end(fs.readFileSync(file));
  } catch {
    res.statusCode = 404;
    res.end("Missing");
  }
});

async function scenario(browser, width, configScript, options = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 960 } });
  await fixture(ctx);
  const state = { health: options.health ?? 200, ticket: options.ticket ?? 200, ticketCalls: 0 };

  await ctx.route("**/assets/js/quant-config.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: configScript }),
  );
  // Same-origin mirror used when proxy is configured.
  await ctx.route("**/quant-terminal/**", (route) => {
    if (route.request().resourceType() === "document") {
      return route.fulfill({ contentType: "text/html", body: TERMINAL_HTML });
    }
    return route.fulfill({
      status: state.health,
      contentType: "application/json",
      body: JSON.stringify({ status: state.health === 200 ? "OK" : "UNAVAILABLE" }),
    });
  });
  await ctx.route("**/api/terminal-ticket", (route) => {
    state.ticketCalls += 1;
    return route.fulfill({ status: state.ticket, contentType: "application/json", body: "{}" });
  });
  // Direct daemon origin used when no proxy path is configured.
  await ctx.route("https://quant.test.invalid/**", (route) => {
    if (route.request().resourceType() === "document") {
      return route.fulfill({ contentType: "text/html", body: TERMINAL_HTML });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"OK"}' });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/quant-desk.html");
  await page.locator("html.auth-ready").waitFor({ timeout: 15000 });
  return { ctx, page, state, errors };
}

async function assertLayout(page, label) {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
    label + ": horizontal overflow",
  );
}

(async () => {
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.TEST_BROWSER_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const results = [];

  try {
    for (const width of [1440, 390]) {
      // 1. Gated proxy: online state, then outage and recovery.
      {
        const { ctx, page, state, errors } = await scenario(browser, width, GATED_CONFIG);
        await page.locator("#qStatus").filter({ hasText: "Terminal online" }).waitFor({ timeout: 15000 });
        assert.equal(await page.locator("#qStatus").getAttribute("data-state"), "online");
        assert.equal((await page.locator("#qOrigin").innerText()).trim(), "quant.test.invalid");
        assert.match(await page.locator("#qFrame").getAttribute("src"), /\/quant-terminal\//);
        assert.match(await page.locator("#qOpen").getAttribute("href"), /\/quant-terminal\/$/);
        assert.equal(await page.locator("#qOpen").getAttribute("rel"), "noopener");
        assert.match(await page.locator(".quant-checked").innerText(), /checked/);
        assert.ok(state.ticketCalls >= 1, "terminal ticket was not requested");
        await assertLayout(page, "gated online " + width);

        state.health = 503;
        await page.locator("#qReload").click();
        await page.locator("#qStatus").filter({ hasText: "Terminal unreachable" }).waitFor({ timeout: 15000 });
        assert.equal(await page.locator("#qStatus").getAttribute("data-state"), "offline");

        state.health = 200;
        await page.locator("#qReload").click();
        await page.locator("#qStatus").filter({ hasText: "Terminal online" }).waitFor({ timeout: 15000 });
        await page.waitForFunction(
          () => /\/quant-terminal\/\?_r=\d+/.test(document.getElementById("qFrame").src),
          null,
          { timeout: 5000 },
        );
        assert.deepEqual(errors, []);
        results.push("Gated terminal online, outage and recovery " + width);
        await ctx.close();
      }

      // 2. Terminal ticket denied -> ask for sign-in, keep the panel offline.
      {
        const { ctx, page, errors } = await scenario(browser, width, GATED_CONFIG, { ticket: 401 });
        await page.locator("#qStatus").filter({ hasText: "Sign in again to open the terminal" }).waitFor({ timeout: 15000 });
        assert.equal(await page.locator("#qStatus").getAttribute("data-state"), "offline");
        await assertLayout(page, "ticket denied " + width);
        assert.deepEqual(errors, []);
        results.push("Denied terminal ticket asks for sign-in " + width);
        await ctx.close();
      }

      // 3. Health probe 401 -> ask for sign-in rather than claiming an outage.
      {
        const { ctx, page, errors } = await scenario(browser, width, GATED_CONFIG, { health: 401 });
        await page.locator("#qStatus").filter({ hasText: "Sign in again to open the terminal" }).waitFor({ timeout: 15000 });
        assert.equal(await page.locator("#qStatus").getAttribute("data-state"), "offline");
        assert.deepEqual(errors, []);
        results.push("Unauthorised health probe asks for sign-in " + width);
        await ctx.close();
      }

      // 4. Ungated direct-origin mode.
      {
        const { ctx, page, state, errors } = await scenario(browser, width, UNGATED_CONFIG);
        await page.locator("#qStatus").filter({ hasText: "Terminal online" }).waitFor({ timeout: 15000 });
        assert.match(await page.locator("#qFrame").getAttribute("src"), /^https:\/\/quant\.test\.invalid\//);
        assert.equal(await page.locator("#qOpen").getAttribute("href"), "https://quant.test.invalid/");
        assert.equal(state.ticketCalls, 0, "ungated mode must not exchange a ticket");
        await assertLayout(page, "ungated " + width);
        assert.deepEqual(errors, []);
        results.push("Ungated direct-origin terminal " + width);
        await ctx.close();
      }

      // 5. Unconfigured terminal: honest fallback, no dead controls.
      {
        const { ctx, page, state, errors } = await scenario(browser, width, UNCONFIGURED_CONFIG);
        await page.locator("#qStatus").filter({ hasText: "Not configured" }).waitFor({ timeout: 15000 });
        assert.equal(await page.locator("#qStatus").getAttribute("data-state"), "offline");
        assert.equal(await page.locator("#qFallback").isVisible(), true);
        assert.equal(await page.locator("#qFrame").isVisible(), false);
        assert.equal(await page.locator("#qReload").isVisible(), false);
        assert.equal(await page.locator("#qOpen").isVisible(), false);
        assert.equal(state.ticketCalls, 0);
        await assertLayout(page, "unconfigured " + width);
        assert.deepEqual(errors, []);
        results.push("Unconfigured terminal fallback " + width);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
    fs.writeFileSync("qa/quant-desk-results.json", JSON.stringify(results, null, 2));
    console.log(results);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});
