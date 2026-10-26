/* Defined-risk credit research and historical UNDERLYING-only validation.
 * Never translates paper candidates to exchange orders: multi-leg margin and
 * historical option fill/IV are not available in this module. */
(function(root){
"use strict";
const base=root.LfcCryptoDesk||(typeof require==="function"?require("./crypto-desk-engine.js"):null);
const num=x=>x===undefined||x===null||x===""?NaN:Number(x);
const finite=Number.isFinite;
const no=(why)=>({status:"NO TRADE",reason:why,candidates:[]});
const ts=x=>base.milliseconds(x);
function contract(t,now,asset){
 if(!t||typeof t.symbol!=="string")return null;
 const m=/^([CP])-([A-Z0-9]+)-(\d+(?:\.\d+)?)-(\d{6})$/.exec(t.symbol);
 if(!m||m[2]!==asset)return null;
 const date=m[4],expiry=Date.UTC(2000+Number(date.slice(4)),Number(date.slice(2,4))-1,Number(date.slice(0,2)),12);
 if(!finite(expiry)||new Date(expiry).getUTCDate()!==Number(date.slice(0,2)))return null;
 const p=t.product||{},q=t.quotes||{},cv=num(p.contract_value),bid=num(q.best_bid),ask=num(q.best_ask),
  oi=num(t.oi_value_usd),rate=num(p.taker_commission_rate),strike=num(m[3]);
 if(!base.fresh(t.timestamp,now)||p.state!=="live"||p.trading_status!=="operational"||
  p.contract_unit_currency!==asset||!finite(cv)||cv<=0||!finite(strike)||strike<=0||
  !finite(bid)||!finite(ask)||bid<=0||ask<=bid||(ask-bid)/((ask+bid)/2)>.20||
  !finite(oi)||oi<500||!finite(expiry))return null;
 return {symbol:t.symbol,kind:m[1],strike,expiry,cv,bid,ask,oi,rate};
}
function costReserve(legs,spot,cv){
 // 2 entries + 2 exits per 2-leg vertical; 8 individual fills for a condor.
 let fee=0,slip=0,fallback=false;
 for(const l of legs){
  const valid=finite(l.rate)&&l.rate>=0&&l.rate<=.01;
  const rate=valid?l.rate:.0005;fallback||=!valid;
  fee+=2*spot*cv*rate;
  slip+=2*.001*(l.ask+l.bid)*cv;
 }
 return {commissionUSD:fee,gstUSD:.18*fee,slippageUSD:slip,totalUSD:fee*1.18+slip,
  feeRateSource:fallback?"FALLBACK 0.05% per fill":"PRODUCT TAKER RATES"};
}
function makeCandidate(label,legs,spot,capital,width,credit,now,hours){
 if(!finite(width)||width<=0||!finite(credit)||credit<=0||credit>=width)return null;
 const cv=legs[0].cv;
 if(!legs.every(l=>l.cv===cv&&l.expiry===legs[0].expiry))return null;
 const costs=costReserve(legs,spot,cv);
 const gain=(credit*cv-costs.totalUSD),loss=((width-credit)*cv+costs.totalUSD);
 if(gain<=0||loss<=0||gain/loss<.20)return null;
 const lots=Math.floor(Math.min(capital*.02/loss,capital*.30/(spot*cv)));
 if(lots<1)return null;
 const cost={...costs,commissionUSD:costs.commissionUSD*lots,gstUSD:costs.gstUSD*lots,
  slippageUSD:costs.slippageUSD*lots,totalUSD:costs.totalUSD*lots};
 const bidAsk=legs.map(l=>({symbol:l.symbol,side:(legs.indexOf(l)%2===0?"SELL":"BUY"),bid:l.bid,ask:l.ask}));
 return{status:"WATCH ONLY",label,legs:bidAsk,expiry:legs[0].expiry,contractValue:cv,
  quantity:lots,creditPerUnit:credit,widthPerUnit:width,estimatedMaxLossUSD:loss*lots,
  estimatedMaxGainUSD:gain*lots,costBreakdown:cost,horizonHours:hours,timeExit:now+hours*3600000,
  score:gain/loss,reason:"Margin, execution sequence, portfolio exposure, IV and exchange fees require account verification. Research only."};
}
function evaluateCredit(tickers,trend,asset,capitalUSD,now=Date.now(),hours=4){
 if(![2,4,8].includes(hours)||!finite(capitalUSD)||capitalUSD<20||
  !finite(trend?.current)||trend.current<=0||!["UP","DOWN","SIDEWAYS"].includes(trend.side))
  return no("Capital, horizon or verified underlying price unavailable");
 const rows=(Array.isArray(tickers)?tickers:[]).map(t=>contract(t,now,asset)).filter(Boolean)
  .filter(l=>l.expiry>now+(hours+1)*3600000&&l.expiry<now+10*86400000&&
   Math.abs(l.strike-trend.current)/trend.current<=.10);
 if(rows.length<2)return no("Insufficient liquid verified call/put contracts");
 const exps=[...new Set(rows.map(l=>l.expiry))].sort((a,b)=>a-b).slice(0,3);
 const proposals=[];
 for(const expiry of exps){
  const expiryRows=rows.filter(l=>l.expiry===expiry);
  const calls=expiryRows.filter(l=>l.kind==="C").sort((a,b)=>a.strike-b.strike);
  const puts=expiryRows.filter(l=>l.kind==="P").sort((a,b)=>a.strike-b.strike);
  const bear=[],bull=[];
  // Outer long leg first in venue execution; do not infer margin from payoff.
  for(const short of calls.filter(l=>l.strike>trend.current*1.005).slice(0,10))
   for(const long of calls.filter(l=>l.strike>short.strike&&l.strike<short.strike+trend.current*.08).slice(0,6)){
    const c=makeCandidate("Bear call credit spread",[short,long],trend.current,capitalUSD,long.strike-short.strike,
      short.bid-long.ask,now,hours);
    if(c)bear.push(c);
   }
  for(const short of puts.filter(l=>l.strike<trend.current*.995).slice(-10))
   for(const long of puts.filter(l=>l.strike<short.strike&&l.strike>short.strike-trend.current*.08).slice(-6)){
    const c=makeCandidate("Bull put credit spread",[short,long],trend.current,capitalUSD,short.strike-long.strike,
      short.bid-long.ask,now,hours);
    if(c)bull.push(c);
   }
  if(trend.side==="DOWN"&&trend.actionable)proposals.push(...bear);
  if(trend.side==="UP"&&trend.actionable)proposals.push(...bull);
  if(trend.side==="SIDEWAYS"){
   // Keep combinations bounded and preserve the correct four-leg maximum-loss.
   const bearCandidates=bear.sort((a,b)=>b.score-a.score).slice(0,8);
   const bullCandidates=bull.sort((a,b)=>b.score-a.score).slice(0,8);
   for(const b of bearCandidates)for(const p of bullCandidates){
    const lookup=sym=>expiryRows.find(l=>l.symbol===sym);
    const legs=[...p.legs,...b.legs].map(x=>lookup(x.symbol));
    if(legs.some(x=>!x))continue;
    if(!(legs[0].strike<legs[2].strike))continue; // short put below short call
    const totalCredit=p.creditPerUnit+b.creditPerUnit;
    const maxWidth=Math.max(p.widthPerUnit,b.widthPerUnit);
    const candidate=makeCandidate("Iron condor",legs,trend.current,capitalUSD,maxWidth,totalCredit,now,hours);
    if(candidate)proposals.push(candidate);
   }
  }
 }
 proposals.sort((a,b)=>b.score-a.score);
 return proposals.length?{status:"WATCH ONLY",candidates:proposals.slice(0,5),
  reason:"Credit structures are cost-checked theoretical research; live order and portfolio margin are NOT verified."}:
 no("No credit spread/condor passes direction, liquidity, costs and capital limits");
}
function normalize(rows,minutes){
 if(!Array.isArray(rows))throw Error("Missing "+minutes+"m OHLC");
 const duration=minutes*60000,out=rows.map(r=>({time:ts(r.time??r.timestamp),open:num(r.open),
  high:num(r.high),low:num(r.low),close:num(r.close)})).sort((a,b)=>a.time-b.time);
 let prev=-Infinity;
 for(const x of out){
  if(!finite(x.time)||x.time<=prev||![x.open,x.high,x.low,x.close].every(finite)||
    x.low<=0||x.low>Math.min(x.open,x.close)||x.high<Math.max(x.open,x.close))throw Error("Bad historical OHLC");
  if(prev!==-Infinity&&x.time-prev!==duration)throw Error("Historical candle gap; backtest refused");
  prev=x.time;
 }
 return out;
}
function backtestUnderlying(raw15,raw60,{hours=4,feeBps=20,from,until}={}){
 if(![2,4,8].includes(hours)||!finite(feeBps)||feeBps<0||feeBps>100)return no("Bad testing parameters");
 let small,big;
 try{small=normalize(raw15,15);big=normalize(raw60,60);}
 catch(e){return no(e.message);}
 if(small.length<165||big.length<90)return no("Not enough continuous historical candles for walk-forward tests");
 const records=[];let curve=0,peak=0,maxDrawdownR=0;
 for(let i=90;i+hours*4+1<small.length;){
  const event=small[i].time+15*60000;
  if((from&&event<from)||(until&&event>until)){i++;continue;}
  const previousHours=big.filter(x=>x.time+3600000<=event).slice(-90);
  if(previousHours.length<65){i++;continue;}
  const t=base.direction(small.slice(i-90,i+1),previousHours,event);
  if(!t.actionable||!["UP","DOWN"].includes(t.side)){i++;continue;}
  const entry=small[i+1].open,stop=t.invalidation;
  if(!finite(stop)){i++;continue;}
  const distance=Math.abs(entry-stop);
  if(distance/entry<.0015||distance/entry>.03||
    (t.side==="UP"&&stop>=entry)||(t.side==="DOWN"&&stop<=entry)){i++;continue;}
  const sign=t.side==="UP"?1:-1,target=entry+sign*1.5*distance;
  let outcome="TIME EXIT",exitPrice=small[i+1+hours*4].close,exitIndex=i+1+hours*4;
  for(let j=i+1;j<=i+hours*4;j++){
   const b=small[j],hitStop=t.side==="UP"?b.low<=stop:b.high>=stop,
    hitTarget=t.side==="UP"?b.high>=target:b.low<=target;
   if(hitStop){outcome="STOP";exitPrice=stop;exitIndex=j;break;}
   if(hitTarget){outcome="TARGET";exitPrice=target;exitIndex=j;break;}
  }
  // Underlying price proxy only: not option-strategy P&L or a fill simulation.
  const grossR=sign*(exitPrice-entry)/distance;
  const costsR=entry*(feeBps/10000)/distance;
  const netR=grossR-costsR;
  curve+=netR;peak=Math.max(peak,curve);maxDrawdownR=Math.max(maxDrawdownR,peak-curve);
  records.push({entryAt:event,side:t.side,outcome,entry,exit:exitPrice,grossR,netR,exitAt:small[exitIndex].time+900000});
  i=exitIndex+1;
 }
 const n=records.length,wins=records.filter(r=>r.netR>0).length,sum=records.reduce((s,r)=>s+r.netR,0);
 return{status:n>=20?"HISTORICAL PROXY":"INSUFFICIENT SAMPLE",trades:n,wins,
  winRate:n?wins/n:null,meanNetR:n?sum/n:null,totalNetR:sum,maxDrawdownR,
  feeBps,hours,from:small[0].time,to:small.at(-1).time+900000,
  records:records.slice(-50),reason:n>=20?
  "Underlying-only non-overlapping historical walk-forward; option premiums, IV, margin and fills NOT tested. No out-of-sample validation.":
  "Fewer than 20 qualifying non-overlapping signals; performance is not validated."};
}
root.LfcCryptoAdvanced={evaluateCredit,backtestUnderlying,normalize};
if(typeof module!=="undefined"&&module.exports)module.exports=root.LfcCryptoAdvanced;
})(typeof window!=="undefined"?window:globalThis);
