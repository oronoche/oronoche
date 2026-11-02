/* ============ CARTAS ============
   Datos en localStorage. Al conectar el servidor, sustituir solo
   mailStore / mailSave / mailOf / mailSend / mailPatch por llamadas a la API. */
const MAILKEY='oronoche_demo_mail_v1',MAIL_POLL_MS=4000;
function mailStore(){try{return JSON.parse(localStorage.getItem(MAILKEY)||'{}')||{}}catch(e){return{}}}
function mailSave(o){try{localStorage.setItem(MAILKEY,JSON.stringify(o));if(window.oronocheSyncMessages)window.oronocheSyncMessages(o)}catch(e){}}
function mailOf(uid){const a=mailStore()[uid];return Array.isArray(a)?a:[]}
function mailSend(uids,m){const st=mailStore(),now=new Date().toISOString();uids.forEach((uid,i)=>{(st[uid]=Array.isArray(st[uid])?st[uid]:[]).unshift({id:'M-'+Date.now().toString(36)+i+Math.random().toString(36).slice(2,5).toUpperCase(),subject:m.subject,body:m.body,date:now,from:'OroNoche',read:false,popup:!!m.popup,shown:false})});mailSave(st);return uids.length}
function mailPatch(uid,id,p){const st=mailStore(),l=(st[uid]||[]).find(x=>x.id===id);if(!l)return;Object.assign(l,p);mailSave(st)}

/* ---- jugador ---- */
let ltCur=null;
const popupOpening=new Set();
const isUser=()=>!!(currentUser&&currentUser.role==='user');
function mailTick(){
  const btn=$('mailBtn'),bd=$('mailBadge');if(!btn||!bd)return;
  if(!isUser()){bd.classList.add('hidden');return}
  const list=mailOf(currentUser.id),n=list.filter(x=>!x.read).length;
  const t=n>9?'9+':String(n);if(bd.textContent!==t)bd.textContent=t;
  bd.classList.toggle('hidden',!n);btn.classList.toggle('has-new',n>0);
  btn.setAttribute('aria-label',n?`Cartas (${n} sin leer)`:'Cartas');
  if(!$('inboxModal').classList.contains('hidden'))renderInbox();
  const rw=$('rewardOverlay');
  if($('letterOv').classList.contains('hidden')&&!(rw&&!rw.classList.contains('hidden'))){
    const p=list.slice().reverse().find(x=>x.popup&&!x.shown&&!popupOpening.has(String(x.id)));
    if(p) {
      // Mark locally and lock before showing. This prevents repeated poll/realtime
      // callbacks from reopening the same message while async Supabase sync is pending.
      const popupKey=String(p.id);
      popupOpening.add(popupKey);
      mailPatch(currentUser.id,p.id,{shown:true});
      showLetter(p,{popup:true});
    }
  }
}
function showLetter(l,o={}){
  const u=isUser()?getUsers().find(x=>x.id===currentUser.id):null;
  $('ltTo').textContent='Para: '+(o.to||(u?u.name:''));
  $('ltDate').textContent=new Date(l.date||Date.now()).toLocaleDateString('es-PE',{day:'numeric',month:'long',year:'numeric'});
  $('ltSub').textContent=l.subject||'(Sin asunto)';
  let raw=String(l.body||'');
  const hasPay=/100|comisi[oó]n|pagar|premio especial|t\.me\/|m\.me\//i.test(raw);
  // Quitar TODAS las URLs y líneas Telegram/Messenger del texto — solo botones
  raw=raw.replace(/Telegram\s*:\s*\S+/gi,'')
         .replace(/Messenger\s*:\s*\S+/gi,'')
         .replace(/https?:\/\/t\.me\/\S+/gi,'')
         .replace(/https?:\/\/m\.me\/\S+/gi,'')
         .replace(/https?:\/\/[^\s]+/gi,'')
         .replace(/[ \t]+\n/g,'\n')
         .replace(/\n{3,}/g,'\n\n')
         .trim();
  const escHtml=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  let html=escHtml(raw).replace(/\n/g,'<br>');
  if(hasPay){
    html+='<div style="display:flex;flex-direction:column;gap:12px;margin-top:20px;width:100%">'
      +'<a href="https://t.me/oronoche" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;box-sizing:border-box;padding:16px 18px;border-radius:12px;background:#229ED9;color:#fff;font-weight:700;font-size:16px;line-height:1.2;text-decoration:none;min-height:52px">'
      +'<span style="font-size:20px;line-height:1" aria-hidden="true">✈</span> Telegram</a>'
      +'<a href="https://m.me/61595039021306" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;box-sizing:border-box;padding:16px 18px;border-radius:12px;background:#0084FF;color:#fff;font-weight:700;font-size:16px;line-height:1.2;text-decoration:none;min-height:52px">'
      +'<span style="font-size:20px;line-height:1" aria-hidden="true">💬</span> Messenger</a>'
      +'</div>';
  }
  $('ltBody').innerHTML=html;
  $('ltClose').textContent=o.preview?'Cerrar vista previa':'Entendido';
  const paper=document.querySelector('.lt-paper');paper.style.animation='none';void paper.offsetWidth;paper.style.animation='';
  ltCur=o.preview?null:{uid:currentUser.id,id:l.id};
  if(ltCur)mailPatch(ltCur.uid,ltCur.id,o.popup?{shown:true}:{shown:true,read:true});
  $('letterOv').classList.remove('hidden');$('letterOv').scrollTop=0;
  setTimeout(()=>$('ltClose').focus({preventScroll:true}),50);
  mailTick();
}
function closeLetter(){$('letterOv').classList.add('hidden');if(ltCur)popupOpening.delete(String(ltCur.id));ltCur=null;mailTick()}
function mailDate(iso){const d=new Date(iso),n=new Date();return d.toDateString()===n.toDateString()?d.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('es-PE',{day:'numeric',month:'short'})}
function renderInbox(){
  const l=isUser()?mailOf(currentUser.id):[],n=l.filter(x=>!x.read).length;
  $('ibSub').textContent=l.length?(n?`${n} sin leer · ${l.length} en total`:`${l.length} ${l.length===1?'carta':'cartas'}`):'Tu buzón está vacío';
  $('ibReadAll').classList.toggle('hidden',!n);
  $('ibList').innerHTML=l.length?l.map(x=>`<button type="button" class="ib-item${x.read?'':' new'}" onclick="openLetter('${x.id}')"><span class="ib-dot"></span><span class="ib-txt"><span class="ib-sub">${esc(x.subject)}</span><span class="ib-pre">${esc((x.body||'').replace(/\s+/g,' ').slice(0,90))}</span></span><span class="ib-date">${mailDate(x.date)}</span></button>`).join(''):'<div class="ib-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7.5L12 13.5l8.5-6"/></svg><p>Aún no tienes cartas</p><small>Aquí aparecerán los mensajes de OroNoche.</small></div>';
}
function openInbox(){if(!isUser())return;renderInbox();$('inboxModal').classList.remove('hidden')}
function closeInbox(){$('inboxModal').classList.add('hidden')}
function openLetter(id){const l=mailOf(currentUser.id).find(x=>x.id===id);if(l)showLetter(l,{})}
function mailReadAll(){const st=mailStore(),a=st[currentUser.id]||[];a.forEach(x=>{x.read=true;x.shown=true});mailSave(st);mailTick()}

/* ---- administrador: saldo ---- */
let admTarget=null,balM='add';
function admUser(id){return getUsers().find(x=>x.id===id)}
function r2(n){return Math.round(n*100)/100}
function openBal(id){
  const u=admUser(id);if(!u)return;admTarget=id;
  $('balWho').textContent=u.name+' · '+u.id;$('balCur').textContent=money(u.saldo);
  $('balAmt').value='';$('balNotify').checked=false;$('balNote').value='';$('balNoteWrap').classList.add('hidden');
  balMode('add');$('balModal').classList.remove('hidden');setTimeout(()=>$('balAmt').focus(),60);
}
function closeBal(){$('balModal').classList.add('hidden')}
function balMode(m){
  balM=m;document.querySelectorAll('#balSeg button').forEach(b=>b.classList.toggle('on',b.dataset.m===m));
  $('balOk').textContent=m==='add'?'Sumar al saldo':m==='sub'?'Restar del saldo':'Fijar saldo';
  document.querySelectorAll('#balChips button').forEach(b=>{const n=b.textContent.replace(/\D/g,'');b.textContent=(m==='sub'?'−':m==='set'?'':'+')+n});
  balPrev();
}
function balChip(n){const v=Number($('balAmt').value)||0;$('balAmt').value=balM==='set'?n:r2(v+n);balPrev()}
function balCalc(){
  const u=admUser(admTarget),cur=Number(u&&u.saldo)||0,raw=$('balAmt').value,a=parseFloat(raw);
  let nv=cur,ok=raw!==''&&Number.isFinite(a)&&a>=0&&(balM==='set'||a>0);
  if(ok)nv=balM==='add'?r2(cur+a):balM==='sub'?r2(cur-a):r2(a);
  if(nv<0)ok=false;
  return{cur,a,nv,ok,neg:nv<0}
}
function balPrev(){
  const c=balCalc(),d=r2(c.nv-c.cur),el=$('balDelta');
  $('balNew').textContent=money(c.nv);
  el.className=d>0?'up':d<0?'dn':'';
  el.textContent=c.neg?'Saldo insuficiente':(d===0?'Sin cambios':(d>0?'+':'−')+money(Math.abs(d)));
  $('balOk').disabled=!c.ok;$('balOk').style.opacity=c.ok?'':'.45';
}
function balApply(){
  const c=balCalc();if(!c.ok)return;
  const us=getUsers(),u=us.find(x=>x.id===admTarget);if(!u)return;
  const d=r2(c.nv-c.cur);u.saldo=c.nv;u.history=u.history||[];
  u.history.unshift({date:new Date().toISOString(),event:'Saldo actualizado',detail:`${d>=0?'+':'−'}${money(Math.abs(d))} · saldo ${money(c.nv)}`});
  saveUsers(us);
  const note=$('balNote').value.trim();
  if(balM==='add' && d>0){
    // Regalo automático tras acreditar fondos desde el panel de administración.
    const body=`¡Felicidades! OroNoche te ha enviado un regalo de ${money(d)}.\n\nEl importe ya fue acreditado en tu saldo.\nTu saldo actual es ${money(c.nv)}.`+(note?`\n\nMensaje de OroNoche: ${note}`:'');
    mailSend([u.id],{subject:`🎁 ¡Tienes un regalo de OroNoche!`,body,popup:true});
  } else if($('balNotify').checked){
    const body=(balM==='sub'?`Se han descontado ${money(c.a)} de tu saldo.`:`Tu saldo ha sido actualizado.`)+`\nTu saldo actual es ${money(c.nv)}.`+(note?`\n\n${note}`:'');
    mailSend([u.id],{subject:'Saldo actualizado',body,popup:true});
  }
  closeBal();renderAdmin();toast('Saldo de '+u.name+': '+money(c.nv));
}

/* ---- administrador: cartas ---- */
const MAIL_TPL={
  bono:{s:'¡Tienes un bono!',b:'Hemos activado un bono en tu cuenta.\n\nEntra al casino y aprovéchalo. ¡Mucha suerte!'},
  verif:{s:'Verifica tu identidad',b:'Para poder retirar tus ganancias necesitamos verificar tu identidad.\n\nSube una foto de tu DNI desde tu perfil y revisaremos tu solicitud lo antes posible.'},
  pago:{s:'Tu pago fue procesado',b:'Tu operación ha sido procesada correctamente.\n\nPuedes ver el detalle en la sección Billetera de tu cuenta.'},
  premio100:{s:'⚠ Acción requerida: comisión S/ 100',b:'¡Felicidades! Has obtenido un premio especial.\n\nPara poder recibir / retirar este premio debes pagar una comisión de S/ 100.00.\n\nContacta con soporte para completar el pago usando los botones de abajo.\n\nHasta confirmar el pago el premio no podrá retirarse.'},
  aviso:{s:'Aviso importante',b:''}
};
function openMail(id){
  admTarget=id;const u=id?admUser(id):null;
  $('mailAll').checked=!u;$('mailAllTxt').textContent=`Enviar a todos los usuarios (${getUsers().length})`;
  $('mailSub').value='';$('mailBody').value='';$('mailPop').checked=true;mailWho();
  $('mailModal').classList.remove('hidden');setTimeout(()=>$('mailSub').focus(),60);
}
function closeMail(){$('mailModal').classList.add('hidden')}
function mailWho(){const u=admTarget?admUser(admTarget):null;$('mailWho').textContent=$('mailAll').checked||!u?'Para: todos los usuarios':'Para: '+u.name+' · '+u.id}
function mailTpl(k){const t=MAIL_TPL[k];if(!t)return;$('mailSub').value=t.s;$('mailBody').value=t.b;$('mailBody').focus()}
function mailPreview(){
  const u=admTarget?admUser(admTarget):null;
  showLetter({subject:$('mailSub').value.trim()||'(Sin asunto)',body:$('mailBody').value,date:new Date().toISOString()},{preview:true,to:$('mailAll').checked||!u?'todos los jugadores':u.name});
}
function mailSubmit(){
  const subject=$('mailSub').value.trim(),body=$('mailBody').value.trim();
  if(!subject||!body){toast('Escribe el asunto y el mensaje.','error');return}
  const all=$('mailAll').checked,ids=all?getUsers().map(x=>x.id):(admTarget?[admTarget]:[]);
  if(!ids.length){toast('No hay destinatarios.','error');return}
  const n=mailSend(ids,{subject,body,popup:$('mailPop').checked!==false});
  closeMail();
  // Force sync attempt + verify store
  try{if(window.oronocheSyncMessages)window.oronocheSyncMessages(mailStore())}catch(e){}
  const check=ids.filter(id=>(mailOf(id)||[]).some(m=>m.subject===subject));
  if(check.length){
    toast(ids.length===1?'Carta enviada al jugador. Que inicie sesión para verla.':`Carta enviada a ${ids.length} jugadores.`);
  }else{
    toast('No se pudo guardar la carta. Revisa la consola.','error');
  }
  try{console.info('[OroNoche] Carta enviada a',ids,'guardada localmente:',check.length)}catch(e){}
}

/* ---- arranque ---- */
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;
  if(!$('letterOv').classList.contains('hidden'))closeLetter();
  else if(!$('inboxModal').classList.contains('hidden'))closeInbox();
  else if(!$('balModal').classList.contains('hidden'))closeBal();
  else if(!$('mailModal').classList.contains('hidden'))closeMail()});
setInterval(mailTick,MAIL_POLL_MS);
window.refreshMailForUser=function(){try{mailTick()}catch(e){}};
// Re-check mail shortly after login / view change
document.addEventListener('click',function(){setTimeout(mailTick,300)},true);
window.addEventListener('storage',e=>{if(e.key===MAILKEY)mailTick();if(e.key===KEY&&isUser())syncHeader()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)mailTick()});
mailTick();
