(function(){
  const CFG = window.APP_CONFIG || {};
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString('th-TH');
  const sgn = n => (n>0?'+':n<0?'−':'') + fmt(Math.abs(n));
  const pct = (a,b) => b ? (a/b*100).toFixed(1)+'%' : '–';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = x => { const n = parseFloat(x); return isFinite(n) && n > 0 ? n : 0; };
  const clone = o => JSON.parse(JSON.stringify(o));

  const LAST_KEY = 'kaoiyok-last-scenario';

  // ---------- defaults ----------
  const SCALARS = {
    pCare1:4000, pCare2:6000,
    nCare1:5, nCare2:0,
    staffN:4, staffSal:15000,
    food:4500, otherPct:5,
    cardFee:1.6, inst3:3, inst6:5, inst10:7,
    tax:20, invest:2000000
  };
  const INT_KEYS = ['nCare1','nCare2','staffN'];
  const INT_FIELDS = ['months','limit','n','beds','nm','nq','nh'];
  const newId = () => 'r' + Math.random().toString(36).slice(2, 9);
  const DEFAULTS = Object.assign({}, SCALARS, {
    rooms: [
      {id:'r6', name:'ห้องรวม 6 เตียง', beds:6, pm:25000, pq:23500, ph:22500, nm:0, nq:3, nh:0},
      {id:'r4', name:'ห้องรวม 4 เตียง', beds:4, pm:27000, pq:25500, ph:24500, nm:0, nq:4, nh:0}
    ],
    fixed: [
      {name:'ค่าเช่า', amount:52632},
      {name:'เงินเดือนผู้จัดการ', amount:20000},
      {name:'ค่าไฟ', amount:12000},
      {name:'ค่าน้ำ', amount:1000},
      {name:'ค่าทำบัญชี', amount:4500},
      {name:'อินเทอร์เน็ต', amount:500},
      {name:'โทรศัพท์ (True)', amount:1200},
      {name:'การตลาดและโปรโมท', amount:20000}
    ],
    promos: [
      {id:'p1', name:'โปรเปิดศูนย์', months:3, prepaid:true, limit:3, afterPlan:'q', rooms:{r6:{n:3, price:19900}, r4:{n:0, price:19900}}}
    ],
    pay: {}   // per-resident payment: {'<group>#<k>': {m:'card', name:'คุณสมศรี'}}
  });
  const NEW_FIXED = () => ({name:'', amount:0});
  const NEW_PROMO = () => ({id:newId(), name:'โปรใหม่', months:3, prepaid:true, limit:0, afterPlan:'q', rooms:{}});
  // which normal room price promo residents continue on after the promo ends
  const AFTER_PLANS = {m:'รายเดือน', q:'จ่ายล่วงหน้า 3 เดือน', h:'จ่ายล่วงหน้า 6 เดือน'};
  const NEW_ROOM = () => {
    const last = state.rooms[state.rooms.length - 1] || {};
    return {id:newId(), name:'ห้องใหม่', beds:2, pm:last.pm||0, pq:last.pq||0, ph:last.ph||0, nm:0, nq:0, nh:0};
  };
  // a promo's residents and promo price for one room; the after-promo price
  // follows that room's normal price for the promo's chosen plan
  const promoRoom = (p, r) => {
    const e = p.rooms[r.id] || {};
    return {n: e.n || 0, price: e.price || 0, after: r['p' + p.afterPlan] || 0};
  };
  const int = x => Math.round(num(x));
  const VAT = 0.07;
  const PAY_METHODS = {cash:'โอน / เงินสด', card:'รูดบัตรเครดิต', i3:'ผ่อน 0% 3 เดือน', i6:'ผ่อน 0% 6 เดือน', i10:'ผ่อน 0% 10 เดือน'};
  // fee the bank keeps per baht charged, VAT on the fee included
  const payRate = (v, m) => ({card:v.cardFee, i3:v.inst3, i6:v.inst6, i10:v.inst10}[m] || 0)/100 * (1 + VAT);

  function normalize(d){
    d = d || {};
    const s = Object.assign(clone(DEFAULTS), d);
    for (const k in SCALARS) s[k] = num(s[k]);
    INT_KEYS.forEach(k => s[k] = Math.round(s[k]));
    // older saves had fixed 6-bed / 4-bed rooms stored as flat keys
    if (!Array.isArray(d.rooms)){
      s.rooms = 'p6m' in d ? [
        {id:'r6', name:'ห้องรวม 6 เตียง', beds:6, pm:d.p6m, pq:d.p6q, ph:d.p6h, nm:d.n6m, nq:d.n6q, nh:d.n6h},
        {id:'r4', name:'ห้องรวม 4 เตียง', beds:4, pm:d.p4m, pq:d.p4q, ph:d.p4h, nm:d.n4m, nq:d.n4q, nh:d.n4h}
      ] : clone(DEFAULTS.rooms);
    }
    s.rooms = s.rooms.map(r => ({id:String(r.id || newId()), name:String(r.name || ''), beds:int(r.beds),
      pm:num(r.pm), pq:num(r.pq), ph:num(r.ph), nm:int(r.nm), nq:int(r.nq), nh:int(r.nh)}));
    s.fixed = Array.isArray(s.fixed) ? s.fixed.map(x => ({name:String(x.name||''), amount:num(x.amount)})) : clone(DEFAULTS.fixed);
    s.promos = Array.isArray(s.promos) ? s.promos.map(p => {
      const rooms = p.rooms && typeof p.rooms === 'object' ? p.rooms
        : {r6:{n:p.n6, after:p.after6}, r4:{n:p.n4, after:p.after4}};
      const clean = {};
      for (const id in rooms){
        const e = rooms[id] || {};
        clean[id] = {n:int(e.n)};
        if (e.price != null) clean[id].price = num(e.price);
      }
      // older saves typed an after-promo price per room: pick the plan whose price matches
      let afterPlan = AFTER_PLANS[p.afterPlan] ? p.afterPlan : null;
      if (!afterPlan){
        const typed = s.rooms.map(r => [r, rooms[r.id] && rooms[r.id].after]).filter(x => x[1] != null);
        afterPlan = ['q','m','h'].find(k => typed.length && typed.every(([r, a]) => num(a) === r['p' + k])) || 'q';
      }
      // older saves had one promo price for every room
      if (p.price != null) s.rooms.forEach(r => {
        const e = clean[r.id] || (clean[r.id] = {n:0});
        if (e.price == null) e.price = num(p.price);
      });
      return {id:String(p.id || newId()), name:String(p.name||''), months:int(p.months), prepaid:p.prepaid !== false, limit:int(p.limit), afterPlan, rooms:clean};
    }) : clone(DEFAULTS.promos);
    const pay = {};
    if (s.pay && typeof s.pay === 'object') for (const k in s.pay){
      const e = s.pay[k] || {};
      pay[k] = {m: PAY_METHODS[e.m] ? e.m : 'cash', name: String(e.name || '')};
    }
    s.pay = pay;
    delete s.cardShare;
    return s;
  }

  // ---------- state ----------
  let state = normalize();
  let user = null;
  let scenarios = [];      // [{id,name,updated_at}]
  let currentId = null;
  let saveTimer = null, saving = false, dirty = false;

  // ======================================================
  // AUTH
  // ======================================================
  let authMode = 'login';
  function setAuthMode(m){
    authMode = m;
    const signup = m === 'signup';
    $('authTitle').textContent = signup ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ';
    $('authSubmit').textContent = signup ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ';
    $('authPass').autocomplete = signup ? 'new-password' : 'current-password';
    $('authSwitch').innerHTML = signup
      ? 'มีบัญชีแล้ว? <button type="button" class="linkbtn" id="toLogin">เข้าสู่ระบบ</button>'
      : 'ยังไม่มีบัญชี? <button type="button" class="linkbtn" id="toSignup">สมัครสมาชิก</button>';
    authMsg('');
  }
  function authMsg(text, kind){
    const el = $('authMsg');
    el.hidden = !text; el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }
  function thaiAuthError(e){
    const m = (e && e.message) || String(e);
    if (/invalid login credentials/i.test(m)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
    if (/email not confirmed/i.test(m)) return 'ยังไม่ได้ยืนยันอีเมล กรุณากดลิงก์ในอีเมลที่ได้รับก่อน';
    if (/already registered|already exists/i.test(m)) return 'อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบแทน';
    if (/at least 6|password should be/i.test(m)) return 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
    if (/rate limit/i.test(m)) return 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่';
    if (/failed to fetch|network/i.test(m)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่';
    return m;
  }

  $('authSwitch').addEventListener('click', e => {
    if (e.target.id === 'toSignup') setAuthMode('signup');
    if (e.target.id === 'toLogin') setAuthMode('login');
  });
  $('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('authEmail').value.trim(), password = $('authPass').value;
    $('authSubmit').disabled = true;
    authMsg('กำลังดำเนินการ…');
    try {
      if (authMode === 'signup'){
        const { data, error } = await sb.auth.signUp({ email, password, options:{ emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session){
          setAuthMode('login');
          authMsg('สมัครเรียบร้อย กรุณาเปิดอีเมลเพื่อยืนยันบัญชี แล้วกลับมาเข้าสู่ระบบ', 'ok');
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch(err){
      authMsg(thaiAuthError(err), 'err');
    } finally {
      $('authSubmit').disabled = false;
    }
  });
  $('forgot').addEventListener('click', async () => {
    const email = $('authEmail').value.trim();
    if (!email){ authMsg('ใส่อีเมลก่อน แล้วกด "ลืมรหัสผ่าน" อีกครั้ง', 'err'); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    authMsg(error ? thaiAuthError(error) : 'ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว', error ? 'err' : 'ok');
  });
  $('logout').addEventListener('click', async () => {
    await flushSave();
    await sb.auth.signOut();
  });

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY'){
      setTimeout(async () => {
        const pw = prompt('ตั้งรหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)');
        if (pw){
          const { error } = await sb.auth.updateUser({ password: pw });
          alert(error ? thaiAuthError(error) : 'เปลี่ยนรหัสผ่านเรียบร้อย');
        }
      }, 0);
    }
    const u = session ? session.user : null;
    if ((u && u.id) === (user && user.id)) return;
    user = u;
    // run outside the auth callback (supabase-js recommends not awaiting inside it)
    setTimeout(() => user ? enterApp() : showLogin(), 0);
  });

  function showLogin(){
    scenarios = []; currentId = null;
    $('appView').hidden = true;
    $('authView').hidden = false;
    $('authPass').value = '';
    setAuthMode('login');
  }

  async function enterApp(){
    $('authView').hidden = true;
    $('appView').hidden = false;
    $('who').textContent = user.email || '';
    setStatus('กำลังโหลด…');
    try {
      await loadScenarioList();
      if (!scenarios.length){
        await createScenario('ชุดหลัก', clone(DEFAULTS));
      } else {
        let last = null;
        try { last = localStorage.getItem(LAST_KEY); } catch(e){}
        await openScenario(scenarios.some(s => s.id === last) ? last : scenarios[0].id);
      }
      setStatus('');
    } catch(err){
      dbError(err);
    }
  }

  // ======================================================
  // SCENARIOS (Supabase)
  // ======================================================
  function dbError(err){
    console.error(err);
    const m = (err && (err.message || err.code)) || String(err);
    const missing = /scenarios/.test(m) && /(does not exist|could not find|schema cache)/i.test(m);
    setStatus(missing ? 'ยังไม่ได้สร้างตาราง: รัน supabase/schema.sql ใน Supabase ก่อน' : 'ผิดพลาด: ' + m, true);
  }
  function setStatus(t, err){
    const el = $('saveStatus');
    el.textContent = t || '';
    el.className = 'status' + (err ? ' err' : '');
  }

  async function loadScenarioList(){
    const { data, error } = await sb.from('scenarios').select('id,name,updated_at').order('updated_at', { ascending:false });
    if (error) throw error;
    scenarios = data || [];
    renderScenarioSelect();
  }
  function renderScenarioSelect(){
    $('scenarioSel').innerHTML = scenarios.map(s =>
      '<option value="' + esc(s.id) + '"' + (s.id === currentId ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
    $('scDelete').disabled = scenarios.length <= 1;
  }
  async function openScenario(id){
    const { data, error } = await sb.from('scenarios').select('id,name,data').eq('id', id).single();
    if (error) throw error;
    currentId = data.id;
    try { localStorage.setItem(LAST_KEY, currentId); } catch(e){}
    state = normalize(data.data);
    renderScenarioSelect();
    fillForm();
  }
  async function createScenario(name, data){
    const { data: row, error } = await sb.from('scenarios').insert({ name, data }).select('id,name,updated_at').single();
    if (error) throw error;
    scenarios.unshift(row);
    currentId = row.id;
    try { localStorage.setItem(LAST_KEY, currentId); } catch(e){}
    state = normalize(data);
    renderScenarioSelect();
    fillForm();
  }

  function scheduleSave(){
    dirty = true;
    setStatus('ยังไม่บันทึก…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 800);
  }
  async function doSave(){
    clearTimeout(saveTimer); saveTimer = null;
    if (!dirty || !currentId || !user) return;
    if (saving){ saveTimer = setTimeout(doSave, 400); return; }
    saving = true; dirty = false;
    setStatus('กำลังบันทึก…');
    const id = currentId, payload = clone(state);
    const { error } = await sb.from('scenarios').update({ data: payload }).eq('id', id);
    saving = false;
    if (error){ dirty = true; dbError(error); return; }
    if (!dirty) setStatus('บันทึกแล้ว ✓');
  }
  async function flushSave(){ if (dirty) await doSave(); }
  window.addEventListener('beforeunload', e => { if (dirty || saving){ doSave(); e.preventDefault(); e.returnValue = ''; } });

  $('scenarioSel').addEventListener('change', async e => {
    const id = e.target.value;
    try { await flushSave(); await openScenario(id); setStatus(''); } catch(err){ dbError(err); }
  });
  $('scNew').addEventListener('click', async () => {
    const name = prompt('ชื่อชุดการคำนวณใหม่', 'ชุดใหม่');
    if (!name) return;
    try { await flushSave(); await createScenario(name.trim(), clone(DEFAULTS)); setStatus('สร้างชุดใหม่แล้ว'); } catch(err){ dbError(err); }
  });
  $('scCopy').addEventListener('click', async () => {
    const cur = scenarios.find(s => s.id === currentId);
    const name = prompt('ชื่อสำเนา', (cur ? cur.name : 'ชุด') + ' (สำเนา)');
    if (!name) return;
    try { await flushSave(); await createScenario(name.trim(), clone(state)); setStatus('ทำสำเนาแล้ว'); } catch(err){ dbError(err); }
  });
  $('scRename').addEventListener('click', async () => {
    const cur = scenarios.find(s => s.id === currentId);
    if (!cur) return;
    const name = prompt('เปลี่ยนชื่อชุดการคำนวณ', cur.name);
    if (!name || name.trim() === cur.name) return;
    const { error } = await sb.from('scenarios').update({ name: name.trim() }).eq('id', cur.id);
    if (error) return dbError(error);
    cur.name = name.trim();
    renderScenarioSelect();
    setStatus('เปลี่ยนชื่อแล้ว');
  });
  $('scDelete').addEventListener('click', async () => {
    const cur = scenarios.find(s => s.id === currentId);
    if (!cur || scenarios.length <= 1) return;
    if (!confirm('ลบชุด "' + cur.name + '" ? ลบแล้วกู้คืนไม่ได้')) return;
    clearTimeout(saveTimer); dirty = false;
    const { error } = await sb.from('scenarios').delete().eq('id', cur.id);
    if (error) return dbError(error);
    scenarios = scenarios.filter(s => s.id !== cur.id);
    try { await openScenario(scenarios[0].id); setStatus('ลบแล้ว'); } catch(err){ dbError(err); }
  });

  // ======================================================
  // FORM
  // ======================================================
  function fillForm(){
    for (const k in SCALARS){ const el = $(k); if (el) el.value = state[k]; }
    renderRoomList();
    renderResidents();
    renderFixedList();
    renderPromoList();
    renderPayList();
    render();
  }

  const numIn = (list, i, f, v, step, label, room) =>
    '<input type="number" data-list="' + list + '" data-i="' + i + '" data-f="' + f + '"' + (room ? ' data-room="' + esc(room) + '"' : '') +
    ' value="' + v + '" step="' + step + '" min="0" aria-label="' + esc(label) + '">';
  const roomName = (r, i) => r.name || ('ห้องที่ ' + (i + 1));

  function renderRoomList(){
    $('roomList').innerHTML = state.rooms.length ? state.rooms.map((r, i) =>
      '<div class="promo-card">' +
        '<div class="top">' +
          '<input type="text" data-list="rooms" data-i="' + i + '" data-f="name" value="' + esc(r.name) + '" placeholder="ชื่อห้อง" aria-label="ชื่อห้อง">' +
          '<button type="button" class="icon-btn" data-del="rooms" data-i="' + i + '" title="ลบห้อง" aria-label="ลบห้อง">×</button>' +
        '</div>' +
        '<div class="row"><label>จำนวนเตียง</label>' + numIn('rooms', i, 'beds', r.beds, 1, 'จำนวนเตียง ' + roomName(r, i)) + '</div>' +
        '<div class="matrix">' +
          '<span></span><span class="h">รายเดือน</span><span class="h">ล่วงหน้า 3 เดือน</span><span class="h">ล่วงหน้า 6 เดือน</span>' +
          '<span class="l">ราคา / เดือน</span>' +
          numIn('rooms', i, 'pm', r.pm, 100, roomName(r, i) + ' รายเดือน') +
          numIn('rooms', i, 'pq', r.pq, 100, roomName(r, i) + ' จ่ายล่วงหน้า 3 เดือน') +
          numIn('rooms', i, 'ph', r.ph, 100, roomName(r, i) + ' จ่ายล่วงหน้า 6 เดือน') +
        '</div>' +
      '</div>').join('') : '<p class="empty">ยังไม่มีห้อง กด "+ เพิ่มห้อง"</p>';
  }

  function renderResidents(){
    $('resMatrix').innerHTML = state.rooms.length
      ? '<span></span><span class="h">รายเดือน</span><span class="h">ล่วงหน้า 3 เดือน</span><span class="h">ล่วงหน้า 6 เดือน</span>' +
        state.rooms.map((r, i) =>
          '<span class="l">' + esc(roomName(r, i)) + '</span>' +
          numIn('rooms', i, 'nm', r.nm, 1, 'ผู้พัก ' + roomName(r, i) + ' รายเดือน') +
          numIn('rooms', i, 'nq', r.nq, 1, 'ผู้พัก ' + roomName(r, i) + ' ล่วงหน้า 3 เดือน') +
          numIn('rooms', i, 'nh', r.nh, 1, 'ผู้พัก ' + roomName(r, i) + ' ล่วงหน้า 6 เดือน')).join('')
      : '<span class="empty span3">เพิ่มห้องก่อน</span>';
  }

  function renderFixedList(){
    $('fixedList').innerHTML = state.fixed.length ? state.fixed.map((f, i) =>
      '<div class="item">' +
        '<input type="text" data-list="fixed" data-i="' + i + '" data-f="name" value="' + esc(f.name) + '" placeholder="ชื่อรายการ" aria-label="ชื่อรายการต้นทุนคงที่">' +
        '<input type="number" data-list="fixed" data-i="' + i + '" data-f="amount" value="' + f.amount + '" step="100" min="0" aria-label="บาทต่อเดือน">' +
        '<button type="button" class="icon-btn" data-del="fixed" data-i="' + i + '" title="ลบรายการ" aria-label="ลบรายการ">×</button>' +
      '</div>').join('') : '<p class="empty">ยังไม่มีรายการ กด "+ เพิ่มรายการ"</p>';
  }

  function renderPromoList(){
    const inp = (i, f, v, step, label) => numIn('promos', i, f, v, step, label);
    $('promoList').innerHTML = state.promos.length ? state.promos.map((p, i) =>
      '<div class="promo-card">' +
        '<div class="top">' +
          '<input type="text" data-list="promos" data-i="' + i + '" data-f="name" value="' + esc(p.name) + '" placeholder="ชื่อโปร" aria-label="ชื่อโปร">' +
          '<button type="button" class="icon-btn" data-del="promos" data-i="' + i + '" title="ลบโปร" aria-label="ลบโปร">×</button>' +
        '</div>' +
        '<div class="row"><label>ระยะเวลาโปร (เดือน)</label>' + inp(i,'months',p.months,1,'ระยะเวลาโปร') + '</div>' +
        '<label class="chk"><input type="checkbox" data-list="promos" data-i="' + i + '" data-f="prepaid"' + (p.prepaid ? ' checked' : '') + '> จ่ายล่วงหน้าทั้งก้อน</label>' +
        '<div class="row"><label>จำกัดจำนวนเตียง<small>0 = ไม่จำกัด</small></label>' + inp(i,'limit',p.limit,1,'จำกัดจำนวนเตียง') + '</div>' +
        '<div class="row"><label>หลังหมดโปรต่อสัญญาแบบ<small>ใช้ราคาปกติของแต่ละห้อง</small></label>' +
          '<select data-list="promos" data-i="' + i + '" data-f="afterPlan" aria-label="หลังหมดโปรต่อสัญญาแบบ">' +
          Object.keys(AFTER_PLANS).map(k => '<option value="' + k + '"' + (p.afterPlan === k ? ' selected' : '') + '>' + AFTER_PLANS[k] + '</option>').join('') +
          '</select></div>' +
        (state.rooms.length ? '<div class="matrix two">' +
          '<span></span><span class="h">ราคาโปร / เดือน</span><span class="h">ผู้พักโปร (คน)</span>' +
          state.rooms.map((r, ri) => {
            const e = promoRoom(p, r);
            return '<span class="l">' + esc(roomName(r, ri)) + '<small data-after="' + esc(r.id) + '">หลังหมดโปร ' + fmt(e.after) + '</small></span>' +
              numIn('promos', i, 'price', e.price, 100, 'ราคาโปร ' + roomName(r, ri), r.id) +
              numIn('promos', i, 'n', e.n, 1, 'ผู้พักโปร ' + roomName(r, ri), r.id);
          }).join('') +
        '</div>' : '') +
      '</div>').join('') : '<p class="empty">ยังไม่มีโปร กด "+ เพิ่มโปร"</p>';
  }

  function renderPayList(){
    const ppl = people(state);
    $('payList').innerHTML = ppl.length ? ppl.map((x, i) =>
      '<div class="payitem">' +
        '<span class="who-l">' + (i + 1) + '. ' + esc(x.room) + '<small>' + esc(x.plan) + ' · ' + fmt(x.price) + ' บาท/เดือน' + (x.months ? ' (รวม ' + fmt(x.price * x.months) + ')' : '') + '</small></span>' +
        '<input type="text" data-pay="' + esc(x.key) + '" data-f="name" value="' + esc(x.name) + '" placeholder="ชื่อผู้พัก (ไม่ใส่ก็ได้)" aria-label="ชื่อผู้พักคนที่ ' + (i + 1) + '">' +
        '<select data-pay="' + esc(x.key) + '" data-f="m" aria-label="วิธีจ่ายของผู้พักคนที่ ' + (i + 1) + '">' +
          Object.keys(PAY_METHODS).filter(k => x.months || k[0] !== 'i')
            .map(k => '<option value="' + k + '"' + (x.m === k ? ' selected' : '') + '>' + PAY_METHODS[k] + '</option>').join('') +
        '</select>' +
      '</div>').join('') : '<p class="empty">ยังไม่มีผู้พัก ใส่จำนวนผู้พักด้านบนก่อน</p>';
  }

  $('form').addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.pay){
      const e2 = state.pay[t.dataset.pay] || (state.pay[t.dataset.pay] = {m:'cash', name:''});
      e2[t.dataset.f] = t.value;
    } else if (t.dataset.list){
      const list = t.dataset.list, f = t.dataset.f;
      let item = state[list][+t.dataset.i];
      if (!item) return;
      if (t.dataset.room){
        const r = state.rooms.find(x => x.id === t.dataset.room);
        if (!r) return;
        item = item.rooms[r.id] || (item.rooms[r.id] = {n:0, price:0});
      }
      if (t.type === 'checkbox') item[f] = t.checked;
      else if (t.type === 'text' || t.tagName === 'SELECT') item[f] = t.value;
      else item[f] = INT_FIELDS.includes(f) ? int(t.value) : num(t.value);
      // room names label the residents grid and the promo cards
      if (list === 'rooms' && f === 'name'){ renderResidents(); renderPromoList(); }
      // after-promo hints follow the plan choice and the rooms' normal prices
      if ((list === 'promos' && f === 'afterPlan') || (list === 'rooms' && /^p[mqh]$/.test(f))) refreshAfterHints();
      // the per-resident payment list follows resident counts, names and prices
      if (list !== 'fixed') renderPayList();
    } else if (t.id in SCALARS){
      state[t.id] = INT_KEYS.includes(t.id) ? Math.round(num(t.value)) : num(t.value);
    } else return;
    render();
    scheduleSave();
  });
  function refreshAfterHints(){
    $('promoList').querySelectorAll('.promo-card').forEach((card, i) => {
      const p = state.promos[i];
      card.querySelectorAll('[data-after]').forEach(el => {
        const r = state.rooms.find(x => x.id === el.dataset.after);
        if (p && r) el.textContent = 'หลังหมดโปร ' + fmt(promoRoom(p, r).after);
      });
    });
  }
  $('form').addEventListener('submit', e => e.preventDefault());
  $('form').addEventListener('click', e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const list = b.dataset.del, i = +b.dataset.i;
    const it = state[list][i];
    if (it && it.name && !confirm('ลบ "' + it.name + '" ?')) return;
    state[list].splice(i, 1);
    if (list === 'rooms'){
      state.promos.forEach(p => { delete p.rooms[it.id]; });
      renderRoomList(); renderResidents(); renderPromoList();
    } else if (list === 'fixed') renderFixedList();
    else renderPromoList();
    if (list !== 'fixed') renderPayList();
    render(); scheduleSave();
  });
  $('addFixed').addEventListener('click', () => {
    state.fixed.push(NEW_FIXED());
    renderFixedList(); render(); scheduleSave();
    const inputs = $('fixedList').querySelectorAll('input[type=text]');
    inputs[inputs.length - 1].focus();
  });
  $('addPromo').addEventListener('click', () => {
    state.promos.push(NEW_PROMO());
    renderPromoList(); render(); scheduleSave();
    const inputs = $('promoList').querySelectorAll('.top input');
    const last = inputs[inputs.length - 1]; last.focus(); last.select();
  });
  $('addRoom').addEventListener('click', () => {
    state.rooms.push(NEW_ROOM());
    renderRoomList(); renderResidents(); renderPromoList(); render(); scheduleSave();
    const inputs = $('roomList').querySelectorAll('.top input');
    const last = inputs[inputs.length - 1]; last.focus(); last.select();
  });
  $('reset').addEventListener('click', () => {
    if (!confirm('คืนค่าเริ่มต้นทั้งหมดของชุดนี้? ห้อง รายการ และโปรที่เพิ่มเองจะหายไป')) return;
    state = normalize(clone(DEFAULTS));
    fillForm(); scheduleSave();
  });

  // ======================================================
  // CALCULATION
  // ======================================================
  function plans(v){
    const out = [];
    v.promos.forEach(p => {
      const months = p.prepaid ? p.months : 0;
      v.rooms.forEach((r, ri) => out.push({key:p.id + ':' + r.id, name:p.name || 'โปร', room:roomName(r, ri), n:promoRoom(p, r).n, price:promoRoom(p, r).price, after:promoRoom(p, r).after, months, promo:true}));
    });
    v.rooms.forEach((r, ri) => {
      const room = roomName(r, ri);
      out.push(
        {key:r.id + ':m', name:'รายเดือน', room, n:r.nm, price:r.pm, months:0},
        {key:r.id + ':q', name:'ล่วงหน้า 3 เดือน', room, n:r.nq, price:r.pq, months:3},
        {key:r.id + ':h', name:'ล่วงหน้า 6 เดือน', room, n:r.nh, price:r.ph, months:6}
      );
    });
    return out;
  }

  // one entry per resident with their payment method; a monthly payer can't be on a 0% plan, so that falls back to card
  function people(v){
    const out = [];
    plans(v).forEach(p => {
      for (let k = 0; k < p.n; k++){
        const key = p.key + '#' + k, e = v.pay[key] || {};
        let m = PAY_METHODS[e.m] ? e.m : 'cash';
        if (!p.months && m[0] === 'i') m = 'card';
        out.push({key, room:p.room, plan:p.name + (p.promo ? ' (โปร)' : ''), price:p.price, after:p.promo ? p.after : p.price, months:p.months, name:e.name || '', m});
      }
    });
    return out;
  }

  // generic P&L for n residents with given total revenue; feeRate = card / 0% fees as a share of revenue
  function pnl(v, n, revenue, feeRate){
    const fixedItems = [['เงินเดือนพนักงานดูแล (' + v.staffN + ' คน)', v.staffN * v.staffSal]]
      .concat(v.fixed.map((f, i) => [f.name || ('รายการที่ ' + (i+1)), f.amount]));
    const fixed = fixedItems.reduce((s,x)=>s+x[1],0);
    const varItems = [['ค่าอาหาร', v.food*n]];
    varItems.push(['อื่นๆ '+v.otherPct+'% ของรายได้', revenue*v.otherPct/100]);
    if (feeRate) varItems.push(['ค่าธรรมเนียมบัตรเครดิต / ผ่อน 0% (รวม VAT)', revenue*feeRate]);
    const variable = varItems.reduce((s,x)=>s+x[1],0);
    const total = fixed + variable;
    const ebit = revenue - total;
    const tax = ebit > 0 ? ebit*v.tax/100 : 0;
    return {fixedItems, varItems, fixed, variable, total, ebit, tax, net: ebit - tax};
  }

  function render(){
    const v = state;
    const P = plans(v);
    const n = P.reduce((s,p)=>s+p.n,0);
    const roomRev = P.reduce((s,p)=>s+p.n*p.price,0);
    const care2 = Math.min(v.nCare2, n);
    const care1 = Math.min(v.nCare1, n - care2);
    const careRev = care1 * v.pCare1 + care2 * v.pCare2;
    const revenue = roomRev + careRev;
    const cash = P.reduce((s,p)=>s+p.n*p.price*p.months,0);
    // payment fees per resident; a prepaid charge is taken once, which averages to price × rate a month
    const ppl = people(v);
    const fee = ppl.reduce((s,x)=>s + x.price*payRate(v, x.m), 0);
    const feeUpfront = ppl.reduce((s,x)=>s + x.price*x.months*payRate(v, x.m), 0);
    const fr = revenue ? fee/revenue : 0;
    const m = pnl(v, n, revenue, fr);
    const avg = n ? revenue/n : 0;
    const pctO = v.otherPct/100 + fr;
    const contrib = avg*(1-pctO) - v.food;
    const be = contrib > 0 ? m.fixed/contrib : Infinity;
    const minAvg = n && pctO < 1 ? (m.fixed/n + v.food)/(1-pctO) : Infinity;

    const nCard = ppl.filter(x => x.m === 'card').length, nInst = ppl.filter(x => x.m[0] === 'i').length;
    $('cardNote').textContent = !ppl.length ? 'ค่าธรรมเนียมคิดจากค่าห้อง (ค่าดูแลติดเตียงยังไม่นับ)'
      : fee ? 'โอน/เงินสด ' + (ppl.length - nCard - nInst) + ' คน · รูดบัตร ' + nCard + ' คน · ผ่อน 0% ' + nInst + ' คน · ค่าธรรมเนียม ≈ ' + fmt(fee) + ' บาท/เดือน (' + (fr*100).toFixed(2) + '% ของรายได้)' +
          (feeUpfront ? ' · เงินล่วงหน้าที่รูดหรือผ่อนโดนหักครั้งเดียว ≈ ' + fmt(feeUpfront) + ' บาท' : '') + ' · คิดจากค่าห้อง ค่าดูแลติดเตียงยังไม่นับ'
      : 'ทุกคนจ่ายโอน / เงินสด ไม่มีค่าธรรมเนียม เลือกวิธีจ่ายของแต่ละคนได้ด้านบน';
    $('fixedSum').textContent = fmt(v.fixed.reduce((s,f)=>s+f.amount,0)) + ' บาท';

    // occupancy note
    const cap = v.rooms.reduce((s,r)=>s+r.beds,0);
    const inRoom = v.rooms.map(r => r.nm + r.nq + r.nh + v.promos.reduce((s,p)=>s+promoRoom(p, r).n,0));
    const nPromo = v.promos.reduce((s,p)=>s + v.rooms.reduce((a,r)=>a+promoRoom(p, r).n,0), 0);
    const warns = [];
    v.rooms.forEach((r, ri) => { if (inRoom[ri] > r.beds) warns.push(roomName(r, ri) + ' ใส่ไว้ ' + inRoom[ri] + ' คน เกินจำนวนเตียง (' + r.beds + ')'); });
    v.promos.forEach(p => {
      const pn = v.rooms.reduce((a,r)=>a+promoRoom(p, r).n,0);
      if (p.limit && pn > p.limit) warns.push('"' + (p.name || 'โปร') + '" จำกัดไว้ ' + p.limit + ' เตียง แต่ใส่ผู้พัก ' + pn + ' คน');
    });
    if (v.nCare1 + v.nCare2 > n) warns.push('ผู้ป่วยติดเตียงรวมมากกว่าจำนวนผู้พัก ระบบนับให้ ' + n + ' คน');
    $('occNote').className = 'note num' + (warns.length ? ' warn' : '');
    $('occNote').textContent = warns.length ? warns.join(' · ')
      : 'รวม ' + n + ' คน · ' + v.rooms.map((r, ri) => roomName(r, ri) + ' ' + inRoom[ri] + '/' + r.beds).join(' · ') + ' · ว่าง ' + Math.max(0, cap - n) + ' จาก ' + cap + ' เตียง';
    $('ratio').textContent = v.staffN > 0 ? 'ผู้พัก ' + n + ' คน ต่อพนักงาน ' + v.staffN + ' คน = ' + (n/v.staffN).toFixed(1) + ' : 1' : 'ยังไม่ได้ใส่จำนวนพนักงาน';

    // tiles
    $('tCost').textContent = n ? fmt(m.total/n) : '–';
    $('tCostS').textContent = n ? 'รายได้เฉลี่ย ' + fmt(avg) + ' / คน' : 'ยังไม่มีผู้พัก';
    $('tNet').textContent = sgn(m.net);
    $('tNet').className = 'v ' + (m.net >= 0 ? 'pos' : 'neg');
    $('tNetS').textContent = m.net > 0 ? 'คืนทุน ' + (v.invest/m.net/12).toFixed(1) + ' ปี' : 'ยังคืนทุนไม่ได้';
    $('tCash').textContent = fmt(cash);
    $('tCashS').textContent = cash ? (m.net < 0 ? 'พอจ่ายส่วนที่ขาดทุนได้ ' + (cash/-m.net).toFixed(1) + ' เดือน' : 'เงินก้อนจากคนที่จ่ายล่วงหน้า') : 'ยังไม่มีคนจ่ายล่วงหน้า';
    $('tBE').textContent = isFinite(be) ? be.toFixed(1) + ' คน' : '—';
    $('tBES').textContent = isFinite(be) ? 'ที่รายได้เฉลี่ยตอนนี้ ต้องมี ' + Math.ceil(be - 1e-9) + ' คนขึ้นไป' : 'รายได้ต่อคนไม่พอต้นทุนต่อหัว';

    const vd = $('verdict');
    if (!n){
      vd.className = 'verdict loss'; $('vPill').textContent = 'ยังไม่มีผู้พัก';
      $('vText').textContent = 'ถ้ายังไม่มีผู้พัก ศูนย์ต้องจ่ายต้นทุนคงที่ ' + fmt(m.fixed) + ' บาท/เดือน';
    } else if (m.ebit >= 0){
      vd.className = 'verdict ok'; $('vPill').textContent = 'มีกำไร';
      $('vText').innerHTML = 'ผู้พัก ' + n + ' คน รายได้เฉลี่ย <b class="num">' + fmt(avg) + '</b> บาท/คน สูงกว่าขั้นต่ำที่ไม่ขาดทุน (' + fmt(minAvg) + ') อยู่ ' + fmt(avg - minAvg) + ' บาท/คน';
    } else {
      vd.className = 'verdict loss'; $('vPill').textContent = 'ขาดทุน';
      $('vText').innerHTML = 'ผู้พัก ' + n + ' คน ต้องได้รายได้เฉลี่ยอย่างน้อย <b class="num">' + fmt(minAvg) + '</b> บาท/คน ตอนนี้ได้ ' + fmt(avg) + ' ขาดอีก ' + fmt(minAvg - avg) + ' บาท/คน' + (isFinite(be) ? ' หรือต้องมีผู้พัก ' + Math.ceil(be - 1e-9) + ' คนขึ้นไป' : '');
    }

    // promo vs after
    const revAfter = revenue + v.promos.reduce((s,p)=>s + v.rooms.reduce((a,r)=>{ const e = promoRoom(p, r); return a + e.n*(e.after - e.price); }, 0), 0);
    const feeAfter = ppl.reduce((s,x)=>s + x.after*payRate(v, x.m), 0);
    const mA = pnl(v, n, revAfter, revAfter ? feeAfter/revAfter : 0);
    const aft = [];
    v.promos.forEach(p => {
      const parts = [];
      v.rooms.forEach((r, ri) => { const e = promoRoom(p, r); if (e.n) parts.push(roomName(r, ri) + ' ' + e.n + ' คน ' + fmt(e.price) + ' → ' + fmt(e.after)); });
      if (parts.length) aft.push('"' + (p.name || 'โปร') + '" ' + p.months + ' เดือน: ' + parts.join(', '));
    });
    $('cmpSub').textContent = nPromo
      ? aft.join(' · ') + ' บาท/เดือน ผู้พักคนอื่นจ่ายเท่าเดิม'
      : 'ยังไม่มีผู้พักราคาโปร ตัวเลขสองช่วงจึงเท่ากัน';
    const cr = (label, a, b, signed, good) => {
      const d = b - a, f = signed ? sgn : fmt;
      const cls = x => signed ? (x >= 0 ? 'pos' : 'neg') : '';
      const dc = d === 0 ? 'muted' : ((good ? d > 0 : d < 0) ? 'pos' : 'neg');
      return '<tr><td>' + label + '</td><td class="' + cls(a) + '">' + f(a) + '</td><td class="' + cls(b) + '">' + f(b) + '</td><td class="' + dc + '">' + (d === 0 ? '–' : sgn(d)) + '</td></tr>';
    };
    $('cmp').innerHTML =
      cr('รายได้รวม', revenue, revAfter, false, true) +
      cr('รายได้เฉลี่ย / คน', n ? revenue/n : 0, n ? revAfter/n : 0, false, true) +
      cr('ต้นทุนรวม', m.total, mA.total, false, false) +
      cr('กำไรก่อนภาษี', m.ebit, mA.ebit, true, true) +
      cr('กำไรสุทธิ', m.net, mA.net, true, true);

    // price card
    $('pcPromos').innerHTML = v.promos.map(p => {
      const lines = v.rooms.map((r, ri) => {
        const e = promoRoom(p, r);
        if (!e.price) return '';
        return '<li><span>' + esc(roomName(r, ri)) + '</span><b class="num">' + fmt(e.price) + ' บาท/เดือน</b><span class="muted">' +
          (p.prepaid && p.months ? 'จ่ายล่วงหน้า ' + p.months + ' เดือน ' + fmt(e.price*p.months) + ' บาท · ' : '') +
          'หลังหมดโปร ' + fmt(e.after) + ' บาท/เดือน</span></li>';
      }).join('');
      return '<div class="promo-strip"><div class="ps-head">' + esc(p.name || 'โปร') + (p.limit ? ' (' + p.limit + ' เตียง)' : '') +
        (p.months ? ' · ' + p.months + ' เดือนแรก' : '') + '</div>' +
        (lines ? '<ul class="ps-rooms">' + lines + '</ul>' : '<span class="muted">ยังไม่ได้ใส่ราคาโปร</span>') + '</div>';
    }).join('');
    const dl = (mo, q, h) =>
      '<dt>รายเดือน</dt><dd>' + fmt(mo) + '</dd>' +
      '<dt>จ่ายล่วงหน้า 3 เดือน</dt><dd>' + fmt(q) + '<span>รวม ' + fmt(q*3) + (mo>q ? ' · ประหยัด ' + fmt((mo-q)*3) : '') + '</span></dd>' +
      '<dt>จ่ายล่วงหน้า 6 เดือน</dt><dd>' + fmt(h) + '<span>รวม ' + fmt(h*6) + (mo>h ? ' · ประหยัด ' + fmt((mo-h)*6) : '') + '</span></dd>';
    $('pcPlans').innerHTML = v.rooms.map((r, ri) => '<div class="plan"><h3>' + esc(roomName(r, ri)) + (roomName(r, ri).includes(r.beds + ' เตียง') ? '' : ' <span class="muted">(' + r.beds + ' เตียง)</span>') + '</h3><dl>' + dl(r.pm, r.pq, r.ph) + '</dl></div>').join('');
    $('pcCare1').textContent = 'ผู้ป่วยติดเตียง (พลิกตัว เช็ดตัว ป้อนอาหาร ดูแลการขับถ่าย) บวกเพิ่ม ' + fmt(v.pCare1) + ' บาท/เดือน';
    $('pcCare2').textContent = 'ผู้ป่วยติดเตียงที่มีสาย (ให้อาหารทางสาย ดูดเสมหะ ดูแลสายสวน) บวกเพิ่ม ' + fmt(v.pCare2) + ' บาท/เดือน';

    // revenue table
    let r = '';
    P.forEach(p => {
      if (!p.n) return;
      r += '<tr><td>' + esc(p.room) + ' · ' + esc(p.name) + (p.promo ? '<span class="tag promo">โปร</span>' : '') + '</td><td>' + p.n + '</td><td>' + fmt(p.price) + '</td><td>' + fmt(p.n*p.price) + '</td><td>' + (p.months ? fmt(p.n*p.price*p.months) : '<span class="muted">–</span>') + '</td></tr>';
    });
    if (care1) r += '<tr><td>ค่าดูแลผู้ป่วยติดเตียง</td><td>' + care1 + '</td><td>' + fmt(v.pCare1) + '</td><td>' + fmt(care1*v.pCare1) + '</td><td><span class="muted">รายเดือน</span></td></tr>';
    if (care2) r += '<tr><td>ค่าดูแลผู้ป่วยมีสาย</td><td>' + care2 + '</td><td>' + fmt(v.pCare2) + '</td><td>' + fmt(care2*v.pCare2) + '</td><td><span class="muted">รายเดือน</span></td></tr>';
    r += '<tr class="total"><td>รวม</td><td>' + n + '</td><td>' + (n ? fmt(avg) : '–') + '</td><td>' + fmt(revenue) + '</td><td>' + fmt(cash) + '</td></tr>';
    $('revenue').innerHTML = r;

    // cost breakdown
    const div = n || 1;
    const max = Math.max(...m.fixedItems.map(x=>x[1]), ...m.varItems.map(x=>x[1]), 1);
    const line = (name, amt, tag) =>
      '<tr><td>' + esc(name) + '<span class="tag' + (tag==='ผันแปร'?' var':'') + '">' + tag + '</span></td><td>' + fmt(amt) + '</td><td>' + (n?fmt(amt/div):'–') + '</td><td>' + pct(amt, revenue) + '</td><td class="barcell"><div class="bar" style="width:' + (amt/max*100).toFixed(1) + '%"></div></td></tr>';
    const sub = (name, amt, cls) => '<tr class="' + (cls||'sub') + '"><td>' + name + '</td><td>' + fmt(amt) + '</td><td>' + (n?fmt(amt/div):'–') + '</td><td>' + pct(amt, revenue) + '</td><td></td></tr>';
    let h = '';
    m.fixedItems.forEach(x => h += line(x[0], x[1], 'คงที่'));
    h += sub('รวมต้นทุนคงที่', m.fixed);
    m.varItems.forEach(x => h += line(x[0], x[1], 'ผันแปร'));
    h += sub('รวมต้นทุนผันแปร', m.variable);
    h += sub('ต้นทุนรวม', m.total, 'total');
    h += '<tr><td>รายได้รวม</td><td>' + fmt(revenue) + '</td><td>' + (n?fmt(avg):'–') + '</td><td>100%</td><td></td></tr>';
    const c = x => x >= 0 ? 'pos' : 'neg';
    h += '<tr><td>EBIT (กำไรก่อนภาษี)</td><td class="' + c(m.ebit) + '">' + sgn(m.ebit) + '</td><td class="' + c(m.ebit) + '">' + (n?sgn(m.ebit/div):'–') + '</td><td>' + pct(m.ebit, revenue) + '</td><td></td></tr>';
    h += '<tr><td>ภาษี ' + v.tax + '%</td><td>' + fmt(m.tax) + '</td><td>' + (n?fmt(m.tax/div):'–') + '</td><td></td><td></td></tr>';
    h += '<tr class="sub"><td>กำไรสุทธิ</td><td class="' + c(m.net) + '">' + sgn(m.net) + '</td><td class="' + c(m.net) + '">' + (n?sgn(m.net/div):'–') + '</td><td>' + pct(m.net, revenue) + '</td><td></td></tr>';
    $('breakdown').innerHTML = h;

    // occupancy
    const rows = [];
    for (let b = 1; b <= cap; b++) rows.push([b, pnl(v, b, avg*b, fr)]);
    const mx = Math.max(...rows.map(x => Math.abs(x[1].net)), 1);
    $('occ').innerHTML = avg ? rows.map(([b, q]) => {
      const w = (Math.abs(q.net)/mx*50).toFixed(1);
      return '<tr' + (b===n?' class="cur"':'') + '><td>' + b + (b===n?' <span class="tag">ตอนนี้</span>':'') + '</td><td>' + fmt(avg*b) + '</td><td>' + fmt(q.total) + '</td><td>' + fmt(q.total/b) + '</td><td class="' + c(q.net) + '">' + sgn(q.net) + '</td><td class="pbar"><div class="pb"><div class="mid"></div><div class="b ' + (q.net>=0?'p':'n') + '" style="width:' + w + '%"></div></div></td></tr>';
    }).join('') : '<tr><td colspan="6" class="muted">ใส่จำนวนผู้พักอย่างน้อย 1 คนเพื่อดูตารางนี้</td></tr>';
  }

  // initial view: wait for the session check before showing anything
  sb.auth.getSession().then(({ data }) => { if (!data.session && !user) showLogin(); });
})();
