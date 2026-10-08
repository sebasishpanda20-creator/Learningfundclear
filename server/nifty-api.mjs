const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function decryptSnapshot(envelope,pem){
 const der=decode(pem.replace(/-----[^-]+-----/g,'').replace(/\s/g,''));
 const privateKey=await crypto.subtle.importKey('pkcs8',der,{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
 const key=await crypto.subtle.decrypt({name:'RSA-OAEP'},privateKey,decode(envelope.key));
 const aes=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['decrypt']);
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv)},aes,decode(envelope.data));
 const result=JSON.parse(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
 if(result.version!==1||!Array.isArray(result.rows)||result.total!==result.rows.length)throw Error('Invalid snapshot');
 return result;
}
export async function serveNifty(request,env,config,fetcher=fetch){
 const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Authorization'}});
 if(request.method!=='GET')return reply({error:'Method not allowed'},405);
 const auth=request.headers.get('Authorization')||'';
 if(!/^Bearer [\w.-]+$/.test(auth))return reply({error:'Sign in to view prices'},401);
 const mode=new URL(request.url).searchParams.get('mode')||'eod';
 if(!['delayed','eod'].includes(mode))return reply({error:'Invalid mode'},400);
 try{
  const h={apikey:config.anonKey,Authorization:auth};
  const u=await fetcher(config.url+'/auth/v1/user',{headers:h,signal:AbortSignal.timeout(10000)});
  if(!u.ok)return reply({error:'Session expired'},401);
  const user=await u.json();if(!user.id)return reply({error:'Invalid session'},401);
  const p=await fetcher(config.url+'/rest/v1/app_users?id=eq.'+encodeURIComponent(user.id)+'&select=is_active',{headers:h,signal:AbortSignal.timeout(10000)});
  if(!p.ok||!(await p.json()).some(x=>x.is_active===true))return reply({error:'Active portal account required'},403);
  if(!env.NIFTY_FEED_PRIVATE_KEY)return reply({error:'Price service is not configured'},503);
  const url='https://raw.githubusercontent.com/sebasishpanda20-creator/Learningfundclear/main/market-data/'+mode+'-latest.enc.json';
  const r=await fetcher(url,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
  if(!r.ok)return reply({error:'No '+mode+' snapshot published yet'},503);
  const latest=await decryptSnapshot(await r.json(),env.NIFTY_FEED_PRIVATE_KEY);
  if(latest.mode!==mode)throw Error('Mode mismatch');
  let previous=null;
  if(latest.available===0){
   const old=await fetcher(url.replace('-latest.','-last-usable.'),{signal:AbortSignal.timeout(15000)});
   if(old.ok){previous=await decryptSnapshot(await old.json(),env.NIFTY_FEED_PRIVATE_KEY);if(previous.mode!==mode)previous=null;}
  }
  return reply({latest,previous});
 }catch{return reply({error:'Price service unavailable. Please retry later.'},503);}
}
