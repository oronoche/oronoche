/* ===== PRO UI v2 · utilidades ===== */
function togglePw(){const i=$('password'),b=$('pwEye');if(!i||!b)return;const show=i.type==='password';i.type=show?'text':'password';
  b.innerHTML=ic(show?'eyeoff':'eye');b.setAttribute('aria-label',show?'Ocultar contraseña':'Mostrar contraseña')}
function footGo(k){const v=document.body.dataset.view;if(v!=='home'&&v!=='casino'){showOnly('home');setTimeout(()=>goProduct(k),160)}else goProduct(k)}
(function(){
  const y=$('yr');if(y)y.textContent=new Date().getFullYear();
  const btns=[...document.querySelectorAll('.pnav button[data-k]')];
  const idFor=k=>(document.body.dataset.view==='casino'&&k!=='extra'&&k!=='pagos'?'c-':'h-')+k;
  function upd(){
    const v=document.body.dataset.view;if(v!=='home'&&v!=='casino')return;
    const hd=document.querySelector('.site-head');const line=window.scrollY+(hd?hd.offsetHeight:120)+60;let cur=null;
    btns.forEach(b=>{const e=document.getElementById(idFor(b.dataset.k));if(e&&e.offsetParent!==null&&e.getBoundingClientRect().top+window.scrollY<=line)cur=b});
    btns.forEach(b=>b.classList.toggle('on',b===cur));
  }
  window.addEventListener('scroll',upd,{passive:true});window.addEventListener('resize',upd);upd();
})();
