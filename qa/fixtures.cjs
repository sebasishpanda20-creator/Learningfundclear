const {chromium}=require('playwright');
const path=require('path'),fs=require('fs');
const origin='http://127.0.0.1:8000';
const user={id:'11111111-1111-4111-8111-111111111111',email:'qa@portal.local',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
const profile={...user,username:'qa',display_name:'QA account',is_admin:true,is_active:true};
const session={access_token:'test-only-access-token',refresh_token:'test-only-refresh-token',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user};
const stamp={u:user.id,n:'QA account',a:true,t:Date.now()};
const ideas=[{id:'idea-1',ticker:'TEST-A',name:'Test research A',sector:'Test sector',rating:'MONITORING',status:'ACTIVE',entry:100,target:120,stop:95,time_frame:'Position',summary:'Isolated QA fixture, not a market recommendation.',created_at:new Date().toISOString(),updated_at:new Date().toISOString()},{id:'idea-2',ticker:'TEST-B',name:'Test research B',sector:'Test sector',rating:'RESEARCH COMPLETE',status:'CLOSED',entry:200,exit_price:220,closed_at:new Date().toISOString(),created_at:new Date().toISOString(),updated_at:new Date().toISOString()}];
const pages=['index.html','performance.html','admin.html','scanner.html','setups.html','gex.html','crypto.html','funds/index.html','funds/funds.html','funds/compare.html','funds/calculators.html','funds/methodology.html','funds/legal.html','funds/scheme.html?code=119551'];
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
 await ctx.route(/query[12]\.finance\.yahoo\.com|r\.jina\.ai/,r=>r.fulfill({status:503,body:'QA data unavailable'}));
}

module.exports={fixture,origin,session,stamp};
