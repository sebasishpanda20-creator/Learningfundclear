/* Indian options research engine. No broker orders, credentials or live-feed claims. */
(function(root){
'use strict';
const round=(v,t=.05)=>Math.round(v/t)*t;
const ema=(a,n)=>a.reduce((v,x,i)=>i?x*2/(n+1)+v*(1-2/(n+1)):x,0);
function direction(bars){
 if(!Array.isArray(bars)||bars.length<60||bars.some(b=>!Number.isFinite(b.close)||b.close<=0||!b.complete))return 'UNAVAILABLE';
 const a=bars.map(b=>b.close),last=a.at(-1),e20=ema(a,20),e50=ema(a,50),old=ema(a.slice(0,-3),20);
 if(last>e20&&e20>e50&&e20>old)return 'UP';
 if(last<e20&&e20<e50&&e20<old)return 'DOWN';
 return 'MIXED';
}
// Conservative estimate, not a contract note: exchange/clearing allowance 0.04%.
function costs(buy,sell,orders,brokerage=20){
 const turnover=buy+sell,broking=orders*brokerage,exchange=turnover*.0004,sebi=turnover*.000001,ipft=turnover*.000005;
 return broking+exchange+sebi+ipft+(broking+exchange+sebi+ipft)*.18+sell*.0015+buy*.00003+turnover*.002;
}
function evaluate(m,capital,kind='AUTO',now=m.now){
 const wait=reason=>({symbol:m.symbol,category:m.category,status:'WAIT',reason});
 if(!Number.isFinite(capital)||capital<=0||capital>1e9)return wait('Enter capital between ₹1 and ₹100 crore.');
 if(m.mode!=='DEMO')return wait('Live provider is not connected. Only labeled practice snapshots are enabled.');
 const fast=direction(m.fast),slow=direction(m.slow);
 if(fast==='UNAVAILABLE'||slow==='UNAVAILABLE')return wait('At least 60 completed candles are required on each timeframe.');
 if(fast!==slow||!['UP','DOWN'].includes(fast))return wait('5m and 15m trends do not agree. No directional option purchase.');
 const bars=m.fast,last=bars.at(-1),previous=bars.slice(-6,-1);
 if(!(fast==='UP'?last.close>Math.max(...previous.map(b=>b.high)):last.close<Math.min(...previous.map(b=>b.low))))return wait('Trend exists; wait for a completed 5m breakout of the previous five bars.');
 const side=fast==='UP'?'CE':'PE';
 const quotes=(m.options||[]).filter(q=>q.type===side&&q.expiry>now+86400000&&q.lot>0&&Number.isInteger(q.lot)&&q.tick>0&&q.bid>0&&q.ask>=q.bid&&(q.ask-q.bid)/q.ask<=.03&&q.oi>=1000&&q.volume>=1000&&now-q.at<=60000&&now>=q.at&&q.depth>=q.lot);
 if(m.category==='STOCK'&&m.eventRisk!==false)return wait('Stock earnings / corporate-event check is required.');
 const eligible=quotes.filter(q=>m.category!=='STOCK'||q.expiry>now+7*86400000).sort((a,b)=>Math.abs(a.strike-m.spot)-Math.abs(b.strike-m.spot));
 const buy=eligible[0];if(!buy)return wait('No fresh, liquid, eligible option. Stocks exclude the final seven calendar days as a research rule.');
 const sell=eligible.find(q=>q.expiry===buy.expiry&&q.lot===buy.lot&&(fast==='UP'?q.strike>buy.strike:q.strike<buy.strike));
 const useSpread=kind==='SPREAD'||(kind==='AUTO'&&sell&&sell.bid/buy.ask>=.3);
 if(useSpread&&!sell)return wait('A matching liquid hedge strike is unavailable.');
 const leg=useSpread?sell:null,width=leg?Math.abs(buy.strike-leg.strike):Infinity,entry=round(buy.ask-(leg?leg.bid:0),buy.tick);
 if(entry<=0||entry>=width)return wait('Invalid spread debit or strike width.');
 // Explicit premium-based research exits. These are not underlying-price targets.
 const risk=round(entry*.25,buy.tick),stop=round(entry-risk,buy.tick),t1=round(entry+risk*1.5,buy.tick),t2=round(entry+risk*2.5,buy.tick);
 if(risk<=0||stop<=0||t2>=width)return wait('Insufficient payoff room for the proposed targets.');
 function outcome(exit,lots){
  const units=lots*buy.lot;
  // Hypothetical leg values preserve the net spread exit. Actual fees depend on fills.
  const shortExit=leg?leg.bid:0,buyValue=(buy.ask+shortExit)*units,sellValue=((leg?leg.bid:0)+exit+shortExit)*units;
  const fee=costs(buyValue,sellValue,leg?4:2);
  return {gross:(exit-entry)*units,fees:fee,net:(exit-entry)*units-fee};
 }
 // Bound worst-case premium loss as well as planned stop loss. No leverage for options buys.
 const lotCost=entry*buy.lot,hardCap=capital*.1,stopCap=capital*.01;
 let hi=Math.min(100000,Math.floor(hardCap/lotCost),Math.floor(buy.depth/buy.lot),leg?Math.floor(leg.depth/leg.lot):100000),lo=0;
 while(lo<hi){const mid=Math.ceil((lo+hi)/2),loss=-outcome(stop,mid).net,maxLoss=lotCost*mid+outcome(stop,mid).fees;if(loss<=stopCap&&maxLoss<=hardCap)lo=mid;else hi=mid-1;}
 if(!lo)return wait('One whole lot exceeds the 1% stop-risk or 10% premium-loss budget, including estimated costs. Do not add leverage to force a trade.');
 const one=outcome(t1,lo),two=outcome(t2,lo),loss=outcome(stop,lo);
 if(one.net<=0||two.net/-loss.net<1.25)return wait('Potential net reward does not cover the required risk after estimated costs.');
 return {symbol:m.symbol,category:m.category,status:'PRACTICE',direction:fast,strategy:leg?(fast==='UP'?'Bull call debit spread':'Bear put debit spread'):(fast==='UP'?'Buy call':'Buy put'),buy, sell:leg,entry,stop,t1,t2,lots:lo,units:lo*buy.lot,premium:entry*lo*buy.lot,maxLoss:entry*lo*buy.lot,one,two,loss,ratio:two.net/-loss.net,reason:'Completed 5m breakout + aligned 5m / 15m EMA20/50 trends.'};
}
function demo(){
 const now=Date.UTC(2026,9,30,5,0),expiry=now+20*86400000;
 function market(symbol,category,spot,lot,sign){
 const bars=Array.from({length:70},(_,i)=>{const close=spot*(1+sign*(i-69)*.0005);return {close,high:close+spot*.0002,low:close-spot*.0002,complete:true};});
 const strike=Math.round(spot/100)*100;
 const options=['CE','PE'].flatMap(type=>[0,1].map(i=>({symbol:`SAMPLE:${symbol}:${type}:${i}`,type,strike:strike+(type==='CE'?1:-1)*i*100,expiry,lot,tick:.05,bid:i?45:99,ask:i?46:100,oi:10000,volume:5000,depth:lot*100,at:now})));
 return {mode:'DEMO',now,symbol,category,spot,eventRisk:false,fast:bars,slow:bars,options};
 }
 return [market('NIFTY','INDEX',24000,25,1),market('BANKNIFTY','INDEX',51000,15,-1),market('RELIANCE','STOCK',1400,100,1),market('SBIN','STOCK',800,100,-1),market('FINNIFTY','INDEX',25000,25,0)];
}
const api={direction,costs,evaluate,demo};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.LfcIndiaOptions=api;
})(typeof window!=='undefined'?window:globalThis);
