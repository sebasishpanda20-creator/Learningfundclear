(async()=>{
 const status=document.getElementById('emailStatus'),enable=document.getElementById('emailEnable'),disable=document.getElementById('emailDisable');
 async function call(method,body){await LfcAuth.ready;const {data}=await LfcAuth.client.auth.getSession();const r=await fetch('/api/email-alerts',{method,headers:{Authorization:'Bearer '+data.session?.access_token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw Error(j.error||'Email service unavailable');return j;}
 function show(j){enable.disabled=!j.configured||j.enabled;status.textContent=!j.configured?'Not active — the administrator must connect the email sender and alert storage.':j.enabled?'Email watch enabled for '+j.email+'. Stop, target and time-exit checks continue in the background.':'Ready. Alerts will be sent to '+j.email+' after you enable a current paper plan.';}
 enable.onclick=async()=>{enable.disabled=true;try{const plan=JSON.parse(sessionStorage.getItem('lfc.crypto.plan')||'null');if(!plan)throw Error('Find a qualifying paper plan first.');show(await call('POST',{plan,consent:true}));}catch(e){status.textContent=e.message;enable.disabled=false;}};
 disable.onclick=async()=>{try{await call('DELETE');show(await call('GET'));}catch(e){status.textContent=e.message;}};
 try{show(await call('GET'));}catch(e){status.textContent='Email alerts unavailable: '+e.message;}
})();
