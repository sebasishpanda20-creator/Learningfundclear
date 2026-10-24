const { chromium } = require("playwright"),
  { fixture, origin } = require("./fixtures.cjs"),
  fs = require("fs"),
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
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote"],
    });
    for (const width of [1440, 390]) {
      const ctx = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      await fixture(ctx, true, false);
      await ctx.route("https://data-api.binance.vision/**", (route) => {
        const url = new URL(route.request().url()),
          p = { "15m": 900, "1h": 3600 }[url.searchParams.get("interval")],
          now = Math.floor(Date.now() / 1000 / p) * p;
        const rows = Array.from({ length: 120 }, (_, i) => {
          const o = 100 + i * 0.1;
          return [
            (now - (120 - i) * p) * 1000,
            o,
            o + 1,
            o - 1,
            o + 0.05,
            1000000,
          ];
        });
        rows.at(-1)[4] = rows.at(-2)[2] + 0.1;
        rows.at(-1)[2] = rows.at(-1)[4] + 0.1;
        rows.at(-1)[5] = 2000000;
        return route.fulfill({ json: rows });
      });
      await ctx.route("**/api/stock-history?**", (route) => {
        const u = new URL(route.request().url()),
          interval = u.searchParams.get("interval"),
          period = interval === "1wk" ? 604800 : 86400,
          now = Math.floor(Date.now() / 1000 / 86400) * 86400;
        const rows = Array.from({ length: 120 }, (_, i) => {
          const o = 100 + i * 0.1;
          return {
            t: now - (120 - i) * period,
            o,
            h: o + 1,
            l: o - 1,
            c: o + 0.05,
            v: 1000000,
          };
        });
        rows.at(-1).c = rows.at(-2).h + 0.1;
        rows.at(-1).h = rows.at(-1).c + 0.1;
        rows.at(-1).v = 2000000;
        return route.fulfill({
          json: {
            chart: {
              chart: {
                result: [
                  {
                    meta: {
                      symbol: u.searchParams.get("symbol"),
                      gmtoffset: 19800,
                    },
                    timestamp: rows.map((x) => x.t),
                    indicators: {
                      quote: [
                        {
                          open: rows.map((x) => x.o),
                          high: rows.map((x) => x.h),
                          low: rows.map((x) => x.l),
                          close: rows.map((x) => x.c),
                          volume: rows.map((x) => x.v),
                        },
                      ],
                    },
                  },
                ],
                error: null,
              },
            },
          },
        });
      });
      const p = await ctx.newPage(),
        errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(origin + "/market-scanner.html");
      await p.locator("#qsWatch").filter({ visible: true }).waitFor();
      await p.waitForFunction(
        () => document.getElementById("qsWatch").value.length > 0,
      );
      await p.locator("#qsMarket").selectOption("crypto");
      await p.locator("#qsWatch").fill("BTCUSDT,ETHUSDT");
      await p.locator("#qsRun").click();
      await p
        .locator("#qsStatus")
        .filter({ hasText: "Scan completed" })
        .waitFor();
      assert.match(
        await p.locator("#qsSummary").innerText(),
        /2 scanned · 2 qualified/,
      );
      assert.equal(await p.locator(".qs-result").count(), 2);
      await p.locator("#qsOnly").check();
      assert.equal(await p.locator(".qs-result").count(), 2);
      assert(
        await p
          .locator("a[aria-current=page]")
          .filter({ hasText: "Stock & crypto" })
          .count(),
      );
      await p.screenshot({
        path: `qa/quality-scanner-${width}.png`,
        fullPage: true,
      });
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await p.locator("#qsRvol").fill("5");
      assert.equal(await p.locator(".qs-result").count(), 0);
      await p.locator("#qsRun").click();
      await p
        .locator("#qsStatus")
        .filter({ hasText: "Scan completed" })
        .waitFor();
      assert.match(await p.locator("#qsSummary").innerText(), /0 qualified/);
      await p.locator("#qsOnly").uncheck();
      assert.match(
        await p.locator("#qsResults").innerText(),
        /Relative volume/,
      );
      await p.locator("#qsMarket").selectOption("stocks");
      await p.locator("#qsWatch").fill("BTCUSDT");
      await p.locator("#qsRun").click();
      assert.match(await p.locator("#qsStatus").innerText(), /valid symbols/);
      await p.locator("#qsMode").selectOption("swing");
      await p.locator("#qsRvol").fill("1.2");
      await p.locator("#qsWatch").fill("INFY.NS");
      await p.locator("#qsRun").click();
      await p
        .locator("#qsStatus")
        .filter({ hasText: "Scan completed" })
        .waitFor();
      assert.match(
        await p.locator("#qsSummary").innerText(),
        /1 scanned · 1 qualified/,
      );
      assert.match(await p.locator("#qsResults").innerText(), /INR/);
      assert.deepEqual(errors, []);
      await ctx.close();
      console.log("Scanner browser flows passed", width);
    }
    const ctx = await browser.newContext();
    await fixture(ctx, false, false);
    const p = await ctx.newPage();
    await p.goto(origin + "/market-scanner.html");
    await p.waitForURL(/signin/);
    await ctx.close();
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
