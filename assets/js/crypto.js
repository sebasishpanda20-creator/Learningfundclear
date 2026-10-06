(async function(){
 'use strict';if(!await LfcAuth.ready)return;
 const $=id=>document.getElementById(id),D=LfcCryptoData;
 let generation=0,controller,quote=null,deltaGeneration=0,deltaController;
 const fmt=x=>Number.isFinite(x)?x.toLocaleString('en-US',{maximumFractionDigits:4}):'—';
 const stamp=t=>new Date(t).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:false})+' IST';
 async function get(url,signal){const r=await fetch(url,{signal,credentials:'omit',cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}
 function clear(){quote=null;for(const id of ['lastPrice','dayHigh','dayLow','dayChange'])$(id).textContent='—';$('quoteStamp').textContent='No quote received';$('cryptoChart').replaceChildren();$('chartNote').textContent='Waiting for history';}
 function chart(bars){const low=Math.min(...bars.map(b=>b.close)),high=Math.max(...bars.map(b=>b.close)),span=high-low||1;
 const points=bars.map((b,i)=>`${80+i*700/(bars.length-1)},${25+(high-b.close)/span*210}`).join(' ');
 $('cryptoChart').innerHTML=`<svg viewBox="0 0 800 285" role="img" aria-label="Completed candle closing prices"><text x="0" y="30">${fmt(high)}</text><text x="0" y="235">${fmt(low)}</text><polyline fill="none" stroke="currentColor" stroke-width="2" points="${points}"/><text x="80" y="270">${new Date(bars[0].time*1000).toISOString().slice(0,10)}</text><text x="680" y="270">${new Date(bars.at(-1).time*1000).toISOString().slice(0,10)}</text></svg>`;
 $('chartNote').textContent=`${bars.length} completed candles · last candle opened ${stamp(bars.at(-1).time*1000)} · prices in ${quote?.currency||($('venue').value==='binance'?'USDT':'USD')}`;
 }
 async function refresh(){
  const id=++generation;controller?.abort();controller=new AbortController();const signal=controller.signal,timer=setTimeout(()=>controller?.signal===signal&&controller.abort(),12000);
  const provider=$('venue').value,asset=$('asset').value,interval=$('interval').value;
  clear();$('pair').textContent=asset+(provider==='binance'?'/USDT · Binance':'/USD · Kraken');$('spotStatus').textContent='Fetching public exchange snapshot…';$('refreshCrypto').disabled=true;
  const base=provider==='binance'?'https://data-api.binance.vision/api/v3/':'https://api.kraken.com/0/public/';const pair=asset==='BTC'?'XBTUSD':asset+'USD';
  const quoteUrl=base+(provider==='binance'?'ticker/24hr?symbol='+asset+'USDT':'Ticker?pair='+pair);
  const barsUrl=base+(provider==='binance'?`klines?symbol=${asset}USDT&interval=${interval}&limit=121`:`OHLC?pair=${pair}&interval=${{'15m':15,'1h':60,'1d':1440}[interval]}`);
  try{
   const [qr,br]=await Promise.allSettled([get(quoteUrl,signal),get(barsUrl,signal)]);if(id!==generation)return;
   if(qr.status==='rejected')throw qr.reason;
   quote=D.quote(qr.value,provider,asset);$('lastPrice').textContent=fmt(quote.last)+' '+quote.currency;$('dayHigh').textContent=fmt(quote.high);$('dayLow').textContent=fmt(quote.low);$('dayChange').textContent=quote.change===null?'Not supplied':fmt(quote.change)+'%';
   $('quoteStamp').textContent=(quote.time?'Exchange time '+stamp(quote.time)+' · ':'')+'Received '+stamp(quote.received);
   $('spotStatus').textContent='Snapshot received · '+(provider==='binance'?'Binance public API':'Kraken public API · trade timestamp not supplied')+' · '+($('autoCrypto').checked?'refreshing every 20 seconds':'automatic refresh off');
   try{if(br.status==='rejected')throw br.reason;if(br.value.error?.length)throw new Error(br.value.error.join(', '));const rows=provider==='binance'?br.value:br.value.result?.[{BTC:'XXBTZUSD',ETH:'XETHZUSD',SOL:'SOLUSD'}[asset]];chart(D.candles(rows,provider,interval));}catch(e){$('chartNote').textContent='History unavailable: '+e.message;}
  }catch(e){if(id===generation){clear();$('spotStatus').textContent='Unavailable · '+(e.name==='AbortError'?'request timed out':e.message)+'. Retry or choose the other exchange.';}}
  finally{clearTimeout(timer);if(id===generation)$('refreshCrypto').disabled=false;}
 }
 for(const id of ['venue','asset','interval'])$(id).onchange=refresh;
 $('refreshCrypto').onclick=refresh;$('autoCrypto').onchange=refresh;
 const interval=setInterval(()=>{if(!document.hidden&&$('autoCrypto').checked&&!$('refreshCrypto').disabled)refresh();if(quote&&Date.now()-quote.received>45000){$('spotStatus').textContent='Stale snapshot · refresh to retrieve a current quote';}},20000);
 document.addEventListener('visibilitychange',()=>{if(document.hidden){controller?.abort();}else if($('autoCrypto').checked)refresh();});
 function clearDelta(){deltaGeneration++;deltaController?.abort();$('deltaRows').replaceChildren();$('deltaStatus').textContent='Selection changed. Load a new snapshot.';$('refreshDelta').disabled=false;}
 $('deltaExpiry').value=new Date().toISOString().slice(0,10);$('deltaExpiry').min=$('deltaExpiry').value;
 $('deltaType').onchange=()=>{$('expiryField').hidden=$('deltaType').value!=='options';clearDelta();};$('deltaAsset').onchange=clearDelta;$('deltaExpiry').onchange=clearDelta;
 $('refreshDelta').onclick=async()=>{
  clearDelta();const id=deltaGeneration,asset=$('deltaAsset').value,type=$('deltaType').value,expiry=$('deltaExpiry').value;
  if(type==='options'&&!/^\d{4}-\d{2}-\d{2}$/.test(expiry)){$('deltaStatus').textContent='Select an expiry date.';return;}
  deltaController=new AbortController();const activeController=deltaController,timer=setTimeout(()=>activeController.abort(),12000);$('refreshDelta').disabled=true;$('deltaStatus').textContent='Loading Delta India public snapshot…';
  let url='https://api.india.delta.exchange/v2/tickers?contract_types=perpetual_futures';if(type==='options')url='https://api.india.delta.exchange/v2/tickers?contract_types=call_options,put_options&underlying_asset_symbols='+asset+'&expiry_date='+expiry.split('-').reverse().join('-');
  try{const data=await get(url,deltaController.signal);if(id!==deltaGeneration)return;if(!data.success||!Array.isArray(data.result))throw new Error('No valid snapshot returned');
   const expiryCode=expiry.slice(8,10)+expiry.slice(5,7)+expiry.slice(2,4);
   const rows=data.result.filter(r=>type==='options'?new RegExp('^[CP]-'+asset+'-[0-9.]+-'+expiryCode+'$').test(r.symbol):r.symbol===asset+'USD'&&r.contract_type==='perpetual_futures');
   rows.sort((a,b)=>a.symbol.localeCompare(b.symbol,undefined,{numeric:true}));
   for(const r of rows){const tr=document.createElement('tr');for(const value of [r.symbol,fmt(D.numeric(r.mark_price)),fmt(D.numeric(r.quotes?.best_bid)),fmt(D.numeric(r.quotes?.best_ask)),fmt(D.numeric(r.oi_value_usd))]){const td=document.createElement('td');td.textContent=value;tr.appendChild(td);}$('deltaRows').appendChild(tr);}
   const times=rows.map(r=>Number(r.timestamp)/1000).filter(t=>Number.isFinite(t)&&t>0);const oldest=times.length===rows.length?Math.min(...times):null;
   $('deltaStatus').textContent=rows.length?`${oldest&&Date.now()-oldest>120000?'DELAYED · ':''}${rows.length} contracts · received ${stamp(Date.now())} · ${oldest?'oldest exchange update '+stamp(oldest):'exchange timestamp unavailable'}`:'No matching contracts for this selection. Try another expiry.';
  }catch(e){if(id===deltaGeneration){$('deltaRows').replaceChildren();$('deltaStatus').textContent='Unavailable · '+(e.name==='AbortError'?'request timed out':e.message)+'. Try again later.';}}
  finally{clearTimeout(timer);if(id===deltaGeneration)$('refreshDelta').disabled=false;}
 };
 window.addEventListener('pagehide',()=>{generation++;deltaGeneration++;controller?.abort();deltaController?.abort();clearInterval(interval);});refresh();
})();
