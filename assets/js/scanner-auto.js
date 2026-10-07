/* Automatic historical scans use the existing quality gates and never overlap. */
(function(root){
 root.LfcScannerAuto=function(scan){
  const toggle=document.getElementById('autoScan'),status=document.getElementById('autoScanStatus');
  const key='lfc.scanner.auto',period=15*60*1000;let lastStarted=0,active=true;
  try{toggle.checked=localStorage.getItem(key)!=='off';}catch{}
  function run(){
   if(!active)return;
   if(!toggle.checked){status.textContent='Automatic scan paused.';return;}
   if(document.hidden){status.textContent='Automatic scan paused while this tab is hidden.';return;}
   if(document.getElementById('historySource').value!=='yahoo'){status.textContent='Local CSV selected: automatic download is paused. Imported files do not update themselves.';return;}
   if(document.getElementById('scanBtn').disabled){status.textContent='Scan in progress; automatic scans will not overlap.';return;}
   if(lastStarted&&Date.now()-lastStarted<period)return;
   lastStarted=Date.now();status.textContent='Automatic historical scan started '+new Date(lastStarted).toLocaleTimeString('en-IN')+'. Repeats every 15 minutes while visible. Source freshness checks still apply.';
   scan();
  }
  toggle.onchange=()=>{try{localStorage.setItem(key,toggle.checked?'on':'off');}catch{}if(toggle.checked)lastStarted=0;run();};
  document.addEventListener('visibilitychange',run);
  document.getElementById('historySource').addEventListener('change',()=>{lastStarted=0;run();});
  const startup=setTimeout(run,1000),timer=setInterval(run,period);
  window.addEventListener('pagehide',()=>{active=false;clearTimeout(startup);clearInterval(timer);});
  return {run};
 };
})(window);
