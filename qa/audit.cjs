const {chromium}=require('playwright');
const path=require('path'),fs=require('fs');
const origin='http://127.0.0.1:8000';
const user={id:'11111111-1111-4111-8111-111111111111',email:'qa@portal.local',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
const profile={...user,username:'qa',display_name:'QA account',is_admin:true,is_active:true};
const session={access_token:'test-only-access-token',refresh_token:'test-only-refresh-token',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user};
const stamp={u:user.id,n:'QA account',a:true,t:Date.now()};
const ideas=[{id:'idea-1',ticker:'TEST-A',name:'Test research A',sector:'Test sector',rating:'MONITORING',status:'ACTIVE',entry:100,target:120,stop:95,time_frame:'Position',summary:'Isolated QA fixture, not a market recommendation.',created_at:new Date().toISOString(),updated_at:new Date().toISOString()},{id:'idea-2',ticker:'TEST-B',name:'Test research B',sector:'Test sector',rating:'RESEARCH COMPLETE',status:'CLOSED',entry:200,exit_price:220,closed_at:new Date().toISOString(),created_at:new Date().toISOString(),updated_at:new Date().toISOString()}];
const pages=['index.html','performance.html','admin.html','nifty500.html','scanner.html','setups.html','gex.html','crypto.html','funds/top-returns.html','funds/index.html','funds/funds.html','funds/compare.html','funds/calculators.html','funds/methodology.html','funds/legal.html','funds/scheme.html?code=119551'];
async function fixture(ctx,auth=true,admin=true){
 await ctx.addInitScript(()=>localStorage.setItem('lfc.scanner.auto','off'));
 if(auth)await ctx.addInitScript(({session,stamp})=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem('sb-chbtjicvbezbiosuouwm-auth-token',JSON.stringify(session));localStorage.setItem('lfc.auth',JSON.stringify(stamp));sessionStorage.setItem('seeded','1');}},{session,stamp});
 await ctx.route('https://chbtjicvbezbiosuouwm.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url());let data=[];
  if(url.pathname==='/auth/v1/user')data=user;
  else if(url.pathname==='/auth/v1/token')data=session;
  else if(url.pathname.includes('/logout'))return route.fulfill({status:204});
  else if(url.pathname.includes('app_users'))data=req.headers().accept?.includes('object')?{...profile,is_admin:admin}:[{...profile,is_admin:admin}];
  else if(url.pathname.includes('/ideas'))data=ideas;
  else if(url.pathname.includes('nse-chain'))return route.fulfill({status:503,json:{error:'Test data source unavailable'}});
  else if(url.pathname.includes('scan_symbols'))data=[{symbol:'TEST.NS',enabled:true,position:1}];
  return route.fulfill({status:200,json:data});
 });
 await ctx.route(/data-api\.binance\.vision|api\.kraken\.com|api\.india\.delta\.exchange/,r=>r.fulfill({status:503,body:'QA unavailable'}));
 await ctx.route('https://api.mfapi.in/**',r=>r.fulfill({status:503,body:'Fixture unavailable'}));
 await ctx.route(/query[12]\.finance\.yahoo\.com|r\.jina\.ai/,r=>r.fulfill({status:503,body:'QA data unavailable'}));
}
(async()=>{
 const http=require('http');const server=http.createServer((req,res)=>{let file=path.resolve('.','.'+new URL(req.url,'http://localhost').pathname);if(file.endsWith('/'))file+='index.html';try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));}catch(e){res.statusCode=404;res.end('Missing')}});await new Promise(r=>server.listen(8000,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH || undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});let results=[];
 for(const width of [1440,390,768,320]){
  const ctx=await browser.newContext({viewport:{width,height:960}});await fixture(ctx);const page=await ctx.newPage();
  for(const name of pages){let errors=[];const listener=e=>errors.push(e.message);page.on('pageerror',listener);
   await page.goto(origin+'/'+name);await page.waitForSelector('html.auth-ready');await page.waitForTimeout(150);
   const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,width:document.documentElement.scrollWidth,title:document.title,activeNav:document.querySelectorAll('.sidebar [aria-current="page"]').length,visible:document.querySelector('main')?.getBoundingClientRect().width}));
   results.push({page:name,width,...layout,errors});
   if([1440,390].includes(width))await page.screenshot({path:'qa/'+width+'-'+name.split('?')[0].replaceAll('/','-')+'.png',fullPage:true});
   page.off('pageerror',listener);
  }await ctx.close();
 }
 const ctx=await browser.newContext({viewport:{width:1440,height:960}});await fixture(ctx,false);const page=await ctx.newPage();await page.goto(origin+'/signin.html');await page.screenshot({path:'qa/signin.png',fullPage:true});await ctx.close();
 fs.writeFileSync('qa/page-audit.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.filter(r=>r.errors.length||r.overflow||r.activeNav!==1),null,2));console.log('Page checks:',results.length);if(results.some(r=>r.errors.length||r.overflow||r.activeNav!==1))process.exitCode=1;await browser.close();server.close();
})();
module.exports={fixture,origin,session,stamp};
