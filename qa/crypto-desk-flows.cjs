"use strict";
const {chromium}=require("playwright");
const {fixture,origin}=require("./fixtures.cjs");
const fs=require("fs"),path=require("path"),http=require("http"),assert=require("node:assert/strict");
const formatExpiry=()=>{const d=new Date(Date.now()+48*3600000);return String(d.getUTCDate()).padStart(2,"0")+String(d.getUTCMonth()+1).padStart(2,"0")+String(d.getUTCFullYear()).slice(-2);};
const bars=(minutes,asset)=>{
 const dt=minutes*60,last=Math.floor(Date.now()/1000/dt)*dt-dt;
 return Array.from({length:90},(_,i)=>{
  const c=asset==="BTC"?100+i*(minutes===15?0.1:0.2):100;
  const close=asset==="BTC"&&minutes===15&&i===89?c+3:c;
  return{time:last-(89-i)*dt,open:c-0.1,high:Math.max(c+0.5,close+0.2),low:c-0.5,close};
 });
};
function quote(symbol,bid,ask,asset="BTC") {
 return{symbol,timestamp:Date.now()*1000,oi_value_usd:5000,quotes:{best_bid:bid,best_ask:ask},
  product:{state:"live",trading_status:"operational",contract_value:0.001,contract_unit_currency:asset}};
}
const server=http.createServer((req,res)=>{
 try{const url=new URL(req.url,origin),file=path.resolve(".","."+url.pathname);
  res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");
  res.end(fs.readFileSync(file));
 }catch{res.writeHead(404);res.end("Missing");}
});
(async()=>{
 await new Promise(resolve=>server.listen(8000,"127.0.0.1",resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||undefined,args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu"]});
 const results=[];
 try {
  for(const width of [1440,390]){
   const ctx=await browser.newContext({viewport:{width,height:960}});
   await fixture(ctx);
   await ctx.route("https://open.er-api.com/**",route=>route.fulfill({json:{result:"success",time_last_update_unix:Math.floor(Date.now()/1000)-3600,rates:{USD:0.012}}}));
   await ctx.route("https://api.india.delta.exchange/**",route=>{
    const url=new URL(route.request().url()),q=url.searchParams;
    if(url.pathname.includes("history/candles")){
     const asset=(q.get("symbol")||"").replace("USD","");
     return route.fulfill({json:{success:true,result:bars(q.get("resolution")==="15m"?15:60,asset)}});
    }
    if(q.get("contract_types")==="perpetual_futures"){
     return route.fulfill({json:{success:true,result:["BTC","ETH","XAUT","PAXG"].map(asset=>({
      symbol:asset+"USD",contract_type:"perpetual_futures",timestamp:Date.now()*1000,
      funding_rate:asset==="BTC"?0.01:-0.005,mark_price:105,
      product:{state:"live",contract_unit_currency:asset,contract_value:0.001}
     }))}});
    }
    const asset=q.get("underlying_asset_symbols"),expiry=formatExpiry();
    const tickers=asset==="BTC"?
     [quote("C-BTC-110-"+expiry,4.7,5),quote("C-BTC-118-"+expiry,1.5,1.6)]:[];
    return route.fulfill({json:{success:true,result:tickers}});
   });
   const page=await ctx.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
   await page.goto(origin+"/crypto-options.html");
   await page.locator("html.auth-ready").waitFor();
   await page.locator("#capital").fill("100000");
   await page.locator("#tradePlan").getByText("Selected research setup", {exact:false}).waitFor({timeout:30000});
   const plan=await page.locator("#tradePlan").innerText();
   assert.match(plan,/Bull call debit spread/);assert.match(plan,/C-BTC-110-/);assert.match(plan,/C-BTC-118-/);
   assert.match(await page.locator("#directionRows").innerText(),/BULLISH BOS/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   await page.locator("#refreshNow").click();
   await page.locator("#monitorPanel").getByText("MONITOR",{exact:true}).waitFor({timeout:25000});
   assert.match(await page.locator("#monitorPanel").innerText(),/Executable NET exit/);
   results.push("Options direction, auto vertical, locked execution quote and layout "+width);
   await page.goto(origin+"/crypto-funding.html");
   await page.locator("html.auth-ready").waitFor();
   await page.locator("#fundRows tr").first().getByText("WATCH ONLY").waitFor({timeout:30000});
   assert.equal(await page.locator("#fundRows tr").count(),4);
   assert.match(await page.locator("#fundRows").innerText(),/PAXG/);
   assert.match(await page.locator("#tradePlan").innerText(),/No spot borrow/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   assert.deepEqual(errors,[]);
   results.push("Funding watch-only, tokenized gold and responsive layout "+width);
   await ctx.close();
  }
 }finally{
  await browser.close();server.close();
  fs.writeFileSync("qa/crypto-desk-results.json",JSON.stringify(results,null,2));
  console.log(results);
 }
})().catch(err=>{console.error(err);process.exitCode=1;server.close();});
