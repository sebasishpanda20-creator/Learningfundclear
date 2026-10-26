"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const D=require("../assets/js/crypto-desk-engine.js");
const now=Date.UTC(2026,9,26,14,0);
function bars(minutes, slope) {
 return Array.from({length:90},(_,i)=>{
  const c=100+i*slope;
  return {time:(now-(90-i)*minutes*60000)/1000,open:c-0.1,high:c+0.5,low:c-0.5,close:c};
 });
}
function trend(rising=true){
 const a=bars(15,rising?0.1:-0.1),b=bars(60,rising?0.2:-0.2);
 a.at(-1).close+=rising?3:-3;
 if(rising)a.at(-1).high=a.at(-1).close+0.2;else a.at(-1).low=a.at(-1).close-0.2;
 return D.direction(a,b,now);
}
function option(type,asset,strike,bid,ask,when=now){
 return {symbol:type+"-"+asset+"-"+strike+"-271026",timestamp:when*1000,oi_value_usd:1500,
  quotes:{best_bid:bid,best_ask:ask},
  product:{state:"live",trading_status:"operational",contract_value:0.001,contract_unit_currency:asset}};
}
const pair=(type="C",asset="BTC",when=now)=>[
 option(type,asset,type==="C"?110:88,type==="C"?4.7:4.2,type==="C"?5:4.5,when),
 option(type,asset,type==="C"?118:81,type==="C"?1.8:2,type==="C"?1.9:2.1,when)
];
test("confirmed completed structure is directional; uncertain bars fail closed",()=>{
 const up=trend(true),down=trend(false);
 assert.equal(up.side,"UP");assert.equal(up.actionable,true);assert.equal(up.bos,"BULLISH BOS");
 assert.equal(down.side,"DOWN");assert.equal(down.actionable,true);assert.equal(down.bos,"BEARISH BOS");
 assert.equal(D.direction([],[],now).side,"UNKNOWN");
});
test("no synthetic quote and stale option contracts never produce a plan",()=>{
 const t=trend();
 assert.equal(D.chooseSpread([],t,"BTC",1000,now).status,"NO TRADE");
 assert.equal(D.chooseSpread(pair("C","BTC",now-500000),t,"BTC",1000,now).status,"NO TRADE");
 assert.equal(D.chooseSpread(pair(),{...t,actionable:false},"BTC",1000,now).status,"NO TRADE");
});
test("single spread, correct side, upper bound on risk and notional",()=>{
 const t=trend(),p=D.chooseSpread(pair(),t,"BTC",1000,now);
 assert.equal(p.status,"PAPER PLAN");assert.equal(p.label,"Bull call debit spread");
 assert(p.quantity>=1);assert(p.riskUSD<=20.00001);
 assert(p.quantity*p.contractValue*t.current<=300.00001);
 assert(p.stopSpread<p.entrySpread&&p.targetSpread>p.entrySpread);
 assert.equal(p.horizonHours,4);assert.equal(p.timeExit,now+4*3600000);
 const p2=D.chooseSpread(pair(),t,"BTC",1000,now,2);
 assert.equal(p2.timeExit,now+2*3600000);
 const p8=D.chooseSpread(pair(),t,"BTC",1000,now,8);
 assert.equal(p8.timeExit,now+8*3600000);
 assert.equal(D.chooseSpread(pair(),t,"BTC",1000,now,3).status,"NO TRADE");
 assert.equal(D.chooseSpread(pair("P"),trend(false),"BTC",1000,now).label,"Bear put debit spread");
 assert.equal(D.chooseSpread(pair("C","XAUT"),t,"XAUT",1000,now).status,"PAPER PLAN");
});
test("exit bid/ask, no mid and missing/stale side = no trade",()=>{
 const p=D.chooseSpread(pair(),trend(),"BTC",1000,now);
 assert.equal(D.monitor(p,pair(),now).status,"MONITOR");
 assert.equal(D.monitor(p,pair().slice(0,1),now).status,"NO TRADE");
 assert.equal(D.monitor(p,pair("C","BTC",now-500000),now).status,"NO TRADE");
 assert.equal(D.monitor(p,pair(),now+10800001).status,"NO TRADE");
});
test("funding hedge is watch-only and never treats a rate as guaranteed returns",()=>{
 const t={symbol:"XAUTUSD",contract_type:"perpetual_futures",timestamp:now*1000,
  funding_rate:0.01,mark_price:105,product:{state:"live",contract_unit_currency:"XAUT",contract_value:0.001}};
 const result=D.fundingDesk([t],"XAUT",1000,now);
 assert.equal(result.status,"WATCH ONLY");assert.match(result.route,/SHORT perp/);
 assert(!("guaranteedReturn" in result));assert(result.notionalUSD<=200.00001);
 assert.equal(D.fundingDesk([t],"XAUT",1000,now+500000).status,"NO TRADE");
});

test("long straddle and strangle evaluated even without directional BOS",()=>{
 const t=trend(true),neutral={...t,side:"SIDEWAYS",actionable:false};
 const call=option("C","BTC",112,3.8,4.0);
 const put=option("P","BTC",112,4.0,4.2);
 const strad=D.chooseVolatility([call,put],neutral,"BTC",1000,now,2);
 assert.equal(strad.status,"PAPER PLAN");
 assert.equal(strad.type,"LONG_STRADDLE");
 assert.equal(strad.timeExit,now+7200000);
 assert(strad.riskUSD<=20.001);
 const assessed=D.assessStrategies([call,put],neutral,"BTC",1000,now,2);
 assert.equal(assessed.strategy.status,"WATCH ONLY");
 assert.equal(assessed.alternatives.length,2);
 assert.equal(assessed.alternatives[0].status,"NO TRADE");
 assert.equal(assessed.alternatives[1].status,"PAPER PLAN");
 const monitor=D.monitor(strad,[call,put],now);
 assert.equal(monitor.status,"MONITOR");
 assert.equal(monitor.exitSpread,7.8);
 const strangle=D.chooseVolatility([
 option("C","BTC",114,3.8,4),option("P","BTC",110,3.8,4)
 ],neutral,"BTC",1000,now,2);
 assert.equal(strangle.type,"LONG_STRANGLE");
});
test("volatility refuses missing put, stale quotes and unaffordable premium",()=>{
 const neutral={...trend(true),side:"SIDEWAYS",actionable:false};
 assert.equal(D.chooseVolatility([option("C","BTC",112,3.8,4)],neutral,"BTC",1000,now,2).status,"NO TRADE");
 assert.equal(D.chooseVolatility([
 option("C","BTC",112,3.8,4,now-500000),option("P","BTC",112,3.8,4,now-500000)
 ],neutral,"BTC",1000,now,2).status,"NO TRADE");
 assert.equal(D.chooseVolatility([
 option("C","BTC",112,999,1000),option("P","BTC",112,999,1000)
 ],neutral,"BTC",20,now,2).status,"NO TRADE");
});

test("cost reserve includes commission, GST and slippage without pretending to know actual fills",()=>{
 const c=D.roundTripCosts([{ask:5,bid:4.7,takerRate:0.0003},{ask:1.6,bid:1.5,takerRate:0.0003}],100,0.001,2);
 assert(c&&c.commissionUSD>0&&c.gstUSD>0&&c.slippageUSD>0);
 assert(Math.abs(c.gstUSD/c.commissionUSD-0.18)<1e-8);
 assert.equal(c.feeRateSource,"PRODUCT TAKER RATES");
 const missing=D.roundTripCosts([{ask:5,bid:4.7},{ask:1.6,bid:1.5}],100,0.001,2);
 assert.match(missing.feeRateSource,/FALLBACK/);
});
test("plan net projection deducts expenses at target, stop and monitoring",()=>{
 const p=D.chooseSpread(pair(),trend(),"BTC",1000,now,2);
 assert.equal(p.status,"PAPER PLAN");
 assert(p.costBreakdown.totalUSD>0);
 assert(p.expectedTargetNetUSD<(p.targetSpread-p.entrySpread)*p.contractValue*p.quantity);
 assert(p.expectedStopNetUSD<0);
 assert(p.riskUSD<=20.00001);
 const m=D.monitor(p,pair(),now);
 assert(Math.abs(m.estimatedNetPnlUSD-(m.grossPnlUSD-p.costBreakdown.totalUSD))<1e-10);
});
