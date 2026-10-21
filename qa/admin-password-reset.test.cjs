const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync('supabase/functions/reset-user-password/index.ts','utf8')).toString('base64'));
const id='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222';
async function run({admin=true,active=true,targetAdmin=false,pw='Ab9!xy',token=true,reject=false}={}) {
 const {handle}=await modulePromise;const writes=[];
 const fetcher=async(url,opt)=>{
  if(url.endsWith('/auth/v1/user')) return Response.json({id});
  if(url.includes('/rest/'))return Response.json(url.endsWith(id)?[{id,is_admin:admin,is_active:active}]:[{id:other,username:'regular',is_admin:targetAdmin,is_active:true}]);
  writes.push({url,body:JSON.parse(opt.body)});return Response.json({}, {status:reject?400:200});
 };
 const r=await handle(new Request('https://example.test',{method:'POST',headers:token?{Authorization:'Bearer fixture'}:{},body:JSON.stringify({userId:other,password:pw})}),{url:'https://auth.test',key:'fixture-service-key'},fetcher);
 return {status:r.status,body:await r.json(),writes};
}
test('admin can reset only password; no roles or profile records are changed',async()=>{const r=await run();assert.equal(r.status,200);assert.deepEqual(r.writes[0].body,{password:'Ab9!xy'});assert.equal(r.writes.length,1)});
for(const [name,args,status] of [['anonymous',{token:false},401],['regular caller',{admin:false},403],['inactive admin',{active:false},403],['admin target',{targetAdmin:true},403],['short password',{pw:'12345'},400]])test(name+' cannot reset',async()=>{const r=await run(args);assert.equal(r.status,status);assert.equal(r.writes.length,0)});
test('backend rejection never reports success',async()=>{const r=await run({reject:true});assert.equal(r.status,400);assert.equal(r.body.ok,undefined);assert.ok(!JSON.stringify(r.body).includes('Ab9!xy'))});
