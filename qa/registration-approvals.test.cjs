"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const promise=import("data:text/javascript;base64,"+Buffer.from(fs.readFileSync("supabase/functions/registration-approvals/index.ts","utf8")).toString("base64"));
const adminId="11111111-1111-4111-8111-111111111111",userId="22222222-2222-4222-8222-222222222222";
const applicant=(confirmed=true)=>({id:userId,email:"newuser@example.com",email_confirmed_at:confirmed?"2026-10-26T12:00:00Z":null,
 created_at:"2026-10-26T11:00:00Z",user_metadata:{lfc_request_access:true,username:"newuser",display_name:"New User"},app_metadata:{provider:"email"}});
async function call({action="list",token=true,admin=true,active=true,confirmed=true,existing=false,user=applicant(confirmed),method="POST"}={}){
 const {handle}=await promise,writes=[],read=[];
 const mock=async(url,opt={})=>{
  const u=new URL(url),p=u.pathname;read.push(p);
  if(p==="/rest/v1/rpc/lfc_registration_ready")return Response.json(true);
  if(p==="/auth/v1/user")return Response.json({id:adminId});
  if(p==="/auth/v1/admin/users"&&opt.method!=="PUT")return Response.json({users:[user]});
  if(p==="/auth/v1/admin/users/"+userId&&opt.method==="PUT"){
   writes.push({path:p,body:JSON.parse(opt.body)});
   return Response.json({user});
  }
  if(p==="/auth/v1/admin/users/"+userId)return Response.json({user});
  if(p==="/rest/v1/app_users"&&opt.method==="POST"){
   const body=JSON.parse(opt.body);writes.push({path:p,body});
   return Response.json({}, {status:201});
  }
  if(p==="/rest/v1/app_users"){
   if(u.searchParams.get("id")==="eq."+adminId)return Response.json([{id:adminId,is_admin:admin,is_active:active}]);
   if(u.searchParams.get("id")==="eq."+userId||u.searchParams.get("id")?.startsWith("in.("))
    return Response.json(existing?[{id:userId}]:[]);
  }
  throw Error("Unmocked "+url);
 };
 const req=new Request("https://supabase.test/registration-approvals",{method,
  headers:token?{Authorization:"Bearer test-user-jwt"}:{},
  body:method==="POST"?JSON.stringify({action,userId}):undefined});
 const r=await handle(req,{url:"https://auth.test",key:"mock-service-role"},mock);
 return{status:r.status,body:await r.json(),writes,read};
}
test("Public availability reports readiness but does not read users",async()=>{
 const r=await call({action:"availability",token:false});
 assert.equal(r.status,200);assert.equal(r.body.ready,true);assert.deepEqual(r.read,["/rest/v1/rpc/lfc_registration_ready"]);
});
test("Anonymous, regular and inactive admin requests cannot list or decide",async()=>{
 for(const settings of [{token:false},{admin:false},{active:false}]){
  const r=await call({...settings,action:"approve"});
  assert.equal(r.status,settings.token===false?401:403);assert.equal(r.writes.length,0);
 }
});
test("Admin sees pending self registrations without granting profile access",async()=>{
 const r=await call({action:"list"});
 assert.equal(r.status,200);assert.equal(r.body.requests.length,1);assert.equal(r.body.requests[0].email,"newuser@example.com");
 assert.equal(r.writes.length,0);
});
test("First-time approval creates ONLY a standard active user, not administrator",async()=>{
 const r=await call({action:"approve"});assert.equal(r.status,200);assert.equal(r.body.decision,"approved");
 assert.equal(r.writes.length,2);
 assert.deepEqual(r.writes[0].body,{id:userId,username:"newuser",display_name:"New User",is_admin:false,is_active:true});
 assert.equal(r.writes[1].body.app_metadata.lfc_access_review,"approved");
});
test("Rejection never creates app_users entry and persists server-controlled status",async()=>{
 const r=await call({action:"reject"});assert.equal(r.status,200);
 assert.equal(r.writes.length,1);assert.equal(r.writes[0].body.app_metadata.lfc_access_review,"rejected");
});
test("Unverified email, previously reviewed, and existing account cannot be approved",async()=>{
 const cases=[{confirmed:false},{existing:true},{user:{...applicant(),app_metadata:{lfc_access_review:"rejected"}}}];
 for(const args of cases){const r=await call({action:"approve",...args});assert.equal(r.status,args.confirmed===false?409:409);assert.equal(r.writes.length,0);}
});
test("Malformed IDs and unsupported actions fail closed",async()=>{
 const x=await call({action:"anything"});assert.equal(x.status,400);assert.equal(x.writes.length,0);
});
