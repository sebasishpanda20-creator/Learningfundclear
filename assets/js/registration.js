(function(){
"use strict";
const $=id=>document.getElementById(id);
const form=$("registrationForm"),button=$("registrationButton"),status=$("registrationStatus"),details=$("signupDetails");
if(!form||!button)return;
const client=LfcAuth.client;
const msg=(s)=>{status.textContent=s;};
async function availability(){
 try{
  const {data,error}=await client.functions.invoke("registration-approvals",{body:{action:"availability"}});
  if(error||!data?.ready)throw Error("service unavailable");
  button.disabled=false;
  msg("Registration is open. Your account will require one-time administrator approval.");
 }catch{
  button.disabled=true;
  msg("Self-registration is temporarily unavailable. Existing users can still sign in, and administrators can create accounts.");
 }
}
details.addEventListener("toggle",()=>{if(details.open)availability();});
form.addEventListener("submit",async(event)=>{
 event.preventDefault();
 if(button.disabled)return;
 const username=$("registerUsername").value.trim(),display_name=$("registerDisplayName").value.trim(),
  email=$("registerEmail").value.trim().toLowerCase(),password=$("registerPassword").value,
  confirm=$("registerConfirm").value;
 if(!/^[a-z0-9_.-]{2,32}$/i.test(username)||!email.includes("@")||email.endsWith("@portal.local")||
    password.length<8||password.length>128||password!==confirm){
  msg("Use a 2–32 character username, your actual email, and matching passwords of at least 8 characters.");return;
 }
 button.disabled=true;msg("Submitting registration for administrator approval…");
 try{
  const {data,error}=await client.auth.signUp({
   email,password,options:{data:{lfc_request_access:true,username,display_name}}
  });
  if(error)throw error;
  // An account is never granted access by signing up. If email confirmation
  // is disabled in Supabase, signUp can create a session: clear it immediately.
  try{await client.auth.signOut({scope:"local"});}catch{}
  form.reset();msg("Request submitted. Check your email for a confirmation link if sent. An administrator must approve you once before you can sign in. No approval is needed for later logins.");
 }catch(e){
  msg(/rate|too many|email rate/i.test(e.message||"")?"Too many attempts. Try again later.":
   "Registration could not be confirmed. Check your details or try again later.");
 }finally{button.disabled=false;}
});
})();