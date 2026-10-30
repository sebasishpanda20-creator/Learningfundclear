/* RANGE_V1: read-only, four-leg iron-condor research. Never places broker orders. */
(function(root){'use strict';
const D=root.LfcCryptoDesk||(typeof require==='function'?require('./crypto-desk-engine.js'):null),N=x=>x===null||x===undefined||x===''?NaN:Number(x),F=Number.isFinite;
const wait=reason=>({status:'WAIT',reason});
function ema(a,n){let v=a[0];for(const x of a.slice(1))v+=(x-v)*2/(n+1);return v;}
function detect(raw,confirm,now=Date.now(),frames=[15,60]){
 try{
 if(![[5,15],[5,30],[15,30],[15,60],[30,60]].some(f=>f[0]===frames[0]&&f[1]===frames[1]))return wait('Unsupported range timeframe.');
 const a=D.candles(raw,frames[0],now),h=D.candles(confirm,frames[1],now);
 for(const [bars,m] of [[a,frames[0]],[h,frames[1]]])for(let i=1;i<bars.length;i++)if(bars[i].time-bars[i-1].time!==m*60000)return wait('Missing candles: range cannot be verified.');
 const recent=a.slice(-25,-1),last=a.at(-1),high=Math.max(...recent.map(b=>b.high)),low=Math.min(...recent.map(b=>b.low)),width=high-low;
 const tr=a.slice(-15).map((b,i,arr)=>i?Math.max(b.high-b.low,Math.abs(b.high-arr[i-1].close),Math.abs(b.low-arr[i-1].close)):NaN).slice(1),atr=tr.reduce((s,x)=>s+x,0)/14;
 const closes=a.map(b=>b.close),hc=h.map(b=>b.close),travel=recent.slice(1).reduce((s,b,i)=>s+Math.abs(b.close-recent[i].close),0),efficiency=travel?Math.abs(recent.at(-1).close-recent[0].close)/travel:1;
 const drift=Math.abs(ema(hc,20)-ema(hc.slice(0,-6),20));
 const touches=side=>{let count=0,prev=-4;recent.forEach((b,i)=>{if((side==='low'?b.low<=low+width*.15:b.high>=high-width*.15)&&i-prev>=3){count++;prev=i;}});return count;};
 const returns=closes.slice(-61).slice(1).map((c,i)=>Math.log(c/closes.slice(-61)[i])),mean=returns.reduce((s,x)=>s+x,0)/returns.length;
 const rv=Math.sqrt(returns.reduce((s,x)=>s+(x-mean)**2,0)/(returns.length-1))*Math.sqrt(365*24*60/frames[0]);
 const checks=[{name:'Repeated support and resistance tests',pass:touches('low')>=2&&touches('high')>=2},{name:'Low directional efficiency (≤0.30)',pass:efficiency<=.30},{name:'Range width between 3 and 12 ATR',pass:atr>0&&width>=3*atr&&width<=12*atr},{name:'Higher-timeframe EMA drift ≤0.5 ATR',pass:drift<=atr*.5},{name:'Latest close in central 60% of range',pass:last.close>low+width*.2&&last.close<high-width*.2},{name:'No latest-candle range breakout',pass:last.high<=high+atr*.25&&last.low>=low-atr*.25}];
 const confirmed=checks.every(c=>c.pass);
 return {status:confirmed?'CONFIRMED RANGE':'WAIT',reason:confirmed?'Repeated boundary tests, low drift and price inside the range.':checks.filter(c=>!c.pass).map(c=>c.name).join('; '),checks,low,high,atr,spot:last.close,rv,efficiency,at:last.time+frames[0]*60000,minutes:frames[0]};
 }catch(e){return wait(e.message);}
}
function quote(t,asset,now){
 const p=t.product||{},q=t.quotes||{},m=/^([CP])-([A-Z0-9]+)-(\d+(?:\.\d+)?)-(\d{6})$/.exec(t.symbol||'');
 if(!m||m[2]!==asset||p.symbol!==t.symbol||p.contract_unit_currency!==asset||p.state!=='live'||p.trading_status!=='operational')return null;
 const expiry=Date.parse(p.settlement_time),cv=N(p.contract_value),bid=N(q.best_bid),ask=N(q.best_ask),rate=N(p.taker_commission_rate),strike=N(m[3]),markIv=N(q.mark_iv),bidIv=N(q.bid_iv),iv=F(markIv)&&markIv>0?markIv:bidIv;
 if(!D.fresh(t.timestamp,now,60000)||![expiry,cv,bid,ask,rate,strike].every(F)||cv<=0||bid<=0||ask<=bid||rate<0||rate>.01||(ask-bid)/((ask+bid)/2)>.15||N(t.oi_value_usd)<500||!F(N(t.oi_value_usd)))return null;
 return {symbol:t.symbol,kind:m[1],strike,expiry,cv,bid,ask,rate,iv,ivSource:F(markIv)&&markIv>0?"mark IV":"bid IV fallback",spot:N(t.spot_price),at:D.milliseconds(t.timestamp)};
}
function reserve(legs,spot){
 // Eight taker fills at product rates; no fee-cap discounts. 20% spot buffer for exits.
 const commission=legs.reduce((s,l)=>s+2*spot*1.2*l.cv*l.rate,0),slippage=legs.reduce((s,l)=>s+2*(l.ask+l.bid)*l.cv*.001,0);
 return {commission,gst:commission*.18,slippage,total:commission*1.18+slippage};
}
function choose(tickers,range,asset,capital,now=Date.now(),hours=2){
 if(range?.status!=='CONFIRMED RANGE')return wait('No confirmed range: '+(range?.reason||'history unavailable'));
 if(![2,4,8].includes(hours)||!F(capital)||capital<20)return wait('Valid capital (at least $20 equivalent) and session required.');
 if(!F(range.at)||now-range.at>range.minutes*120000||range.at>now)return wait('Range evidence is stale.');
 const all=(Array.isArray(tickers)?tickers:[]).map(t=>quote(t,asset,now)).filter(Boolean).filter(q=>q.expiry>now+(hours+2)*3600000&&q.expiry<now+7*86400000);
 let best=null,structures=0,volReject=0,costReject=0,capitalReject=0;
 for(const expiry of [...new Set(all.map(q=>q.expiry))].sort().slice(0,3)){
 const rows=all.filter(q=>q.expiry===expiry),puts=rows.filter(q=>q.kind==='P').sort((a,b)=>b.strike-a.strike),calls=rows.filter(q=>q.kind==='C').sort((a,b)=>a.strike-b.strike);
 for(const sp of puts.filter(q=>q.strike<=range.low-range.atr*.25).slice(0,4))for(const sc of calls.filter(q=>q.strike>=range.high+range.atr*.25).slice(0,4)){
 if(![sp.iv,sc.iv].every(v=>F(v)&&v>0&&v<=5)||Math.min(sp.iv,sc.iv)<range.rv*1.2){volReject++;continue;}
 for(const lp of puts.filter(q=>q.strike<sp.strike).slice(0,3))for(const lc of calls.filter(q=>q.strike>sc.strike).slice(0,3)){
 const legs=[{...lp,side:'BUY'},{...sp,side:'SELL'},{...sc,side:'SELL'},{...lc,side:'BUY'}];
 if(!legs.every(l=>l.cv===sp.cv&&F(l.spot)&&l.spot>range.low+range.atr*.25&&l.spot<range.high-range.atr*.25))continue;
 structures++;
 const credit=sp.bid+sc.bid-lp.ask-lc.ask,width=Math.max(sp.strike-lp.strike,lc.strike-sc.strike),exit=sp.ask+sc.ask-lp.bid-lc.bid,cv=sp.cv;
 if(!(credit>0&&credit<width&&exit>=0))continue;
 const costs=reserve(legs,range.spot),target=credit*.5,stop=Math.min(credit*1.25,width*.95),reward=(credit-target)*cv-costs.total,loss=(stop-credit)*cv+costs.total,maxLoss=(width-credit)*cv+costs.total;
 if(stop<=credit||exit>=stop||reward<=0||reward/loss<1||credit*cv-costs.total<=0){costReject++;continue;}
 // Four-leg notional cap and payoff-risk cap; this is NOT account margin.
 const quantity=Math.floor(Math.min(capital*.02/maxLoss,capital*.30/(4*range.spot*cv)));
 if(quantity<1){capitalReject++;continue;}
 const plan={status:'PAPER CANDIDATE',model:'RANGE_V1',asset,legs,expiry,createdAt:now,timeExit:now+hours*3600000,hours,range:{...range},credit,entryClose:exit,target,stop,width,cv,quantity,costs,totalCosts:costs.total*quantity,netTarget:reward*quantity,netStop:loss*quantity,maxLoss:maxLoss*quantity,maxGain:(credit*cv-costs.total)*quantity,lowerBE:sp.strike-credit,upperBE:sc.strike+credit,score:reward/loss,iv:Math.min(sp.iv,sc.iv),reason:'Range + short-leg '+(sp.ivSource==='mark IV'&&sc.ivSource==='mark IV'?'mark IV':'quoted IV')+' at least 1.2× recent realised volatility; heuristic, not a proven edge.'};
 if(!best||plan.score>best.score)best=plan;
 }
 }
 }
 return best||{...wait(`No affordable condor passes all checks. ${structures} structures examined; ${volReject} short-strike pairs failed the IV-versus-realised-volatility check; ${costReject} cost/exit failures; ${capitalReject} capital failures. Fresh product expiry, quotes and both protective wings are required.`),structures,volReject,costReject,capitalReject};
}
function monitor(plan,tickers,range,now=Date.now()){
 if(plan?.model!=='RANGE_V1')return wait('No saved range paper plan.');
 if(now>=plan.timeExit)return {status:'TIME EXIT',reason:'Planned session has ended. Review all four legs on Delta; no order was sent.'};
 const legs=plan.legs.map(l=>{const t=tickers.find(t=>t.symbol===l.symbol);return t?quote(t,plan.asset,now):null;});
 if(legs.some((l,i)=>!l||l.cv!==plan.legs[i].cv||l.expiry!==plan.expiry))return {status:'DATA UNAVAILABLE',reason:'All four fresh leg quotes are required. Do not interpret missing data as HOLD.'};
 const close=legs.reduce((s,l,i)=>s+(plan.legs[i].side==='SELL'?l.ask:-l.bid),0);
 const costs=Math.max(plan.costs.total,reserve(legs,range?.spot||plan.range.spot).total)*plan.quantity;
 const net=(plan.credit-close)*plan.cv*plan.quantity-costs;
 const base={close,net,at:now};
 if(legs.some(l=>F(l.spot)&&(l.spot<plan.range.low-plan.range.atr*.25||l.spot>plan.range.high+plan.range.atr*.25)))return {...base,status:'BREAKOUT EXIT',reason:'Fresh option underlying quote moved beyond the original range exit boundary.'};
 if(close>=plan.stop)return {...base,status:'STOP WATCH',reason:'Combined buyback cost reached the paper stop. Review all four legs.'};
 if(!range||!F(range.spot)||!F(range.at)||range.at>now||now-range.at>range.minutes*120000)return {...base,status:'DATA UNAVAILABLE',reason:'Underlying range evidence unavailable or stale.'};
 if(range.spot<plan.range.low-plan.range.atr*.25||range.spot>plan.range.high+plan.range.atr*.25)return {...base,status:'BREAKOUT EXIT',reason:'Closed underlying candle invalidated the original range. Review all four legs.'};
 if(close<=plan.target)return {...base,status:'TARGET WATCH',reason:'Combined buyback cost reached the paper target.'};
 if(range.status!=='CONFIRMED RANGE')return {...base,status:'RANGE REVIEW',reason:'Fresh candles no longer confirm a stable range. '+range.reason};
 return {...base,status:'MONITOR',reason:'Original range, fixed target, stop and session exit remain under observation.'};
}
root.LfcCryptoRange={detect,choose,monitor,reserve};if(typeof module!=='undefined')module.exports=root.LfcCryptoRange;
})(typeof window!=='undefined'?window:globalThis);
