/* Index-point research setups. No orders, option premiums or win-rate claims. */
(function(root){
 function analyze(feed,mode,now=Date.now()){
  const bars=feed.bars,empty={signal:'Wait',entry:null,stop:null,target:null};
  if(!Array.isArray(bars)||bars.length<100)return {...empty,reason:'At least 100 completed candles required',trend:'Unavailable'};
  const zones=root.LfcScanner.computeZones(bars);if(!zones)return {...empty,reason:'Invalid candle history',trend:'Unavailable'};
  const last=bars.at(-1),prev=bars.at(-2),period=mode==='crypto'?feed.intervalSeconds*1000:900000,end=last.timestamp*1000+(mode==='intraday'||mode==='crypto'?period:0);
  const india=new Date(now+19800000),minute=india.getUTCHours()*60+india.getUTCMinutes();
  const sessionOpen=india.getUTCDay()>0&&india.getUTCDay()<6&&minute>=555&&minute<=930;
  const result={...empty,trend:zones.trend==='UPTREND'?'Bullish':zones.trend==='DOWNTREND'?'Bearish':'Neutral',price:last.close,demand:zones.nearestDemand,supply:zones.nearestSupply,candleAt:last.timestamp*1000};
  if(feed.discarded||feed.gaps)return {...result,reason:'History has invalid candles or intraday gaps'};
  if(feed.stale||now-end>(mode==='crypto'?period*3:mode==='intraday'?45*60000:4*86400000)||now<end)return {...result,reason:'Stale history — wait for a recent completed candle'};
  if(mode==='intraday'&&!sessionOpen)return {...result,reason:'Outside regular market hours — historical context only'};
  const lookback=bars.slice(-21,-1),high=Math.max(...lookback.map(b=>b.high)),low=Math.min(...lookback.map(b=>b.low));
  let direction=0,label='';
  if(result.trend==='Bullish'&&last.close>high&&prev.close<=high){direction=1;label='Bullish breakout';}
  else if(result.trend==='Bearish'&&last.close<low&&prev.close>=low){direction=-1;label='Bearish breakdown';}
  else if(result.trend==='Bullish'&&zones.nearestDemand&&last.low<=zones.nearestDemand.top&&last.high>=zones.nearestDemand.bottom&&last.close>zones.nearestDemand.top&&last.close>last.open){direction=1;label='Demand rejection';}
  else if(result.trend==='Bearish'&&zones.nearestSupply&&last.high>=zones.nearestSupply.bottom&&last.low<=zones.nearestSupply.top&&last.close<zones.nearestSupply.bottom&&last.close<last.open){direction=-1;label='Supply rejection';}
  if(!direction)return {...result,reason:'No confirmed trend-aligned breakout or zone rejection'};
  const atr=bars.slice(-14).reduce((sum,b,i)=>{const prior=bars[bars.length-15+i];return sum+Math.max(b.high-b.low,Math.abs(b.high-prior.close),Math.abs(b.low-prior.close));},0)/14;
  if(!(atr>0))return {...result,reason:'Insufficient price movement'};
  const stop=direction===1?Math.min(last.low,last.close-atr):Math.max(last.high,last.close+atr),risk=Math.abs(last.close-stop),target=last.close+direction*2*risk;
  if(stop<=0||target<=0)return {...result,reason:'Invalid setup levels'};
  return {...result,signal:direction===1?'Buy setup':'Sell setup',reason:label+' · completed candle · target 2× initial risk',entry:last.close,stop,target};
 }
 root.LfcIndexScanner={analyze};
})(typeof window!=='undefined'?window:globalThis);
