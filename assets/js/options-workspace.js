/* Presentation controls only. Strategy, sizing and quotes stay in the desk engine. */
(()=>{
 const capital=document.getElementById('capital');
 document.querySelectorAll('[data-capital]').forEach(button=>button.addEventListener('click',()=>{
  capital.value=button.dataset.capital;
  capital.dispatchEvent(new Event('input',{bubbles:true}));
  capital.dispatchEvent(new Event('change',{bubbles:true}));
  capital.focus();
 }));
})();
