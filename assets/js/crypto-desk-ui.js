/* Separate crypto options and funding desks. Public exchange read-only. */
(async function () {
"use strict";
if (!await LfcAuth.ready) return;
const D=window.LfcCryptoDesk,A=window.LfcCryptoAdvanced,V=window.LfcCryptoValidation,API="https://api.india.delta.exchange/v2",view=document.body.dataset.page;
const $=id=>document.getElementById(id), money=v=>Number.isFinite(v)?"$"+v.toLocaleString("en-US",{maximumFractionDigits:2}):"—";
const fnum=(v,d=4)=>Number.isFinite(v)?v.toLocaleString("en-US",{maximumFractionDigits:d}):"—";
const stamp=t=>new Date(t).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",hour12:false})+" IST";
const cash=()=>Number($("capital").value);
const safeText=(id,text)=>{const node=$(id);if(node)node.textContent=text;};
const R=window.LfcCryptoRange;
let rangeLocked=null;
let fx=null,fxAt=0,running=false,pendingRefresh=false,locked=null,latestTickers=[],timer=null,controller=null;
try{const cached=JSON.parse(sessionStorage.getItem("lfc.crypto.plan")||"null");
 if(cached?.status==="PAPER PLAN"&&cached.timeExit>Date.now()&&cached.signalMethod==="MULTI_FACTOR_V1"&&cached.selectionMethod==="SESSION_NET_RR_V2"&&Number(cached.sessionNetRR)>=1.5&&Number(cached.expectedTargetNetUSD)>=Number(cached.minRequiredNetTargetUSD)&&
 Number.isFinite(cached.sizedCapitalINR)&&Number(sessionStorage.getItem("lfc.crypto.capital"))===cached.sizedCapitalINR)locked=cached;
 else if(cached?.status==="PAPER PLAN")sessionStorage.removeItem("lfc.crypto.plan");
}catch(e){}
async function get(path,timeout=10000) {
 const ctl=new AbortController(),handle=setTimeout(()=>ctl.abort(),timeout);
 try {
  const r=await fetch(path,{signal:ctl.signal,cache:"no-store",credentials:"omit",headers:{"Accept":"application/json"}});
  if(!r.ok)throw Error("HTTP "+r.status);
  return await r.json();
 }finally{clearTimeout(handle);}
}
async function getDelta(path){
 const data=await get(API+path,12000);
 if(!data?.success||!Array.isArray(data.result))throw Error("Exchange data rejected");
 return data.result;
}
async function conversion(){
 if(fx&&Date.now()-fxAt<3600000)return fx;
 try{
  const data=await get("https://open.er-api.com/v6/latest/INR",12000);
  const quote=Number(data?.rates?.USD),age=Date.now()-Number(data?.time_last_update_unix)*1000;
  if(data.result!=="success"||!Number.isFinite(quote)||quote<0.005||quote>0.03||age>48*3600000||age<0)
   throw Error("FX snapshot invalid or stale");
  fx=quote;fxAt=Date.now();capitalDiagnostics();
  safeText("fxStatus","Indicative FX: ₹1 = "+fnum(fx,6)+" USD · provider "+stamp(Number(data.time_last_update_unix)*1000)+". INR conversion is illustrative; Delta settlement FX/fees can differ.");
 }catch(e){fx=null;capitalDiagnostics();safeText("fxStatus","No recent INR/USD FX quote — lot sizing blocked. "+e.message);}
 return fx;
}
function node(tag,text){const el=document.createElement(tag);el.textContent=String(text);return el;}
function setRows(id,data){
 const tbody=$(id);if(!tbody)return;tbody.replaceChildren();
 for(const line of data){const tr=document.createElement("tr");
  for(const val of line)tr.append(node("td",val));tbody.append(tr);}
}
function capitalUSD(){const c=cash();return fx&&Number.isFinite(c)&&c>0?c*fx:NaN;}
function capitalDiagnostics(){
 const out=$("capitalDiagnostics"),impact=$("capitalImpact");if(!out)return;
 const c=cash();
 if(!Number.isFinite(c)||c<100||c>1e9){out.textContent="Enter valid capital to calculate limits.";return;}
 const inr=n=>"₹"+n.toLocaleString("en-IN",{maximumFractionDigits:2}),usd=capitalUSD();
 out.textContent="Capital "+inr(c)+" · 2% maximum modeled spread loss = "+inr(c*.02)+
  " · 30% notional cap = "+inr(c*.30)+
  (Number.isFinite(usd)?" · approximate USD "+fnum(usd,2):" · INR/USD conversion unavailable")+
  ". Limits are models, not broker buying power.";
 if(impact)impact.textContent=Number.isFinite(usd)&&usd<20?
  "CAPITAL BLOCK: below the portal's $20-equivalent research threshold (~"+inr(Math.ceil(20/fx))+" at current FX).":
  "Market direction never depends on capital; trade eligibility may still fail on price, liquidity, contract minimum, expiry or risk/reward.";
}
async function history(symbol,resolution,seconds){
 const end=Math.floor(Date.now()/1000),start=end-seconds;
 return getDelta("/history/candles?symbol="+encodeURIComponent(symbol)+
  "&resolution="+resolution+"&start="+start+"&end="+end);
}
async function readTrend(asset) {
 const fast=$("optionSignalFrame")?.value==="FAST",frames=fast?[5,15]:[15,60];
 const result=await Promise.all([history(asset+"USD",fast?"5m":"15m",(fast?12:36)*3600),history(asset+"USD",fast?"15m":"1h",(fast?36:120)*3600)]);
 const trend=D.direction(result[0],result[1],Date.now(),frames);
 if(R)trend.range=R.detect(result[0],result[1],Date.now(),frames);
 return trend;
}
// Ticker payloads do not carry complete contract metadata. Pull product specs
// separately for the small set of near-ATM, near-expiry candidate contracts.
const productCache=new Map();
async function product(symbol) {
 const cached=productCache.get(symbol);
 if(cached&&Date.now()-cached.at<10*60000)return cached.value;
 const data=await get(API+"/products/"+encodeURIComponent(symbol),12000);
 const p=data?.result;
 if(!data?.success||!p||p.symbol!==symbol||!Number.isFinite(Number(p.contract_value))||Number(p.contract_value)<=0)
  throw Error("Cannot verify Delta product specification: "+symbol);
 productCache.set(symbol,{at:Date.now(),value:p});return p;
}
async function hydrate(tickers,symbols) {
 const unique=[...new Set(symbols)].filter(Boolean);
 const details=await Promise.allSettled(unique.map(product));
 const mapped=new Map(details.flatMap((x,i)=>x.status==="fulfilled"?[[unique[i],x.value]]:[]));
 return tickers.map(t=>({...t,product:mapped.get(t.symbol)||t.product||null}));
}
function optionCandidates(tickers,trend,asset,lockedSymbols=[]) {
 if(lockedSymbols.length)return lockedSymbols;
 if(!Number.isFinite(trend?.current))return[];
 const side=trend.side==="UP"?"C":trend.side==="DOWN"?"P":null;
 const now=Date.now(),valid=tickers.filter(t=>typeof t.symbol==="string"&&(t.symbol.startsWith("C-"+asset+"-")||t.symbol.startsWith("P-"+asset+"-")))
  .map(t=>({ticker:t,match:/^[CP]-[A-Z0-9]+-([0-9.]+)-(\d{6})$/.exec(t.symbol)}))
  .filter(x=>x.match).map(x=>{
   const code=x.match[2],expiry=Date.UTC(2000+Number(code.slice(4)),Number(code.slice(2,4))-1,Number(code.slice(0,2)),12);
   return {...x,expiry,strike:Number(x.match[1])};
  }).filter(x=>x.expiry>now+(Number($("tradeHorizon")?.value)||4)*3600000+3600000&&x.expiry<now+10*86400000&&
   Number.isFinite(x.strike)&&Math.abs(x.strike-trend.current)/trend.current<=0.08);
 const expiries=[...new Set(valid.map(x=>x.expiry))].sort((a,b)=>a-b).slice(0,3);
 return expiries.flatMap(expiry=>{
  const nearest=valid.filter(x=>x.expiry===expiry);
  return ["C","P"].flatMap(type=>nearest.filter(x=>x.ticker.symbol.startsWith(type+"-"))
   .sort((a,b)=>Math.abs(a.strike-trend.current)-Math.abs(b.strike-trend.current))
   .slice(0,12).map(x=>x.ticker.symbol));
 });
}
async function readOptions(asset,trend,lockedSymbols=[]) {
 const rows=await getDelta("/tickers?contract_types=call_options,put_options&underlying_asset_symbols="+asset);
 const chosen=optionCandidates(rows,trend,asset,lockedSymbols);
 return hydrate(rows,chosen);
}
async function readPerps(){
 const out=await getDelta("/tickers?contract_types=perpetual_futures");
 const symbols=["BTCUSD","ETHUSD","XAUTUSD","PAXGUSD"];
 const hydrated=await hydrate(out,symbols.filter(x=>out.some(t=>t.symbol===x)));
 return hydrated.map(t=>({...t,contract_type:t.contract_type||t.product?.contract_type}));
}
function rowTrend(asset,x){
 const display=v=>Number.isFinite(v)?fnum(v,1):"N/A";
 const smc=[x.bos,x.sweep].filter(v=>v&&v!=="NONE").join(" + ")||"NONE";
 return[asset==="XAUT"?"Tokenized gold · XAUT":asset,x.side,
  smc,display(x.rsi),Number.isFinite(x.macdHistogram)?(x.macdHistogram>0?"POSITIVE":x.macdHistogram<0?"NEGATIVE":"FLAT"):"N/A",
  display(x.adx),Number.isFinite(x.volumeRatio)?fnum(x.volumeRatio,2)+"×":"N/A",
  x.score===undefined?"—":x.score+"/"+x.maxScore,
  x.actionable?"MULTI-FACTOR CONFIRMED":"WAIT",x.why];
}
function showPlan(plan){
 const box=$("tradePlan");box.replaceChildren();
 if(plan.status!=="PAPER PLAN"){
  box.append(node("h2",plan.status==="SIDEWAYS PAPER PLAN"?"Sideways paper plan selected":"No suitable trade right now"),node("p",plan.reason||"No option strategy passed the market evidence, price, liquidity, expiry and risk checks."));
  return;
 }
 box.append(node("h2","Selected research setup · "+plan.label),
  node("p","This is a PAPER plan, not a placed order. The exchange can quote different prices."));
 const dl=document.createElement("dl");
 const fields=[
  ["Market direction",plan.direction==="UP"?"UP ↗":"DOWN ↘"],
   ["Directional evidence",Number.isFinite(plan.signalScore)?plan.signalScore+"/"+plan.signalMaxScore+" weighted points (not win probability)":"Not recorded"],
  ["Suggested strategy",plan.label],
  ["Planned net target / stop",Number.isFinite(plan.sessionNetRR)?fnum(plan.sessionNetRR,2)+" : 1 after estimated costs":"Older plan — clear and rescan for session economics"],
  ["Why selected","Ranked by session target/stop economics, not maximum profit at expiry"],
  ["Buy this option",plan.long],
  ["Sell this option",plan.short],
  ["Contracts per leg",String(plan.quantity)+" (automatically calculated)"],
  ["Planned holding period",plan.horizonHours+" hours"],
  ["Estimated entry cost",money(plan.entrySpread*plan.contractValue*plan.quantity)],
  ["Stop-loss alert",fnum(plan.stopSpread,4)+" USD net spread price"],
  ["Target alert",fnum(plan.targetSpread,4)+" USD net spread price"],
  ["Maximum estimated risk",money(plan.riskUSD)+" / approx. ₹"+fnum(plan.riskUSD/fx,0)],
  ["Net profit IF target reached (not forecast)",money(plan.expectedTargetNetUSD)+" / approx. ₹"+fnum(plan.expectedTargetNetUSD/fx,0)],
  ["Net loss IF stop reached",money(plan.expectedStopNetUSD)+" / approx. ₹"+fnum(plan.expectedStopNetUSD/fx,0)],
  ["Close by",stamp(plan.timeExit)],
  ["Option expiry",stamp(plan.expiry)]];
 for(const [key,value] of fields)dl.append(node("dt",key),node("dd",value));
 box.append(dl,node("p","The displayed net target is a hypothetical outcome, NOT a prediction of profit or a tested win probability. It must exceed the portal’s stricter friction and risk gate. Stop and target refer to the combined two-option price. They are monitoring alerts; no order will be placed automatically."));
}
function simpleSummary(search){
 const area=$("simpleDirection"),decision=$("simpleDecision");
 if(!area||!decision)return;
 area.replaceChildren();
 const items=search.map(x=>({asset:x.asset,trend:x.trend,plan:x.plan}));
 for(const x of items){
  const t=x.trend||{},card=document.createElement("div");card.className="trend-tile";
  const direction=t.side==="UP"?"UP ↗":t.side==="DOWN"?"DOWN ↘":t.side==="SIDEWAYS"?(t.range?.status==="CONFIRMED RANGE"?"RANGE ↔":"MIXED / UNCONFIRMED"):"DATA UNAVAILABLE";
  card.dataset.direction=t.side||"UNKNOWN";
  const label=x.asset==="XAUT"?"Gold (XAUT)":x.asset;
  const call=t.actionable?(Number.isFinite(t.score)?"Multi-factor confirmed ("+t.score+"/"+t.maxScore+" evidence points)":"Paper plan — fresh signal needs recheck"):t.side==="UP"||t.side==="DOWN"?"Unconfirmed ("+(t.score??0)+"/"+(t.maxScore||95)+" evidence points)":"Wait for aligned market evidence";
  card.append(node("strong",label),node("span",direction),node("small",call));area.append(card);
 }
 const qualified=items.map(x=>x.plan).filter(p=>p?.status==="PAPER PLAN").sort((a,b)=>b.score-a.score);
 decision.replaceChildren();
 if(qualified.length){
  const p=qualified[0];decision.append(node("h3",(locked?"Saved plan — review current trend: ":"Suggested: ")+p.label),
   node("p","Market: "+(p.long.split("-")[1]||"crypto")+" · Direction: "+(p.direction==="UP"?"UP":"DOWN")),
   node("p","Contracts per leg: "+p.quantity+" · Auto-sized from your capital."),
   node("p","See entry, stop-loss, target and expiry below. Paper plan only."));
 }else{
  const trending=items.filter(x=>x.trend?.actionable&&["UP","DOWN"].includes(x.trend.side));
  if(trending.length){
   const x=trending[0],choice=x.trend.side==="DOWN"?"Bear Put Spread":"Bull Call Spread";
   decision.append(node("h3","WAIT — "+x.asset+" looks "+(x.trend.side==="DOWN"?"bearish":"bullish")),
    node("p","Strategy to watch: "+choice+"."),
    node("p","No suitable option prices passed the safety checks. Contracts, entry, stop and target cannot be calculated reliably yet."));
  }else{
   const forming=items.find(x=>["UP","DOWN"].includes(x.trend?.side));
   if(forming)decision.append(node("h3","FORMING — "+forming.asset+" "+(forming.trend.side==="UP"?"bullish":"bearish")+" bias"),node("p","Conditional strategy: "+(forming.trend.side==="UP"?"Bull Call debit spread":"Bear Put debit spread")+". Wait for the selected signal-candle confirmation and an affordable quoted spread. Entry, quantity and targets remain unavailable until both pass."));
   else decision.append(node("h3","WAIT — mixed or unavailable direction"),node("p","Strategy map: confirmed UP → Bull Call debit spread; confirmed DOWN → Bear Put debit spread. A mixed trend alone does not justify a neutral option trade. See each market's checks below."));
  }
 }
}
function showMonitor(current){
 const p=$("monitorPanel");if(!p)return;p.replaceChildren();
 if(!locked){p.append(node("p","A single eligible trade plan will be locked here and checked against fresh Delta quotes."));return;}
 p.append(node("h2",current.status));
 p.append(node("p",current.reason||""));
 if(Number.isFinite(current.exitSpread)){
  p.append(node("p","Indicative NET exit quote (two-leg bid/ask based, not a guaranteed executable fill): "+fnum(current.exitSpread,6)+" USD per unit."));
  p.append(node("p","Gross indicative P/L: "+money(current.grossPnlUSD)+" · estimated net after cost reserve: "+money(current.estimatedNetPnlUSD)+" (approx. ₹"+fnum(current.estimatedNetPnlUSD/fx,0)+"). Costs are indicative, not a confirmed fill."));
 }
 if(["TARGET WATCH","STOP WATCH","TIME EXIT"].includes(current.status))
  p.append(node("strong","Check Delta terminal NOW. No order has been submitted. Confirm BOTH legs, price and risk."));
}
function renderRange(items=[],current=null){
 const box=$("rangeResults");if(!box)return;box.replaceChildren();
 const ru=v=>Number.isFinite(v)&&fx?"₹"+fnum(v/fx,2):"—";
 if(rangeLocked){
  const p=rangeLocked;
  box.append(node("h3",p.asset+" · Iron condor · PAPER PLAN"),node("p","Original entry credit: "+fnum(p.credit)+" USD/unit · "+p.quantity+" contracts per leg. Live account margin is unverified."));
  const ul=document.createElement("ul");for(const l of p.legs)ul.append(node("li",l.side+" "+l.symbol+" · "+p.quantity+" contracts @ "+fnum(l.side==="BUY"?l.ask:l.bid)+" USD/unit"));box.append(ul);
  const metrics=node("div","");metrics.className="range-metrics";
  for(const [label,value] of [["Buyback target",fnum(p.target)+" USD/unit"],["Buyback stop",fnum(p.stop)+" USD/unit"],["Net target scenario",ru(p.netTarget)],["Modeled stop loss",ru(p.netStop)],["Max expiry loss + reserve",ru(p.maxLoss)],["Eight-fill cost reserve",ru(p.totalCosts)]]){const cell=node("div","");cell.append(node("small",label),node("strong",value));metrics.append(cell);}box.append(metrics);
  box.append(node("p","Original range: "+fnum(p.range.low)+"–"+fnum(p.range.high)+". Closed-candle exit boundaries: "+fnum(p.range.low-p.range.atr*.25)+" / "+fnum(p.range.high+p.range.atr*.25)+". Time exit: "+stamp(p.timeExit)+". Expiry: "+stamp(p.expiry)+"."),node("p","Expiry breakevens before costs: "+fnum(p.lowerBE)+" / "+fnum(p.upperBE)+". Maximum expiry gain after reserve: "+ru(p.maxGain)+"; this is not the few-hour target."));
  const state=current||{status:"MONITOR",reason:"Paper entry recorded from bid/ask. Waiting for the next refresh."};
  box.append(node("h3",state.status),node("p",state.reason));
  if(Number.isFinite(state.close))box.append(node("p","Current combined buyback: "+fnum(state.close)+" USD/unit · estimated net since paper entry: "+ru(state.net)));
  box.append(node("strong","No orders or protective stops placed. Paper-only, unvalidated strategy. Monitor all four legs together; do not remove a protective wing alone."));
  return;
 }
 for(const x of items){const details=node("details","");details.open=x.neutral?.status==="PAPER CANDIDATE";details.append(node("summary",x.asset+" · "+(x.trend?.range?.status||"DATA UNAVAILABLE")),node("p",x.neutral?.reason||x.trend?.range?.reason||x.trend?.why||"Range data unavailable"));if(x.optionFeed)details.append(node("p","Delta options feed: "+x.optionFeed.listed+" listed · "+x.optionFeed.fresh+" fresh (≤60s) · "+x.optionFeed.spotMatched+" matching latest candle price."));const r=x.trend?.range;if(r&&Number.isFinite(r.low))details.append(node("p","Observed range "+fnum(r.low)+"–"+fnum(r.high)+" · realised volatility "+fnum(r.rv*100,1)+"% annualised."));box.append(details);}
 if(!items.length)box.append(node("p","Scan with capital to check live ranges and protected condors."));
}
async function refreshOption(isMonitor=false) {
 const inputKey=()=>[cash(),$("tradeHorizon")?.value,$("optionSignalFrame")?.value].join("|");
 const startedKey=inputKey();
 if(rangeLocked){
  const saved=rangeLocked;
  try{const [rows,trend]=await Promise.all([readOptions(saved.asset,null,saved.legs.map(l=>l.symbol)),readTrend(saved.asset)]);
   if(rangeLocked!==saved||startedKey!==inputKey())return;
   renderRange([],R.monitor(saved,rows,trend.range));safeText("status","Four-leg sideways paper plan monitored · "+stamp(Date.now()));
  }catch(e){if(rangeLocked===saved)renderRange([],{status:"DATA UNAVAILABLE",reason:"Four-leg monitor failed: "+e.message+". Check Delta terminal."});}
  return;
 }
 if(locked){
  try{
   const asset=locked.long.split("-")[1],rows=await readOptions(asset,null,[locked.long,locked.short]);
   latestTickers=rows;
   showPlan(locked);
   // Restore the simple answer even after page reload while a paper plan is locked.
   let freshTrend;try{freshTrend=await readTrend(asset);}catch(e){freshTrend={side:"UNKNOWN",actionable:false,why:"Current trend feed unavailable"};}
   simpleSummary([{asset,trend:freshTrend,plan:locked}]);
   const result=D.monitor(locked,rows);
   if(result.status==="MONITOR"&&(!freshTrend.actionable||freshTrend.side!==locked.direction)){
    result.status="TREND REVIEW";result.reason="The current trend no longer confirms the saved plan, or cannot be verified. Review both legs on Delta; original stop/target remain fixed. "+(freshTrend.why||"");
   }
   showMonitor(result);
   safeText("status","Plan locked; monitoring both legs · "+stamp(Date.now())+" · read-only");
  }catch(e){showMonitor({status:"DATA UNAVAILABLE",reason:"Cannot monitor live exit: "+e.message});safeText("status","Exchange feed unavailable; verify Delta terminal immediately.");}
  return;
 }
 const frameMode=$("optionSignalFrame")?.value||"STANDARD",assets=["BTC","ETH","XAUT"],results=[];
 safeText("status","Scanning BTC, ETH and gold using EMA trend, RSI, MACD, ADX, optional volume and SMC, then risk-checking options…");
 const search=await Promise.all(assets.map(async asset=>{
  try{
   const trend=await readTrend(asset);
   results.push({asset,trend});
   const ticks=await readOptions(asset,trend);
   const evaluated=D.assessStrategies(ticks,trend,asset,capitalUSD(),Date.now(),Number($("tradeHorizon").value));
   const credit=A.evaluateCredit(ticks,trend,asset,capitalUSD(),Date.now(),Number($("tradeHorizon").value));
    const now=Date.now(),spot=trend.range?.spot;
    const optionFeed={listed:ticks.filter(t=>String(t.symbol||"").startsWith("C-"+asset+"-")||String(t.symbol||"").startsWith("P-"+asset+"-")).length,fresh:ticks.filter(t=>(String(t.symbol||"").startsWith("C-"+asset+"-")||String(t.symbol||"").startsWith("P-"+asset+"-"))&&D.fresh(t.timestamp,now,60000)).length,spotMatched:Number.isFinite(spot)?ticks.filter(t=>(String(t.symbol||"").startsWith("C-"+asset+"-")||String(t.symbol||"").startsWith("P-"+asset+"-"))&&Number.isFinite(Number(t.spot_price))&&Math.abs(Number(t.spot_price)-spot)/spot<=.02).length:0};
    const neutral=R?R.choose(ticks,trend.range,asset,capitalUSD(),now,Number($("tradeHorizon").value)):null;
    return{asset,trend,plan:evaluated.strategy,alternatives:evaluated.alternatives,credit,neutral,optionFeed};
  }catch(e){
   const trend={side:"UNKNOWN",score:0,maxScore:95,actionable:false,why:"Feed unavailable: "+e.message};
   results.push({asset,trend});return{asset,trend,plan:{status:"NO TRADE",reason:e.message}};
  }
 }));
 if(frameMode!==($("optionSignalFrame")?.value||"STANDARD")||startedKey!==inputKey())return;
 renderRange(search);
 setRows("directionRows",assets.map(asset=>rowTrend(asset,results.find(x=>x.asset===asset)?.trend||{side:"UNKNOWN",why:"No exchange response"})));
 simpleSummary(search);
 const blockers=$("optionBlockers");if(blockers){blockers.replaceChildren();for(const x of search){const group=node("details","");group.append(node("summary",x.asset+" · "+x.plan.status+" · "+($("optionSignalFrame")?.value==="FAST"?"5m / 15m":"15m / 1h")),node("p","Direction: "+(x.trend.why||x.trend.side)),node("p","Option result: "+x.plan.status+" · "+(x.plan.reason||x.plan.label||"No contract plan")));for(const alt of x.alternatives||[])group.append(node("p",alt.name+": "+alt.status+" · "+alt.reason));blockers.append(group);}}
 const report=$("strategyDiagnostics");
 if(report){
  report.replaceChildren();
  for(const item of search)for(const alt of item.alternatives||[]){
   const p=node("p",item.asset+" · "+alt.name+" · "+alt.status+" · "+alt.reason);
   report.append(p);
  }
 }
 const panel=$("creditCandidates");
 if(panel){
  panel.replaceChildren();
  for(const x of search){
   panel.append(node("h3",x.asset+" · "+(x.credit?.status||"FEED UNAVAILABLE")),
    node("p",x.credit?.reason||"No credit structure data"));
   for(const c of x.credit?.candidates||[]){
    const d=document.createElement("details");
    d.append(node("summary",c.label+" · "+c.quantity+" contract(s) · max modeled loss "+
     money(c.estimatedMaxLossUSD)+" · modeled gain "+money(c.estimatedMaxGainUSD)),
     node("p",c.legs.map(l=>l.side+" "+l.symbol).join(" | ")),
     node("p","Premium credit "+fnum(c.creditPerUnit)+" per unit · cost reserve "+
      money(c.costBreakdown.totalUSD)+" · "+c.reason));
    panel.append(d);
   }
  }
 }
 const plans=search.map(x=>x.plan).filter(x=>x.status==="PAPER PLAN");
 plans.sort((a,b)=>b.score-a.score);
 if(plans.length){
  locked={...plans[0],createdAt:Date.now(),sizedCapitalINR:cash(),signalFrameMode:$("optionSignalFrame")?.value||"STANDARD"};
  try{sessionStorage.setItem("lfc.crypto.plan",JSON.stringify(locked));}catch(e){}
  showPlan(locked);showMonitor({status:"MONITOR",reason:"Plan created and locked; waiting for next quote"});
  safeText("status","One spread selected for the requested "+$("tradeHorizon").value+"-hour horizon using verified public inputs.");
 }else{
  const neutrals=search.map(x=>x.neutral).filter(p=>p?.status==="PAPER CANDIDATE").sort((a,b)=>b.score-a.score);
  if(neutrals.length){rangeLocked=neutrals[0];renderRange();
   showPlan({status:"SIDEWAYS PAPER PLAN",reason:"Protected iron condor selected. Four-leg entry, fixed exits and capital sizing appear in the Sideways strategy panel."});
   safeText("simpleDecision","Suggested for paper review: "+rangeLocked.asset+" iron condor. Confirmed range; unvalidated strategy. See all four legs below.");
   safeText("status","Sideways paper plan locked for "+rangeLocked.hours+" hours. Account margin, news risk and fills remain unverified.");
   return;
  }
  const watches=search.filter(x=>x.plan.status==="WATCH ONLY");
  showPlan({status:"NO TRADE",reason:"No risk-qualified directional entry. "+
   (watches.length?"Potential straddle/strangle watchlist (NOT a trade signal): "+watches.map(x=>x.asset+" "+x.plan.label).join(", ")+". ":"")+
   search.map(x=>x.asset+": "+(x.plan.reason||x.plan.why)).join(" · ")});
  safeText("status","Scan complete · no eligible setup · "+stamp(Date.now()));
 }
}
// Exchange-documented funding_rate websocket: fr is in percent; nfr and ts are microsecond epochs.
// Unlike REST ticker's ambiguous funding_rate field, only recent websocket fr may drive an estimate.
const fundingLive=new Map();let fundingWebsocket=null,lastFundingRefreshAt=0;
if(view==="crypto-funding"&&typeof WebSocket!=="undefined"){
 try{
  fundingWebsocket=new WebSocket("wss://public-socket.india.delta.exchange");
  fundingWebsocket.addEventListener("open",()=>fundingWebsocket.send(JSON.stringify({
   type:"subscribe",payload:{channels:[{name:"funding_rate",symbols:["all"]}]}})));
  fundingWebsocket.addEventListener("message",event=>{
   try{
    const q=JSON.parse(event.data);
    if(q.type!=="funding_rate"||!["BTCUSD","ETHUSD","XAUTUSD","PAXGUSD"].includes(q.sy))return;
    const stampMs=D.milliseconds(q.ts),nextMs=D.milliseconds(q.nfr);
    if(!Number.isFinite(stampMs)||Math.abs(Date.now()-stampMs)>120000||
     !Number.isFinite(nextMs)||nextMs<Date.now()||nextMs>Date.now()+86400000||
     !Number.isFinite(Number(q.fr))||Math.abs(Number(q.fr))>2)return;
    fundingLive.set(q.sy,{ratePercent:Number(q.fr),settlement:nextMs,intervalSeconds:Number(q.fi),updated:Date.now()});
    if(!running&&Date.now()-lastFundingRefreshAt>15000&&Number.isFinite(capitalUSD())&&capitalUSD()>=20){
     lastFundingRefreshAt=Date.now();refresh();
    }
   }catch{}
  });
 }catch{}
 addEventListener("pagehide",()=>fundingWebsocket?.close());
}
function fundingClock(t,now=Date.now()){
 // Delta's documented 8-hour schedule; other schedules remain unverified.
 const interval=Number(t.product?.rate_exchange_interval??t.rate_exchange_interval);
 const fixed=Number(t.next_funding_realization??t.next_funding_time??t.next_funding_timestamp);
 const ms=D.milliseconds(fixed);
 if(Number.isFinite(ms)&&ms>now&&ms<=now+24*3600000)return{at:ms,verified:true};
 if(Number.isFinite(interval)&&interval!==28800)return{at:null,verified:false};
 const ist=now+330*60000,day=Math.floor(ist/86400000)*86400000;
 for(const minutes of [330,810,1290,1770]){
  const at=day+minutes*60000-330*60000;
  if(at>now)return{at,verified:false};
 }
 return{at:null,verified:false};
}
function timeLeft(at){
 if(!Number.isFinite(at))return "Exchange timing unavailable";
 const secs=Math.max(0,Math.floor((at-Date.now())/1000));
 return Math.floor(secs/3600)+"h "+Math.floor(secs%3600/60)+"m "+secs%60+"s";
}
 function indicativeFunding(t,asset,cap){
 const live=fundingLive.get(t.symbol);
 if(!live||Date.now()-live.updated>120000)return null;
 const base=D.fundingDesk([{...t,funding_rate:live.ratePercent}],asset,cap);
 if(base.status!=="WATCH ONLY")return null;
 if(!Number.isFinite(live.ratePercent)||Math.abs(live.ratePercent)>2)return null;
 const receipt=base.notionalUSD*Math.abs(live.ratePercent)/100;
 // Illustrative round trip for ONE perpetual leg: 0.05% taker each way,
 // 18% GST on fee and 0.1% slippage each way. NOT hedge/borrow costs.
 const cost=base.notionalUSD*(.0005*2*1.18+.001*2);
 return{...base,ratePercent:live.ratePercent,route:live.ratePercent>0?
  "SHORT perp + LONG matching spot":"LONG perp + SHORT matching spot",
  receiptUSD:receipt,costUSD:cost,afterCostsUSD:receipt-cost,
  clock:{at:live.settlement,verified:true},fundingRateAt:live.updated};
}

async function refreshFunding(){
 safeText("status","Checking BTC, ETH and gold funding estimates in Indian rupees…");
 const tickers=await readPerps(),assets=["BTC","ETH","XAUT","PAXG"],cap=capitalUSD();
 const rows=assets.map(asset=>{
  const tick=tickers.find(t=>t.symbol===asset+"USD");
  return{asset,data:tick?indicativeFunding(tick,asset,cap):null};
 });
 const rupees=x=>"₹"+fnum(x/fx,2);
 setRows("fundRows",rows.map(({asset,data:x})=>{
 if(!x){
  const t=tickers.find(item=>item.symbol===asset+"USD");
  // The published standard schedule is only a reference, never a verified
  // settlement time or evidence of a payable funding rate.
  const c=t&&["BTC","ETH"].includes(asset)?fundingClock(t):{at:null,verified:false};
  return [asset,"Awaiting verified live funding rate","—",
   c.at?timeLeft(c.at)+(c.verified?" · Exchange timing; rate unverified":" · Approx. standard 8h schedule; NOT exchange-confirmed"):
   "Funding hour unavailable — waiting for verified exchange timestamp",
   "—","—","—"];
 }
 return[asset,x.route.startsWith("SHORT")?"SELL perpetual":"BUY perpetual",
   fnum(x.ratePercent,4)+"% (indicative)",
   x.clock.at?timeLeft(x.clock.at)+(x.clock.verified?" · Exchange time":" · Estimated IST schedule"):"Unverified",
   rupees(x.receiptUSD),rupees(x.afterCostsUSD),x.contracts];
}));
 // Keep the settlement countdown ticking in IST between market refreshes.
 const liveCells=$("fundRows")?.querySelectorAll("tr")||[];
 rows.forEach((entry,i)=>{
  const cell=liveCells[i]?.children?.[3];if(!cell)return;
  if(entry.data?.clock?.at){
   cell.dataset.fundingEnd=String(entry.data.clock.at);
   cell.dataset.fundingVerified="true";
  }else if(["BTC","ETH"].includes(entry.asset)){
   const contract=tickers.find(t=>t.symbol===entry.asset+"USD");
   const estimated=contract?fundingClock(contract):{at:null,verified:false};
   if(estimated.at){
    cell.dataset.fundingEnd=String(estimated.at);
    cell.dataset.fundingVerified=estimated.verified?"time-only":"false";
   }
  }
 });
 const box=$("tradePlan");box.replaceChildren();
 const candidates=rows.filter(x=>x.data&&Number.isFinite(x.data.afterCostsUSD))
  .sort((a,b)=>b.data.afterCostsUSD-a.data.afterCostsUSD);
 if(!candidates.length){
  box.append(node("h2","WAIT — no exchange-confirmed funding rate"),
   node("p","Funding websocket must confirm the rate and exact next settlement time. No estimated payment is shown until verified."));
 }else{
  const best=candidates[0],x=best.data,positive=candidates.filter(v=>v.data.afterCostsUSD>0);
  if(!positive.length){
   box.append(node("h2","WAIT — funding does not cover estimated trading costs"),
    node("p","Highest gross funding receipt: "+best.asset+" · "+rupees(x.receiptUSD)+
     ". After a sample round-trip fee/GST/slippage allowance: "+rupees(x.afterCostsUSD)+"."),
    node("p","This estimate excludes price movement, hedge cost and taxes. Do not chase the last-minute funding payment."));
  }else{
   const pick=positive[0],p=pick.data;
   box.append(node("h2","WATCH ONLY — "+pick.asset+" has the highest illustrative funding after costs"),
    node("p","Estimated funding receipt: "+rupees(p.receiptUSD)+
     " · After sample trading charges: "+rupees(p.afterCostsUSD)+"."),
    node("p","Suggested funding side: "+(p.route.startsWith("SHORT")?"SELL perpetual":"BUY perpetual")+
     " · Example contracts: "+p.contracts+". These are NOT confirmed hedge profits."),
    node("p","Next event in "+(p.clock.at?timeLeft(p.clock.at):"unknown time")+
     ". Actual eligible funding and exchange timestamps must be verified before any trade."));
  }
 }
 box.append(node("p","IMPORTANT: This is a one-leg funding estimate, not net trading profit. Unhedged price changes can produce a much larger loss. Funding rates change and funding is paid only if the position is included in the exchange snapshot."));
 safeText("status","Live public funding snapshot · "+stamp(Date.now())+" · no orders placed");
}

async function refresh(){
 if(running){pendingRefresh=true;return;}
 if(document.hidden)return;
 running=true;$("refreshNow").disabled=true;
 try{
  const c=cash();capitalDiagnostics();
  if(!Number.isFinite(c)||c<100||c>1e9){
   safeText("status",view==="crypto-options"?"Enter INR capital (₹100–₹100 crore); the options horizon is 2, 4 or 8 hours.":"Enter valid INR capital. Funding settlement hours are set by Delta Exchange, not by your chosen holding period.");
   if(view==="crypto-options")showPlan({status:"NO TRADE",reason:"Enter valid capital first."});
   return;
  }
  if(!await conversion()){if(rangeLocked)renderRange([],{status:"DATA UNAVAILABLE",reason:"FX unavailable; sizing and INR estimates cannot be refreshed."});safeText("status","FX unavailable. Not sizing or recommending a trade.");return;}
  if(view==="crypto-options")await refreshOption();else await refreshFunding();
 }catch(e){safeText("status","Market data unavailable: "+e.message+" · NO TRADE. Retry when feed recovers.");}
 finally{$("refreshNow").disabled=false;running=false;safeText("lastChecked","Last checked "+stamp(Date.now()));if(pendingRefresh){pendingRefresh=false;setTimeout(refresh,0);}}
}
// On-demand backtest on perpetual OHLC; not historical option profitability.
async function runBacktest(){
 const button=$("runBacktest"),out=$("backtestResults");if(!button||!out)return;
 button.disabled=true;out.replaceChildren(node("p","Fetching completed Delta candles…"));
 try{
  const hours=Number($("tradeHorizon").value),days=14,results=[];
  for(const asset of ["BTC","ETH"]){
   try{
    const [a,b]=await Promise.all([history(asset+"USD","15m",days*86400),
     history(asset+"USD","1h",(days+5)*86400)]);
    results.push({asset,result:A.backtestUnderlying(a,b,{hours,feeBps:20})});
   }catch(e){results.push({asset,result:{status:"NO TRADE",reason:e.message}});}
  }
  out.replaceChildren();
  for(const {asset,result:r}of results)out.append(node("p",asset+" · "+r.status+" · sample "+(r.trades??0)+
   " trades · net win rate "+(Number.isFinite(r.winRate)?(100*r.winRate).toFixed(1)+"%":"—")+
   " · mean net R "+(Number.isFinite(r.meanNetR)?fnum(r.meanNetR,3):"—")+
   " · historical max drawdown "+(Number.isFinite(r.maxDrawdownR)?fnum(r.maxDrawdownR,2)+"R":"—")+
   " · "+r.reason));
  out.append(node("p","UNDERLYING signal proxy only. No historical option premiums, implied volatility, fills, liquidity or margin; not a strategy performance claim."));
 }catch(e){out.replaceChildren(node("p","Backtest unavailable: "+e.message));}
 finally{button.disabled=false;}
}
if($("runBacktest"))$("runBacktest").onclick=runBacktest;
// Calendar-aligned inclusive Delta candle windows; max 1,500 candles per call.
// Never infer a continuous series if any historical candle is missing.
async function validationHistory(symbol,resolution,fromSec,endSec,progress){
 const seconds=resolution==="15m"?900:3600,rows=[];
 for(let start=fromSec;start<endSec;){
  const end=Math.min(endSec,start+1499*seconds);
  if(progress)progress();
  const part=await getDelta("/history/candles?symbol="+encodeURIComponent(symbol)+
    "&resolution="+resolution+"&start="+start+"&end="+end);
  rows.push(...part);
  start=end+seconds;
 }
 return rows;
}
const pct=n=>Number.isFinite(n)?(100*n).toFixed(1)+"%":"—";
function validationGrid(columns,rows){
 const wrap=document.createElement("div");wrap.className="table-wrap";
 const t=document.createElement("table"),head=document.createElement("thead"),h=document.createElement("tr");
 for(const column of columns)h.append(node("th",column));
 head.append(h);t.append(head);
 const body=document.createElement("tbody");
 for(const row of rows){const tr=document.createElement("tr");for(const v of row)tr.append(node("td",v));body.append(tr);}
 t.append(body);wrap.append(t);return wrap;
}
function validationStatRow(title,x){
 return[title,String(x.trades),pct(x.winRate),x.wilson95?pct(x.wilson95.low)+"–"+pct(x.wilson95.high):"—",
  fnum(x.meanNetR,3),fnum(x.maxDrawdownR,2),fnum(x.stress40bpsMeanR,3)];
}
function renderValidation(out,asset,r){
 const part=document.createElement("section");part.className="validation-asset";
 part.append(node("h3",asset+" · "+r.status));
 if(!r.methods?.length){part.append(node("p",r.reason));out.append(part);return;}
 part.append(node("p","Public Delta perpetuals · "+r.days+" days · "+r.candleCount15+
  " completed 15-minute and "+r.candleCount60+" hourly candles · "+r.hours+"-hour maximum holding · "+
  r.feeBps+" bps assumed round-trip costs. Train/test cutoff: "+stamp(Date.parse(r.splitAt))+"."));
 part.append(node("p",r.reason));
 part.append(validationGrid(["Predefined rule","Training trades","Training mean net R",
  "Out-of-sample trades","OOS win rate","OOS win-rate interval (95%)","OOS mean net R",
  "OOS max drawdown R","OOS mean R with 40bps cost","Evidence status"],
  r.methods.map(m=>[m.label,String(m.train.trades),fnum(m.train.meanNetR,3),
   String(m.oos.trades),pct(m.oos.winRate),
   m.oos.wilson95?pct(m.oos.wilson95.low)+"–"+pct(m.oos.wilson95.high):"—",
   fnum(m.oos.meanNetR,3),fnum(m.oos.maxDrawdownR,2),fnum(m.oos.stress40bpsMeanR,3),m.status])));
 const current=r.methods.find(m=>m.key==="confluence");
 if(current){
  part.append(node("h4","Multi-factor results by prior market conditions (OOS only)"));
  const regimes=[["Trending (ADX ≥25)",current.byTrend.trending],
   ["Ranging (ADX ≤18)",current.byTrend.ranging],
   ["Transition",current.byTrend.transition],
   ["Normal volatility (relative ATR)",current.byVolatility.normal],
   ["Elevated volatility (relative ATR)",current.byVolatility.elevated]];
  part.append(validationGrid(["Observed trailing regime","Trades","Win rate","95% interval","Mean net R","Max drawdown R","40bps stressed mean R"],
   regimes.map(([name,stats])=>validationStatRow(name,stats))));
 }
 part.append(node("p","BOTTOM LINE: "+(r.status==="PRELIMINARY HISTORICAL RESEARCH"?
  "A limited historical test is available, but these samples DO NOT establish a profitable live options strategy.":
  "NO VALIDATED EDGE. Minimum 30 training and 20 untouched test-period trades are required for each method.")));
 part.append(node("p","UNDERLYING signal proxy only. No historical options bid/ask, option premiums, implied volatility, funding, actual executions or margin. No trade or automation is authorised."));
 out.append(part);
}
async function runValidation(){
 const button=$("runValidation"),out=$("validationResults");if(!button||!out)return;
 if(!V){out.textContent="Historical validation module unavailable; no performance claim.";return;}
 button.disabled=true;out.replaceChildren(node("p","Retrieving full candle history from Delta…"));
 const days=42,hours=Number($("tradeHorizon").value),reference=Date.now();
 const end15=Math.floor(reference/900000)*900,from15=end15-days*86400;
 const end60=Math.floor(reference/3600000)*3600,from60=end60-(days+5)*86400;
 const results=[];
 try{
  for(const asset of ["BTC","ETH"]){
   try{
    let fetched=0;const bump=()=>{fetched++;safeText("validationStatus","Loading "+asset+" historical batches ("+fetched+" requests)…");};
    const [a,b]=await Promise.all([
     validationHistory(asset+"USD","15m",from15,end15,bump),
     validationHistory(asset+"USD","1h",from60,end60,bump)]);
    results.push({asset,result:V.validate(a,b,{days,hours,feeBps:20,asOf:reference})});
   }catch(e){results.push({asset,result:{status:"UNAVAILABLE",reason:"History request failed; refusing to invent results: "+e.message}});}
  }
  out.replaceChildren();
  for(const x of results)renderValidation(out,x.asset,x.result);
 }catch(e){out.replaceChildren(node("p","Historical validation unavailable: "+e.message));}
 finally{button.disabled=false;safeText("validationStatus","Study checked "+stamp(Date.now())+"; no historical option P&L was simulated.");}
}
if($("runValidation"))$("runValidation").onclick=runValidation;

$("refreshNow").onclick=()=>refresh();
let debounce=null;
$("capital").addEventListener("input",()=>{
 clearTimeout(debounce);
 rangeLocked=null;renderRange();
 const newCap=cash(),old=Number(sessionStorage.getItem("lfc.crypto.capital"));
 try{sessionStorage.setItem("lfc.crypto.capital",String(newCap));}catch(e){}
 capitalDiagnostics();
 if(locked&&Math.abs(old-newCap)>0.01){
  locked=null;latestTickers=[];
  try{sessionStorage.removeItem("lfc.crypto.plan");}catch(e){}
  showMonitor({status:"NO TRADE",reason:"Capital changed; previous paper plan cleared."});
  safeText("status","Capital changed; automatically recalculating this paper setup.");
 }
 debounce=setTimeout(refresh,600);
});
if($("optionSignalFrame")){
 $("optionSignalFrame").value=locked?.signalFrameMode||"STANDARD";
 $("optionSignalFrame").addEventListener("change",()=>{rangeLocked=null;renderRange();if(locked){$("optionSignalFrame").value=locked.signalFrameMode||"STANDARD";safeText("status","Paper plan remains locked. Reset paper plan before changing signal candles.");}else refresh();});
}
if($("tradeHorizon")){
 const savedH=Number(sessionStorage.getItem("lfc.crypto.horizon"));
 if([2,4,8].includes(savedH))$("tradeHorizon").value=String(savedH);
 if(locked&&locked.horizonHours)$("tradeHorizon").value=String(locked.horizonHours);
 $("tradeHorizon").addEventListener("change",()=>{rangeLocked=null;renderRange();
  sessionStorage.setItem("lfc.crypto.horizon",$("tradeHorizon").value);
  if(locked){safeText("status","Existing paper plan remains locked at "+locked.horizonHours+" hours. Clear locked paper plan to scan at the new timeframe.");}
  else refresh();
 });
}
const saved=Number(sessionStorage.getItem("lfc.crypto.capital"));
if(Number.isFinite(saved)&&saved>0)$("capital").value=String(saved);
capitalDiagnostics();
if($("resetPlan"))$("resetPlan").onclick=()=>{
 rangeLocked=null;renderRange();
 locked=null;try{sessionStorage.removeItem("lfc.crypto.plan");}catch(e){}
 showMonitor({status:"NO TRADE",reason:""});refresh();
};
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});
window.addEventListener("pagehide",()=>clearInterval(timer));
timer=setInterval(()=>refresh(),view==="crypto-options"?25000:60000);
if(view==="crypto-funding"){
 const countdown=setInterval(()=>{
  for(const cell of document.querySelectorAll("[data-funding-end]")){
   const end=Number(cell.dataset.fundingEnd);
   const mode=cell.dataset.fundingVerified;
    cell.textContent="in "+timeLeft(end)+" · "+stamp(end)+
      (mode==="true"?" · Exchange-confirmed event":mode==="time-only"?" · Exchange timestamp; rate unverified":" · Approximate schedule ONLY, unverified");
  }
 },1000);
 addEventListener("pagehide",()=>clearInterval(countdown));
}
if(locked&&view==="crypto-options"){showPlan(locked);showMonitor({status:"NO TRADE",reason:"Awaiting fresh quotes"});}
refresh();
})();
