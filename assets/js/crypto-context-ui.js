(async function(){
 'use strict';if(!await LfcAuth.ready)return;
 const $=id=>document.getElementById(id),box=$('freeContext');if(!box)return;
 const C=LfcCryptoContext,api='https://api.india.delta.exchange/v2';
 const fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('en-IN',{maximumFractionDigits:d}):'Unavailable';
 const stamp=t=>new Date(t).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:false})+' IST';
 const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 let rows=[],total=0,ws=null,wsSymbols='',rates=new Map(),busy=false,seq=0,detailSeq=0,controllers=new Set(),lastLoad=0,bookSnapshot=null,paused=false;
 async function get(path){const ctl=new AbortController();controllers.add(ctl);const timer=setTimeout(()=>ctl.abort(),12000);try{const r=await fetch(api+path,{signal:ctl.signal,cache:'no-store',credentials:'omit'});if(!r.ok)throw Error('Exchange HTTP '+r.status);const d=await r.json();if(!d.success)throw Error('Exchange rejected request');return d.result;}finally{clearTimeout(timer);controllers.delete(ctl);}}
 function render(){
  $('contextRows').replaceChildren();const now=Date.now();
  for(const r of rows){const tr=document.createElement('tr'),isFresh=C.fresh(r.at,now),f=rates.get(r.symbol),live=isFresh&&f&&C.fresh(f.at,now)&&f.next>now;
   const status=!isFresh?'Stale snapshot':r.spread===null?'Spread unavailable':r.spread>.1?'Wide spread — review':'Snapshot available';
   const rate=live?fmt(f.rate,5)+'% / '+fmt(f.seconds/3600)+'h':'Awaiting verified stream';
   const values=[r.symbol,status,isFresh?fmt(r.change)+'%':'—',isFresh?fmt(r.oi)+' USD':'—',isFresh?fmt(r.turnover)+' USD':'—',isFresh&&r.spread!==null?fmt(r.spread,4)+'%':'—',rate,live?stamp(f.next)+' · '+Math.max(0,Math.ceil((f.next-now)/60000))+' min':'—'];
   for(const value of values)tr.append(node('td',value));$('contextRows').append(tr);
  }
  if(!rows.length){const tr=document.createElement('tr'),td=node('td','No verified market snapshot loaded.');td.colSpan=8;tr.append(td);$('contextRows').append(tr);}
  if(bookSnapshot&&!C.fresh(bookSnapshot.receivedAt,now,30000)){$('contextBook').textContent='Order-book snapshot expired. Refresh selected coin to check current liquidity.';bookSnapshot=null;}
 }
 function stream(){const symbols=rows.filter(r=>C.fresh(r.at)).map(r=>r.symbol).sort().join(',');if(ws&&wsSymbols===symbols&&[0,1].includes(ws.readyState))return;
  ws?.close();ws=null;rates.clear();wsSymbols=symbols;if(!symbols||typeof WebSocket==='undefined')return;
  try{const current=new WebSocket('wss://public-socket.india.delta.exchange');ws=current;
   current.addEventListener('open',()=>{if(ws===current)current.send(JSON.stringify({type:'subscribe',payload:{channels:[{name:'funding_rate',symbols:symbols.split(',')}]}}));});
   current.addEventListener('message',e=>{if(ws!==current)return;try{const r=C.funding(JSON.parse(e.data));if(r&&symbols.split(',').includes(r.symbol)){rates.set(r.symbol,r);render();}}catch{}});
   current.addEventListener('close',()=>{if(ws===current){rates.clear();render();}});
   current.addEventListener('error',()=>{if(ws===current){rates.clear();render();}});
  }catch{rates.clear();}
 }
 async function load(){if(busy||paused||!box.open||document.hidden)return;busy=true;lastLoad=Date.now();const id=++seq;$('contextRefresh').disabled=true;$('contextStatus').textContent='Loading free Delta India market data…';
  try{const data=await get('/tickers?contract_types=perpetual_futures');if(id!==seq)return;const list=C.universe(data);rows=list.rows;total=list.total;lastLoad=Date.now();
   const previous=$('contextSymbol').value;$('contextSymbol').replaceChildren();for(const r of rows){const o=node('option',r.symbol);o.value=r.symbol;$('contextSymbol').append(o);}if(rows.some(r=>r.symbol===previous))$('contextSymbol').value=previous;
   if(previous&&previous!==$('contextSymbol').value){detailSeq++;bookSnapshot=null;$('contextHistory').replaceChildren();$('contextBook').textContent='Select a coin to inspect its book.';}
   stream();render();$('contextStatus').textContent=rows.length+' shown from '+total+' operational perpetuals · sorted by 24h turnover, with BTC, ETH and available gold contracts included. Received '+stamp(lastLoad)+'. '+rows.filter(r=>C.fresh(r.at)).length+' have recent ticker timestamps.';
  }catch(e){if(id!==seq)return;rows=[];detailSeq++;$('contextSymbol').replaceChildren();$('contextHistory').replaceChildren();bookSnapshot=null;$('contextBook').textContent='Market snapshot unavailable.';rates.clear();ws?.close();ws=null;render();$('contextStatus').textContent='Market context unavailable: '+(e.name==='AbortError'?'request timed out':e.message)+'. No rates or signals invented.';}
  finally{if(id===seq){busy=false;$('contextRefresh').disabled=false;}}
 }
 async function detail(){const symbol=$('contextSymbol').value;if(!rows.some(r=>r.symbol===symbol))return;const id=++detailSeq;$('contextInspect').disabled=true;bookSnapshot=null;$('contextHistory').replaceChildren();$('contextBook').textContent='Loading '+symbol+' order book…';$('contextDetailStatus').textContent='Loading hourly OI and funding observations…';const end=Math.floor(Date.now()/1000),query='&resolution=1h&start='+(end-50*3600)+'&end='+end;
  const results=await Promise.allSettled([get('/history/candles?symbol='+encodeURIComponent('OI:'+symbol)+query),get('/history/candles?symbol='+encodeURIComponent('FUNDING:'+symbol)+query),get('/l2orderbook/'+encodeURIComponent(symbol)+'?depth=20').then(raw=>({raw,receivedAt:Date.now()}))]);
  if(id!==detailSeq||paused||!box.open)return;$('contextInspect').disabled=false;const output=$('contextHistory');
  for(let i=0;i<2;i++){const kind=i===0?'OI':'funding';try{if(results[i].status!=='fulfilled')throw results[i].reason;const h=C.history(results[i].value,kind==='OI'?'OI':'funding');
    if(kind==='OI')output.append(node('p','Open interest changed '+fmt(h.change)+'% across 24 hours of completed hourly observations ('+stamp(h.from)+' to '+stamp(h.to)+'). This does not tell us whether price will rise or fall.'));
    else{output.append(node('p','Funding history: '+h.positive+' positive, '+h.negative+' negative and '+h.zero+' zero hourly observations. These are rate observations, not settlement payments.'));const list=document.createElement('ul');for(const b of h.bars.slice(-8).reverse())list.append(node('li',stamp(b.at)+' · '+(b.value>0?'Positive':b.value<0?'Negative':'Zero')));output.append(list);}
   }catch(e){output.append(node('p',(kind==='OI'?'OI history':'Funding history')+' unavailable: '+(e.name==='AbortError'?'request timed out':e.message)));}}
  try{if(results[2].status!=='fulfilled')throw results[2].reason;const value=results[2].value,b=C.book(value.raw,symbol,value.receivedAt);bookSnapshot=b;$('contextBook').textContent=symbol+' · bid '+fmt(b.bid,5)+' USD / ask '+fmt(b.ask,5)+' USD · spread '+fmt(b.spread,4)+'% · '+fmt(b.buySize)+' buy contracts across '+b.buyLevels+' levels; '+fmt(b.sellSize)+' sell contracts across '+b.sellLevels+' levels. '+(b.at?'Exchange time '+stamp(b.at):'Exchange timestamp not supplied; receipt time only: '+stamp(b.receivedAt))+'. Displayed orders may be cancelled; this is not a fill guarantee.';}catch(e){$('contextBook').textContent='Order book unavailable: '+(e.name==='AbortError'?'request timed out':e.message);}
  $('contextDetailStatus').textContent=symbol+' · checked '+stamp(Date.now())+'. Each dataset reports its own availability.';
 }
 function suspend(){$('contextInspect').disabled=false;seq++;detailSeq++;busy=false;for(const c of controllers)c.abort();controllers.clear();ws?.close();ws=null;rates.clear();bookSnapshot=null;$('contextBook').textContent='Refresh selected coin for a current order book.';$('contextRefresh').disabled=false;render();}
 box.addEventListener('toggle',()=>{if(box.open){paused=false;load();}else suspend();});$('contextRefresh').onclick=load;$('contextInspect').onclick=detail;$('contextSymbol').onchange=()=>{$('contextInspect').disabled=false;detailSeq++;bookSnapshot=null;$('contextBook').textContent='Refresh selected coin for its order book.';$('contextHistory').replaceChildren();$('contextDetailStatus').textContent='Selection changed.';};
 document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();else if(box.open)load();});
 const timer=setInterval(()=>{if(box.open&&!document.hidden){render();if(Date.now()-lastLoad>=60000)load();}},10000);
 addEventListener('pagehide',()=>{paused=true;suspend();clearInterval(timer);});render();
})();
