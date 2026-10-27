'use strict';
const {chromium}=require('playwright'),{fixture,origin}=require('./fixtures.cjs');
const fs=require('fs'),path=require('path'),http=require('http'),a=require('node:assert/strict');
const server=http.createServer((req,res)=>{try{const file=path.resolve('.','.'+new URL(req.url,origin).pathname);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
(async()=>{
 await new Promise(r=>server.listen(8000,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 try{for(const width of [1440,390]){
  const ctx=await browser.newContext({viewport:{width,height:960}});await fixture(ctx);
  await ctx.addInitScript(()=>{
   window.WebSocket=class extends EventTarget{constructor(){super();this.readyState=0;setTimeout(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));},0);}
    send(s){const data=JSON.parse(s);for(const sy of data.payload.channels[0].symbols)setTimeout(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'funding_rate',sy,ts:Date.now()*1000,nfr:(Date.now()+3600000)*1000,fi:28800,fr:.01})})),5);}
    close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
   };
  });
  let fail=false;
  await ctx.route('https://open.er-api.com/**',r=>r.fulfill({status:503}));
  await ctx.route('https://api.india.delta.exchange/**',r=>{
   const u=new URL(r.request().url());let result=[];
   if(u.pathname.endsWith('/tickers')){
    if(fail)return r.fulfill({status:503});
    result=['BTCUSD','ETHUSD'].map(symbol=>({symbol,contract_type:'perpetual_futures',product_trading_status:'operational',timestamp:Date.now()*1000,mark_price:100,mark_change_24h:2,quotes:{best_bid:99.99,best_ask:100.01},turnover_usd:100000,oi_value_usd:200000}));
   }else if(u.pathname.includes('history')&&u.searchParams.get('symbol').startsWith('OI:')){
    const last=Math.floor(Date.now()/3600000)*3600-3600;result=Array.from({length:25},(_,i)=>({time:last-(24-i)*3600,close:100+i}));
   }else if(u.pathname.includes('l2orderbook'))result={symbol:'BTCUSD',buy:[{price:99.99,size:10}],sell:[{price:100.01,size:12}]};
   return r.fulfill({json:{success:true,result}});
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/crypto-funding.html');await page.locator('html.auth-ready').waitFor();
  await page.locator('#freeContext summary').click();
  await page.locator('#contextRows').getByText('0.01% / 8h').first().waitFor();
  await page.locator('#contextInspect').click();
  await page.locator('#contextHistory').getByText(/changed 24%/).waitFor();
  a.match(await page.locator('#contextHistory').innerText(),/Funding history unavailable/);
  a.match(await page.locator('#contextBook').innerText(),/receipt time only/);
  a.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:'qa/crypto-context-'+width+'.png',fullPage:true});
  await page.locator('#contextSymbol').selectOption('ETHUSD');a.equal(await page.locator('#contextHistory').innerText(),'');
  fail=true;await page.locator('#contextRefresh').click();await page.locator('#contextStatus').getByText(/unavailable/).waitFor();
  a.equal(await page.locator('#contextSymbol option').count(),0);
  a.match(await page.locator('#contextRows').innerText(),/No verified/);a.deepEqual(errors,[]);
  await ctx.close();
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
 console.log('Crypto context desktop/mobile flows passed');
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
