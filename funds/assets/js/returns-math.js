(function(root){
 'use strict';
 const DAY=86400000;
 function date(raw){const m=/^(\d{2})-(\d{2})-(\d{4})$/.exec(raw||'');if(!m)return NaN;const t=Date.UTC(+m[3],+m[2]-1,+m[1]);return new Date(t).toISOString().slice(0,10)===`${m[3]}-${m[2]}-${m[1]}`?t:NaN;}
 function analyze(json,code,now=Date.now()){
  if(String(json.meta?.scheme_code)!==String(code)||json.status!=='SUCCESS'||!Array.isArray(json.data))throw new Error('Provider identity or response mismatch');
  const seen=new Map();for(const r of json.data){const t=date(r.date),v=Number(r.nav);if(!Number.isFinite(t)||!Number.isFinite(v)||v<=0||t>now)throw new Error('Invalid NAV history');if(seen.has(t)&&seen.get(t)!==v)throw new Error('Conflicting NAV for one date');seen.set(t,v);}
  const rows=[...seen].sort((a,b)=>a[0]-b[0]);if(!rows.length)throw new Error('No history');const latest=rows.at(-1);if(now-latest[0]>7*DAY)throw new Error('NAV older than seven days');
  const returns={};for(const years of [1,3,5]){const d=new Date(latest[0]);d.setUTCFullYear(d.getUTCFullYear()-years);const target=d.getTime(),base=rows.filter(r=>r[0]<=target).at(-1);returns[years]=base&&target-base[0]<=10*DAY?(years===1?(latest[1]/base[1]-1)*100:(Math.pow(latest[1]/base[1],365.25*DAY/(latest[0]-base[0]))-1)*100):null;}
  // Use completed calendar month-end observations only, not a partial current month.
  const months=new Map(),lastDate=new Date(latest[0]),monthStart=Date.UTC(lastDate.getUTCFullYear(),lastDate.getUTCMonth(),1);
  for(const r of rows)if(r[0]<monthStart)months.set(new Date(r[0]).toISOString().slice(0,7),r);
  const ends=[...months.values()].slice(-13),changes=[];let volatility=null;
  if(ends.length===13&&ends.every((r,i)=>!i||(r[0]-ends[i-1][0]>=20*DAY&&r[0]-ends[i-1][0]<=40*DAY))){for(let i=1;i<ends.length;i++)changes.push(Math.log(ends[i][1]/ends[i-1][1]));const mean=changes.reduce((a,b)=>a+b,0)/changes.length;volatility=Math.sqrt(changes.reduce((n,r)=>n+(r-mean)**2,0)/(changes.length-1))*Math.sqrt(12)*100;}
  const tier=volatility===null?'Unknown':volatility<5?'Lower':volatility<12?'Moderate':volatility<20?'High':'Very high';
  return {code:String(code),asOf:new Date(latest[0]).toISOString().slice(0,10),returns,volatility,tier,provider:'MFapi.in',checkedAt:now};
 }
 root.LfcFundReturns={analyze,date};
})(typeof window!=='undefined'?window:globalThis);
