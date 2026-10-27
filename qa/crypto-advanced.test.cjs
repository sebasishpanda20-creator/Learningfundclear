"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const D=require("../assets/js/crypto-desk-engine.js");
const A=require("../assets/js/crypto-advanced-engine.js");
const now=Date.UTC(2026,9,26,14),exp="271026";
function option(type,strike,bid,ask,asset="BTC",stamp=now){
 return{symbol:type+"-"+asset+"-"+strike+"-"+exp,timestamp:stamp*1000,
  oi_value_usd:6000,quotes:{best_bid:bid,best_ask:ask},
  product:{state:"live",trading_status:"operational",contract_value:0.001,
   contract_unit_currency:asset,taker_commission_rate:"0.0005"}};
}
const chain=[
 option("C",105,3.5,3.7),option("C",110,1.9,2),
 option("P",95,3.7,3.9),option("P",90,2.3,2.5)];
test("bull put vertical is watch-only and within capital risk cap",()=>{
 const t={side:"UP",actionable:true,current:100};
 const r=A.evaluateCredit(chain,t,"BTC",1000,now,4);
 assert.equal(r.status,"WATCH ONLY");
 const v=r.candidates.find(x=>x.label==="Bull put credit spread");
 assert(v);assert.equal(v.legs.length,2);assert(v.estimatedMaxLossUSD<=20.00000001);
 assert(v.costBreakdown.totalUSD>0);
 assert.equal(v.legs[0].side,"SELL");assert.equal(v.legs[1].side,"BUY");
});
test("bear call vertical and sideways condor have correct risk and watches",()=>{
 const bear=A.evaluateCredit(chain,{side:"DOWN",actionable:true,current:100},"BTC",1000,now,4);
 assert.equal(bear.candidates[0].label,"Bear call credit spread");
 const neutral=A.evaluateCredit(chain,{side:"SIDEWAYS",actionable:false,current:100},"BTC",1000,now,4);
 assert.equal(neutral.status,"WATCH ONLY");
 const c=neutral.candidates.find(x=>x.label==="Iron condor");
 assert(c);assert.equal(c.legs.length,4);assert(c.estimatedMaxLossUSD<=20.00000001);
 // Max loss is max(put width, call width) - credit + all-leg costs.
 assert(c.estimatedMaxLossUSD>0&&c.estimatedMaxGainUSD>0);
});
test("credit structures reject stale/invalid markets and excessive minimum lots",()=>{
 const trend={side:"UP",actionable:true,current:100};
 assert.equal(A.evaluateCredit(chain.map(x=>({...x,timestamp:(now-300000)*1000})),trend,"BTC",1000,now).status,"NO TRADE");
 assert.equal(A.evaluateCredit(chain,trend,"BTC",0,now).status,"NO TRADE");
 assert.equal(A.evaluateCredit(chain,trend,"BTC",1000,now,3).status,"NO TRADE");
 assert.equal(A.evaluateCredit(chain.map(x=>({...x,quotes:{best_bid:5,best_ask:4}})),trend,"BTC",1000,now).status,"NO TRADE");
});
function bars(minutes,n,slope=0.05){
 return Array.from({length:n},(_,i)=>{
  const mid=100+i*slope;
  return{time:(now-(n-i)*minutes*60000)/1000,
   open:mid-.1,high:mid+.4,low:mid-.4,close:mid};
 });
}
test("walk-forward backtest refuses missing/corrupt/candle-gap history",()=>{
 const a=bars(15,300),b=bars(60,160);
 assert.equal(A.backtestUnderlying([],b).status,"NO TRADE");
 const gap=[...a];gap[180]={...gap[180],time:gap[180].time+4};
 assert.match(A.backtestUnderlying(gap,b).reason,/gap|Bad/);
 const invalid=[...a];invalid[100]={...invalid[100],high:0};
 assert.equal(A.backtestUnderlying(invalid,b).status,"NO TRADE");
});
test("walk-forward backtest returns explicitly qualified underlying-only record",()=>{
 const r=A.backtestUnderlying(bars(15,700),bars(60,250),{hours:2,feeBps:20});
 assert(["INSUFFICIENT SAMPLE","HISTORICAL PROXY"].includes(r.status));
 assert(r.trades>=0);assert(r.reason.includes("historical")||r.reason.includes("signals"));
 assert.equal(r.feeBps,20);assert.equal(r.hours,2);
});
test("owner bridge HMAC matches independently calculated SHA-256 signature",async()=>{
 const {deltaSignature}=await import("../server/delta-account.mjs");
 const msg="GET"+"12345"+"/v2/wallet/balances";
 const expected=crypto.createHmac("sha256","secret").update(msg).digest("hex");
 assert.equal(await deltaSignature("secret","GET","12345","/v2/wallet/balances"),expected);
});
test("owner bridge denies wrong user, missing secrets, anonymous and write methods",async()=>{
 const {serveDeltaAccount}=await import("../server/delta-account.mjs");
 const cfg={url:"https://auth.example.com",anonKey:"ANON"};
 const env={DELTA_API_KEY:"key",DELTA_API_SECRET:"secret",DELTA_ACCOUNT_OWNER_USER_ID:"owner"};
 const get=()=>new Request("https://portal.example.com/api/delta/account",{headers:{Authorization:"Bearer test.token"}});
 assert.equal((await serveDeltaAccount(get(),{},cfg)).status,503);
 assert.equal((await serveDeltaAccount(new Request("https://portal.example.com/api/delta/account"),env,cfg)).status,401);
 assert.equal((await serveDeltaAccount(new Request("https://portal.example.com/api/delta/account",{method:"POST"}),env,cfg)).status,405);
 const denied=await serveDeltaAccount(get(),env,cfg,async()=>Response.json({id:"other"}));
 assert.equal(denied.status,403);
});
test("owner bridge returns read-only account data for active admin owner",async()=>{
 const {serveDeltaAccount}=await import("../server/delta-account.mjs");
 const cfg={url:"https://auth.example.com",anonKey:"anon"},env={
  DELTA_API_KEY:"dummy",DELTA_API_SECRET:"testsecret",DELTA_ACCOUNT_OWNER_USER_ID:"owner"};
 const endpoints=[];
 const mock=async (url,opts)=>{
  endpoints.push(url);
  if(url.endsWith("/auth/v1/user"))return Response.json({id:"owner"});
  if(url.includes("/app_users?"))return Response.json([{is_active:true,is_admin:true}]);
  if(url==="https://api.india.delta.exchange/v2/wallet/balances"){
   assert.equal(opts.headers["api-key"],"dummy");
   assert(/^[a-f0-9]{64}$/.test(opts.headers.signature));
   return Response.json({success:true,result:[{asset_symbol:"USD",available_balance:"100"}]});
  }
  throw Error("Unexpected URL "+url);
 };
 const result=await serveDeltaAccount(new Request("https://portal.example.com/api/delta/account?view=wallet",
  {headers:{Authorization:"Bearer valid.token"}}),env,cfg,mock);
 assert.equal(result.status,200);
 assert.equal((await result.json()).result.length,1);
 assert.equal(endpoints.length,3);
});

test("historical time exit is exactly the selected holding duration, not one extra candle",()=>{
 const fifteen=bars(15,750,.2).map(x=>({...x,high:x.close+.1,low:x.open-.05}));
 const hourly=bars(60,250,.4).map(x=>({...x,high:x.close+.1,low:x.open-.05}));
 const report=A.backtestUnderlying(fifteen,hourly,{hours:2,feeBps:20});
 const timed=report.records.find(x=>x.outcome==="TIME EXIT");
 assert(timed,"a deterministic trending fixture must produce a time-exit event");
 assert.equal(timed.exitAt-timed.entryAt,2*3600000);
});
