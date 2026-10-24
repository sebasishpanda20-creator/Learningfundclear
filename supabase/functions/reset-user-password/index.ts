// Deploy as reset-user-password. No custom secrets: Supabase injects the URL and service role.
// @ts-nocheck
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply = (status, body) => new Response(JSON.stringify(body), {status, headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
export async function handle(req, env, send = fetch) {
  if (req.method === "OPTIONS") return new Response(null,{status:204,headers:cors});
  if (req.method !== "POST") return reply(405,{error:"Method not allowed"});
  const authorization=req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(401,{error:"Sign in required"});
  if (!env.url || !env.key) return reply(503,{error:"Reset service is not configured"});
  const headers={apikey:env.key,Authorization:`Bearer ${env.key}`,"Content-Type":"application/json"};
  const call=(path, options={})=>send(env.url+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(12000)});
  try {
    const verified=await call('/auth/v1/user',{headers:{Authorization:authorization}});
    if (!verified.ok) return reply(401,{error:"Sign in required"});
    const caller=await verified.json();
    const profile=async id=>{
      const r=await call('/rest/v1/app_users?select=id,username,is_admin,is_active&id=eq.'+encodeURIComponent(id));
      if (!r.ok) throw new Error('profile unavailable');
      const rows=await r.json();return rows.length===1?rows[0]:null;
    };
    if (!caller.id) return reply(401,{error:"Sign in required"});
    const admin=await profile(caller.id);
    if (!admin || admin.is_admin!==true || admin.is_active!==true) return reply(403,{error:"Active admin access required"});
    const raw=await req.text();
    if (raw.length>4096) return reply(413,{error:"Request too large"});
    let body;try {body=JSON.parse(raw);} catch {return reply(400,{error:"Invalid request"});}
    if (!body || typeof body.userId!=='string' || !/^[0-9a-f-]{36}$/i.test(body.userId) || typeof body.password!=='string' || body.password.length<6 || body.password.length>128) return reply(400,{error:"Select a user and use a password of 6–128 characters"});
    const target=await profile(body.userId);
    if (!target || target.is_admin!==false || target.id===caller.id) return reply(403,{error:"Only regular user accounts can be reset here"});
    const updated=await call('/auth/v1/admin/users/'+encodeURIComponent(target.id),{method:'PUT',body:JSON.stringify({password:body.password})});
    if (!updated.ok) return reply(400,{error:"Password was not changed. Check the Supabase password policy and try again"});
    return reply(200,{ok:true,username:target.username});
  } catch (_) {return reply(503,{error:"Could not confirm the reset. Check connectivity before retrying"});}
}
if (typeof Deno !== 'undefined') Deno.serve(req=>handle(req,{url:Deno.env.get('SUPABASE_URL'),key:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}));
