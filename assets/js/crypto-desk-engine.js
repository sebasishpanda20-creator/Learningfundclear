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
 const out=rows.map(r=>({time:milliseconds(r.time??r.timestamp),open:number(r.open),high:number(r.high),low:number(r.low),close:number(r.close),volume:number(r.volume??r.v)})).sort((a,b)=>a.time-b.time).filter(b=>{
  if(!ok(b.time)||b.time<=prev||![b.open,b.high,b.low,b.close].every(ok)||b.low<=0||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close,b.low))throw Error("Invalid OHLC");
  prev=b.time;return b.time+duration<=now;
 });
 if(out.length<65||now-out.at(-1).time-duration>2*duration)throw Error("Insufficient or stale "+minutes+"m closed candles");
 return out;
}
function ema(rows,len){let v=rows[0].close,alpha=2/(len+1);for(let r of rows.slice(1))v=alpha*r.close+(1-alpha)*v;return v;}
// Indicator families are separate pieces of evidence, not independent probabilities.
// All calculations use closed candles only; no current/forming candle is allowed.
function rsi(rows,n=14){
 if(rows.length<n+2)return NaN;
 let gains=0,losses=0;
 for(let i=1;i<=n;i++){const d=rows[i].close-rows[i-1].close;gains+=Math.max(d,0);losses+=Math.max(-d,0);}
 let avgGain=gains/n,avgLoss=losses/n;
 for(let i=n+1;i<rows.length;i++){
  const d=rows[i].close-rows[i-1].close;
  avgGain=(avgGain*(n-1)+Math.max(d,0))/n;
  avgLoss=(avgLoss*(n-1)+Math.max(-d,0))/n;
 }
 return avgLoss===0?(avgGain===0?50:100):100-100/(1+avgGain/avgLoss);
}
function macdHistogram(rows){
 if(rows.length<40)return NaN;
 let fast=rows[0].close,slow=fast,signal=0;
 for(let i=1;i<rows.length;i++){
  const price=rows[i].close;
  fast+=(price-fast)*(2/13);slow+=(price-slow)*(2/27);
  signal+=((fast-slow)-signal)*(2/10);
 }
 return fast-slow-signal;
}
function adx(rows,n=14){
 if(rows.length<2*n+1)return{value:NaN,plusDI:NaN,minusDI:NaN};
 let tr=0,plus=0,minus=0,dx=[];
 for(let i=1;i<rows.length;i++){
  const c=rows[i],p=rows[i-1],up=c.high-p.high,down=p.low-c.low;
  const trueRange=Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close));
  const pos=up>down&&up>0?up:0,neg=down>up&&down>0?down:0;
  if(i<=n){tr+=trueRange;plus+=pos;minus+=neg;}
  else{tr=tr-tr/n+trueRange;plus=plus-plus/n+pos;minus=minus-minus/n+neg;}
  if(i>=n){
   const plusDI=tr>0?100*plus/tr:0,minusDI=tr>0?100*minus/tr:0;
   dx.push({dx:plusDI+minusDI?100*Math.abs(plusDI-minusDI)/(plusDI+minusDI):0,plusDI,minusDI});
  }
 }
 if(dx.length<n)return{value:NaN,plusDI:NaN,minusDI:NaN};
 let value=dx.slice(0,n).reduce((sum,x)=>sum+x.dx,0)/n;
 for(const x of dx.slice(n))value=(value*(n-1)+x.dx)/n;
 const last=dx.at(-1);
 return{value,plusDI:last.plusDI,minusDI:last.minusDI};
}
function direction(raw15,raw60,now=Date.now(),frames=[15,60]){
 if(!Array.isArray(frames)||![[15,60],[5,15]].some(x=>x[0]===frames[0]&&x[1]===frames[1]))return {side:"UNKNOWN",actionable:false,why:"Unsupported signal timeframe"};
 const [entryMinutes,confirmMinutes]=frames;
 let a,b;try{a=candles(raw15,entryMinutes,now);b=candles(raw60,confirmMinutes,now);}
 catch(e){return{side:"UNKNOWN",actionable:false,score:0,why:e.message};}
 const l=a.at(-1),f=ema(a,20),s=ema(a,50),hf=ema(b,20),hs=ema(b,50),hour=b.at(-1).close;
 const up=hour>hf&&hf>hs&&l.close>f&&f>s,down=hour<hf&&hf<hs&&l.close<f&&f<s;
 const side=up?"UP":down?"DOWN":"SIDEWAYS";
 const upper=Math.max(...a.slice(-13,-1).map(v=>v.high)),lower=Math.min(...a.slice(-13,-1).map(v=>v.low));
 const bos=up&&l.close>upper?"BULLISH BOS":down&&l.close<lower?"BEARISH BOS":"NONE";
 const sweep=up&&a.at(-2).low<Math.min(...a.slice(-10,-2).map(v=>v.low))&&l.close>a.at(-2).high?"BULLISH SWEEP":
  down&&a.at(-2).high>Math.max(...a.slice(-10,-2).map(v=>v.high))&&l.close<a.at(-2).low?"BEARISH SWEEP":"NONE";
 const strength=adx(a),momentumRsi=rsi(a),histogram=macdHistogram(a);
 const rsiAligned=Number.isFinite(momentumRsi)&&(up?momentumRsi>=55:down?momentumRsi<=45:false);
 const macdAligned=Number.isFinite(histogram)&&(up?histogram>0:down?histogram<0:false);
 const adxAligned=Number.isFinite(strength.value)&&strength.value>=20&&
  (up?strength.plusDI>strength.minusDI:down?strength.minusDI>strength.plusDI:false);
 const structure=bos!=="NONE"||sweep!=="NONE";
 const volumes=a.slice(-21).map(x=>x.volume);
 const volumeReady=volumes.length===21&&volumes.every(x=>Number.isFinite(x)&&x>=0);
 const meanVolume=volumeReady?volumes.slice(0,-1).reduce((sum,x)=>sum+x,0)/20:NaN;
 const volumeRatio=Number.isFinite(meanVolume)&&meanVolume>0?volumes.at(-1)/meanVolume:NaN;
 const volumeAligned=Number.isFinite(volumeRatio)&&volumeRatio>=1.2;
 const aligned=side!=="SIDEWAYS";
 const components=[
  {name:`EMA ${entryMinutes}m + ${confirmMinutes===60?"1h":confirmMinutes+"m"}`,passed:aligned,points:aligned?35:0,max:35},
  {name:"SMC BOS / sweep",passed:structure,points:structure?20:0,max:20},
  {name:"RSI(14) momentum",passed:rsiAligned,points:rsiAligned?15:0,max:15},
  {name:"MACD(12,26,9) momentum",passed:macdAligned,points:macdAligned?15:0,max:15},
  {name:"ADX(14) +DI/-DI",passed:adxAligned,points:adxAligned?10:0,max:10},
  {name:"Volume expansion (optional)",passed:volumeAligned,points:volumeAligned?5:0,max:5,available:Number.isFinite(volumeRatio)}
 ];
 const score=aligned?components.reduce((sum,x)=>sum+x.points,0):0;
 // Without BOS/sweep, require BOTH momentum families plus ADX trend strength.
 // A BOS/sweep without momentum must not authorize a directional paper plan.
 const actionable=aligned&&score>=70&&(rsiAligned||macdAligned)&&
  (structure||(rsiAligned&&macdAligned&&adxAligned));
 const why=!aligned?`${entryMinutes}m and ${confirmMinutes}m EMA20/50 do not align — no directional trade`:
  actionable?"Multi-factor directional confirmation; "+(structure?"SMC and indicators aligned":"RSI, MACD and ADX agree without an SMC break"):
  "Directional EMA trend, but multi-factor momentum/strength threshold not met";
 return{side,bos,sweep,actionable,current:l.close,lastClosedAt:l.time+entryMinutes*60000,
  invalidation:up?lower:down?upper:null,
  score,maxScore:Number.isFinite(volumeRatio)?100:95,components,
  rsi:momentumRsi,macdHistogram:histogram,adx:strength.value,
  plusDI:strength.plusDI,minusDI:strength.minusDI,volumeRatio,
  signalMethod:"MULTI_FACTOR_V1",why};
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
  bid:number(q.best_bid),ask:number(q.best_ask),oi:number(t.oi_value_usd),timestamp:t.timestamp,takerRate:number(p.taker_commission_rate)};
}
function liquid(x,asset,now){return x&&x.asset===asset&&x.live&&x.unit===asset&&ok(x.cv)&&x.cv>0&&
 ok(x.bid)&&x.bid>0&&ok(x.ask)&&x.ask>x.bid&&
 (x.ask-x.bid)/((x.ask+x.bid)/2)<=0.20&&ok(x.oi)&&x.oi>=500&&
 fresh(x.timestamp,now)&&x.expiry>now+3600000&&x.expiry<now+10*86400000;}
// Conservative cost estimates: four taker fills and no premium fee-cap discounts.
const GST_RATE=0.18,SLIPPAGE_RATE=0.001,FALLBACK_TAKER_RATE=0.0005;
function roundTripCosts(legs,spot,cv,qty=1){
 if(!ok(spot)||spot<=0||!ok(cv)||cv<=0||!Number.isInteger(qty)||qty<1||!Array.isArray(legs)||legs.length!==2)return null;
 let taker=0,premiums=0,fallback=false;
 for(const leg of legs){
  const rate=number(leg.takerRate),valid=ok(rate)&&rate>=0&&rate<=0.01;
  const used=valid?rate:FALLBACK_TAKER_RATE;
  if(!valid)fallback=true;
  taker+=spot*cv*qty*used*2;
  premiums+=(leg.ask+leg.bid)*cv*qty;
 }
 const gst=taker*GST_RATE,slippage=premiums*SLIPPAGE_RATE*2;
 return{commissionUSD:taker,gstUSD:gst,slippageUSD:slippage,totalUSD:taker+gst+slippage,
  feeRateSource:fallback?"CONSERVATIVE FALLBACK (0.05% each leg per side)":"PRODUCT TAKER RATES",
  note:"Estimated four taker fills, no premium cap or discounts; GST 18% on fees; slippage 0.1% each side on option premiums. Actual fill, expiry settlement, INR settlement FX, TDS and income taxes excluded."};
}
// Session economics are planning scenarios, not expected returns or win probability.
function sessionEconomics(debit,width,costs,currentExit){
 if(![debit,width,costs,currentExit].every(ok)||debit<=0||width<=debit||costs<0)return {eligible:false,reason:"Invalid spread economics"};
 const stop=debit*.5,target=Math.min(width*.9,debit*1.6),netReward=target-debit-costs,netLoss=debit-stop+costs;
 const rr=netReward/netLoss,entryDrag=debit-currentExit;
 const reason=netReward<=0?"Estimated fees consume the session target":currentExit<=stop?"Current close quotes already breach the planned stop":rr<1?"Net session target is smaller than the modeled stop loss":"Session target and stop pass cost checks";
 return {eligible:netReward>0&&currentExit>stop&&rr>=1,reason,stop,target,netReward,netLoss,rr,entryDrag,breakEvenWinRate:netLoss/(netLoss+netReward)};
}
function chooseSpread(tickers,trend,asset,capitalUSD,now=Date.now(),hours=4){
 if(![2,4,8].includes(hours))return wait("Choose a valid 2, 4 or 8 hour trade horizon");
 if(!ok(capitalUSD))return wait("Capital or verified FX missing");
 if(capitalUSD<20)return wait("CAPITAL BLOCK: available $"+capitalUSD.toFixed(2)+" is below this portal\u0027s $20 research minimum; ₹1,000 and ₹10,000 have different risk budgets");
 if(!trend?.actionable||!["UP","DOWN"].includes(trend.side))return wait("No confirmed direction: "+(trend?.why||"no data"));
 const side=trend.side==="UP"?"C":"P",chain=(Array.isArray(tickers)?tickers:[]).map(parseOption).filter(t=>liquid(t,asset,now)&&t.side===side);
 if(chain.length<2||!ok(trend.current))return wait("Fresh liquid option strikes and verified contract sizes not available");
 let best=null,minOneLotCapital=Infinity,sessionRejected=0;
 const expiries=[...new Set(chain.map(t=>t.expiry))].sort((a,b)=>a-b);
 for(const expiry of expiries.slice(0,3)){
  if(expiry<=now+hours*3600000+3600000)continue;
  const rows=chain.filter(x=>x.expiry===expiry).sort((a,b)=>a.strike-b.strike);
  const longs=[...rows].sort((a,b)=>Math.abs(a.strike-trend.current)-Math.abs(b.strike-trend.current)).slice(0,5);
  for(const long of longs)for(const short of rows){
   if((side==="C"&&short.strike<=long.strike)||(side==="P"&&short.strike>=long.strike))continue;
   if(long.cv!==short.cv||Math.abs(long.strike-trend.current)/trend.current>0.03||Math.abs(short.strike-long.strike)/trend.current>0.08)continue;
   const width=Math.abs(short.strike-long.strike)*long.cv,debit=(long.ask-short.bid)*long.cv;
   const costs=roundTripCosts([long,short],trend.current,long.cv);
   if(!costs)continue;
   const buffer=costs.totalUSD;
   const loss=debit+buffer,gain=width-debit-buffer;
   if(debit<=0||loss<=0||gain<=0||gain/loss<1.15)continue;
   const economics=sessionEconomics(debit,width,buffer,(long.bid-short.ask)*long.cv);
   if(!economics.eligible){sessionRejected++;continue;}
   minOneLotCapital=Math.min(minOneLotCapital,Math.max(20,loss/.02,long.cv*trend.current/.30));
   const quantity=Math.floor(Math.min(capitalUSD*0.02/loss,capitalUSD*0.30/(long.cv*trend.current)));
   if(quantity<1)continue;
   const candidate={status:"PAPER PLAN",direction:trend.side,
    signalScore:trend.score,signalMaxScore:trend.maxScore,signalMethod:trend.signalMethod,
    label:side==="C"?"Bull call debit spread":"Bear put debit spread",
    long:long.symbol,short:short.symbol,expiry,contractValue:long.cv,
    quantity,entrySpread:debit/long.cv,stopSpread:debit*0.5/long.cv,
    targetSpread:Math.min(width*0.9,debit*1.6)/long.cv,
    timeExit:now+hours*3600000,horizonHours:hours,
    riskUSD:loss*quantity,estimatedFeesUSD:costs.commissionUSD*quantity,
    costBreakdown:roundTripCosts([long,short],trend.current,long.cv,quantity),
    estimatedMaxGainUSD:gain*quantity,
    expectedTargetNetUSD:(Math.min(width*0.9,debit*1.6)-debit-buffer)*quantity,
    expectedStopNetUSD:(debit*0.5-debit-buffer)*quantity,
    breakevenSpread:(debit+buffer)/long.cv,
    why:"Multi-factor 15m/1h direction (SMC or RSI/MACD/ADX) → liquid quoted expiry → positive session target and at least 1:1 net target/stop ratio → 2% modeled maximum spread-risk / 30% notional checks",
    sessionNetRR:economics.rr,breakEvenWinRate:economics.breakEvenWinRate,
    entryDragUSD:economics.entryDrag*quantity,underlyingInvalidation:trend.invalidation,
    selectionMethod:"SESSION_NET_RR_V2",
    score:economics.rr};
   if(!best||candidate.score>best.score)best=candidate;
  }
 }
 return best||wait(Number.isFinite(minOneLotCapital)&&capitalUSD<minOneLotCapital?
  "CAPITAL BLOCK: smallest qualifying vertical needs approximately $"+minOneLotCapital.toFixed(2)+
  " of modeled research capital for one contract under 2% risk and 30% notional limits; available $"+capitalUSD.toFixed(2):
  "No option vertical passes direction, timeframe, liquidity and session economics. "+sessionRejected+" pairs rejected because fees consume the target, net target/stop is below 1:1, or close quotes already breach the stop. Increasing capital does not repair poor per-contract economics");
}
// Long-volatility alternatives are research-only: a sideways market does not by
// itself imply imminent movement. Liquidity, fresh quotes and premium risk still apply.
function chooseVolatility(tickers,trend,asset,capitalUSD,now=Date.now(),hours=4) {
 if(![2,4,8].includes(hours))return wait("Invalid duration");
 if(!ok(capitalUSD))return wait("Capital or FX quote unavailable");
 if(capitalUSD<20)return wait("CAPITAL BLOCK: available $"+capitalUSD.toFixed(2)+" is below the $20 portal research minimum");
 if(!trend||!Number.isFinite(trend.current)||trend.side==="UNKNOWN")
  return wait("Underlying history unavailable; no volatility setup");
 const all=(Array.isArray(tickers)?tickers:[]).map(parseOption)
  .filter(x=>liquid(x,asset,now)&&x.expiry>now+(hours+1)*3600000);
 const expiries=[...new Set(all.map(x=>x.expiry))].sort((a,b)=>a-b);
 if(!expiries.length)return wait("No fresh call and put contract pairs with sufficient expiry");
 let best=null;
 for(const expiry of expiries.slice(0,3)){
  const calls=all.filter(x=>x.expiry===expiry&&x.side==="C"),
   puts=all.filter(x=>x.expiry===expiry&&x.side==="P");
  if(!calls.length||!puts.length)continue;
  for(const call of calls)for(const put of puts){
   if(call.cv!==put.cv||call.unit!==put.unit)continue;
   const straddle=call.strike===put.strike;
   const strangle=call.strike>put.strike&&call.strike!==put.strike;
   if(!straddle&&!strangle)continue;
   if(straddle&&Math.abs(call.strike-trend.current)/trend.current>0.025)continue;
   if(strangle&&(call.strike-trend.current)/trend.current>0.05||
      strangle&&(trend.current-put.strike)/trend.current>0.05)continue;
   if(strangle&&(call.strike<trend.current||put.strike>trend.current))continue;
   const debit=(call.ask+put.ask)*call.cv;
   const costEstimate=roundTripCosts([call,put],trend.current,call.cv);
   if(!costEstimate)continue;
   const feeReserve=costEstimate.totalUSD;
   const risk=debit+feeReserve;
   if(risk<=0||!ok(risk))continue;
   const qty=Math.floor(Math.min(capitalUSD*0.02/risk,capitalUSD*0.3/(trend.current*call.cv)));
   if(qty<1)continue;
   const score=(straddle?1:0.8)-
    Math.abs(call.strike-trend.current)/trend.current-
    Math.abs(put.strike-trend.current)/trend.current-
    (call.ask-call.bid+put.ask-put.bid)/(call.ask+put.ask);
   const candidate={status:"PAPER PLAN",type:straddle?"LONG_STRADDLE":"LONG_STRANGLE",
    label:straddle?"Long straddle":"Long strangle",
    direction:"VOLATILITY / TWO-SIDED",long:call.symbol,short:put.symbol,
    long2:put.symbol,expiry,contractValue:call.cv,quantity:qty,
    entrySpread:call.ask+put.ask,stopSpread:(call.ask+put.ask)*0.5,
    targetSpread:(call.ask+put.ask)*1.5,timeExit:now+hours*3600000,horizonHours:hours,
    riskUSD:risk*qty,estimatedFeesUSD:costEstimate.commissionUSD*qty,
    costBreakdown:roundTripCosts([call,put],trend.current,call.cv,qty),
    estimatedMaxGainUSD:null,
    score,why:"Both legs bought for potential movement in either direction. Requires strong realised movement to beat two premiums, fees and time decay. No verified implied-volatility edge."};
   if(!best||candidate.score>best.score)best=candidate;
  }
  if(best)break;
 }
 return best||wait("Straddle/strangle failed live bid-ask, matched expiry, 2% premium-risk or contract-size checks");
}
function assessStrategies(tickers,trend,asset,capitalUSD,now=Date.now(),hours=4){
 const directional=chooseSpread(tickers,trend,asset,capitalUSD,now,hours);
 const volatility=chooseVolatility(tickers,trend,asset,capitalUSD,now,hours);
 const alternatives=[
  {name:"Bull call / bear put debit vertical",status:directional.status,reason:directional.reason||directional.why},
  {name:"Long straddle / strangle",status:volatility.status,reason:volatility.reason||volatility.why}
 ];
 // Neutral strategies require verified volatility catalysts / IV. Without these,
 // show a qualified WATCH candidate, not a recommendation for execution.
 const strategy=directional.status==="PAPER PLAN"?directional:
  volatility.status==="PAPER PLAN"?{...volatility,status:"WATCH ONLY"}:
  {status:"NO TRADE",reason:alternatives.map(x=>x.name+": "+x.reason).join(" | ")};
 return{strategy,alternatives,volatility};
}
function monitor(plan,tickers,now=Date.now()){
 if(plan?.status!=="PAPER PLAN")return wait("No locked spread");
 const rows=Array.isArray(tickers)?tickers:[],a=rows.find(t=>(t.symbol||t.product_symbol)===plan.long),b=rows.find(t=>(t.symbol||t.product_symbol)===plan.short);
 if(!a||!b||!fresh(a.timestamp,now)||!fresh(b.timestamp,now))return wait("Both leg timestamps must be current");
 // Validate BOTH complete bid/ask books, not just the side used in the calculation.
 // A stale, crossed or absent leg must not produce an apparently executable exit.
 const bid=number(a.quotes?.best_bid),longAsk=number(a.quotes?.best_ask);
 const shortBid=number(b.quotes?.best_bid),ask=number(b.quotes?.best_ask);
 if(![bid,longAsk,shortBid,ask].every(ok)||bid<=0||longAsk<bid||shortBid<=0||ask<shortBid)
  return wait("Missing, invalid or crossed two-leg order book; check Delta terminal");
 if(!Number.isInteger(plan.quantity)||plan.quantity<1||!ok(plan.contractValue)||plan.contractValue<=0||
    !ok(plan.entrySpread)||!ok(plan.stopSpread)||!ok(plan.targetSpread)||
    !ok(plan.costBreakdown?.totalUSD))
  return wait("Locked plan has incomplete sizing, stops or cost estimates; clear and rescan");
 const exitSpread=plan.long2?bid+shortBid:bid-ask;
 if(!Number.isFinite(exitSpread))return wait("Cannot validate two-leg net exit");
 const grossPnlUSD=(exitSpread-plan.entrySpread)*plan.contractValue*plan.quantity;
 const estimatedNetPnlUSD=grossPnlUSD-(plan.costBreakdown?.totalUSD??NaN);
 const status=now>=plan.timeExit?"TIME EXIT":exitSpread<=plan.stopSpread?"STOP WATCH":exitSpread>=plan.targetSpread?"TARGET WATCH":"MONITOR";
 return{status,exitSpread,grossPnlUSD,estimatedNetPnlUSD,reason:status==="MONITOR"?"Neither spread stop, target nor time reached":"Multi-leg exit alert only; no broker orders created"};
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
root.LfcCryptoDesk={milliseconds,fresh,candles,direction,roundTripCosts,sessionEconomics,chooseSpread,chooseVolatility,assessStrategies,monitor,fundingDesk};
if(typeof module!=="undefined"&&module.exports)module.exports=root.LfcCryptoDesk;
})(typeof window!=="undefined"?window:globalThis);
