"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const D=require("../assets/js/crypto-desk-engine.js");
require("../assets/js/crypto-advanced-engine.js");
const V=require("../assets/js/crypto-validation-engine.js");
const now=Date.UTC(2026,9,27,12);
function synthetic(minutes,days,leadDays=0){
 const period=minutes*60000,end=now,from=end-(days+leadDays)*86400000;
 const n=(days+leadDays)*24*60/minutes;
 return Array.from({length:n},(_,i)=>{
  const close=100+i*(minutes===15?.04:.16)+Math.sin(i/19)*.12,open=close-.06;
  return{time:(from+i*period)/1000,open,close,high:close+.32,low:open-.25,volume:100+i%15};
 });
}
const small=synthetic(15,42),big=synthetic(60,42,5);
test("42-day fixed-model historical report compares independent baselines without options P&L",()=>{
 const r=V.validate(small,big,{hours:2,asOf:now,days:42,feeBps:20});
 assert(["PRELIMINARY HISTORICAL RESEARCH","INSUFFICIENT SAMPLE"].includes(r.status),r.reason);
 assert.equal(r.candleCount15,4032);assert.equal(r.candleCount60,1128);
 assert.equal(r.methods.length,3);
 assert.deepEqual(r.methods.map(x=>x.key),["confluence","smc","ema"]);
 assert.match(r.limitations.join(" "),/NOT historical option returns/);
 const split=Date.parse(r.splitAt);
 assert(split>small[0].time*1000&&split<now);
 for(const m of r.methods){
  assert(m.train.trades>=0&&m.oos.trades>=0);
  assert.equal(m.byTrend.trending.trades+m.byTrend.ranging.trades+m.byTrend.transition.trades+
   m.oos.trades-(m.byTrend.trending.trades+m.byTrend.ranging.trades+m.byTrend.transition.trades),m.oos.trades);
  for(const x of m.examples)assert(Date.parse(x.entryAt)>=split);
 }
});
test("fixed chronological test excludes unclosed candles, future data and does not reoptimize",()=>{
 const first=V.validate(small,big,{hours:4,asOf:now,days:42});
 const addedFuture={...small.at(-1),time:now/1000,close:9999,high:10000,low:0.001,open:9999};
 const second=V.validate([...small,addedFuture],big,{hours:4,asOf:now,days:42});
 assert.equal(second.status,first.status);
 assert.deepEqual(second.methods,first.methods);
});
test("gap, stale or missing history fail closed rather than inventing performance",()=>{
 const gap=small.map(x=>({...x}));gap[1500].time+=10;
 assert.equal(V.validate(gap,big,{asOf:now,days:42}).status,"UNAVAILABLE");
 assert.equal(V.validate(small.slice(0,500),big,{asOf:now,days:42}).status,"UNAVAILABLE");
 assert.equal(V.validate(small,big,{asOf:now+86400000,days:42}).status,"UNAVAILABLE");
});
test("Wilson interval and net drawdown are bounded and account for losses",()=>{
 const s=V.stats([{netR:1,stress40R:.9},{netR:-.5,stress40R:-.6},{netR:-2,stress40R:-2.1}]);
 assert.equal(s.trades,3);
 assert(s.winRate>0&&s.winRate<1);
 assert(s.wilson95.low<=s.winRate&&s.wilson95.high>=s.winRate);
 assert(s.maxDrawdownR>=2.5);
 assert(s.stress40bpsMeanR<s.meanNetR);
 assert.equal(V.stats([]).wilson95,null);
});
test("₹1,000 and ₹10,000 have different eligibility and notional/risk limits",()=>{
 const trend={side:"UP",actionable:true,current:112,signalMethod:"MULTI_FACTOR_V1"};
 const opt=(strike,bid,ask)=>({symbol:"C-BTC-"+strike+"-281026",
  timestamp:now*1000,oi_value_usd:5000,quotes:{best_bid:bid,best_ask:ask},
  product:{state:"live",trading_status:"operational",contract_value:.001,contract_unit_currency:"BTC",taker_commission_rate:.0001}});
 const pair=[opt(110,4.7,5),opt(118,1.8,1.9)];
 const low=D.chooseSpread(pair,trend,"BTC",1000*.012,now,4);
 const high=D.chooseSpread(pair,trend,"BTC",10000*.012,now,4);
 assert.equal(low.status,"NO TRADE");assert.match(low.reason,/CAPITAL BLOCK/);
 assert.equal(high.status,"PAPER PLAN");assert(high.quantity>0);
 assert(high.riskUSD<=.02*120+1e-8);
 const fallback=pair.map(x=>({...x,product:{...x.product,taker_commission_rate:undefined}}));
 assert.equal(D.chooseSpread(fallback,trend,"BTC",120,now,4).status,"NO TRADE","conservative fallback fees make this session unattractive even with sufficient capital");
});
