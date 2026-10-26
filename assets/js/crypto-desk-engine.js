/* Crypto desk analytics; no order placement, no assumed fill prices. */
(function(root) {
"use strict";
const number=v=>v===null||v===undefined||v===""?NaN:Number(v);
const ok=Number.isFinite, wait=reason=>({status:"NO TRADE",reason});
function milliseconds(x) {let t=number(x);return !ok(t)?NaN:t>1e14?t/1000:t>1e11?t:t*1000;}
function fresh(t,now,age=120000){t=milliseconds(t);return ok(t)&&t<=now+15000&&t>=now-age;}
function candles(rows,minutes,now){
 if(!Array.isArray(rows))throw Error("No "+minutes+"m exchange candles");
 let duration=minutes*60000, prev=0;
 const out=rows.map(r=>({time:milliseconds(r.time??r.timestamp),open:number(r.open),high:number(r.high),low:number(r.low),close:number(r.close)})).sort((a,b)=>a.time-b.time).filter(b=>{
  if(!ok(b.time)||b.time<=prev||![b.open,b.high,b.low,b.close].every(ok)||b.low<=0||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close,b.low))throw Error("Invalid OHLC");
  prev=b.time;return b.time+duration<=now;
 });
 if(out.length<65||now-out.at(-1).time-duration>2*duration)throw Error("Insufficient or stale "+minutes+"m closed candles");
 return out;
}
function ema(rows,len){let v=rows[0].close,alpha=2/(len+1);for(let r of rows.slice(1))v=alpha*r.close+(1-alpha)*v;return v;}
function direction(raw15,raw60,now=Date.now()){
 let a,b;try{a=candles(raw15,15,now);b=candles(raw60,60,now);}catch(e){return{side:"UNKNOWN",actionable:false,why:e.message};}
 const l=a.at(-1),f=ema(a,20),s=ema(a,50),hf=ema(b,20),hs=ema(b,50),hour=b.at(-1).close;
 const up=hour>hf&&hf>hs&&l.close>f&&f>s,down=hour<hf&&hf<hs&&l.close<f&&f<s;
 const side=up?"UP":down?"DOWN":"SIDEWAYS";
 const upper=Math.max(...a.slice(-13,-1).map(v=>v.high)),lower=Math.min(...a.slice(-13,-1).map(v=>v.low));
 const bos=up&&l.close>upper?"BULLISH BOS":down&&l.close<lower?"BEARISH BOS":"NONE";
 const sweep=up&&a.at(-2).low<Math.min(...a.slice(-10,-2).map(v=>v.low))&&l.close>a.at(-2).high?"BULLISH SWEEP":
  down&&a.at(-2).high>Math.max(...a.slice(-10,-2).map(v=>v.high))&&l.close<a.at(-2).low?"BEARISH SWEEP":"NONE";
 const actionable=side!=="SIDEWAYS"&&(bos!=="NONE"||sweep!=="NONE");
 return{side,bos,sweep,actionable,current:l.close,lastClosedAt:l.time+900000,invalidation:up?lower:down?upper:null,
  why:side==="SIDEWAYS"?"1h and 15m EMA20/50 disagree":
   actionable?"Completed 15m structure break/reclaim confirmed by 1h trend":
   "Trend aligned; no completed BOS/sweep confirmation"};
}
function parseOption(t){
 const symbol=String(t.symbol||t.product_symbol||"");
 const m=/^([CP])-([A-Z0-9]+)-([0-9]+(?:\.[0-9]+)?)-([0-9]{6})$/.exec(symbol);
 if(!m)return null;
 const dd=Number(m[4].slice(0,2)),mo=Number(m[4].slice(2,4))-1,yr=2000+Number(m[4].slice(4)),expiry=Date.UTC(yr,mo,dd,12);
 if(new Date(expiry).getUTCDate()!==dd)return null;
 const p=t.product||{},q=t.quotes||{};
 return{symbol,side:m[1],asset:m[2],strike:number(m[3]),expiry,
  cv:number(p.contract_value),unit:p.contract_unit_currency,live:p.state==="live"&&p.trading_status==="operational",
  bid:number(q.best_bid),ask:number(q.best_ask),oi:number(t.oi_value_usd),timestamp:t.timestamp};
}
function liquid(x,asset,now){return x&&x.asset===asset&&x.live&&x.unit===asset&&ok(x.cv)&&x.cv>0&&
 ok(x.bid)&&x.bid>0&&ok(x.ask)&&x.ask>x.bid&&
 (x.ask-x.bid)/((x.ask+x.bid)/2)<=0.20&&ok(x.oi)&&x.oi>=500&&
 fresh(x.timestamp,now)&&x.expiry>now+8*3600000&&x.expiry<now+10*86400000;}
function chooseSpread(tickers,trend,asset,capitalUSD,now=Date.now()){
 if(!ok(capitalUSD)||capitalUSD<20)return wait("Capital or verified FX missing (minimum $20 equivalent)");
 if(!trend?.actionable||!["UP","DOWN"].includes(trend.side))return wait("No confirmed direction: "+(trend?.why||"no data"));
 const side=trend.side==="UP"?"C":"P",chain=(Array.isArray(tickers)?tickers:[]).map(parseOption).filter(t=>liquid(t,asset,now)&&t.side===side);
 if(chain.length<2||!ok(trend.current))return wait("Fresh liquid option strikes and verified contract sizes not available");
 let best=null;
 const expiries=[...new Set(chain.map(t=>t.expiry))].sort((a,b)=>a-b);
 for(const expiry of expiries.slice(0,3)){
  const rows=chain.filter(x=>x.expiry===expiry).sort((a,b)=>a.strike-b.strike);
  const longs=[...rows].sort((a,b)=>Math.abs(a.strike-trend.current)-Math.abs(b.strike-trend.current)).slice(0,5);
  for(const long of longs)for(const short of rows){
   if((side==="C"&&short.strike<=long.strike)||(side==="P"&&short.strike>=long.strike))continue;
   if(long.cv!==short.cv||Math.abs(short.strike-long.strike)/trend.current>0.08)continue;
   const width=Math.abs(short.strike-long.strike)*long.cv,debit=(long.ask-short.bid)*long.cv;
   const buffer=(long.ask+long.bid+short.ask+short.bid)*long.cv*0.005;
   const loss=debit+buffer,gain=width-debit-buffer;
   if(debit<=0||loss<=0||gain/loss<1.15)continue;
   const quantity=Math.floor(capitalUSD*0.02/loss);
   if(quantity<1)continue;
   const candidate={status:"PAPER PLAN",direction:trend.side,
    label:side==="C"?"Bull call debit spread":"Bear put debit spread",
    long:long.symbol,short:short.symbol,expiry,contractValue:long.cv,
    quantity,entrySpread:debit/long.cv,stopSpread:debit*0.5/long.cv,
    targetSpread:Math.min(width*0.9,debit*1.6)/long.cv,
    timeExit:Math.min(now+3*3600000,expiry-3600000),
    riskUSD:loss*quantity,estimatedFeesUSD:buffer*quantity,estimatedMaxGainUSD:gain*quantity,
    why:"15m/1h direction → fresh executable quotes → liquid nearest expiry → defined risk, under 2% capital",
    score:gain/loss-Math.abs(long.strike-trend.current)/trend.current};
   if(!best||candidate.score>best.score)best=candidate;
  }
  if(best)break;
 }
 return best||wait("No option vertical passes 2% max-loss, expiry, liquidity and reward gates");
}
function monitor(plan,tickers,now=Date.now()){
 if(plan?.status!=="PAPER PLAN")return wait("No locked spread");
 const rows=Array.isArray(tickers)?tickers:[],a=rows.find(t=>t.symbol===plan.long),b=rows.find(t=>t.symbol===plan.short);
 if(!a||!b||!fresh(a.timestamp,now)||!fresh(b.timestamp,now))return wait("Both leg timestamps must be current");
 const bid=number(a.quotes?.best_bid),ask=number(b.quotes?.best_ask);
 if(!ok(bid)||!ok(ask)||bid<=0||ask<=0)return wait("Cannot determine executable spread exit quote");
 const exitSpread=bid-ask, grossPnlUSD=(exitSpread-plan.entrySpread)*plan.contractValue*plan.quantity;
 const status=now>=plan.timeExit?"TIME EXIT":exitSpread<=plan.stopSpread?"STOP WATCH":exitSpread>=plan.targetSpread?"TARGET WATCH":"MONITOR";
 return{status,exitSpread,grossPnlUSD,reason:status==="MONITOR"?"Neither spread stop, target nor time reached":"Multi-leg exit alert only; no broker orders created"};
}
function fundingDesk(tickers,asset,capitalUSD,now=Date.now()){
 if(!ok(capitalUSD)||capitalUSD<20)return wait("Capital or FX conversion unavailable");
 const t=(Array.isArray(tickers)?tickers:[]).find(x=>x.symbol===asset+"USD"&&x.contract_type==="perpetual_futures");
 if(!t||!fresh(t.timestamp,now))return wait("Fresh Delta perpetual funding quote not available");
 const p=t.product||{},funding=number(t.funding_rate??t.funding_rate_value),
  mark=number(t.mark_price),cv=number(p.contract_value);
 if(!ok(funding)||!ok(mark)||mark<=0||!ok(cv)||cv<=0||p.state!=="live"||p.contract_unit_currency!==asset)
  return wait("Missing verified funding/mark/contract metadata");
 const contracts=Math.floor(capitalUSD*0.20/(mark*cv));
 if(contracts<1)return wait("20% notional limit cannot cover a single contract");
 return{status:"WATCH ONLY",asset,perp:asset+"USD",fundingRaw:funding,
  mark,contractValue:cv,contracts,notionalUSD:contracts*mark*cv,
  route:funding>0?"SHORT perp + LONG matching spot":funding<0?"LONG perp + SHORT matching spot":"NO CARRY",
  reason:"No spot borrow/executable hedge, basis, taxes, fees or funding settlement verified. Zero trades placed."};
}
root.LfcCryptoDesk={milliseconds,fresh,candles,direction,chooseSpread,monitor,fundingDesk};
if(typeof module!=="undefined"&&module.exports)module.exports=root.LfcCryptoDesk;
})(typeof window!=="undefined"?window:globalThis);
