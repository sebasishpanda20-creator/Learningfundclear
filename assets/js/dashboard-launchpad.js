(function(){
  const tabs=[...document.querySelectorAll("[data-launch-tab]")],cards=[...document.querySelectorAll("[data-launch-group]")],search=document.getElementById("launchpadSearch"),grid=document.getElementById("launchpadGrid"),empty=document.getElementById("launchpadEmpty");
  if(!tabs.length||!search||!grid)return;
  let active="trade";
  function render(){
    const q=search.value.trim().toLocaleLowerCase();let visible=0;
    for(const card of cards){const matchGroup=card.dataset.launchGroup===active,matchText=!q||card.textContent.toLocaleLowerCase().includes(q),show=matchGroup&&matchText;card.hidden=!show;if(show)visible++;}
    empty.hidden=visible>0;
    const selected=tabs.find(t=>t.dataset.launchTab===active);
    grid.setAttribute("aria-labelledby",selected.id);
  }
  function select(tab,focus){
    active=tab.dataset.launchTab;
    tabs.forEach(t=>{const on=t===tab;t.setAttribute("aria-selected",String(on));t.tabIndex=on?0:-1;});
    render();if(focus)tab.focus();
  }
  tabs.forEach((tab,index)=>{
    tab.addEventListener("click",()=>select(tab,false));
    tab.addEventListener("keydown",event=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();let next=index;
      if(event.key==="ArrowRight")next=(index+1)%tabs.length;
      if(event.key==="ArrowLeft")next=(index+tabs.length-1)%tabs.length;
      if(event.key==="Home")next=0;if(event.key==="End")next=tabs.length-1;
      select(tabs[next],true);
    });
  });
  search.addEventListener("input",render);render();
})();