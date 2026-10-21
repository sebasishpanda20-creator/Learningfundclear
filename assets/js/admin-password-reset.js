(function(){
 const form=document.getElementById('resetUserForm'), target=document.getElementById('resetUserTarget'), password=document.getElementById('resetUserPassword'), confirmPassword=document.getElementById('resetUserConfirm'), button=document.getElementById('resetUserButton'), status=document.getElementById('resetUserStatus');
 let admin=false;
 LfcAuth.ready.then(async user=>{
   if (!user?.is_admin) {form.hidden=true;return;}
   admin=true;
   try {
     const {data,error}=await LfcAuth.client.from('app_users').select('id,username,is_admin').eq('is_admin',false).order('username');
     if(error) throw error;
     target.replaceChildren(new Option('Select a user',''));
     for(const row of data||[]) target.add(new Option(row.username,row.id));
     button.disabled=false;
   } catch (_) {status.textContent='Could not load users. Reload this page to retry.';}
 });
 form.onsubmit=async event=>{
   event.preventDefault();if(!admin||button.disabled) return;
   if(!target.value||password.value.length<6||password.value!==confirmPassword.value){status.textContent='Select a user and enter matching passwords of at least 6 characters.';return;}
   const name=target.selectedOptions[0].textContent;
   if(!window.confirm('Reset the password for '+name+'?')) return;
   button.disabled=true;status.textContent='Resetting password…';
   try {
     const {data,error}=await LfcAuth.client.functions.invoke('reset-user-password',{body:{userId:target.value,password:password.value}});
     if(error||!data?.ok){status.textContent='Reset was not confirmed. Ensure the reset-user-password Supabase function is deployed and the password meets its policy.';return;}
     status.textContent='Password reset for '+name+'. Share it privately; ask the user to sign in and change it in My account.';
   } catch (_) {status.textContent='Reset was not confirmed. Check your connection before retrying.';}
   finally {password.value=confirmPassword.value='';button.disabled=false;}
 };
})();
