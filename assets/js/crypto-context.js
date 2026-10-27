/* Public Delta India context. No credentials, orders or trade recommendations. */
(function(root){
 'use strict';
 const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
 const epoch=v=>{const n=number(v);return n===null?null:n>1e14?n/1000:n>1e11?n:n*1000;};
 const fresh=(t,now=Date.now(),max=120000)=>Number.isFinite(t)&&t<=now+5000&&now-t<=max;
 function ticker(t,now=Date.now()){
  if(t?.contract_type!=='perpetual_futures'||t.product_trading_status!=='operational'||!/^[A-Z0-9]{1,20}USD$/.test(t.symbol||''))return null;
  const at=epoch(t.timestamp),bid=number(t.quotes?.best_bid),ask=number(t.quotes?.best_ask),oi=number(t.oi_value_usd),turnover=number(t.turnover_usd),price=number(t.mark_price),change=number(t.mark_change_24h);
  const spread=bid>0&&ask>=bid?100*(ask-bid)/((ask+bid)/2):null;
  return {symbol:t.symbol,at,stale:!fresh(at,now),price:price>0?price:null,oi:oi>=0?oi:null,turnover:turnover>=0?turnover:null,change,spread};
 }
 function universe(rows,now=Date.now()){
  if(!Array.isArray(rows))throw Error('No perpetual market snapshot');
  const seen=new Set(),all=rows.map(t=>ticker(t,now)).filter(x=>x&&!seen.has(x.symbol)&&seen.add(x.symbol));
  all.sort((a,b)=>Number(a.stale)-Number(b.stale)||(b.turnover??-1)-(a.turnover??-1)||a.symbol.localeCompare(b.symbol));
  const selected=all.slice(0,20);for(const symbol of ['BTCUSD','ETHUSD','XAUTUSD','PAXGUSD']){const x=all.find(r=>r.symbol===symbol);if(x&&!selected.some(r=>r.symbol===symbol))selected.push(x);}
  return {total:all.length,rows:selected};
 }
 function funding(q,now=Date.now()){
  if(q?.type!=='funding_rate'||!/^[A-Z0-9]{1,20}USD$/.test(q.sy||''))return null;
  const at=epoch(q.ts),next=epoch(q.nfr),rate=number(q.fr),seconds=number(q.fi);
  if(!fresh(at,now)||rate===null||Math.abs(rate)>2||!(seconds>0&&seconds<=86400)||!(next>now&&next<=now+86400000))return null;
  return {symbol:q.sy,at,next,rate,seconds}; // fr is already percent; never multiply by 100.
 }
 function history(rows,kind,now=Date.now()){
  if(!Array.isArray(rows)||!rows.length)throw Error('Exchange returned no '+kind+' history');
  const seen=new Set(),bars=[];
  for(const row of rows){const t=number(row.time),v=number(row.close);
   if(!(t>0)||v===null||(kind==='OI'&&v<0)||seen.has(t))throw Error('Invalid or duplicate '+kind+' observations');seen.add(t);
   if((t+3600)*1000<=now)bars.push({at:t*1000,value:v});
  }
  bars.sort((a,b)=>a.at-b.at);if(!bars.length)throw Error('No completed hourly observations');
  const last=bars.at(-1);if(now-(last.at+3600000)>7200000)throw Error(kind+' history is stale');
  if(kind==='OI'){
   const tail=bars.slice(-25);if(tail.length<25||tail.some((b,i)=>i&&b.at-tail[i-1].at!==3600000)||tail[0].value<=0)throw Error('24-hour OI comparison needs 25 consecutive hourly observations');
   return {from:tail[0].at,to:last.at,change:100*(last.value/tail[0].value-1),bars:tail};
  }
  return {from:bars[0].at,to:last.at,bars,positive:bars.filter(b=>b.value>0).length,negative:bars.filter(b=>b.value<0).length,zero:bars.filter(b=>b.value===0).length};
 }
 function book(raw,symbol,receivedAt,now=Date.now()){
  if(raw?.symbol!==symbol||!fresh(receivedAt,now,30000))throw Error('Order book unavailable or expired');
  const levels=(xs,side)=>{if(!Array.isArray(xs)||!xs.length)throw Error('Order book side missing');const a=xs.slice(0,20).map(r=>({price:number(r.price),size:number(r.size)}));if(a.some((r,i)=>!(r.price>0&&r.size!==null&&r.size>=0)||(i&&(side==='buy'?r.price>=a[i-1].price:r.price<=a[i-1].price))))throw Error('Invalid order book');return a;};
  const buy=levels(raw.buy,'buy'),sell=levels(raw.sell,'sell');if(sell[0].price<buy[0].price)throw Error('Crossed order book');
  const at=epoch(raw.timestamp??raw.last_updated_at);if(at!==null&&!fresh(at,now,30000))throw Error('Exchange order book timestamp is stale');
  return {bid:buy[0].price,ask:sell[0].price,spread:100*(sell[0].price-buy[0].price)/((sell[0].price+buy[0].price)/2),buySize:buy.reduce((a,b)=>a+b.size,0),sellSize:sell.reduce((a,b)=>a+b.size,0),buyLevels:buy.length,sellLevels:sell.length,at,receivedAt};
 }
 root.LfcCryptoContext={number,epoch,fresh,ticker,universe,funding,history,book};
})(typeof window!=='undefined'?window:globalThis);
