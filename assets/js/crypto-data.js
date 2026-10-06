/* Public, read-only exchange endpoints. No API keys or account access. */
(function(root){
 'use strict';
 const numeric = x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x)) ? Number(x) : null;
 function candles(rows,provider,interval,now=Date.now()){
  if(!Array.isArray(rows))throw new Error('No candle history returned');
  const period={'15m':900,'1h':3600,'1d':86400}[interval];
  const seen=new Set(),bars=[];
  for(const r of rows){
   const t=numeric(r[0]),o=numeric(r[1]),h=numeric(r[2]),l=numeric(r[3]),c=numeric(r[4]);
   const time=provider==='binance'?t/1000:t;
   if(![t,o,h,l,c].every(Number.isFinite)||t<=0||l<=0||l>Math.min(o,c)||h<Math.max(o,c,l)||seen.has(time))throw new Error('Invalid or duplicate exchange candles');
   seen.add(time);
   if((time+period)*1000>now)continue; // Never chart an unfinished candle as completed.
   bars.push({time,open:o,high:h,low:l,close:c});
  }
  bars.sort((a,b)=>a.time-b.time);
  if(bars.length<2)throw new Error('Not enough completed candles');
  if(now/1000-bars.at(-1).time>period*3)throw new Error('Exchange candle history is stale');
  return bars.slice(-120);
 }
 function quote(raw,provider,asset,now=Date.now()){
  let q;
  if(provider==='binance'){
   if(raw.symbol!==asset+'USDT')throw new Error('Exchange returned a different pair');
   q={last:numeric(raw.lastPrice),high:numeric(raw.highPrice),low:numeric(raw.lowPrice),change:numeric(raw.priceChangePercent),time:numeric(raw.closeTime),pair:asset+'/USDT',currency:'USDT'};
  }else{
   if(raw.error?.length)throw new Error(raw.error.join(', '));
   const expected={BTC:'XXBTZUSD',ETH:'XETHZUSD',SOL:'SOLUSD'}[asset];
   const r=raw.result?.[expected];if(!r)throw new Error('Exchange returned a different pair');
   // Kraken REST opening price is midnight UTC, not a rolling 24-hour open.
   q={last:numeric(r.c?.[0]),high:numeric(r.h?.[1]),low:numeric(r.l?.[1]),change:null,time:null,pair:asset+'/USD',currency:'USD'};
  }
  if(!Number.isFinite(q.last)||q.last<=0)throw new Error('Exchange returned an invalid quote');
  if(provider==='binance'&&(!q.time||now-q.time>120000||q.time>now+60000))throw new Error('Exchange quote timestamp is stale or invalid');
  return {...q,received:now,provider};
 }
 root.LfcCryptoData={numeric,candles,quote};
})(typeof window!=='undefined'?window:globalThis);
