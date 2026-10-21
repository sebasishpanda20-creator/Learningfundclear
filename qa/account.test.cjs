const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
async function setup(mode='ok') {
 const nodes=Object.fromEntries(['passwordForm','changePassword','passwordStatus','currentPassword','nextPassword','confirmPassword','accountUsername','signInAgain'].map(id=>[id,{value:'',disabled:id==='changePassword',hidden:false}]));
 const calls=[];const user={id:'same-user',email:'admin@portal.local'};
 const auth={getUser:async()=>({data:{user}}),signInWithPassword:async()=>({error:mode==='wrong'?{}:null,data:{user:mode==='switched'?{id:'other'}:user}}),updateUser:async v=>{calls.push('update');assert.deepEqual(Object.keys(v),['password']);return {error:mode==='rejected'?{}:null}}};
 vm.runInNewContext(fs.readFileSync('assets/js/account.js','utf8'),{document:{getElementById:id=>nodes[id]},LfcAuth:{ready:Promise.resolve({id:user.id,username:'admin'}),client:{auth},logout:async()=>calls.push('logout')}});
 await Promise.resolve();nodes.currentPassword.value='old-example';nodes.nextPassword.value=nodes.confirmPassword.value='new-example-12345';
 return {nodes,calls,submit:()=>nodes.passwordForm.onsubmit({preventDefault(){}})};
}
test('successful change clears all passwords and signs out only after success',async()=>{const x=await setup();await x.submit();assert.deepEqual(x.calls,['update','logout']);for(const id of ['currentPassword','nextPassword','confirmPassword'])assert.equal(x.nodes[id].value,'');assert.equal(x.nodes.passwordForm.hidden,true)});
for(const mode of ['wrong','switched'])test(mode+' credentials cannot change password',async()=>{const x=await setup(mode);await x.submit();assert.deepEqual(x.calls,[]);assert.equal(x.nodes.changePassword.disabled,false)});
test('server rejection does not report success or sign out',async()=>{const x=await setup('rejected');await x.submit();assert.deepEqual(x.calls,['update']);assert.match(x.nodes.passwordStatus.textContent,/not changed/)});
test('mismatched confirmation never calls auth update',async()=>{const x=await setup();x.nodes.confirmPassword.value='different';await x.submit();assert.deepEqual(x.calls,[])});
