// Fixed instrument allowlist; no arbitrary upstream URLs or broker credentials.
const symbols={nifty50:'^NSEI',banknifty:'^NSEBANK',finnifty:'NIFTY_FIN_SERVICE.NS',next50:'^NSMIDCP',midcapselect:'NIFTY_MID_SELECT.NS'};
const cache=new Map();let blockedUntil=0;
export async function serveIndexHistory(request,config,fetcher=fetch){
 const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Authorization'}});
 if(request.method!=='GET')return reply({error:'Method not allowed'},405);
 const auth=request.headers.get('Authorization')||'';
 if(!/^Bearer [\w.-]+$/.test(auth))return reply({error:'Sign in to scan indices'},401);
 const url=new URL(request.url),id=url.searchParams.get('index'),mode=url.searchParams.get('mode');
 if(!Object.hasOwn(symbols,id)||!['intraday','swing'].includes(mode))return reply({error:'Invalid index or mode'},400);
 try{
  const h={apikey:config.anonKey,Authorization:auth};
  const u=await fetcher(config.url+'/auth/v1/user',{headers:h,signal:AbortSignal.timeout(10000)});
  if(!u.ok)return reply({error:'Session expired'},401);
  const user=await u.json();if(!user.id)return reply({error:'Invalid session'},401);
  const p=await fetcher(config.url+'/rest/v1/app_users?id=eq.'+encodeURIComponent(user.id)+'&select=is_active',{headers:h,signal:AbortSignal.timeout(10000)});
  if(!p.ok||!(await p.json()).some(x=>x.is_active===true))return reply({error:'Active portal account required'},403);
  const key=id+':'+mode,old=cache.get(key),now=Date.now();
  if(old&&now-old.fetchedAt<300000)return reply({...old,cached:true});
  if(now<blockedUntil)return reply({error:'Historical source temporarily unavailable. Retry later.'},503);
  const symbol=symbols[id],interval=mode==='intraday'?'15m':'1d',range=mode==='intraday'?'1mo':'1y';
  const r=await fetcher('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?range='+range+'&interval='+interval,{signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
  if(!r.ok){if([401,403,429].includes(r.status))blockedUntil=now+300000;return reply({error:'Historical source unavailable (HTTP '+r.status+'). No signal generated.'},503);}
  const raw=await r.text();if(raw.length>1500000)throw Error('Oversized response');
  const chart=JSON.parse(raw),result=chart.chart?.result?.[0];
  if(chart.chart?.error||result?.meta?.symbol!==symbol||!Array.isArray(result.timestamp)||result.timestamp.length>2500)throw Error('Invalid source response');
  const payload={id,symbol,mode,interval,fetchedAt:now,cached:false,chart};cache.set(key,payload);
  return reply(payload);
 }catch{return reply({error:'Index history unavailable. Please retry later.'},503);}
}
