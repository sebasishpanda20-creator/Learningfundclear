'use strict';
const {chromium}=require('playwright'),{fixture,origin}=require('./fixtures.cjs');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const server=http.createServer((req,res)=>{
 try{let file=path.resolve('.','.'+new URL(req.url,origin).pathname);if(file.endsWith('/'))file+='index.html';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}
 catch{res.writeHead(404);res.end('Not found');}
});
(async()=>{
 await new Promise(r=>server.listen(8000,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 try{
  for(const width of [1440,390]){
   const ctx=await browser.newContext({viewport:{width,height:900}});
   await fixture(ctx,true,true);
   let requests=[{id:'22222222-2222-4222-8222-222222222222',username:'newmember',displayName:'New Member',email:'new@example.com',emailVerified:true,createdAt:new Date().toISOString()}];
   await ctx.route('https://chbtjicvbezbiosuouwm.supabase.co/functions/v1/registration-approvals',route=>{
    const body=route.request().postDataJSON();
    if(body.action==='list')return route.fulfill({json:{ok:true,requests}});
    if(body.action==='approve'||body.action==='reject'){requests=[];return route.fulfill({json:{ok:true,decision:body.action==='approve'?'approved':'rejected'}});}
    return route.fulfill({json:{ready:true}});
   });
   const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/approvals.html');
   await page.locator('html.auth-ready').waitFor({timeout:12000});
   await page.locator('#approvalRows').getByText('newmember').waitFor({timeout:15000});
   assert.equal(await page.locator('#approvalsNav').isVisible(),true);
   assert.equal(await page.locator('#approvalRows button').count(),2);
   page.once('dialog',dialog=>dialog.accept());
   await page.locator('#approvalRows button[data-decision="approve"]').click();
   await page.locator('#approvalRows').getByText(/No pending applications/).waitFor({timeout:12000});
   assert.deepEqual(errors,[]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   await ctx.close();
  }
  const standard=await browser.newContext({viewport:{width:390,height:900}});
  await fixture(standard,true,false);
  const denied=await standard.newPage();
  await denied.goto(origin+'/approvals.html');
  await denied.waitForURL(origin+'/index.html',{timeout:16000});
  assert.equal(await denied.locator('#approvalsNav').isVisible(),false);
  await standard.close();
  const reg=await browser.newContext({viewport:{width:390,height:860}});
  await fixture(reg,false,false);
  await reg.route('https://chbtjicvbezbiosuouwm.supabase.co/functions/v1/registration-approvals',r=>r.fulfill({json:{ready:true}}));
  const p=await reg.newPage();
  await p.goto(origin+'/signin.html');
  await p.locator('#signupDetails summary').click();
  await p.locator('#registrationButton').waitFor({state:'attached'});
  assert.equal(await p.locator('#registrationButton').isEnabled(),true);
  assert.equal(await p.locator('#loginForm').isVisible(),true);
  await reg.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
 console.log('Registration approval desktop/mobile and public signup availability smoke passed');
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
