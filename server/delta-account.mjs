/* Delta India read-only authenticated account bridge.
 * Hard-gated to ONE portal admin + owner UUID. No order endpoint, no secrets in JS.
 * Keys must be provided via worker secrets DELTA_API_KEY, DELTA_API_SECRET and
 * DELTA_ACCOUNT_OWNER_USER_ID. Use a read-data-only Delta key. */
const json=(obj,status=200)=>Response.json(obj,{status,headers:{
 "Cache-Control":"private, no-store, max-age=0","Pragma":"no-cache","Vary":"Authorization",
 "X-Content-Type-Options":"nosniff"}});
export async function deltaSignature(secret,method,timestamp,path,query="",body=""){
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
  {name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const data=new TextEncoder().encode(method+timestamp+path+query+body);
 const hash=new Uint8Array(await crypto.subtle.sign("HMAC",key,data));
 return Array.from(hash,x=>x.toString(16).padStart(2,"0")).join("");
}
export async function serveDeltaAccount(request,env,config,fetcher=fetch){
 if(request.method!=="GET")return json({error:"Read-only method"},405);
 const url=new URL(request.url),origin=request.headers.get("Origin");
 if(origin&&origin!==url.origin)return json({error:"Origin mismatch"},403);
 const view=url.searchParams.get("view")||"wallet";
 const endpoints={wallet:"/v2/wallet/balances",positions:"/v2/positions/margined",orders:"/v2/orders"};
 if(!Object.hasOwn(endpoints,view))return json({error:"Unsupported account view"},400);
 if(!env.DELTA_API_KEY||!env.DELTA_API_SECRET||!env.DELTA_ACCOUNT_OWNER_USER_ID)
  return json({error:"Owner read-only Delta credentials are not configured"},503);
 const auth=request.headers.get("Authorization")||"";
 if(!/^Bearer [A-Za-z0-9_.-]+$/.test(auth))return json({error:"Sign in required"},401);
 try{
  const headers={apikey:config.anonKey,Authorization:auth};
  const userResp=await fetcher(config.url+"/auth/v1/user",{headers,signal:AbortSignal.timeout(10000)});
  if(!userResp.ok)return json({error:"Invalid or expired session"},401);
  const user=await userResp.json();
  if(!user?.id||user.id!==env.DELTA_ACCOUNT_OWNER_USER_ID)return json({error:"Account owner only"},403);
  const active=await fetcher(config.url+"/rest/v1/app_users?id=eq."+
   encodeURIComponent(user.id)+"&select=is_active,is_admin",
   {headers,signal:AbortSignal.timeout(10000)});
  if(!active.ok)return json({error:"Authorization unavailable"},503);
  const users=await active.json();
  if(!Array.isArray(users)||!users.some(x=>x.is_active===true&&x.is_admin===true))
   return json({error:"Active portal administrator required"},403);
  const path=endpoints[view],timestamp=String(Math.floor(Date.now()/1000));
  const signature=await deltaSignature(env.DELTA_API_SECRET,"GET",timestamp,path);
  const exchange=await fetcher("https://api.india.delta.exchange"+path,{
   headers:{"Accept":"application/json","api-key":env.DELTA_API_KEY,
    "timestamp":timestamp,signature},signal:AbortSignal.timeout(12000)});
  if(!exchange.ok)return json({error:"Delta account feed unavailable",status:exchange.status},502);
  const payload=await exchange.json();
  if(payload?.success!==true||!Array.isArray(payload.result))
   return json({error:"Unexpected Delta account response"},502);
  return json({source:"Delta Exchange India authenticated read-data",asOf:new Date().toISOString(),
   view,result:payload.result});
 }catch{
  return json({error:"Delta account bridge unavailable; no account changes made"},503);
 }
}
