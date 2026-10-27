(function(){
"use strict";
const $=id=>document.getElementById(id),client=LfcAuth.client;
let admin=false,busy=false,requests=[];
const cell=(tr,text)=>{const td=document.createElement("td");td.textContent=String(text??"—");tr.append(td);return td;};
const fmt=date=>{if(!date)return "—";const d=new Date(date);return Number.isNaN(d.getTime())?"—":d.toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"});};
const status=(text)=>{$("approvalStatus").textContent=text;};
async function action(body){
 const {data,error}=await client.functions.invoke("registration-approvals",{body});
 if(error||!data?.ok)throw Error(data?.error||"Approval service unavailable. Check whether the Supabase function is deployed.");
 return data;
}
function render(){
 const body=$("approvalRows");body.replaceChildren();
 if(!requests.length){const tr=document.createElement("tr"),td=cell(tr,"No pending applications.");td.colSpan=6;body.append(tr);return;}
 for(const r of requests){
  const tr=document.createElement("tr");cell(tr,r.username);cell(tr,r.displayName);cell(tr,r.email);
  cell(tr,r.emailVerified?"Yes":"Not yet");cell(tr,fmt(r.createdAt));
  const actionTd=document.createElement("td");
  for(const [decision,label] of [["approve","Approve"],["reject","Reject"]]){
   const button=document.createElement("button");button.type="button";button.textContent=label;
   button.dataset.decision=decision;button.dataset.id=r.id;
   if(decision==="approve"&&!r.emailVerified){button.disabled=true;button.title="Email confirmation required";}
   actionTd.append(button);
  }
  tr.append(actionTd);body.append(tr);
 }
}
async function reload(){
 if(!admin||busy)return;busy=true;$("refreshApprovals").disabled=true;status("Loading pending requests…");
 try{
  const result=await action({action:"list"});requests=result.requests||[];render();
  status(requests.length+" pending request(s)."+(result.hasMore?" More registrations exist; review service pagination limit.":""));
 }catch(e){status(e.message||"Could not load requests.");$("approvalRows").replaceChildren();}
 finally{busy=false;$("refreshApprovals").disabled=false;}
}
$("refreshApprovals").onclick=reload;
$("approvalRows").addEventListener("click",async(event)=>{
 const button=event.target.closest("button[data-decision]");if(!button||!admin||busy)return;
 const applicant=requests.find(r=>r.id===button.dataset.id);if(!applicant)return;
 const decision=button.dataset.decision;
 if(!["approve","reject"].includes(decision))return;
 const verb=decision==="approve"?"Approve":"Reject";
 if(!window.confirm(verb+" access for "+applicant.username+" ("+applicant.email+")?"))return;
 busy=true;$("refreshApprovals").disabled=true;
 for(const b of $("approvalRows").querySelectorAll("button"))b.disabled=true;
 status(verb+" request…");
 try{
  const result=await action({action:decision,userId:applicant.id});
  status("Request "+result.decision+". "+(decision==="approve"?"User can now sign in with the registered email and password.":"Account remains without access."));
 }catch(e){status(e.message||"Decision not confirmed. Reload to check status.");}
 finally{busy=false;$("refreshApprovals").disabled=false;await reload();}
});
LfcAuth.ready.then(async user=>{
 if(!user?.is_admin){$("approvalDenied").textContent="Administrator access required.";location.replace("index.html");return;}
 admin=true;$("approvalDenied").hidden=true;$("approvalPanel").hidden=false;await reload();
}).catch(()=>{$("approvalDenied").textContent="Unable to verify administrator access.";});
})();