const test=require('node:test'),assert=require('node:assert/strict'),F=require('../assets/js/futures-engine.js');
const now=Date.UTC(2026,9,29,10),p={symbol:'TESTUSD',contract_type:'perpetual_futures',notional_type:'vanilla',settling_asset:{symbol:'USD'},state:'live',trading_status:'operational',contract_value:1,tick_size:.01,taker_commission_rate:.0005,product_specs:{rate_exchange_interval:14400}},t={timestamp:now,quotes:{best_bid:100,best_ask:100.05},oi_value_usd:1e6,turnover_usd:1e6,funding_rate:.01};
const bars=Array.from({length:90},(_,i)=>({time:(now-(90-i)*900000)/1000,open:100,high:101,low:99,close:100}));
const trend={side:'UP',actionable:true,invalidation:98};
test('long and short plans size under capital and modeled stop budgets with explicit costs',()=>{
 for(const side of ['UP','DOWN']){const x=F.evaluate(p,t,{...trend,side,invalidation:side==='UP'?98:102},bars,10000,4,now);assert.equal(x.status,'RESEARCH CANDIDATE');assert(x.stopLoss<=100);assert(x.notional<=8000);assert.equal(x.quantity,Math.floor(Math.min(100/(x.stopLoss/x.quantity),8000/(x.entry*x.cv))));assert(Math.abs(x.cost-(x.commission+x.gst+x.slippage+x.funding))<1e-9);assert(x.rr>=1.25);assert(side==='UP'?x.stop<x.entry&&x.target>x.entry:x.stop>x.entry&&x.target<x.entry);}
});
test('stale, mixed, missing fees and unaffordable contracts fail closed',()=>{
 for(const [a,b,c,capital] of [[p,{...t,timestamp:now-61000},trend,10000],[p,t,{side:'SIDEWAYS'},10000],[{...p,taker_commission_rate:null},t,trend,10000],[p,t,trend,1],[{...p,product_specs:{only_reduce_only_orders_allowed:true}},t,trend,10000]])assert.equal(F.evaluate(a,b,c,bars,capital,4,now).status,'NO TRADE');
});
test('negative funding never boosts directional profit',()=>{
 const a=F.evaluate(p,t,trend,bars,10000,4,now),b=F.evaluate(p,{...t,funding_rate:-.01},trend,bars,10000,4,now);assert.equal(a.funding,b.funding);assert.equal(a.targetGain,b.targetGain);
});
test('funding receipt needs fresh exchange timing and remains watch only, even when positive',()=>{
 const live={at:now,next:now+3600000,rate:1,seconds:14400},x=F.funding(p,t,live,10000,now);assert.equal(x.status,'WATCH ONLY');assert.equal(x.side,'SHORT');assert(x.notional<=2000);assert.equal(x.receipt,x.notional*.01);assert.equal(x.afterCosts,x.receipt-x.cost);assert(x.afterCosts>0);assert.equal(F.funding(p,t,null,10000,now).status,'NO TRADE');assert.equal(F.funding(p,t,{...live,next:now-1},10000,now).status,'NO TRADE');assert.equal(F.funding(p,t,{...live,rate:-1},10000,now).side,'LONG');
});
test('EMA comparison requires a fresh closed cross, not simply price above a band',()=>{
 assert.equal(F.bandSignal(bars,now).side,'WAIT');const a=structuredClone(bars);a.at(-1).close=102;a.at(-1).high=102.2;assert.equal(F.bandSignal(a,now).side,'LONG');a.push({...a.at(-1),time:now/1000,close:90,low:89});assert.equal(F.bandSignal(a,now).side,'LONG','forming bar excluded');assert.equal(F.category({product_specs:{tags:['xStock']}}),'STOCK');
});
test('short-session mode uses completed 5m bars and rejects mismatched holding periods',()=>{
 const D=require('../assets/js/crypto-desk-engine.js'),make=m=>Array.from({length:90},(_,i)=>{const c=100+i*.1;return{time:(now-(90-i)*m*60000)/1000,open:c-.1,high:c+1,low:c-1,close:c};}),a=make(5),b=make(15),trend=D.direction(a,b,now,[5,15]);
 assert.equal(trend.side,'UP');assert.equal(trend.actionable,true);assert.equal(trend.lastClosedAt,now);assert.equal(trend.components[0].name,'EMA 5m + 15m');
 const tick={...t,quotes:{best_bid:108.9,best_ask:108.95}},x=F.evaluate(p,tick,trend,a,10000,.5,now,5);assert.equal(x.status,'RESEARCH CANDIDATE');assert.equal(x.timeExit,now+1800000);assert(x.stopLoss<=100);assert.match(x.reason,/5m\/15m/);
 assert.equal(F.evaluate(p,tick,trend,a,10000,.5,now,15).status,'NO TRADE');assert.equal(D.direction(a,b,now,[1,5]).actionable,false);
 a.push({time:now/1000,open:1,high:2,low:1,close:1});assert.equal(D.direction(a,b,now,[5,15]).side,trend.side,'ignore forming candles');
 assert.equal(D.direction(make(5).map(v=>({...v,time:v.time-3600})),b,now,[5,15]).side,'UNKNOWN','reject stale short candles');
});
test('entry ranges and both net target estimates use the less favorable quoted entry',()=>{
 for(const side of ['UP','DOWN']){const x=F.evaluate(p,t,{...trend,side,invalidation:side==='UP'?98:102},bars,10000,4,now);assert.equal(x.status,'RESEARCH CANDIDATE');assert(x.entryLow<x.entryHigh);assert.equal(side==='UP'?x.entryHigh:x.entryLow,x.entry);assert(side==='UP'?x.target1>x.entry&&x.target1<x.target:x.target1<x.entry&&x.target1>x.target);assert(Math.abs(x.targetGain1-(Math.abs(x.target1-x.entry)*x.cv*x.quantity-x.cost))<1e-8);assert(x.targetGain1<x.targetGain);assert(x.stopLoss<=100);}
});
test('funding cost source uses verified stream first and fresh REST estimates as fallback',()=>{
 const live={at:now,rate:.02,seconds:28800};assert.equal(F.fundingCostSource(p,t,live,now).source,'STREAM VERIFIED');const r=F.fundingCostSource(p,t,null,now);assert.equal(r.source,'REST ESTIMATE');assert.equal(r.rate,.01);assert.equal(r.seconds,14400);assert.equal(F.fundingCostSource(p,{...t,funding_rate:null},null,now),null);assert.equal(F.fundingCostSource(p,{...t,timestamp:now-61000},null,now),null);assert.equal(F.fundingCostSource({...p,product_specs:{}},t,null,now),null);assert.equal(F.funding(p,t,null,10000,now).status,'NO TRADE','REST cost estimate must not invent a funding settlement');
});
test('leverage uses per-contract initial margin and never overrides stop-risk sizing',()=>{
 const product={...p,initial_margin:5},a=F.evaluate(product,t,trend,bars,10000,4,now,15,1),b=F.evaluate(product,t,trend,bars,10000,4,now,15,50);assert.equal(b.leverage,20);assert.equal(b.contractMax,20);assert.equal(b.estimatedMargin,b.notional/20);assert(b.estimatedMargin<=8000);assert(b.stopLoss<=100);assert(b.quantity>=a.quantity);assert.equal(F.evaluate(p,t,trend,bars,10000,4,now,15,10).status,'NO TRADE');assert.equal(F.evaluate(product,t,trend,bars,10000,4,now,15,201).status,'NO TRADE');
});
