/* Deterministic research models. Closed candles only; no execution. */
(function(root){'use strict';const D=root.LfcCryptoDesk||(typeof require==='function'?require('./crypto-desk-engine.js'):null);
function atr(a){const t=a.slice(-15);return t.slice(1).reduce((s,b,i)=>s+Math.max(b.high-b.low,Math.abs(b.high-t[i].close),Math.abs(b.low-t[i].close)),0)/14;}
function cpr(a,h,minutes){const last=a.at(-1),period=14400000,start=Math.floor(last.time/period)*period,prev=h.filter(b=>b.time>=start-period&&b.time<start);if(prev.length!==4||prev.some((b,i)=>b.time!==start-period+i*3600000))throw Error('Previous UTC 4h block needs four consecutive hourly candles');const high=Math.max(...prev.map(b=>b.high)),low=Math.min(...prev.map(b=>b.low)),p=(high+low+prev[3].close)/3,bc=(high+low)/2,tc=2*p-bc;return {low:Math.min(bc,tc),high:Math.max(bc,tc),pivot:p,r1:2*p-low,s1:2*p-high,from:start-period,to:start};}
function models(raw,hourly,minutes=15,now=Date.now()){
 let a,h;try{a=D.candles(raw,minutes,now);h=D.candles(hourly,60,now);if(a.slice(-20).some((b,i,t)=>i&&b.time-t[i-1].time!==minutes*60000))throw Error('Entry candle gaps');}catch(e){return [{model:'Data check',state:'UNAVAILABLE',reason:e.message}];}
 const l=a.at(-1),p=a.at(-2),v=atr(a),base={at:l.time+minutes*60000,expiresAt:l.time+3*minutes*60000},out=[];
 try{const band=cpr(a,h,minutes),recent=a.slice(-5,-1),sameBlock=b=>Math.floor(b.time/14400000)===Math.floor(l.time/14400000),up=l.close>band.high&&p.close<=band.high&&sameBlock(p),down=l.close<band.low&&p.close>=band.low&&sameBlock(p),retestUp=recent.some(b=>sameBlock(b)&&b.close>band.high)&&p.close>band.high&&l.low<=band.high&&l.close>band.high&&l.close>l.open,retestDown=recent.some(b=>sameBlock(b)&&b.close<band.low)&&p.close<band.low&&l.high>=band.low&&l.close<band.low&&l.close<l.open;
 const side=up||retestUp?'UP':down||retestDown?'DOWN':null;
 out.push({...base,model:'4h CPR breakout / retest',state:side?'TRIGGERED':'FORMING',side,invalidation:side==='UP'?Math.min(l.low,band.low)-v*.1:side==='DOWN'?Math.max(l.high,band.high)+v*.1:null,band,reason:side?'Closed candle crossed or retested the prior UTC 4h CPR':'Wait for a closed cross or confirmed retest of CPR '+band.low.toFixed(4)+'–'+band.high.toFixed(4)});
 }catch(e){out.push({model:'4h CPR breakout / retest',state:'UNAVAILABLE',reason:e.message});}
 const prior=a.slice(-14,-2),low=Math.min(...prior.map(b=>b.low)),high=Math.max(...prior.map(b=>b.high)),bull=p.low<low&&p.close>low,bear=p.high>high&&p.close<high,displacement=Math.abs(l.close-l.open)>=v*.5,up=bull&&l.close>p.high&&l.close>l.open&&displacement,down=bear&&l.close<p.low&&l.close<l.open&&displacement;
 out.push({...base,model:'Liquidity sweep + structure shift',state:up||down?'TRIGGERED':bull||bear?'FORMING':'NO SETUP',side:up?'UP':down?'DOWN':null,invalidation:up?p.low-v*.1:down?p.high+v*.1:null,reason:up||down?'Previous bar swept a 12-bar extreme and reclaimed it; latest body ≥0.5 ATR and closes beyond sweep candle':bull||bear?'Sweep detected; waiting for displacement and close beyond sweep candle':'No completed sweep-and-reclaim sequence'});
 return out;
}
function replay(raw,hourly,minutes=15,fee=.0005){
 // Price-only walk-forward diagnostic. Current fee assumption, not historical fills/funding.
 const now=Date.now();let a=D.candles(raw,minutes,now),h=D.candles(hourly,60,now);const trades=[];let lastExit=-1;
 for(let i=65;i<a.length-1;i++){if(i<=lastExit)continue;const at=a[i].time+minutes*60000,signal=models(a.slice(0,i+1).map(b=>({...b,time:b.time/1000})),h.filter(b=>b.time+3600000<=at).map(b=>({...b,time:b.time/1000})),minutes,at).find(x=>x.state==='TRIGGERED');if(!signal)continue;
 const entry=a[i+1].open,long=signal.side==='UP',distance=Math.max(1.5*atr(a.slice(0,i+1)),long?entry-signal.invalidation:signal.invalidation-entry);if(!(distance>0)||distance/entry>.05||Math.abs(entry-a[i].close)>atr(a.slice(0,i+1)))continue;
 const stop=entry+(long?-distance:distance),target=entry+(long?2*distance:-2*distance);if(stop<=0||target<=0)continue;const end=Math.min(a.length-1,i+(minutes===5?6:8));if(end!==i+(minutes===5?6:8))continue;let exit=a[end].close,j=end,result='TIME';
 for(let k=i+1;k<=end;k++){const b=a[k],sl=long?b.low<=stop:b.high>=stop,tp=long?b.high>=target:b.low<=target;if(sl){exit=long?Math.min(stop,b.open):Math.max(stop,b.open);j=k;result=tp?'BOTH: STOP FIRST':'STOP';break;}if(tp){exit=target;j=k;result='TARGET';break;}}
 const cost=(entry+exit)*(fee*1.18+.001),net=(long?exit-entry:entry-exit)-cost;trades.push({model:signal.model,at,entry,exit,result,netR:net/(distance+cost)});lastExit=j;
 }
 return {trades,count:trades.length,netR:trades.reduce((s,t)=>s+t.netR,0),wins:trades.filter(t=>t.netR>0).length,assumptions:'Price-only replay; next-bar open; 2R target; 30m (5m) / 2h (15m) timeout; stop first if both touched. Current taker fee +18% GST and 0.1% slippage per side. Excludes funding, bid/ask history, liquidity, margin and tax. Sequential signals per symbol; not a portfolio backtest or validated profitability.'};
}
root.LfcFuturesSetups={models,replay,cpr};if(typeof module!=='undefined')module.exports=root.LfcFuturesSetups;
})(typeof window!=='undefined'?window:globalThis);
