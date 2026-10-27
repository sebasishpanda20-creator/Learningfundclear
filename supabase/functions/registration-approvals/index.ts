// Supabase Edge Function: registration-approvals
// Public availability check; all listing/review actions require an ACTIVE admin JWT.
// Deploy with verify_jwt=false ONLY because this function performs its own JWT
// validation and role authorization before every protected operation.
// @ts-nocheck
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER=/^[a-z0-9_.-]{2,32}$/i;
export async function handle(req,env,send=fetch){
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return reply(405,{error:"Method not allowed"});
 if(!env?.url||!env?.key)return reply(503,{error:"Approval service is not configured"});
 let raw;
 try{raw=await req.text();if(raw.length>2048)return reply(413,{error:"Request too large"});}catch{return reply(400,{error:"Invalid request"});}
 let data;try{data=JSON.parse(raw);}catch{return reply(400,{error:"Invalid JSON"});}
 if(data?.action==="availability"){
  // The SQL migration installs restrictive RLS and an RPC readiness marker.
  // Never open public signup if the DB-level approval gate is uninstalled.
  try{
   const checked=await send(env.url+"/rest/v1/rpc/lfc_registration_ready",{
    method:"POST",headers:{apikey:env.key,Authorization:"Bearer "+env.key,"Content-Type":"application/json"},
    body:"{}",signal:AbortSignal.timeout(12000)});
   if(!checked.ok||await checked.json()!==true)return reply(503,{ready:false,error:"Registration database protection is not installed"});
   return reply(200,{ready:true,registration:"admin-approval-required"});
  }catch{return reply(503,{ready:false,error:"Registration database protection unavailable"});}
 }
 if(!["list","approve","reject"].includes(data?.action))return reply(400,{error:"Unknown action"});
 const authorization=req.headers.get("Authorization")||"";
 if(!/^Bearer\s+\S+$/i.test(authorization))return reply(401,{error:"Sign in required"});
 const headers={apikey:env.key,Authorization:"Bearer "+env.key,"Content-Type":"application/json"};
 const api=(path,options={})=>send(env.url+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(12000)});
 const getJson=async response=>{let payload;try{payload=await response.json();}catch{throw Error("Backend unavailable");}
  if(!response.ok)throw Error("Backend request failed ("+response.status+")");return payload;};
 try{
  const callerResp=await api("/auth/v1/user",{headers:{Authorization:authorization}});
  if(!callerResp.ok)return reply(401,{error:"Sign in required"});
  const caller=await callerResp.json();
  if(!UUID.test(caller?.id||""))return reply(401,{error:"Sign in required"});
  const adminProfile=await getJson(await api("/rest/v1/app_users?select=id,is_admin,is_active&id=eq."+encodeURIComponent(caller.id)));
  if(adminProfile.length!==1||adminProfile[0].is_admin!==true||adminProfile[0].is_active!==true)
   return reply(403,{error:"Active administrator access required"});
  const getProfile=async id=>{
   const rows=await getJson(await api("/rest/v1/app_users?select=id,is_active&id=eq."+encodeURIComponent(id)));
   return rows[0]||null;
  };
  const pending=user=>!!user?.user_metadata?.lfc_request_access&&
   user?.app_metadata?.lfc_access_review!=="rejected"&&user?.app_metadata?.lfc_access_review!=="approved";
  if(data.action==="list"){
   let pendingUsers=[],page=1,more=true;
   while(more&&page<=10){
    const result=await getJson(await api("/auth/v1/admin/users?page="+page+"&per_page=100"));
    const users=Array.isArray(result?.users)?result.users:[];
    pendingUsers.push(...users.filter(pending));
    more=users.length===100;page++;
   }
   const ids=pendingUsers.map(u=>u.id).filter(x=>UUID.test(x));
   let profiles=[];
   for(let i=0;i<ids.length;i+=75){
    const path="/rest/v1/app_users?select=id&id=in.("+ids.slice(i,i+75).join(",")+")";
    profiles.push(...await getJson(await api(path)));
   }
   const profilesSet=new Set(profiles.map(x=>x.id));
   const requests=pendingUsers.filter(u=>!profilesSet.has(u.id))
    .map(u=>({id:u.id,username:String(u.user_metadata?.username||""),
     displayName:String(u.user_metadata?.display_name||""),
     email:String(u.email||""),emailVerified:!!u.email_confirmed_at,createdAt:u.created_at}))
    .slice(0,250);
   return reply(200,{ok:true,requests,hasMore:more});
  }
  const id=data.userId;
  if(typeof id!=="string"||!UUID.test(id))return reply(400,{error:"Invalid registration ID"});
  if(id===caller.id)return reply(403,{error:"Cannot review your own account"});
  const loaded=await getJson(await api("/auth/v1/admin/users/"+encodeURIComponent(id)));
  const target=loaded.user||loaded;
  if(target?.id!==id||!pending(target))return reply(409,{error:"Request is no longer pending"});
  if(await getProfile(id))return reply(409,{error:"An account profile already exists"});
  const appMeta={...(target.app_metadata||{}),lfc_access_review:data.action==="reject"?"rejected":"approved"};
  if(data.action==="reject"){
   const rejected=await api("/auth/v1/admin/users/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify({app_metadata:appMeta})});
   if(!rejected.ok)return reply(503,{error:"Rejection was not saved; try again"});
   return reply(200,{ok:true,decision:"rejected"});
  }
  const username=String(target.user_metadata.username||"").trim(),display=String(target.user_metadata.display_name||"").trim();
  if(!USER.test(username)||display.length>80)return reply(422,{error:"Applicant username or display name invalid"});
  // Supabase email confirmation must be enabled for public registrations. A user
  // without a confirmed email is never provisioned as active.
  if(!target.email_confirmed_at)return reply(409,{error:"Applicant must confirm their email before approval"});
  const created=await api("/rest/v1/app_users",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({
   id,username,display_name:display||username,is_admin:false,is_active:true
  })});
  if(!created.ok)return reply(409,{error:"Unable to create profile; username may already be taken"});
  const marked=await api("/auth/v1/admin/users/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify({app_metadata:appMeta})});
  // The account is already active after the profile insert. Report successful
  // approval, but note metadata sync for admin review if its update failed.
  return reply(200,{ok:true,decision:"approved",metadataSynced:marked.ok});
 }catch(e){return reply(503,{error:"Approval service unavailable; no decision confirmed"});}
}
if(typeof Deno!=="undefined")Deno.serve(req=>handle(req,{url:Deno.env.get("SUPABASE_URL"),key:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}));
