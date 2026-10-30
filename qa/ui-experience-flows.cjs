"use strict";
const {chromium}=require("playwright"),{fixture,origin}=require("./fixtures.cjs");
const fs=require("fs"),path=require("path"),http=require("http"),assert=require("node:assert/strict");
const srv=http.createServer((req,res)=>{
 try{
  const file=path.resolve(".","."+new URL(req.url,origin).pathname.replace(/\\/g,"/"));
  const local=file.endsWith("/")?path.join(file,"index.html"):file;
  const data=fs.readFileSync(local);
  res.setHeader("Content-Type",local.endsWith(".js")?"text/javascript":local.endsWith(".css")?"text/css":"text/html");res.end(data);
 }catch(e){res.writeHead(404);res.end("Not found");}
});
(async()=>{
 await new Promise(r=>srv.listen(8000,"127.0.0.1",r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||undefined,args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu"]});
 try{
  for(const width of [1440,390,320]){
   const ctx=await browser.newContext({viewport:{width,height:900}});
   await fixture(ctx,true,true);
   await ctx.route(/api\.india\.delta\.exchange|open\.er-api\.com/,r=>r.fulfill({status:503,body:"Unavailable test feed"}));
   const page=await ctx.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
   await page.goto(origin+"/index.html");
   await page.locator("html.auth-ready").waitFor({timeout:15000});
   assert.equal(await page.locator(".sidebar .nav-group").count(),4,"Navigation sections");
   assert.equal(await page.locator("#adminNav").getAttribute("hidden"),null,"Admin nav visible to authorized admin");
   assert.equal(await page.locator(".launch-card[data-launch-group='trade']:visible").count(),4,"Trading research cards visible");
   await page.locator("#launchInvestTab").click();
   assert.equal(await page.locator(".launch-card[data-launch-group='invest']:visible").count(),2,"Investing research cards visible");
   await page.locator("#launchpadSearch").fill("mutual");
   assert.equal(await page.locator(".launch-card[data-launch-group='invest']:visible").count(),1,"Workspace search filters cards");
   await page.locator("#launchpadSearch").fill("");
   await page.locator("#launchInvestTab").focus();
   await page.keyboard.press("ArrowRight");
   assert.equal(await page.locator("#launchReviewTab").getAttribute("aria-selected"),"true","Arrow keys switch workspace tabs");
   assert.equal(await page.locator(".launch-card[data-launch-group='review']:visible").count(),3,"Review cards visible");
   await page.locator("#launchTradeTab").click();
   await page.locator("#lfcQuickNavOpen").click();
   await page.locator("#lfcCommandQuery").waitFor({state:"visible"});
   await page.locator("#lfcCommandQuery").fill("crypto funding");
   assert.equal(await page.locator("#lfcCommandResults .lfc-command-item").count(),1,"Search filters unique route");
   assert.match(await page.locator("#lfcCommandResults").innerText(),/Crypto funding desk/i);
   await page.locator("#lfcCommandQuery").press("Enter");
   await page.waitForURL("**/crypto-funding.html",{timeout:10000});
   await page.locator("html.auth-ready").waitFor();
   assert.equal(await page.locator(".desk-hero").count(),1);
   assert.equal(await page.locator(".desk-jumps a").count(),3);
   await page.keyboard.press("Control+k");
   assert.equal(await page.locator("#lfcCommandQuery").isVisible(),true);
   await page.keyboard.press("Escape");
   assert.equal(await page.locator("#lfcCommandQuery").isVisible(),false);
   await page.locator(".topbar-theme").click();
   await page.locator("html.theme-dark").waitFor();
   const layout=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:window.innerWidth,menu:!!document.getElementById("lfcQuickNavOpen")}));
   assert.equal(layout.page<=layout.viewport+1,true,"No horizontal document overflow at "+width+"px: "+JSON.stringify(layout));
   assert.deepEqual(errors,[],"Runtime JS errors "+width);
   await page.screenshot({path:"qa/ui-funding-"+width+".png",fullPage:true});
   await page.goto(origin+"/crypto-options.html");
   await page.locator("html.auth-ready").waitFor();
   assert.equal(await page.locator(".desk-hero").count(),1);
   assert.equal(await page.locator("#tradePlan").count(),1);
   assert.equal(await page.locator(".options-masthead").count(),1);
   await page.locator("[data-capital=\"50000\"]").click();
   assert.equal(await page.locator("#capital").inputValue(),"50000");
   assert.equal(await page.locator("#tradeHorizon").isVisible(),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,"No crypto overflow "+width);
   await page.screenshot({path:"qa/ui-options-"+width+".png",fullPage:true});
   await ctx.close();
  }
  const c=await browser.newContext({viewport:{width:390,height:844}});
  await fixture(c,true,false);
  const p=await c.newPage();
  await p.goto(origin+"/index.html");await p.locator("html.auth-ready").waitFor();
  await p.locator("#lfcQuickNavOpen").click();
  await p.locator("#lfcCommandQuery").fill("approval");
  assert.equal(await p.locator("#lfcCommandResults .lfc-command-item").count(),0,"Regular user must not search admin page");
  await c.close();
  console.log("Responsive 320/390/1440 design, quick search, role filtering, theme and crypto panels passed.");
 }finally{await browser.close();await new Promise(r=>srv.close(r));}
})().catch(e=>{console.error(e);srv.close();process.exitCode=1;});
