/* Historical validation of fixed, documented UNDERLYING signal rules.
 * NO option-chain backtest, optimisation, probability or real execution.
 * Deterministic, closed-candle, chronological 70/30 holdout only. */
(function(root){
"use strict";
const D=root.LfcCryptoDesk||(typeof require==="function"?require("./crypto-desk-engine.js"):null);
const A=root.LfcCryptoAdvanced||(typeof require==="function"?require("./crypto-advanced-engine.js"):null);
const finite=Number.isFinite, MIN_TRAIN=30,MIN_OOS=20;
const methods=[
 {key:"confluence",label:"Multi-factor (current portal)"},
 {key:"smc",label:"EMA + SMC baseline"},
 {key:"ema",label:"EMA trend baseline"}
];
const empty=(reason)=>({status:"UNAVAILABLE",reason,methods:[]});
const iso=t=>new Date(t).toISOString();
function wilson(success,n){
 if(!n)return null;
 const z=1.96,p=success/n,den=1+z*z/n,mid=(p+z*z/(2*n))/den,
   margin=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
 return{low:Math.max(0,mid-margin),high:Math.min(1,mid+margin)};
}
function stats(records){
 const n=records.length,wins=records.filter(x=>x.netR>0).length;
 let equity=0,highWater=0,drawdown=0,gains=0,losses=0;
 for(const x of records){
  equity+=x.netR;highWater=Math.max(highWater,equity);drawdown=Math.max(drawdown,highWater-equity);
  if(x.netR>0)gains+=x.netR;else losses-=x.netR;
 }
 const sum=records.reduce((s,x)=>s+x.netR,0);
 return{trades:n,wins,winRate:n?wins/n:null,wilson95:wilson(wins,n),
  meanNetR:n?sum/n:null,totalNetR:sum,maxDrawdownR:drawdown,
  profitFactor:losses>0?gains/losses:null,
  stress40bpsMeanR:n?records.reduce((s,x)=>s+x.stress40R,0)/n:null};
}
function atrRegimes(rows,i){
 const ranges=[];
 for(let k=i-95;k<=i;k++){
  if(k<1)return{volatility:"UNKNOWN"};
  const q=rows[k],prev=rows[k-1];
  ranges.push(Math.max(q.high-q.low,Math.abs(q.high-prev.close),Math.abs(q.low-prev.close)));
 }
 const recent=ranges.slice(-14).reduce((s,x)=>s+x,0)/14;
 const baseline=ranges.slice(0,-14).reduce((s,x)=>s+x,0)/82;
 return{volatility:baseline>0&&recent>=1.25*baseline?"ELEVATED_VOL":"NORMAL_VOL"};
}
function match(method,t){
 if(!["UP","DOWN"].includes(t.side))return false;
 if(method==="confluence")return t.actionable===true&&t.signalMethod==="MULTI_FACTOR_V1";
 if(method==="smc")return t.bos!=="NONE"||t.sweep!=="NONE";
 if(method==="ema")return true;
 return false;
}
function simulate(rows,index,hours,side,stop,feeBps,atrRegime,trendRegime,method,split){
 const entry=rows[index+1].open;
 if(!finite(entry)||entry<=0||!finite(stop)||stop<=0)return null;
 const distance=Math.abs(entry-stop),long=side==="UP";
 if(distance/entry<.0015||distance/entry>.03||(long&&stop>=entry)||(!long&&stop<=entry))return null;
 const target=entry+(long?1:-1)*distance*1.5;
 let outcome="TIME EXIT",exitIndex=index+hours*4,exit=rows[exitIndex].close;
 for(let j=index+1;j<=index+hours*4;j++){
  const bar=rows[j],stopHit=long?bar.low<=stop:bar.high>=stop,
   targetHit=long?bar.high>=target:bar.low<=target;
  if(stopHit){
   // Gap through stop cannot be filled at the old stop level.
   exit=long?Math.min(stop,bar.open):Math.max(stop,bar.open);
   exitIndex=j;outcome="STOP";break;
  }
  if(targetHit){
   exit=target;exitIndex=j;outcome="TARGET";break;
  }
 }
 const grossR=(long?1:-1)*(exit-entry)/distance;
 const netR=grossR-entry*(feeBps/10000)/distance;
 const stress40R=grossR-entry*(40/10000)/distance;
 return{entryAt:rows[index].time+900000,exitAt:rows[exitIndex].time+900000,
  side,entry,exit,stop,target,outcome,method,split,
  trendRegime,volatilityRegime:atrRegime,netR,stress40R,exitIndex};
}
function validate(raw15,raw60,{hours=4,feeBps=20,asOf=Date.now(),days=42}={}){
 if(![2,4,8].includes(hours)||!finite(feeBps)||feeBps<0||feeBps>100||
    !finite(asOf)||!finite(days)||days<14||days>90)return empty("Invalid validation inputs");
 let a,b;
 try{
  a=A.normalize(raw15,15).filter(x=>x.time+900000<=asOf);
  b=A.normalize(raw60,60).filter(x=>x.time+3600000<=asOf);
 }catch(e){return empty("History refused: "+e.message);}
 // No silently shorter sample, no partial candle, no stale feed.
 const coverageMs=days*86400000;
 if(a.length<Math.floor(days*96*.95)||a.at(-1).time+900000<asOf-1800000||
    a[0].time>asOf-coverageMs+3600000||
    b.length<Math.floor(days*24*.95)||b.at(-1).time+3600000<asOf-7200000||
    b[0].time> a[0].time-65*3600000)
  return empty("Incomplete, stale or truncated 42-day history; refusing an invented validation. Try again when Delta provides all requested 15m/1h candles.");
 const splitAt=a[Math.floor(a.length*.7)].time;
 const records=Object.fromEntries(methods.map(m=>[m.key,[]]));
 const nextAllowed=Object.fromEntries(methods.map(m=>[m.key,0]));
 // Advance hourly pointer only as complete hourly bars become available.
 let hourEnd=0;
 for(let i=110;i+hours*4<a.length;i++){
  const event=a[i].time+900000;
  while(hourEnd<b.length&&b[hourEnd].time+3600000<=event)hourEnd++;
  if(hourEnd<65)continue;
  if(methods.every(m=>i<nextAllowed[m.key]))continue;
  const t=D.direction(a.slice(i-89,i+1),b.slice(Math.max(0,hourEnd-90),hourEnd),event);
  if(!["UP","DOWN"].includes(t.side)||!finite(t.invalidation))continue;
  const timeSplit=event<splitAt?"TRAIN":"OOS";
  const regime=finite(t.adx)?t.adx>=25?"TRENDING":t.adx<=18?"RANGING":"TRANSITION":"UNKNOWN";
  const atr=atrRegimes(a,i).volatility;
  for(const m of methods){
   if(i<nextAllowed[m.key]||!match(m.key,t))continue;
   const record=simulate(a,i,hours,t.side,t.invalidation,feeBps,atr,regime,m.key,timeSplit);
   if(!record)continue;
   // Embargo crossing the chronological split: training cannot use OOS candles.
   if(timeSplit==="TRAIN"&&record.exitAt>splitAt)continue;
   records[m.key].push(record);
   nextAllowed[m.key]=record.exitIndex+1;
  }
 }
 const grouped=methods.map(m=>{
  const all=records[m.key],train=all.filter(x=>x.split==="TRAIN"),oos=all.filter(x=>x.split==="OOS");
  const oosTrend=oos.filter(x=>x.trendRegime==="TRENDING");
  const oosRange=oos.filter(x=>x.trendRegime==="RANGING");
  const oosNormal=oos.filter(x=>x.volatilityRegime==="NORMAL_VOL");
  const oosElevated=oos.filter(x=>x.volatilityRegime==="ELEVATED_VOL");
  const adequate=train.length>=MIN_TRAIN&&oos.length>=MIN_OOS;
  return{key:m.key,label:m.label,train:stats(train),oos:stats(oos),
   byTrend:{trending:stats(oosTrend),ranging:stats(oosRange),transition:stats(oos.filter(x=>x.trendRegime==="TRANSITION"))},
   byVolatility:{normal:stats(oosNormal),elevated:stats(oosElevated)},
   status:adequate?"RESEARCH SAMPLE":"INSUFFICIENT SAMPLE",
   reason:adequate?
    "Predefined rule, no parameter tuning. Historical underlying proxy only; independent forward paper trading needed.":
    "Requires at least "+MIN_TRAIN+" training and "+MIN_OOS+" out-of-sample non-overlapping trades; no positive edge can be claimed.",
   // Limit UI memory: never persist bulk historical OHLC and trade records.
   examples:oos.slice(-5).map(x=>({entryAt:iso(x.entryAt),exitAt:iso(x.exitAt),netR:x.netR,trendRegime:x.trendRegime}))};
 });
 const current=grouped[0],baseline=grouped[1];
 const enough=current.train.trades>=MIN_TRAIN&&current.oos.trades>=MIN_OOS;
 const relative=enough&&baseline.oos.trades>=MIN_OOS?
   current.oos.meanNetR-baseline.oos.meanNetR:null;
 return{status:enough?"PRELIMINARY HISTORICAL RESEARCH":"INSUFFICIENT SAMPLE",
  reason:enough?
   "OOS is chronological, not a future live test. No options P&L, fill simulation, or strategy-profitability guarantee.":
   "No validated edge: minimum training and untouched OOS sample counts not reached.",
  start:iso(a[0].time),end:iso(a.at(-1).time+900000),splitAt:iso(splitAt),
  candleCount15:a.length,candleCount60:b.length,days,hours,feeBps,
  minTrain:MIN_TRAIN,minOos:MIN_OOS,methods:grouped,
  multiVsSmcOosDeltaR:relative,limitations:[
   "Historical UNDERLYING perpetual price proxy only: NOT historical option returns.",
   "Chronological 70/30 holdout with fixed rules, no parameter fitting; only one holdout period.",
   "Next-candle-open idealised entry; no order-book depth, latency, funding, margin or actual fill confirmation.",
   "20 bps round-trip assumption; 40 bps sensitivity includes no other fees; future volatility/costs can differ.",
   "ADX and ATR regimes are trailing indicators evaluated before entry; split-boundary crossing trades are excluded.",
   "No statistically established edge until larger independent datasets and forward paper results."
  ]};
}
root.LfcCryptoValidation={validate,stats,wilson,methods};
if(typeof module!=="undefined"&&module.exports)module.exports=root.LfcCryptoValidation;
})(typeof window!=="undefined"?window:globalThis);
