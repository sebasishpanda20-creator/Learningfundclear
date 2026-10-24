(async function(){
 if(!await LfcAuth.ready)return;
 const $=id=>document.getElementById(id),indices=[['nifty50','Nifty 50'],['banknifty','Bank Nifty'],['finnifty','Fin Nifty'],['midcapselect','Midcap Select'],['next50','Nifty Next 50']];
 let mode='intraday',generation=0,controller,results=new Map(),running=false,lastScan=0;
 const number=n=>Number.isFinite(n)?n.toLocaleString('en-IN',{maximumFractionDigits:2}):'—';
 const stamp=n=>Number.isFinite(n)?new Date(n).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST':'Unavailable';
 function element(tag,text,cls){const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;}
 function pair(label,value){const div=document.createElement('div');div.append(element('dt',label),element('dd',value));return div;}
 function render(){
  $('indexCards').replaceChildren();let ready=0,setups=0;
  for(const [id,name] of indices){const r=results.get(id),a=r?.analysis; if(a?.price)ready++;if(a?.entry)setups++;
   const card=element('article','','card');card.dataset.index=id;
   const head=element('div','','index-card-head');head.append(element('h2',name),element('span',a?.trend||'Unavailable','index-badge'+(!a?.entry?' wait':'')));card.append(head);
   card.append(element('div',number(a?.price),'index-price'),element('p',a?.signal||'Wait'));
   card.append(element('p',r?.error||a?.reason||(running?'Checking history…':'Ready to scan'),'index-reason'));
   const levels=element('dl','','index-levels');levels.append(pair('Entry · points',number(a?.entry)),pair('Stop · points',number(a?.stop)),pair('Target · points',number(a?.target)));card.append(levels);
   const zones=element('dl','','index-zones'),zone=z=>z?number(z.bottom)+' – '+number(z.top):'—';zones.append(pair('Demand zone',zone(a?.demand)),pair('Supply zone',zone(a?.supply)));card.append(zones);
   card.append(element('p','Candle opened: '+stamp(a?.candleAt),'index-time'),element('p',r?.feed?'Yahoo historical · '+r.feed.bars.length+' completed candles · '+(r.cached?'cached':'fetched')+' '+stamp(r.fetchedAt):'History unavailable','index-time'));
   $('indexCards').append(card);
  }
  $('indexReady').textContent=ready+' / 5';$('indexSetups').textContent=setups;$('indexWaiting').textContent=5-setups;
 }
 async function scan(){
  const run=++generation;controller?.abort();controller=new AbortController();running=true;lastScan=Date.now();results=new Map();$('scanIndices').disabled=true;render();
  $('indexStatus').textContent='Checking index histories…';
  try{
   const {data:{session}}=await LfcAuth.client.auth.getSession();if(!session)throw Error('Sign in again to scan indices');
   for(const [id,name] of indices){
    if(run!==generation)return;
    $('indexStatus').textContent='Checking '+name+'…';
    try{
     const r=await fetch(new URL('api/index-history?index='+id+'&mode='+mode,LfcAuth.base),{headers:{Authorization:'Bearer '+session.access_token},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(40000)])});
     const data=await r.json();if(!r.ok)throw Error(data.error||'History unavailable');
     if(run!==generation)return;
     const feed=LfcMarketData.parseYahoo(data.chart,data.symbol,data.interval);
     results.set(id,{feed,analysis:LfcIndexScanner.analyze(feed,mode),cached:data.cached,fetchedAt:data.fetchedAt});
    }catch(e){if(run!==generation)return;results.set(id,{error:e.name==='TimeoutError'?'History request timed out. No signal generated.':e.message});}
    render();
   }
   $('indexStatus').textContent='Scan completed '+stamp(Date.now())+'. Check each candle timestamp.';
  }catch(e){if(run===generation)$('indexStatus').textContent=e.message;}
  finally{if(run===generation){running=false;$('scanIndices').disabled=false;render();}}
 }
 function select(next){mode=next;document.querySelectorAll('[data-mode]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.mode===mode));b.tabIndex=b.dataset.mode===mode?0:-1;});$('indexPanel').setAttribute('aria-labelledby',mode+'Tab');$('indexModeHelp').textContent=mode==='intraday'?'Intraday · completed 15-minute candles. Setups require recent data during regular market hours.':'Swing · completed daily candles. Levels describe the latest session, not live prices.';scan();}
 document.querySelectorAll('[data-mode]').forEach(b=>{b.onclick=()=>select(b.dataset.mode);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'intraday':e.key==='End'?'swing':mode==='intraday'?'swing':'intraday';$(next+'Tab').focus();select(next);}};});
 $('scanIndices').onclick=scan;
 function auto(){if($('indexAuto').checked&&!document.hidden&&!running&&Date.now()-lastScan>=15*60000)scan();}
 const timer=setInterval(auto,60000);document.addEventListener('visibilitychange',auto);$('indexAuto').onchange=auto;
 addEventListener('pagehide',()=>{generation++;controller?.abort();clearInterval(timer);});scan();
})();
