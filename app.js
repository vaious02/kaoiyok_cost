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

  const CAP6 = 6, CAP4 = 4;
  const LAST_KEY = 'kaoiyok-last-scenario';

  // ---------- defaults ----------
  const SCALARS = {
    p6m:25000, p6q:23500, p6h:22500, p4m:27000, p4q:25500, p4h:24500, pCare1:4000, pCare2:6000,
    n6m:0, n6q:3, n6h:0, n4m:0, n4q:4, n4h:0, nCare1:5, nCare2:0,
    staffN:4, staffSal:15000,
    food:4500, diaper:0, otherPct:5,
    tax:20, invest:2000000
  };
  const INT_KEYS = ['n6m','n6q','n6h','n4m','n4q','n4h','nCare1','nCare2','staffN'];
  const DEFAULTS = Object.assign({}, SCALARS, {
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
      {name:'โปรเปิดศูนย์ 3 เตียงแรก', price:19900, months:3, prepaid:true, limit:3, n6:3, n4:0, after6:23500, after4:25500}
    ]
  });
  const NEW_FIXED = () => ({name:'', amount:0});
  const NEW_PROMO = () => ({name:'โปรใหม่', price:0, months:3, prepaid:true, limit:0, n6:0, n4:0, after6:SCALARS.p6q, after4:SCALARS.p4q});

  function normalize(d){
    const s = Object.assign(clone(DEFAULTS), d || {});
    for (const k in SCALARS) s[k] = num(s[k]);
    INT_KEYS.forEach(k => s[k] = Math.round(s[k]));
    s.fixed = Array.isArray(s.fixed) ? s.fixed.map(x => ({name:String(x.name||''), amount:num(x.amount)})) : clone(DEFAULTS.fixed);
    s.promos = Array.isArray(s.promos) ? s.promos.map(p => Object.assign(NEW_PROMO(), p, {
      name:String(p.name||''), price:num(p.price), months:Math.round(num(p.months)), prepaid:p.prepaid !== false,
      limit:Math.round(num(p.limit)), n6:Math.round(num(p.n6)), n4:Math.round(num(p.n4)), after6:num(p.after6), after4:num(p.after4)
    })) : clone(DEFAULTS.promos);
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
    renderFixedList();
    renderPromoList();
    render();
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
    const inp = (i, f, v, step, label) =>
      '<input type="number" data-list="promos" data-i="' + i + '" data-f="' + f + '" value="' + v + '" step="' + step + '" min="0" aria-label="' + label + '">';
    $('promoList').innerHTML = state.promos.length ? state.promos.map((p, i) =>
      '<div class="promo-card">' +
        '<div class="top">' +
          '<input type="text" data-list="promos" data-i="' + i + '" data-f="name" value="' + esc(p.name) + '" placeholder="ชื่อโปร" aria-label="ชื่อโปร">' +
          '<button type="button" class="icon-btn" data-del="promos" data-i="' + i + '" title="ลบโปร" aria-label="ลบโปร">×</button>' +
        '</div>' +
        '<div class="row"><label>ราคาโปร / เดือน</label>' + inp(i,'price',p.price,100,'ราคาโปรต่อเดือน') + '</div>' +
        '<div class="row"><label>ระยะเวลาโปร (เดือน)</label>' + inp(i,'months',p.months,1,'ระยะเวลาโปร') + '</div>' +
        '<label class="chk"><input type="checkbox" data-list="promos" data-i="' + i + '" data-f="prepaid"' + (p.prepaid ? ' checked' : '') + '> จ่ายล่วงหน้าทั้งก้อน</label>' +
        '<div class="row"><label>จำกัดจำนวนเตียง<small>0 = ไม่จำกัด</small></label>' + inp(i,'limit',p.limit,1,'จำกัดจำนวนเตียง') + '</div>' +
        '<div class="matrix two">' +
          '<span></span><span class="h">ห้อง 6 เตียง</span><span class="h">ห้อง 4 เตียง</span>' +
          '<span class="l">ผู้พักราคาโปร (คน)</span>' + inp(i,'n6',p.n6,1,'ผู้พักโปร ห้อง 6 เตียง') + inp(i,'n4',p.n4,1,'ผู้พักโปร ห้อง 4 เตียง') +
          '<span class="l">ราคาหลังหมดโปร<small>ต่อสัญญาหลังหมดโปร</small></span>' + inp(i,'after6',p.after6,100,'ราคาหลังหมดโปร ห้อง 6 เตียง') + inp(i,'after4',p.after4,100,'ราคาหลังหมดโปร ห้อง 4 เตียง') +
        '</div>' +
      '</div>').join('') : '<p class="empty">ยังไม่มีโปร กด "+ เพิ่มโปร"</p>';
  }

  $('form').addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.list){
      const item = state[t.dataset.list][+t.dataset.i];
      const f = t.dataset.f;
      if (!item) return;
      if (t.type === 'checkbox') item[f] = t.checked;
      else if (t.type === 'text') item[f] = t.value;
      else item[f] = ['months','limit','n6','n4'].includes(f) ? Math.round(num(t.value)) : num(t.value);
    } else if (t.id in SCALARS){
      state[t.id] = INT_KEYS.includes(t.id) ? Math.round(num(t.value)) : num(t.value);
    } else return;
    render();
    scheduleSave();
  });
  $('form').addEventListener('submit', e => e.preventDefault());
  $('form').addEventListener('click', e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const list = b.dataset.del, i = +b.dataset.i;
    const it = state[list][i];
    if (it && it.name && !confirm('ลบ "' + it.name + '" ?')) return;
    state[list].splice(i, 1);
    list === 'fixed' ? renderFixedList() : renderPromoList();
    render(); scheduleSave();
  });
  $('addFixed').addEventListener('click', () => {
    state.fixed.push(NEW_FIXED());
    renderFixedList(); render(); scheduleSave();
    const inputs = $('fixedList').querySelectorAll('input[type=text]');
    inputs[inputs.length - 1].focus();
  });
  $('addPromo').addEventListener('click', () => {
    const p = NEW_PROMO(); p.after6 = state.p6q; p.after4 = state.p4q;
    state.promos.push(p);
    renderPromoList(); render(); scheduleSave();
    const inputs = $('promoList').querySelectorAll('.top input');
    const last = inputs[inputs.length - 1]; last.focus(); last.select();
  });
  $('reset').addEventListener('click', () => {
    if (!confirm('คืนค่าเริ่มต้นทั้งหมดของชุดนี้? รายการและโปรที่เพิ่มเองจะหายไป')) return;
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
      out.push({name:p.name || 'โปร', room:'ห้อง 6 เตียง', n:p.n6, price:p.price, months, promo:true});
      out.push({name:p.name || 'โปร', room:'ห้อง 4 เตียง', n:p.n4, price:p.price, months, promo:true});
    });
    out.push(
      {name:'รายเดือน', room:'ห้อง 6 เตียง', n:v.n6m, price:v.p6m, months:0},
      {name:'ล่วงหน้า 3 เดือน', room:'ห้อง 6 เตียง', n:v.n6q, price:v.p6q, months:3},
      {name:'ล่วงหน้า 6 เดือน', room:'ห้อง 6 เตียง', n:v.n6h, price:v.p6h, months:6},
      {name:'รายเดือน', room:'ห้อง 4 เตียง', n:v.n4m, price:v.p4m, months:0},
      {name:'ล่วงหน้า 3 เดือน', room:'ห้อง 4 เตียง', n:v.n4q, price:v.p4q, months:3},
      {name:'ล่วงหน้า 6 เดือน', room:'ห้อง 4 เตียง', n:v.n4h, price:v.p4h, months:6}
    );
    return out;
  }

  // generic P&L for n residents with given total revenue
  function pnl(v, n, revenue){
    const fixedItems = [['เงินเดือนพนักงานดูแล (' + v.staffN + ' คน)', v.staffN * v.staffSal]]
      .concat(v.fixed.map((f, i) => [f.name || ('รายการที่ ' + (i+1)), f.amount]));
    const fixed = fixedItems.reduce((s,x)=>s+x[1],0);
    const varItems = [['ค่าอาหาร', v.food*n]];
    if (v.diaper > 0) varItems.push(['แพมเพิร์ส (รวมในค่าห้อง)', v.diaper*n]);
    varItems.push(['อื่นๆ '+v.otherPct+'% ของรายได้', revenue*v.otherPct/100]);
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
    const m = pnl(v, n, revenue);
    const avg = n ? revenue/n : 0;
    const pctO = v.otherPct/100;
    const contrib = avg*(1-pctO) - v.food - v.diaper;
    const be = contrib > 0 ? m.fixed/contrib : Infinity;
    const minAvg = n && pctO < 1 ? (m.fixed/n + v.food + v.diaper)/(1-pctO) : Infinity;

    $('fixedSum').textContent = fmt(v.fixed.reduce((s,f)=>s+f.amount,0)) + ' บาท';

    // occupancy note
    const promoN6 = v.promos.reduce((s,p)=>s+p.n6,0), promoN4 = v.promos.reduce((s,p)=>s+p.n4,0);
    const nPromo = promoN6 + promoN4;
    const in6 = promoN6 + v.n6m + v.n6q + v.n6h, in4 = promoN4 + v.n4m + v.n4q + v.n4h;
    const warns = [];
    if (in6 > CAP6) warns.push('ห้อง 6 เตียงใส่ไว้ ' + in6 + ' คน เกินจำนวนเตียง');
    if (in4 > CAP4) warns.push('ห้อง 4 เตียงใส่ไว้ ' + in4 + ' คน เกินจำนวนเตียง');
    v.promos.forEach(p => { if (p.limit && p.n6 + p.n4 > p.limit) warns.push('"' + (p.name || 'โปร') + '" จำกัดไว้ ' + p.limit + ' เตียง แต่ใส่ผู้พัก ' + (p.n6 + p.n4) + ' คน'); });
    if (v.nCare1 + v.nCare2 > n) warns.push('ผู้ป่วยติดเตียงรวมมากกว่าจำนวนผู้พัก ระบบนับให้ ' + n + ' คน');
    $('occNote').className = 'note num' + (warns.length ? ' warn' : '');
    $('occNote').textContent = warns.length ? warns.join(' · ')
      : 'รวม ' + n + ' คน · ห้อง 6 เตียง ' + in6 + '/' + CAP6 + ' · ห้อง 4 เตียง ' + in4 + '/' + CAP4 + ' · ว่าง ' + Math.max(0, CAP6+CAP4-n) + ' เตียง';
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
    const revAfter = revenue + v.promos.reduce((s,p)=>s + p.n6*(p.after6 - p.price) + p.n4*(p.after4 - p.price), 0);
    const mA = pnl(v, n, revAfter);
    const aft = [];
    v.promos.forEach(p => {
      const parts = [];
      if (p.n6) parts.push('ห้อง 6 เตียง ' + p.n6 + ' คน ต่อที่ ' + fmt(p.after6));
      if (p.n4) parts.push('ห้อง 4 เตียง ' + p.n4 + ' คน ต่อที่ ' + fmt(p.after4));
      if (parts.length) aft.push('"' + (p.name || 'โปร') + '" ' + fmt(p.price) + ' × ' + p.months + ' เดือน → ' + parts.join(', '));
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
    $('pcPromos').innerHTML = v.promos.map(p =>
      '<div class="promo-strip"><span>' + esc(p.name || 'โปร') + (p.limit ? ' (' + p.limit + ' เตียง)' : '') + '</span><b class="num">' + fmt(p.price) + ' บาท/เดือน</b><span class="muted">' +
        (p.prepaid && p.months ? 'จ่ายล่วงหน้า ' + p.months + ' เดือน ' + fmt(p.price*p.months) + ' บาท · ' : (p.months ? p.months + ' เดือนแรก · ' : '')) +
        'หลังหมดโปร ห้อง 6 เตียง ' + fmt(p.after6) + ' / ห้อง 4 เตียง ' + fmt(p.after4) + ' บาท/เดือน</span></div>').join('');
    const dl = (mo, q, h) =>
      '<dt>รายเดือน</dt><dd>' + fmt(mo) + '</dd>' +
      '<dt>จ่ายล่วงหน้า 3 เดือน</dt><dd>' + fmt(q) + '<span>รวม ' + fmt(q*3) + (mo>q ? ' · ประหยัด ' + fmt((mo-q)*3) : '') + '</span></dd>' +
      '<dt>จ่ายล่วงหน้า 6 เดือน</dt><dd>' + fmt(h) + '<span>รวม ' + fmt(h*6) + (mo>h ? ' · ประหยัด ' + fmt((mo-h)*6) : '') + '</span></dd>';
    $('pc6').innerHTML = dl(v.p6m, v.p6q, v.p6h);
    $('pc4').innerHTML = dl(v.p4m, v.p4q, v.p4h);
    $('pcCare1').textContent = 'ผู้ป่วยติดเตียง (พลิกตัว เช็ดตัว ป้อนอาหาร ดูแลการขับถ่าย) บวกเพิ่ม ' + fmt(v.pCare1) + ' บาท/เดือน';
    $('pcCare2').textContent = 'ผู้ป่วยติดเตียงที่มีสาย (ให้อาหารทางสาย ดูดเสมหะ ดูแลสายสวน) บวกเพิ่ม ' + fmt(v.pCare2) + ' บาท/เดือน';

    // revenue table
    let r = '';
    P.forEach(p => {
      if (!p.n) return;
      r += '<tr><td>' + p.room + ' · ' + esc(p.name) + (p.promo ? '<span class="tag promo">โปร</span>' : '') + '</td><td>' + p.n + '</td><td>' + fmt(p.price) + '</td><td>' + fmt(p.n*p.price) + '</td><td>' + (p.months ? fmt(p.n*p.price*p.months) : '<span class="muted">–</span>') + '</td></tr>';
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
    const cap = CAP6 + CAP4;
    const rows = [];
    for (let b = 1; b <= cap; b++) rows.push([b, pnl(v, b, avg*b)]);
    const mx = Math.max(...rows.map(x => Math.abs(x[1].net)), 1);
    $('occ').innerHTML = avg ? rows.map(([b, q]) => {
      const w = (Math.abs(q.net)/mx*50).toFixed(1);
      return '<tr' + (b===n?' class="cur"':'') + '><td>' + b + (b===n?' <span class="tag">ตอนนี้</span>':'') + '</td><td>' + fmt(avg*b) + '</td><td>' + fmt(q.total) + '</td><td>' + fmt(q.total/b) + '</td><td class="' + c(q.net) + '">' + sgn(q.net) + '</td><td class="pbar"><div class="pb"><div class="mid"></div><div class="b ' + (q.net>=0?'p':'n') + '" style="width:' + w + '%"></div></div></td></tr>';
    }).join('') : '<tr><td colspan="6" class="muted">ใส่จำนวนผู้พักอย่างน้อย 1 คนเพื่อดูตารางนี้</td></tr>';
  }

  // initial view: wait for the session check before showing anything
  sb.auth.getSession().then(({ data }) => { if (!data.session && !user) showLogin(); });
})();
