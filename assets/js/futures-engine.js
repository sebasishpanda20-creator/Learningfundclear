/* Public-data research only. No exchange orders or promised returns. */
(function(root){
'use strict';
const D=root.LfcCryptoDesk||(typeof require==='function'?require('./crypto-desk-engine.js'):null),n=x=>x==null||x===''?NaN:Number(x),fail=reason=>({status:'NO TRADE',reason});
function category(p){const tags=p.product_specs?.tags||[];if(tags.some(t=>/xstock|bstock|equity/i.test(t)))return 'STOCK';return null;}
function evaluate(p,t,trend,bars,capital,hours=4,now=Date.now()){
 if(!Number.isFinite(capital)||capital<=0||![2,4,8].includes(hours))return fail('Valid capital and 2/4/8-hour duration required');
 if(p.contract_type!=='perpetual_futures'||p.notional_type!=='vanilla'||p.is_quanto===true||p.settling_asset?.symbol!=='USD'||p.state!=='live'||p.trading_status!=='operational'||p.product_specs?.only_reduce_only_orders_allowed||t.oi_reduce_only_mode)return fail('Unsupported or unavailable contract');
 if(t.product_trading_status&&t.product_trading_status!=='operational')return fail('Ticker reports unavailable market');
 if(!D.fresh(t.timestamp,now,60000))return fail('Exchange quote older than 60 seconds');
 const bid=n(t.quotes?.best_bid),ask=n(t.quotes?.best_ask),cv=n(p.contract_value),tick=n(p.tick_size),fee=n(p.taker_commission_rate),fund=n(t.funding_rate),interval=n(p.product_specs?.rate_exchange_interval),oi=n(t.oi_value_usd),turnover=n(t.turnover_usd);
 if(![bid,ask,cv,tick].every(x=>Number.isFinite(x)&&x>0)||ask<bid)return fail('Invalid bid/ask or contract specifications');
 if((ask-bid)/((ask+bid)/2)>.0015||!(oi>=10000&&turnover>=50000))return fail('Liquidity filter: spread ≤0.15%, OI ≥$10k, 24h turnover ≥$50k');
 if(!Number.isFinite(fee)||fee<0||fee>.01||!Number.isFinite(fund)||Math.abs(fund)>1||!Number.isFinite(interval)||interval<60)return fail('Fee or funding inputs unavailable');
 if(!trend?.actionable||!['UP','DOWN'].includes(trend.side))return fail('No confirmed 15m/1h direction; mixed signals are not a range setup');
 let a;try{a=D.candles(bars,15,now);}catch(e){return fail(e.message);}
 const tail=a.slice(-15),tr=tail.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-tail[i].close),Math.abs(b.low-tail[i].close))),atr=tr.reduce((s,v)=>s+v,0)/14;
 const long=trend.side==='UP',entry=long?ask:bid;
 if(!(atr>0)||Math.abs(entry-a.at(-1).close)>atr)return fail('Entry too far from the last closed candle; do not chase');
 const structural=n(trend.invalidation),distance=Math.max(1.5*atr,long?entry-structural:structural-entry,2*(ask-bid));
 if(!Number.isFinite(distance)||distance<=0||distance/entry>.05)return fail('Invalid stop or stop distance exceeds 5%');
 const roundDown=x=>Math.floor(x/tick)*tick,roundUp=x=>Math.ceil(x/tick)*tick;
 const stop=long?roundDown(entry-distance):roundUp(entry+distance),riskDistance=Math.abs(entry-stop),target=long?roundUp(entry+2*riskDistance):roundDown(entry-2*riskDistance);
 if(stop<=0||target<=0)return fail('Invalid positive-price exit levels');
 // Reserve fees at the highest modeled price and one extra funding interval.
 // Funding rate is percentage per exchange interval. Never count credits as income.
 const maxPrice=Math.max(entry,stop,target),commission=2*maxPrice*cv*fee,gst=commission*.18,slippage=2*maxPrice*cv*.001,
 funding=maxPrice*cv*Math.abs(fund)/100*(Math.ceil(hours*3600/interval)+1),cost=commission+gst+slippage+funding,
 stopLoss=riskDistance*cv+cost,targetGain=Math.abs(target-entry)*cv-cost;
 if(!(targetGain>0&&targetGain/stopLoss>=1.25))return fail('Net target/stop below 1.25 after fees, GST, slippage and funding reserve');
 const quantity=Math.floor(Math.min(capital*.01/stopLoss,capital*.8/(entry*cv)));
 if(quantity<1)return fail('One contract exceeds the 1% modeled stop-risk or 80% notional budget');
 return {status:'RESEARCH CANDIDATE',symbol:p.symbol,side:long?'LONG':'SHORT',entry,stop,target,quantity,cv,notional:entry*cv*quantity,stopLoss:stopLoss*quantity,targetGain:targetGain*quantity,cost:cost*quantity,commission:commission*quantity,gst:gst*quantity,slippage:slippage*quantity,funding:funding*quantity,rr:targetGain/stopLoss,timeExit:now+hours*3600000,quoteAt:D.milliseconds(t.timestamp),reason:'15m/1h trend + 1.5 ATR/structure stop; 2R gross target. Account margin, order depth and execution unverified.'};
}
function bandSignal(rows,now=Date.now()){
 let a;try{a=D.candles(rows,15,now);}catch(e){return {side:'UNKNOWN',reason:e.message};}
 let hi=a[0].high,lo=a[0].low,prevHi=hi,prevLo=lo;
 for(let i=1;i<a.length;i++){prevHi=hi;prevLo=lo;hi+=(a[i].high-hi)*2/21;lo+=(a[i].low-lo)*2/21;}
 const last=a.at(-1),prev=a.at(-2),side=prev.close<=prevHi&&last.close>hi?'LONG':prev.close>=prevLo&&last.close<lo?'SHORT':'WAIT';
 return {side,high:hi,low:lo,reason:side==='WAIT'?'No fresh closed 15m EMA-band cross':'Fresh closed 15m EMA(20) high/low-band cross'};
}
function funding(p,t,live,capital,now=Date.now()){
 if(!live||!D.fresh(live.at,now,120000)||!(live.next>now&&live.next<=now+86400000)||!Number.isFinite(live.rate)||Math.abs(live.rate)>2)return fail('Waiting for exchange-confirmed funding rate and settlement time');
 if(!Number.isFinite(capital)||capital<=0||!D.fresh(t.timestamp,now,60000))return fail('Invalid capital or stale market quote');
 if(p.contract_type!=='perpetual_futures'||p.notional_type!=='vanilla'||p.is_quanto||p.settling_asset?.symbol!=='USD'||p.state!=='live'||p.trading_status!=='operational'||p.product_specs?.only_reduce_only_orders_allowed||t.oi_reduce_only_mode)return fail('Unsupported or unavailable contract');
 const bid=n(t.quotes?.best_bid),ask=n(t.quotes?.best_ask),cv=n(p.contract_value),fee=n(p.taker_commission_rate);
 if(![bid,ask,cv].every(x=>Number.isFinite(x)&&x>0)||ask<bid||(ask-bid)/((ask+bid)/2)>.0015||!Number.isFinite(fee)||fee<0||fee>.01||!(n(t.turnover_usd)>=50000&&n(t.oi_value_usd)>=10000))return fail('Invalid specifications, fees or insufficient liquidity');
 const price=live.rate>0?bid:ask,quantity=Math.floor(capital*.2/(price*cv));
 if(quantity<1)return fail('One contract exceeds 20% illustrative notional budget');
 const notional=quantity*price*cv,receipt=notional*Math.abs(live.rate)/100,cost=quantity*cv*(ask*fee*2*1.18+ask*.002+ask-bid);
 return {status:'WATCH ONLY',side:live.rate>0?'SHORT':'LONG',quantity,notional,receipt,cost,afterCosts:receipt-cost,next:live.next,rate:live.rate,at:live.at,
 reason:receipt>cost?'Funding exceeds modeled one-leg costs; matching hedge and its costs are unverified':'Funding does not cover modeled one-leg round-trip costs',
 hedge:live.rate>0?'Short perpetual + buy matching spot':'Long perpetual + short matching spot (borrow availability and cost required)'};
}
root.LfcFutures={category,evaluate,bandSignal,funding};if(typeof module!=='undefined')module.exports=root.LfcFutures;
})(typeof window!=='undefined'?window:globalThis);
