/* OroNoche Supabase bridge — load after the original app scripts.
   The SQL policies/RPC are part of the security boundary; never use service_role here. */
(function () {
  const url = window.ORONOCHE_SUPABASE_URL;
  const key = window.ORONOCHE_SUPABASE_ANON_KEY;
  if (!url || !key || url.includes('YOUR_PROJECT_ID') || key.includes('YOUR_SUPABASE')) {
    // Recover if the hosting cached an older HTML file or the config script
    // was not loaded before this bridge. Resolve the config beside this file.
    const currentScript = document.currentScript;
    const bridgeUrl = currentScript && currentScript.src
      ? currentScript.src
      : new URL('./supabase-bridge.js', window.location.href).href;
    const configUrl = new URL('./supabase-config.js', bridgeUrl).href;
    const config = document.createElement('script');
    config.src = configUrl + (configUrl.includes('?') ? '&' : '?') + 'v=oronoche-fix-1';
    config.onload = function () {
      if (window.ORONOCHE_SUPABASE_URL && window.ORONOCHE_SUPABASE_ANON_KEY) {
        const retry = document.createElement('script');
        retry.src = bridgeUrl + (bridgeUrl.includes('?') ? '&' : '?') + 'retry=oronoche-fix-1';
        document.body.appendChild(retry);
      } else {
        console.error('[OroNoche] supabase-config.js loaded, but URL/key variables are missing. Check the file contents.');
      }
    };
    config.onerror = function () {
      console.error('[OroNoche] Cannot load supabase-config.js from: ' + configUrl + '. Upload it beside index_supabase.html and supabase-bridge.js.');
    };
    document.head.appendChild(config);
    return;
  }
  const start = () => {
    if (!window.supabase || !window.supabase.createClient) {
      console.error('[OroNoche] Supabase JS failed to load.');
      return;
    }
    const sb = window.supabase.createClient(url, key);
    window.oronocheSupabase = sb;
    let remoteReady = false;
    let cached = [];
    let adminMode = false;
    let remoteSnapshot = new Map();
    // Serialize writes: placeBet/creditWin can fire close together. Without a queue,
    // both saves can calculate a delta from the same old balance and race each other.
    let userSaveQueue = Promise.resolve();
    const originalGetUsers = window.getUsers || getUsers;
    const originalSaveUsers = window.saveUsers || saveUsers;
    const toApp = r => ({
      id:r.id, role:r.role, name:r.name || '', identifier:r.phone || '',
      phone:r.phone || '', saldo:Number(r.balance)||0, level:r.level||1,
      dniStatus:r.dni_status || 'Pendiente', country:r.country||'Perú',
      birthDate:r.birth_date||'', language:r.language||'Español',
      currency:r.currency||'PEN', notifications:r.notifications!==false,
      history:Array.isArray(r.history)?r.history:[], createdAt:r.created_at,
      password:''
    });
    async function loadProfiles() {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { cached=[]; remoteReady=true; return null; }
      const { data: own, error: ownErr } = await sb.from('profiles').select('*').eq('id',user.id).single();
      if (ownErr) { console.error('[OroNoche] Profile fetch failed:', ownErr); throw new Error('No se pudo leer tu perfil en Supabase: ' + ownErr.message); }
      adminMode = own.role === 'admin';
      if (adminMode) {
        const { data, error } = await sb.from('profiles').select('*').order('created_at',{ascending:false});
        if (error) { console.error('[OroNoche] Admin clients fetch failed:', error); throw new Error('No se pudieron cargar los clientes: ' + error.message); }
        cached = (data||[]).map(toApp);
        console.info('[OroNoche] Perfiles cargados para administración:', cached.length);
      } else cached = [toApp(own)];
      remoteSnapshot = new Map(cached.map(u=>[u.id, JSON.parse(JSON.stringify(u))]));
      originalSaveUsers(cached);
      remoteReady=true;
      await hydrateSideTables();
      return toApp(own);
    }
    async function hydrateSideTables() {
      try {
        const { data: tx, error: txErr } = await sb.from('transactions').select('*').order('created_at',{ascending:false});
        if (txErr) throw txErr;
        const names = new Map(cached.map(u=>[u.id,u.name]));
        localStorage.setItem('on_tx', JSON.stringify((tx||[]).map(t=>({
          id:t.id, uid:t.user_id, name:names.get(t.user_id)||'Usuario', type:t.type,
          method:t.method||'', ref:t.reference||'', amount:Number(t.amount)||0,
          status:t.status, date:t.created_at
        }))));
      } catch(e) { console.warn('[OroNoche] Could not load transactions:',e.message); }
      try {
        const { data: msgs, error: msgErr } = await sb.from('user_messages').select('*').order('created_at',{ascending:false});
        if (msgErr) throw msgErr;
        const grouped={};
        let flagsChanged=false;
        let localMessages={};
        try { localMessages=JSON.parse(localStorage.getItem('oronoche_demo_mail_v1')||'{}')||{}; } catch {}
        const localById=new Map();
        Object.entries(localMessages).forEach(([uid,list])=>(Array.isArray(list)?list:[]).forEach(m=>localById.set(String(m.id),{uid,read:!!m.read,shown:!!m.shown})));
        (msgs||[]).forEach(m=>{
          const prior=localById.get(String(m.id));
          // Once shown/read in this browser, never regress those flags because of a
          // delayed poll/realtime event.
          const isShown=!!m.shown || !!(prior && prior.shown);
          const isRead=!!m.is_read || !!(prior && prior.read);
          if ((isShown && !m.shown) || (isRead && !m.is_read)) flagsChanged=true;
          (grouped[m.user_id] ||= []).push({id:m.id,subject:m.subject,body:m.body,date:m.created_at,from:m.sender||'OroNoche',read:isRead,popup:!!m.popup,shown:isShown});
        });
        localStorage.setItem('oronoche_demo_mail_v1',JSON.stringify(grouped));
        if (flagsChanged) {
          const flagRows=[];
          Object.entries(grouped).forEach(([uid,list])=>list.forEach(m=>{ if(m.shown||m.read) flagRows.push({id:String(m.id),user_id:uid,subject:m.subject||'(Sin asunto)',body:m.body||'',sender:m.from||'OroNoche',is_read:!!m.read,popup:!!m.popup,shown:!!m.shown,date:m.date,created_at:m.date}); }));
          if(flagRows.length) {
            const {error:flagErr}=await sb.from('user_messages').upsert(flagRows.map(({date,...row})=>row),{onConflict:'id'});
            if(flagErr) console.warn('[OroNoche] Message seen-state sync failed:',flagErr.message);
          }
        }
      } catch(e) { console.warn('[OroNoche] Could not load messages:',e.message); }
    }
    window.oronocheSyncTransactions = async function(list) {
      if (!remoteReady || !Array.isArray(list)) return;
      const rows=list.filter(t=>t.uid).map(t=>({id:String(t.id),user_id:t.uid,type:t.type,method:t.method||'',reference:t.ref||'',amount:Number(t.amount)||0,status:t.status||'pending',created_at:t.date||new Date().toISOString()}));
      if (!rows.length) return;
      const {error}=await sb.from('transactions').upsert(rows,{onConflict:'id'});
      if(error) console.error('[OroNoche] Transaction sync failed:',error.message);
    };
    window.oronocheSyncMessages = async function(store) {
      if (!remoteReady || !store || typeof store!=='object') return;
      const rows=[];
      Object.entries(store).forEach(([uid,list])=>(Array.isArray(list)?list:[]).forEach(m=>rows.push({
        id:String(m.id),user_id:uid,subject:m.subject||'(Sin asunto)',body:m.body||'',sender:m.from||'OroNoche',
        is_read:!!m.read,popup:!!m.popup,shown:!!m.shown,created_at:m.date||new Date().toISOString()
      })));
      if (!rows.length) return;
      // Existing message flags are monotonic: once read/shown, never reset by a stale
      // local snapshot from another poll/tab. Insert new rows, update only mutable content
      // and set flags with logical OR against the current server value.
      for (const row of rows) {
        const {data: existing, error: readError}=await sb.from('user_messages')
          .select('id,is_read,shown').eq('id',row.id).maybeSingle();
        if (readError) { console.warn('[OroNoche] Message state read failed:',readError.message); continue; }
        if (!existing) {
          const {error}=await sb.from('user_messages').insert(row);
          if(error && error.code!=='23505') console.error('[OroNoche] Message insert failed:',error.message);
          continue;
        }
        const {error}=await sb.from('user_messages').update({
          subject:row.subject, body:row.body, sender:row.sender, popup:row.popup,
          is_read:!!existing.is_read || row.is_read,
          shown:!!existing.shown || row.shown
        }).eq('id',row.id);
        if(error) console.error('[OroNoche] Message update failed:',error.message);
      }
    };

    function appGetUsers(){ return cached.length ? cached : originalGetUsers(); }
    async function appSaveUsersNow(arr) {
      originalSaveUsers(arr);
      if (!remoteReady || !Array.isArray(arr)) return;
      const previous = remoteSnapshot;
      const nextIds = new Set(arr.map(u=>u.id));
      if (adminMode) {
        for (const oldId of previous.keys()) {
          if (!nextIds.has(oldId)) {
            const { error } = await sb.rpc('admin_delete_user', { p_user_id: oldId });
            if (error) { console.error('[OroNoche] User deletion failed:', error.message); if (window.toast) toast('No se pudo eliminar la cuenta: '+error.message,'error'); }
            else remoteSnapshot.delete(oldId);
          }
        }
      }
      cached = arr;
      for (const u of arr) {
        const old = previous.get(u.id);
        if (!old) continue; // New accounts must be created by Supabase Auth.
        if (adminMode) {
          const changed = !old || Number(old.saldo)!==Number(u.saldo) || old.name!==u.name ||
            Number(old.level)!==Number(u.level) || old.dniStatus!==u.dniStatus ||
            JSON.stringify(old.history||[])!==JSON.stringify(u.history||[]);
          if (changed) {
            const { error } = await sb.rpc('admin_update_profile', {
              p_user_id:u.id, p_name:u.name||null, p_phone:u.identifier||null,
              p_balance:Number(u.saldo)||0, p_level:Number(u.level)||1,
              p_dni_status:u.dniStatus||'Pendiente', p_history:u.history||[]
            });
            if (error) { console.error('[OroNoche] Admin profile update failed:',error.message); if (window.toast) toast('No se guardó el cambio del cliente: '+error.message,'error'); }
            else remoteSnapshot.set(u.id, JSON.parse(JSON.stringify(u)));
          }
        } else if (u.id === old.id) {
          // Persist game balance changes as a server-side atomic delta. Never overwrite
          // the balance with a stale client snapshot.
          const delta = Math.round((Number(u.saldo||0) - Number(old.saldo||0)) * 100) / 100;
          if (delta !== 0) {
            const { data: newBalance, error: balanceError } = await sb.rpc('apply_user_balance_delta', {
              p_delta: delta,
              p_event: 'Juego',
              p_detail: delta < 0 ? `Apuesta: ${Math.abs(delta).toFixed(2)} soles` : `Premio: ${delta.toFixed(2)} soles`
            });
            if (balanceError) {
              console.error('[OroNoche] Game balance sync failed:', balanceError.message);
              // Restore the last server-known balance so the UI cannot pretend a failed
              // transaction was saved.
              u.saldo = Number(old.saldo)||0;
              originalSaveUsers(arr.map(x=>x.id===u.id?u:x));
              if (window.toast) toast('No se pudo guardar el saldo. Actualiza la página e inténtalo de nuevo.','error');
            } else {
              u.saldo = Number(newBalance);
              remoteSnapshot.set(u.id, JSON.parse(JSON.stringify(u)));
            }
          }
          // User-safe columns only; balance/history/role cannot be written directly.
          const patch = {};
          if (old.name!==u.name) patch.name=u.name;
          if (old.country!==u.country) patch.country=u.country;
          if (old.birthDate!==u.birthDate) patch.birth_date=u.birthDate||'';
          if (old.language!==u.language) patch.language=u.language||'Español';
          if (old.currency!==u.currency) patch.currency=u.currency||'PEN';
          if (old.notifications!==u.notifications) patch.notifications=u.notifications!==false;
          if (Object.keys(patch).length) {
            const { error } = await sb.from('profiles').update(patch).eq('id',u.id);
            if (error) console.error('[OroNoche] Profile save failed:',error.message);
            else remoteSnapshot.set(u.id, JSON.parse(JSON.stringify(u)));
          }
        }
      }
    }
    function appSaveUsers(arr) {
      // Preserve the UI's synchronous local update, but serialize all server writes.
      originalSaveUsers(arr);
      const snapshot = JSON.parse(JSON.stringify(arr));
      userSaveQueue = userSaveQueue.then(() => appSaveUsersNow(snapshot)).catch(err => {
        console.error('[OroNoche] Queued profile save failed:', err);
      });
      return userSaveQueue;
    }
    // Replace the global function bindings used by the existing app.
    try { getUsers = appGetUsers; saveUsers = appSaveUsers; } catch(e) {}
    window.getUsers = appGetUsers;
    window.saveUsers = appSaveUsers;

    function setBusy(on) {
      const b=document.querySelector('#authForm button[type="submit"]');
      if (b) { b.disabled=on; b.dataset.oldText ||= b.textContent; b.textContent=on?'Conectando…':b.dataset.oldText; }
    }
    async function authHandler(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const identifierEl=document.getElementById('identifier');
      const passEl=document.getElementById('password');
      const nameEl=document.getElementById('fullName');
      let phone=String(identifierEl?.value||'').trim();
      const password=String(passEl?.value||'');
      const name=String(nameEl?.value||'').trim();
      // Admin and player accounts must both authenticate through Supabase.
      // A local-only admin session cannot pass server-side RLS/RPC checks.
      const digits=phone.replace(/\D/g,'');
      if (!phone.startsWith('+') && digits.length===9) phone='+51'+digits;
      if (!phone || !password) { if(window.toast) toast('Introduce tus datos.','warn'); return; }
      setBusy(true);
      try {
        // Map the legacy admin username to a real Supabase Auth account.
        // Create admin@accounts.oronoche.com once and promote it using admin_account_setup.sql.
        const isLegacyAdmin = phone.toLowerCase() === 'admin';
        if (isLegacyAdmin && (window.authMode === 'register' || (document.getElementById('nameField') && !document.getElementById('nameField').classList.contains('hidden')))) {
          throw new Error('La cuenta admin solo puede iniciar sesión. Créala en Supabase Authentication y asígnale el rol admin con el SQL incluido.');
        }
        const usernameEmail = isLegacyAdmin
          ? 'admin@accounts.oronoche.com'
          : 'phone-' + phone.replace(/\\D/g, '') + '@accounts.oronoche.com';
        if (window.authMode === 'register' || document.getElementById('nameField') && !document.getElementById('nameField').classList.contains('hidden')) {
          if (!name) throw new Error('Introduce tu nombre completo.');
          const { data, error } = await sb.auth.signUp({
            email: usernameEmail,
            password,
            options: { data: { name, phone } }
          });
          if (error) throw error;
          if (!data.session) {
            throw new Error('La cuenta se creó, pero Supabase exige confirmación por email. En Supabase abre Authentication → Sign In / Providers → Email y desactiva Confirm email. También comprueba que esté permitido registrar nuevos usuarios.');
          }
          const profile = await loadProfiles();
          if (!profile) throw new Error('No se pudo cargar el perfil.');
          startRealtime();
          currentUser={role:profile.role,id:profile.id};
          try { localStorage.setItem('oronoche_demo_session_v2',JSON.stringify(currentUser)); } catch {}
          if (typeof syncHeader==='function') syncHeader();
          if (profile.role==='admin') { renderAdmin(); showOnly('admin'); }
          else { renderCasino(); showOnly('casino'); }
          toast('Cuenta creada. Bono de bienvenida: S/ 100.00');
          setTimeout(()=>{ if(typeof showReward==='function') showReward(100,{eyebrow:'Bono de bienvenida',title:'¡Bienvenido a OroNoche!',sub:'Tu bono de bienvenida de S/ 100.00 se ha acreditado en el saldo.'}); },400);
        } else {
          const { data, error } = await sb.auth.signInWithPassword({email: usernameEmail, password});
          if (error) throw error;
          const profile = await loadProfiles();
          if (!profile) throw new Error('No existe el perfil del usuario.');
          startRealtime();
          currentUser={role:profile.role,id:profile.id};
          try { localStorage.setItem('oronoche_demo_session_v2',JSON.stringify(currentUser)); } catch {}
          if (typeof syncHeader==='function') syncHeader();
          if (profile.role==='admin') { renderAdmin(); showOnly('admin'); }
          else { renderCasino(); showOnly('casino'); }
          toast('Sesión iniciada desde Supabase.');
        }
      } catch(err) {
        console.error('[OroNoche] Auth error:',err);
        toast(err.message || 'No se pudo conectar con Supabase.','error');
      } finally { setBusy(false); }
    }
    const form=document.getElementById('authForm');
    if(form) form.addEventListener('submit',authHandler,true);

    // Passwords are never available from Supabase Auth (only secure hashes exist).
    // Keep the admin table useful without pretending the plaintext password can be retrieved.
    const originalRenderAdmin=window.renderAdmin || renderAdmin;
    try {
      renderAdmin = function() {
        originalRenderAdmin();
        const table=document.querySelector('#usersTable');
        if (!table) return;
        const headers=document.querySelectorAll('#admin .users-tbl thead th');
        if(headers[2]) headers[2].textContent='Acceso';
        table.querySelectorAll('tr').forEach(tr=>{
          const cell=tr.children[2];
          if(cell) cell.innerHTML='<span class="pill">Contraseña protegida</span>';
        });
      };
      window.renderAdmin=renderAdmin;
    } catch(e) {}

    // Refresh admin/player data across devices. Realtime is preferred; polling is a fallback.
    let refreshInFlight=false;
    async function refreshRemoteData() {
      if (refreshInFlight || !remoteReady) return;
      refreshInFlight=true;
      try {
        const profile=await loadProfiles();
        if (!profile) return;
        if (adminMode) {
          if (typeof renderAdmin==='function') renderAdmin();
        } else if (currentUser && currentUser.id===profile.id) {
          currentUser={role:profile.role,id:profile.id};
          if (typeof syncHeader==='function') syncHeader();
          if (typeof renderCasino==='function' && document.body.dataset.view==='casino') renderCasino();
          if (typeof mailTick==='function') mailTick();
        }
      } catch(err) { console.warn('[OroNoche] Background refresh failed:',err.message); }
      finally { refreshInFlight=false; }
    }
    window.oronocheRefresh=refreshRemoteData;
    let realtimeChannel=null;
    function startRealtime() {
      if (realtimeChannel) sb.removeChannel(realtimeChannel);
      realtimeChannel=sb.channel('oronoche-live-sync')
        .on('postgres_changes',{event:'*',schema:'public',table:'profiles'},()=>refreshRemoteData())
        .on('postgres_changes',{event:'*',schema:'public',table:'user_messages'},()=>refreshRemoteData())
        .on('postgres_changes',{event:'*',schema:'public',table:'transactions'},async()=>{
          await hydrateSideTables();
          if (typeof renderAdminTx==='function' && adminMode) renderAdminTx();
        })
        .subscribe(status=>{ if(status==='CHANNEL_ERROR') console.warn('[OroNoche] Realtime unavailable; polling remains active.'); });
    }
    setInterval(()=>{ if(remoteReady) refreshRemoteData(); },10000);

    // Restore a Supabase session on page refresh.
    (async()=>{
      try {
        const {data:{session}}=await sb.auth.getSession();
        if(!session) {
          currentUser=null; cached=[]; remoteReady=false;
          try { sessionStorage.removeItem('oronoche_demo_session_v2'); localStorage.removeItem('oronoche_demo_session_v2'); } catch {}
          if(typeof syncHeader==='function') syncHeader();
          if(typeof showOnly==='function') showOnly(location.hash==='#admin'?'auth':'home');
          return;
        }
        const profile=await loadProfiles();
        if(!profile) return;
        startRealtime();
        currentUser={role:profile.role,id:profile.id};
        if(typeof syncHeader==='function') syncHeader();
        if(profile.role==='admin'){renderAdmin();showOnly('admin');}
        else {renderCasino();showOnly('casino');}
      } catch(err) {
        console.error('[OroNoche] Session restore failed:',err);
        if(window.toast) toast('No se pudo cargar tu perfil desde Supabase.','error');
      }
    })();

    // Logout must invalidate the server session too.
    const oldLogout=window.logout || logout;
    try {
      logout = async function() {
        await sb.auth.signOut();
        currentUser=null; cached=[]; remoteReady=false;
        try { sessionStorage.removeItem('oronoche_demo_session_v2'); localStorage.removeItem('oronoche_demo_session_v2'); } catch {}
        if(typeof syncHeader==='function') syncHeader();
        if(typeof showOnly==='function') showOnly('home');
      };
      window.logout=logout;
    } catch(e) {}
  };
  const loadSupabase = () => {
    if (window.supabase && window.supabase.createClient) return start();
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.onload=start;
    s.onerror=()=>console.error('[OroNoche] Could not load Supabase JS.');
    document.head.appendChild(s);
  };
  const cfg=document.createElement('script');
  cfg.src='./supabase-config.js';
  cfg.onload=loadSupabase;
  cfg.onerror=()=>console.error('[OroNoche] Missing supabase-config.js');
  document.head.appendChild(cfg);
})();