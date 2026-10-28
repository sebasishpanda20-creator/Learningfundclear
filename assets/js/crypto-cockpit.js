(()=>{
 const $=id=>document.getElementById(id),usd=x=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(x);let active=null,key='';
 function update(){let p;try{p=JSON.parse(sessionStorage.getItem('lfc.crypto.plan')||'null');}catch{}const status=$('monitorPanel')?.querySelector('h2')?.textContent||'Waiting for a qualifying plan';$('cockpitState').textContent=status+' · Quotes and email alerts do not place orders.';
 const next=JSON.stringify(p);if(next===key)return;key=next;active=null;$('cockpitMetrics').replaceChildren();
 if(!p||p.status!=='PAPER PLAN'){$('cockpitTitle').textContent='Your next setup starts here';$('payoffPlayground').hidden=true;for(const label of ['Contracts per leg','Maximum modeled loss','Net gain at target','Net loss at stop']){const c=document.createElement('div'),a=document.createElement('span'),b=document.createElement('strong');a.textContent=label;b.textContent='—';c.append(a,b);$('cockpitMetrics').append(c)}return;}
 $('cockpitTitle').textContent=p.label+' · '+p.long.split('-')[1];
 const rows=[['Quantity per leg',p.quantity+' contracts'],['Maximum modeled loss',usd(p.riskUSD)],['Net gain at target',usd(p.expectedTargetNetUSD)],['Net loss at stop',usd(p.expectedStopNetUSD)]];
 for(const [label,value] of rows){const c=document.createElement('div'),a=document.createElement('span'),b=document.createElement('strong');a.textContent=label;b.textContent=value;c.append(a,b);$('cockpitMetrics').append(c)}
 const a=Number(p.long.split('-')[2]),b=Number(p.short.split('-')[2]);if(![a,b,p.contractValue,p.quantity,p.entrySpread,p.costBreakdown?.totalUSD].every(Number.isFinite)||a===b||p.long2){$('payoffPlayground').hidden=true;return;}
 active={p,a,b};const width=Math.abs(a-b),slider=$('payoffPrice');slider.min=Math.max(0,Math.min(a,b)-width);slider.max=Math.max(a,b)+width;slider.value=(a+b)/2;$('payoffPlayground').hidden=false;plot();
 }
 function pnl(x){const {p,a,b}=active,call=p.long.startsWith('C-'),intrinsic=k=>Math.max(0,call?x-k:k-x);return (intrinsic(a)-intrinsic(b)-p.entrySpread)*p.contractValue*p.quantity-p.costBreakdown.totalUSD;}
 function plot(){if(!active)return;const slider=$('payoffPrice'),x=Number(slider.value),lo=Number(slider.min),hi=Number(slider.max);$('payoffValue').textContent=usd(x)+' underlying → '+usd(pnl(x))+' modeled expiry P/L';
 const pts=Array.from({length:61},(_,i)=>{const spot=lo+(hi-lo)*i/60;return [spot,pnl(spot)]}),ys=pts.map(v=>v[1]),min=Math.min(...ys,0),max=Math.max(...ys,0),y=v=>140-(v-min)/(max-min||1)*120;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 600 160');svg.setAttribute('role','img');svg.setAttribute('aria-label','Modeled expiry payoff curve');
 const line=document.createElementNS(ns,'line');Object.entries({x1:10,x2:590,y1:y(0),y2:y(0),stroke:'#7893a5','stroke-dasharray':'4 4'}).forEach(([k,v])=>line.setAttribute(k,v));svg.append(line);
 const path=document.createElementNS(ns,'polyline');path.setAttribute('points',pts.map(([s,v])=>(10+(s-lo)/(hi-lo)*580)+','+y(v)).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#80decd');path.setAttribute('stroke-width','3');svg.append(path);
 const dot=document.createElementNS(ns,'circle');Object.entries({cx:10+(x-lo)/(hi-lo)*580,cy:y(pnl(x)),r:5,fill:'#fff'}).forEach(([k,v])=>dot.setAttribute(k,v));svg.append(dot);$('payoffChart').replaceChildren(svg);
 }
 $('payoffPrice').addEventListener('input',plot);new MutationObserver(update).observe($('tradePlan'),{childList:true,subtree:true});new MutationObserver(update).observe($('monitorPanel'),{childList:true,subtree:true});update();
})();
