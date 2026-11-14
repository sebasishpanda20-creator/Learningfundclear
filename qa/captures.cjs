/** Saves the review screenshots used in the acceptance report. Intercepted data. */
const { chromium } = require("playwright");
const { fixture, origin, port } = require("./fixtures.cjs");
const http = require("http"), fs = require("fs"), path = require("path");
const DAY = 86400;
const todayUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
function shape() { const a=[]; for(let i=0;i<100;i++)a.push(220-i*1.1+Math.sin(i/3)*0.6); for(let i=0;i<22;i++)a.push(110+Math.sin(i/2)*0.5); for(let i=0;i<8;i++)a.push(110+i*1.4); for(let i=0;i<10;i++)a.push(121.2-i*1.3); return a; }
function bars() { const a=shape(); let last=null; return a.map((c,i)=>{const o=last==null?c:last;last=c;return {t:(todayUtc-DAY*1000)/1000-(a.length-1-i)*DAY,o,h:Math.max(o,c)*1.008,l:Math.min(o,c)*0.992,c,v:900000+i};}); }
function chart(b){return {chart:{error:null,result:[{meta:{gmtoffset:19800,exchangeTimezoneName:"Asia/Kolkata"},timestamp:b.map(x=>x.t),indicators:{quote:[{open:b.map(x=>x.o),high:b.map(x=>x.h),low:b.map(x=>x.l),close:b.map(x=>x.c),volume:b.map(x=>x.v)}]}}]}};}
(async () => {
  const server = http.createServer((req,res)=>{let f=path.resolve(".","."+new URL(req.url,"http://x").pathname);if(f.endsWith("/"))f+="index.html";if(!fs.existsSync(f)){res.statusCode=404;return res.end("nf");}res.setHeader("Content-Type",f.endsWith(".js")?"text/javascript":f.endsWith(".css")?"text/css":"text/html");res.end(fs.readFileSync(f));});
  await new Promise(r=>server.listen(port,"127.0.0.1",r));
  const browser = await chromium.launch({headless:true,args:["--no-sandbox"]});
  const ctx = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await fixture(ctx);
  await ctx.route("**/api/market/**", r=>r.fulfill({status:200,json:chart(bars())}));
  const page = await ctx.newPage();

  await page.goto(origin+"/lfc_terminal_v6.html",{waitUntil:"load"});
  await page.waitForTimeout(700);
  await page.locator(".menu-toggle").click();
  await page.waitForTimeout(350);
  await page.screenshot({path:"qa/shot-terminal-drawer-390.png"});
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await page.locator(".menu-toggle").click();
  await page.waitForTimeout(300);
  await page.locator("#connectFyersBtn").click();
  await page.waitForTimeout(500);
  await page.screenshot({path:"qa/shot-terminal-dialog-390.png"});
  await page.keyboard.press("Escape");

  await page.goto(origin+"/scanner.html",{waitUntil:"domcontentloaded"});
  await page.waitForSelector("html.auth-ready");
  await page.evaluate(()=>{document.getElementById("watchInput").value="TCS.NS";document.getElementById("historySource").value="yahoo";localStorage.removeItem("lfc.scan.settings");});
  await page.locator("#scanBtn").click();
  await page.waitForFunction(()=>document.querySelectorAll("#resultsBody tr[data-row]").length>0,null,{timeout:30000});
  await page.locator('#resultsBody tr[data-row="0"]').click();
  await page.waitForTimeout(600);
  await page.screenshot({path:"qa/shot-scanner-sheet-390.png"});

  console.log(JSON.stringify({saved:["qa/shot-terminal-drawer-390.png","qa/shot-terminal-dialog-390.png","qa/shot-scanner-sheet-390.png"]}));
  await browser.close(); server.close(); process.exit(0);
})();
