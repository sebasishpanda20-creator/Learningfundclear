(function(root){
 function analyze(bars,interval,now=Date.now()){
  const seconds={'15m':900,'1h':3600,'1d':86400}[interval];
  const empty={signal:'Wait',reason:'At least 100 continuous completed candles required',entry:null,stop:null,target:null};
  if(!seconds||!Array.isArray(bars)||bars.length<100)return empty;
  const normalized=bars.map(b=>({...b,timestamp:b.time}));
  if(normalized.some((b,i)=>!Number.isFinite(b.timestamp)||(i&&b.timestamp-normalized[i-1].timestamp!==seconds)))return {...empty,reason:'Candle history has gaps or invalid timestamps'};
  return root.LfcIndexScanner.analyze({bars:normalized,intervalSeconds:seconds,stale:false,gaps:0,discarded:0},'crypto',now);
 }
 root.LfcCryptoSignals={analyze};
})(typeof window!=='undefined'?window:globalThis);
