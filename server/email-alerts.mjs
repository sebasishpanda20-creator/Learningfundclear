import './crypto-engine.js';
const json=(x,s=200)=>Response.json(x,{status:s,headers:{'Cache-Control':'no-store'}});
export function validatePlan(p,now=Date.now()){
 if(!p||p.status!=='PAPER PLAN'||p.long2||!/^([CP])-(BTC|ETH|XAUT)-\d+-\d{6}$/.test(p.long||'')||!/^([CP])-(BTC|ETH|XAUT)-\d+-\d{6}$/.test(p.short||''))return false;
 if(p.long===p.short||p.long.split('-')[1]!==p.short.split('-')[1]||p.long.split('-')[3]!==p.short.split('-')[3])return false;
 return Number.isInteger(p.quantity)&&p.quantity>0&&p.quantity<=1e6&&[p.contractValue,p.entrySpread,p.stopSpread,p.targetSpread,p.timeExit,p.createdAt,p.costBreakdown?.totalUSD].every(Number.isFinite)&&p.contractValue>0&&p.stopSpread>0&&p.stopSpread<p.entrySpread&&p.entrySpread<p.targetSpread&&p.timeExit>now&&p.timeExit<=now+9*3600000&&p.createdAt<=now+15000&&p.createdAt>now-120000;
}
const ready=env=>!!(env.ALERTS_KV&&env.RESEND_API_KEY&&env.ALERT_FROM);
export async function serveAlerts(request,env,config,fetcher=fetch){
 if(!['GET','POST','DELETE'].includes(request.method))return json({error:'Method not allowed'},405);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Origin mismatch'},403);
 const auth=request.headers.get('Authorization')||'';if(!/^Bearer [\w.-]+$/.test(auth))return json({error:'Sign in required'},401);
 try{
 const headers={apikey:config.anonKey,Authorization:auth};const r=await fetcher(config.url+'/auth/v1/user',{headers,signal:AbortSignal.timeout(10000)});if(!r.ok)return json({error:'Session expired'},401);const u=await r.json();
 if(!u.id||!u.email||!u.email_confirmed_at)return json({error:'A verified login email is required'},403);
 const a=await fetcher(config.url+'/rest/v1/app_users?id=eq.'+encodeURIComponent(u.id)+'&select=is_active',{headers,signal:AbortSignal.timeout(10000)});if(!a.ok||!(await a.json()).some(x=>x.is_active===true))return json({error:'Approved active account required'},403);
 const key='plan:'+u.id;
 if(request.method==='DELETE'){if(env.ALERTS_KV)await env.ALERTS_KV.delete(key);return json({enabled:false});}
 if(!ready(env))return json({configured:false,enabled:false,email:u.email,message:'Email delivery is not configured. No alerts will be sent.'});
 if(request.method==='GET'){const saved=await env.ALERTS_KV.get(key,'json');return json({configured:true,enabled:!!saved,email:u.email,expiresAt:saved?.plan.timeExit});}
 const raw=await request.text();if(raw.length>12000)return json({error:'Plan too large'},413);const body=JSON.parse(raw);if(body.consent!==true||!validatePlan(body.plan))return json({error:'A fresh, valid debit-spread paper plan and email consent are required'},400);
 const old=await env.ALERTS_KV.get(key,'json');if(old&&old.plan.createdAt!==body.plan.createdAt)return json({error:'Disable the existing email watch before replacing it'},409);
 const plan=body.plan;await env.ALERTS_KV.put(key,JSON.stringify(old||{email:u.email,id:crypto.randomUUID(),plan,sent:{},origin:new URL(request.url).origin}),{expirationTtl:36000});return json({configured:true,enabled:true,email:u.email,expiresAt:plan.timeExit});
 }catch{return json({error:'Alert service unavailable; no delivery confirmed'},503);}
}
export async function runAlerts(env,fetcher=fetch){
 if(!ready(env))return;let cursor;
 do{const page=await env.ALERTS_KV.list({prefix:'plan:',limit:100,cursor});for(const key of page.keys){try{
 const item=await env.ALERTS_KV.get(key.name,'json');if(!item)continue;const p=item.plan;let event='PLAN SAVED';
 if(item.sent[event]){
 if(Date.now()>=p.timeExit)event='TIME EXIT';else{
 const asset=p.long.split('-')[1];const r=await fetcher('https://api.india.delta.exchange/v2/tickers?contract_types=call_options,put_options&underlying_asset_symbols='+asset,{signal:AbortSignal.timeout(12000)});if(!r.ok)continue;const j=await r.json();if(!j.success)continue;const m=globalThis.LfcCryptoDesk.monitor(p,j.result);event=m.status;if(!['STOP WATCH','TARGET WATCH'].includes(event))continue;
 }}
 if(item.sent[event])continue;
 const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':item.id+'-'+event.replaceAll(' ','-')},body:JSON.stringify({from:env.ALERT_FROM,to:[item.email],subject:'LearningFundClear · '+event,text:'Paper spread watch: '+event+'\nBuy '+p.quantity+' contracts '+p.long+'\nSell '+p.quantity+' contracts '+p.short+'\nStop spread price: '+p.stopSpread+' USD\nTarget spread price: '+p.targetSpread+' USD\nClose-by time: '+new Date(p.timeExit).toISOString()+'\n\nResearch alert only. Quotes and email can be delayed. No exchange order or stop has been placed. Check both legs on Delta.\nManage or disable this watch: '+item.origin+'/crypto-options.html'}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)continue;item.sent[event]=true;await env.ALERTS_KV.put(key.name,JSON.stringify(item),{expirationTtl:36000});if(event==='TIME EXIT')await env.ALERTS_KV.delete(key.name);
 }catch{/* Retry next scheduled run; never mark an unsuccessful send as delivered. */}}
 cursor=page.list_complete?undefined:page.cursor;
 }while(cursor);
}
