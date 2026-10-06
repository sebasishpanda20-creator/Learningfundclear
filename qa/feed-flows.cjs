const {chromium}=require('playwright'),{fixture,origin}=require('./fixtures.cjs');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
(async()=>{
 const server=http.createServer((req,res)=>{try{const file=path.resolve('.','.'+new URL(req.url,origin).pathname);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(8000,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});const results=[];
 try {for(const width of [1440,390]){
 const ctx=await browser.newContext({viewport:{width,height:1000}});await fixture(ctx);const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let requests=0,old=false;
 await ctx.route(/query1\.finance\.yahoo\.com/,route=>{
  requests++;let t=Math.floor(Date.now()/86400000)*86400-86400-(old?10*86400:0);
  const rows=Array.from({length:260},(_,i)=>({t:t-(259-i)*86400,o:100,h:104,l:96,c:101,v:1000}));rows[255].l=90;rows[259]={...rows[259],o:98,h:100,l:92,c:94};
  return route.fulfill({json:{chart:{result:[{meta:{gmtoffset:19800},timestamp:rows.map(x=>x.t),indicators:{quote:[{open:rows.map(x=>x.o),high:rows.map(x=>x.h),low:rows.map(x=>x.l),close:rows.map(x=>x.c),volume:rows.map(x=>x.v)}]}}]}}});
 });
 await page.goto(origin+'/scanner.html');await page.locator('html.auth-ready').waitFor();await page.locator('#watchInput').fill('TEST.NS');
 for(const id of ['tfWeekly','tfMonthly','tfHourly','tf15'])await page.locator('#'+id).uncheck();await page.locator('#tfDaily').check();await page.locator('#trendFilter').uncheck();
 await page.locator('#scanBtn').click();await page.locator('#resultsBody tr').waitFor();assert((await page.locator('#resultsBody').innerText()).includes('IST'));assert.equal(await page.locator('#stInside').innerText(),'1');
 await page.locator('#resultsBody [data-chart]').click();assert(await page.locator('#chartCard').isVisible());results.push({name:'valid completed feed, signal and chart '+width,status:'PASS'});
 const count=requests;await page.locator('#forceRefresh').uncheck();await page.locator('#scanBtn').click();await page.waitForFunction(()=>!document.querySelector('#scanBtn').disabled);assert.equal(requests,count);results.push({name:'short cache and explicit bypass '+width,status:'PASS'});
 old=true;await page.locator('#forceRefresh').check();await page.locator('#scanBtn').click();await page.waitForFunction(()=>!document.querySelector('#scanBtn').disabled);assert.equal(await page.locator('#stSkipped').innerText(),'1');assert((await page.locator('#feedIssues').textContent()).includes('freshness'));assert(!(await page.locator('#resultsCard').isVisible()));results.push({name:'stale candles excluded '+width,status:'PASS'});
 await page.screenshot({path:'qa/scanner-feed-'+width+'.png',fullPage:true});
 let fail=false;
 await ctx.route('**/functions/v1/nse-chain**',route=>fail?route.fulfill({status:503,json:{error:'Fixture feed failure'}}):route.fulfill({json:{symbol:'NIFTY',expiry:'08-Oct-2026',expiries:['08-Oct-2026'],underlying:25000,nse_timestamp:'01-Oct-2026 10:00:00',strikes:[{strike:25000,ce:{oi:100,vol:20,ltp:100,iv:10},pe:{oi:120,vol:30,ltp:110,iv:12}}]}}));
 await page.goto(origin+'/gex.html');await page.locator('#chain tr').waitFor();assert.equal(await page.locator('#mkt').innerText(),'DELAYED SNAPSHOT');fail=true;await page.locator('#sym').selectOption('BANKNIFTY');await page.locator('#mkt').filter({hasText:'UNAVAILABLE'}).waitFor();assert.equal(await page.locator('#chain tr').count(),0);assert.equal(await page.locator('#stats').innerText(),'');assert.deepEqual(errors,[]);results.push({name:'source age and contract failure do not show wrong quotes '+width,status:'PASS'});
 await ctx.close();
 }}finally{await browser.close();server.close();fs.writeFileSync('qa/feed-results.json',JSON.stringify(results,null,2));console.log(results);}
})().catch(e=>{console.error(e);process.exitCode=1});
