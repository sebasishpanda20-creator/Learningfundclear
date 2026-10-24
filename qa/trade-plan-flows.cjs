const { chromium } = require("playwright"),
  { fixture, origin } = require("./fixtures.cjs");
const fs = require("fs"),
  http = require("http"),
  path = require("path"),
  assert = require("node:assert/strict");
(async () => {
  const server = http.createServer((q, r) => {
    try {
      const f = path.join(process.cwd(), new URL(q.url, origin).pathname);
      r.setHeader(
        "Content-Type",
        f.endsWith(".js")
          ? "text/javascript"
          : f.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      r.end(fs.readFileSync(f));
    } catch {
      r.writeHead(404);
      r.end();
    }
  });
  await new Promise((r) => server.listen(8000, "127.0.0.1", r));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.TEST_BROWSER_PATH,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-zygote",
      ],
    });
    for (const width of [1440, 390]) {
      const ctx = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      await fixture(ctx, true, false);
      const p = await ctx.newPage(),
        errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(origin + "/trading-plan.html");
      await p.locator("#capital").filter({ visible: true }).waitFor();
      await p.waitForFunction(
        () => document.getElementById("capital").value === "50000",
      );
      await p
        .locator("#notes")
        .fill("Test plan: completed candles, fixed stop and target.");
      await p.locator("#planForm button[type=submit]").click();
      await p
        .locator("#planStatus")
        .filter({ hasText: "Plan saved" })
        .waitFor();
      await p.reload();
      await p.waitForFunction(() =>
        document.getElementById("notes").value.includes("Test plan"),
      );
      assert.equal(await p.locator("#adminNav").isVisible(), false);
      assert(
        await p
          .locator("a[aria-current=page]")
          .filter({ hasText: "Trading plan" })
          .count(),
      );
      await p.screenshot({
        path: `qa/trading-plan-${width}.png`,
        fullPage: true,
      });
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await p.goto(origin + "/setups.html");
      await p.locator("#activePlan").filter({ hasText: "50,000" }).waitFor();
      async function add(symbol) {
        for (const [id, v] of Object.entries({
          mSym: symbol,
          mEntry: "100",
          mStop: "95",
          mTarget: "120",
        }))
          await p.locator("#" + id).fill(v);
        await p.locator("#addManual").click();
      }
      await add("PAPER-TEST");
      assert(await p.locator("#paperOpen").isDisabled());
      await p.locator("#rUnitCost").fill("1");
      await p.locator("#rFixedCost").fill("0");
      await p.locator("#rStrategy").selectOption({ label: "Trend pullback" });
      for (const id of [
        "checkContext",
        "checkData",
        "checkTrigger",
        "checkEvents",
      ])
        await p.locator("#" + id).check();
      assert.equal(await p.locator("#oQty").innerText(), "41");
      await p.locator("#paperOpen").click();
      await p.locator("#ledgerBody tr").waitFor();
      await p.locator("#exit-0").fill("110");
      await p.locator("#cost-0").fill("50");
      await p.locator('[data-close="0"]').click();
      assert((await p.locator("#msg").innerText()).includes("exit reason"));
      await p.locator("#reason-0").fill("Manual test exit");
      await p.locator('[data-close="0"]').click();
      assert((await p.locator("#ledgerStats").innerText()).includes("360"));
      const records = await p.evaluate(() =>
        JSON.parse(
          localStorage.getItem(
            "lfc.papertrades.11111111-1111-4111-8111-111111111111",
          ),
        ),
      );
      assert.equal(records[0].pnl, 360);
      assert.equal(records[0].actualCosts, 50);
      assert(records[0].planSnapshot);
      assert(records[0].checklist.checkData);
      await p.locator('[data-del="0"]').click();
      assert.equal(await p.locator("#ledgerBody tr").count(), 0);
      await p.locator("#showArchived").check();
      assert.equal(await p.locator("#ledgerBody tr").count(), 1);
      assert(
        (await p.locator("#budgetStatus").innerText()).includes("1 trades"),
      );
      await add("STORAGE-TEST");
      await p.locator("#rStrategy").selectOption({ label: "Trend pullback" });
      for (const id of [
        "checkContext",
        "checkData",
        "checkTrigger",
        "checkEvents",
      ])
        await p.locator("#" + id).check();
      await p.evaluate(() => {
        Storage.prototype.setItem = function () {
          throw new Error("full");
        };
      });
      await p.locator("#paperOpen").click();
      assert((await p.locator("#msg").innerText()).includes("Could not save"));
      assert(await p.locator("#riskCard").isVisible());
      await p.screenshot({
        path: `qa/paper-plan-${width}.png`,
        fullPage: true,
      });
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    const unauth = await browser.newContext();
    await fixture(unauth, false);
    const page = await unauth.newPage();
    await page.goto(origin + "/trading-plan.html");
    await page.waitForURL(/signin/);
    await unauth.close();
    console.log(
      "Trading plan browser flows passed: desktop/mobile, user auth, save/reload, sizing, checklist, costs, archive, storage failure, signed-out redirect.",
    );
  } finally {
    await browser?.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
