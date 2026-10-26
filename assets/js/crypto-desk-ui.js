/* Separate crypto options and funding desks. Public exchange read-only. */
(async function () {
"use strict";
if (!await LfcAuth.ready) return;
const D=window.LfcCryptoDesk,API="https://api.india.delta.exchange/v2",view=document.body.dataset.page;
const $=id=>document.getElementById(id), money=v=>Number.isFinite(v)?"$"+v.toLocaleString("en-US",{maximumFractionDigits:2}):"—";
const fnum=(v,d=4)=>Number.isFinite(v)?v.toLocaleString("en-US",{maximumFractionDigits:d}):"—";
const stamp=t=>new Date(t).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",hour12:false})+" IST";
const cash=()=>Number($("capital").value);
const safeText=(id,text)=>{const node=$(id);if(node)node.textContent=text;};
let fx=null,fxAt=0,running=false,locked=null,latestTickers=[],timer=null,controller=null;
try{const cached=JSON.parse(sessionStorage.getItem("lfc.crypto.plan")||"null");
 if(cached?.status==="PAPER PLAN"&&cached.timeExit>Date.now())locked=cached;}catch(e){}
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
  fx=quote;fxAt=Date.now();
  safeText("fxStatus","Indicative FX: ₹1 = "+fnum(fx,6)+" USD · provider "+stamp(Number(data.time_last_update_unix)*1000)+". INR conversion is illustrative; Delta settlement FX/fees can differ.");
 }catch(e){fx=null;safeText("fxStatus","No recent INR/USD FX quote — lot sizing blocked. "+e.message);}
 return fx;
}
function node(tag,text){const el=document.createElement(tag);el.textContent=String(text);return el;}
function setRows(id,data){
 const tbody=$(id);if(!tbody)return;tbody.replaceChildren();
 for(const line of data){const tr=document.createElement("tr");
  for(const val of line)tr.append(node("td",val));tbody.append(tr);}
}
function capitalUSD(){const c=cash();return fx&&Number.isFinite(c)&&c>0?c*fx:NaN;}
async function history(symbol,resolution,seconds){
 const end=Math.floor(Date.now()/1000),start=end-seconds;
 return getDelta("/history/candles?symbol="+encodeURIComponent(symbol)+
  "&resolution="+resolution+"&start="+start+"&end="+end);
}
async function readTrend(asset) {
 const result=await Promise.all([history(asset+"USD","15m",36*3600),history(asset+"USD","1h",120*3600)]);
 return D.direction(result[0],result[1]);
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
 return tickers.map(t=>({...t,product:t.product||mapped.get(t.symbol)||null}));
}
function optionCandidates(tickers,trend,asset,lockedSymbols=[]) {
 if(lockedSymbols.length)return lockedSymbols;
 if(!Number.isFinite(trend?.current))return[];
 const side=trend.side==="UP"?"C":"P";
 const now=Date.now(),valid=tickers.filter(t=>typeof t.symbol==="string"&&t.symbol.startsWith(side+"-"+asset+"-"))
  .map(t=>({ticker:t,match:/^[CP]-[A-Z0-9]+-([0-9.]+)-(\d{6})$/.exec(t.symbol)}))
  .filter(x=>x.match).map(x=>{
   const code=x.match[2],expiry=Date.UTC(2000+Number(code.slice(4)),Number(code.slice(2,4))-1,Number(code.slice(0,2)),12);
   return {...x,expiry,strike:Number(x.match[1])};
  }).filter(x=>x.expiry>now+8*3600000&&x.expiry<now+10*86400000&&
   Number.isFinite(x.strike)&&Math.abs(x.strike-trend.current)/trend.current<=0.08);
 const expiry=[...new Set(valid.map(x=>x.expiry))].sort((a,b)=>a-b)[0];
 return valid.filter(x=>x.expiry===expiry).sort((a,b)=>Math.abs(a.strike-trend.current)-Math.abs(b.strike-trend.current))
  .slice(0,24).map(x=>x.ticker.symbol);
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
 return[asset==="XAUT"?"Tokenized gold · XAUT":asset,x.side,
  x.bos||"—",x.sweep||"—",x.actionable?"CONFIRMED":"WAIT",x.why];
}
function showPlan(plan){
 const box=$("tradePlan");box.replaceChildren();
 const title=node("h2",plan.status==="PAPER PLAN"?"Selected research setup · "+plan.label:"NO TRADE");
 box.append(title);
 if(plan.status!=="PAPER PLAN"){box.append(node("p",plan.reason||"No verified opportunity"));return;}
 const dl=document.createElement("dl");
 const fields=[
 ["Direction",plan.direction],["Buy to open",plan.long],["Sell to open",plan.short],
 ["Number of contracts (each leg)",plan.quantity],["Entry debit, USD per underlying unit",fnum(plan.entrySpread,6)],
 ["Watch stop, spread USD per underlying unit",fnum(plan.stopSpread,6)],
 ["Watch target, spread USD per underlying unit",fnum(plan.targetSpread,6)],
 ["Time exit (whichever comes first)",stamp(plan.timeExit)],
 ["Risk budget incl. fee reserve",money(plan.riskUSD)+" · approximately ₹"+fnum(plan.riskUSD/fx,0)],
 ["Theoretical maximum gain after fee reserve",money(plan.estimatedMaxGainUSD)],
 ["Indicative estimated fee reserve",money(plan.estimatedFeesUSD)],
 ["Options expire",stamp(plan.expiry)]];
 for(const [label,value]of fields){dl.append(node("dt",label),node("dd",value));}
 box.append(dl,node("p",plan.why));
 box.append(node("p","Research alert, NOT an exchange order. Stop/target are for the NET two-leg spread, not standalone Delta leg stop orders. Exits can slip; fees, taxes, funding and INR settlement FX must be checked on Delta."));
}
function showMonitor(current){
 const p=$("monitorPanel");if(!p)return;p.replaceChildren();
 if(!locked){p.append(node("p","A single eligible trade plan will be locked here and checked against fresh Delta quotes."));return;}
 p.append(node("h2",current.status));
 p.append(node("p",current.reason||""));
 if(Number.isFinite(current.exitSpread)){
  p.append(node("p","Executable NET exit (long bid − short ask): "+fnum(current.exitSpread,6)+" USD per unit."));
  p.append(node("p","Gross indicative P/L: "+money(current.grossPnlUSD)+" · approx. ₹"+fnum(current.grossPnlUSD/fx,0)+" before commissions and FX changes."));
 }
 if(["TARGET WATCH","STOP WATCH","TIME EXIT"].includes(current.status))
  p.append(node("strong","Check Delta terminal NOW. No order has been submitted. Confirm BOTH legs, price and risk."));
}
async function refreshOption(isMonitor=false) {
 if(locked){
  try{
   const asset=locked.long.split("-")[1],rows=await readOptions(asset,null,[locked.long,locked.short]);
   latestTickers=rows;
   showPlan(locked);
   showMonitor(D.monitor(locked,rows));
   safeText("status","Plan locked; monitoring both legs · "+stamp(Date.now())+" · read-only");
  }catch(e){showMonitor({status:"DATA UNAVAILABLE",reason:"Cannot monitor live exit: "+e.message});safeText("status","Exchange feed unavailable; verify Delta terminal immediately.");}
  return;
 }
 const assets=["BTC","ETH","XAUT"],results=[];
 safeText("status","Scanning BTC, ETH and tokenized gold for 15m/1h direction and defined-risk spreads…");
 const search=await Promise.all(assets.map(async asset=>{
  try{
   const trend=await readTrend(asset);
   results.push({asset,trend});
   if(!trend.actionable)return{asset,trend,plan:{status:"NO TRADE",reason:trend.why}};
   const ticks=await readOptions(asset,trend);
   return{asset,trend,plan:D.chooseSpread(ticks,trend,asset,capitalUSD())};
  }catch(e){
   const trend={side:"UNKNOWN",actionable:false,why:"Feed unavailable: "+e.message};
   results.push({asset,trend});return{asset,trend,plan:{status:"NO TRADE",reason:e.message}};
  }
 }));
 setRows("directionRows",assets.map(asset=>rowTrend(asset,results.find(x=>x.asset===asset)?.trend||{side:"UNKNOWN",why:"No exchange response"})));
 const plans=search.map(x=>x.plan).filter(x=>x.status==="PAPER PLAN");
 plans.sort((a,b)=>b.score-a.score);
 if(plans.length){
  locked={...plans[0],createdAt:Date.now()};
  try{sessionStorage.setItem("lfc.crypto.plan",JSON.stringify(locked));}catch(e){}
  showPlan(locked);showMonitor({status:"MONITOR",reason:"Plan created and locked; waiting for next quote"});
  safeText("status","One spread selected from three assets using only capital and verified public inputs.");
 }else{
  showPlan({status:"NO TRADE",reason:"No verified spread passed direction/liquidity/risk gates. "+search.map(x=>x.asset+": "+x.plan.reason).join(" · ")});
  safeText("status","Scan complete · no eligible setup · "+stamp(Date.now()));
 }
}
async function refreshFunding(){
 safeText("status","Scanning BTC, ETH, XAUT and PAXG perpetuals. No assumed spot hedge.");
 const tickers=await readPerps(),assets=["BTC","ETH","XAUT","PAXG"],cap=capitalUSD();
 const rows=assets.map(asset=>D.fundingDesk(tickers,asset,cap));
 setRows("fundRows",assets.map((asset,i)=>{
  const x=rows[i];return[asset,x.status,x.status==="WATCH ONLY"?fnum(x.fundingRaw,8):"—",
   x.status==="WATCH ONLY"?x.route:"No verified carry",
   x.status==="WATCH ONLY"?x.contracts:"—",x.status==="WATCH ONLY"?money(x.notionalUSD):"—",
   x.status==="WATCH ONLY"?"Spot/borrow/fee verification required":x.reason];
 }));
 const viable=rows.filter(x=>x.status==="WATCH ONLY");
 viable.sort((a,b)=>Math.abs(b.fundingRaw)-Math.abs(a.fundingRaw));
 const box=$("tradePlan");box.replaceChildren();
 if(viable.length){
  const x=viable[0];box.append(node("h2","Funding watch: "+x.perp+" · "+x.route),
   node("p","Indicative hedge size: "+x.contracts+" perpetual contracts; notional "+money(x.notionalUSD)+". Raw funding field: "+fnum(x.fundingRaw,8)+"."),
   node("p",x.reason));
 }else box.append(node("h2","NO FUNDING TRADE"),node("p","No tradable-sized verified perpetual quote for current capital."));
 safeText("status","Funding research snapshot · "+stamp(Date.now())+" · execution blocked until both hedge legs and settlement economics are verified.");
}
async function refresh(){
 if(running||document.hidden)return;
 running=true;$("refreshNow").disabled=true;
 try{
  const c=cash();
  if(!Number.isFinite(c)||c<100||c>1e9){
   safeText("status","Enter your capital in INR (₹100–₹100 crore). This is the ONLY required input.");
   if(view==="crypto-options")showPlan({status:"NO TRADE",reason:"Enter valid capital first."});
   return;
  }
  if(!await conversion()){safeText("status","FX unavailable. Not sizing or recommending a trade.");return;}
  if(view==="crypto-options")await refreshOption();else await refreshFunding();
 }catch(e){safeText("status","Market data unavailable: "+e.message+" · NO TRADE. Retry when feed recovers.");}
 finally{$("refreshNow").disabled=false;running=false;safeText("lastChecked","Last checked "+stamp(Date.now()));}
}
$("refreshNow").onclick=()=>refresh();
let debounce=null;
$("capital").addEventListener("input",()=>{
 clearTimeout(debounce);
 const newCap=cash(),old=Number(sessionStorage.getItem("lfc.crypto.capital"));
 try{sessionStorage.setItem("lfc.crypto.capital",String(newCap));}catch(e){}
 if(locked&&Math.abs(old-newCap)>0.01){
  // A locked plan must NEVER be silently resized on a new capital figure.
  safeText("status","Existing research plan locked at its original size. Clear the plan to recalculate.");
 }else debounce=setTimeout(refresh,600);
});
const saved=Number(sessionStorage.getItem("lfc.crypto.capital"));
if(Number.isFinite(saved)&&saved>0)$("capital").value=String(saved);
if($("resetPlan"))$("resetPlan").onclick=()=>{
 locked=null;try{sessionStorage.removeItem("lfc.crypto.plan");}catch(e){}
 showMonitor({status:"NO TRADE",reason:""});refresh();
};
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});
window.addEventListener("pagehide",()=>clearInterval(timer));
timer=setInterval(()=>refresh(),view==="crypto-options"?25000:60000);
if(locked&&view==="crypto-options"){showPlan(locked);showMonitor({status:"NO TRADE",reason:"Awaiting fresh quotes"});}
refresh();
})();
