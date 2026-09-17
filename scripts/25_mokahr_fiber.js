// scripts/25_mokahr_fiber.js —— mokahr 申请页「React 组件 API 直写」引擎（快路径）
//
// 背景（2026-09 实测）：app.mokahr.com 系申请页是 **React 16**，fiber 键是
// `__reactInternalInstance$xxx`（不是 `__reactFiber$`）——所有依赖 `__reactFiber$`
// 的通用方案在该站点天然失灵；而「开下拉面板读 DOM 选项」又要跟 portal/离场动画/
// 大列表轮询搏斗，是「下拉选不中」反复出现的根因。
//
// 本引擎**根本不开面板**：每个字段组件的 memoizedProps 上挂着整套表单 API——
//   fieldInfo:{id, blockId, name, type, isRequired, options:[{label,value}]}
//   _get_()  读值   _set_(v)  写值（= store.setValue(fieldId, v, rowCtx)，与用户点选同链路）
//   _validate_()
// 任一 block 组件的 _get_values_() 返回**整表 store**，一次调用即可全量核对。
// 详见 references/adapters/mokahr.md《React16 组件 API 直写》一节。
//
// 用法：把下面 __CONFIG__ 替换成实际配置后，整段粘进 browseros-neo_evaluate(page)，
// 或生成临时文件走 `node scripts/cdp.mjs eval <target> <file> 600000`（推荐，长任务无 60s 限制）：
//   python -c "import json,pathlib; s=pathlib.Path('scripts/25_mokahr_fiber.js').read_text(encoding='utf-8'); pathlib.Path('_run.js').write_text(s.replace('__CONFIG__', json.dumps({'mode':'dump'})), encoding='utf-8')"
//
// CONFIG 形状：
//   { mode: 'dump' | 'fill' | 'store', stepDelayMs: 240, steps: [...] }
// steps 每项（按「区块 blockId + 字段 fid + 出现序号 occ」定位，不依赖 DOM uid，重渲染不失效）：
//   {a:'set',     blockId:'basicInfo', fid:'gender',  occ:0, v:'男'}                 // select/bool/text/date 起始端
//   {a:'daterow', blockId:'projectInfo', fid:'startDate', occ:0, start:'2026-03', end:'至今'|'2026-06'}
//   {a:'add',     blockId:'projectInfo', n:12}                                      // 点「添加」×n（新增重复条目）
//   {a:'delLast', blockId:'awardInfo',   n:5}                                       // 点「删除本条」×n（清掉多余空行）
//   可选：onlyIfEmpty:true（已有值就跳过）、force:true（回读对不上也认为成功）
//
// 取值形状（实测）：
//   select → option.value（字符串）；bool_info → **数字 1/0**（传 true 显示会空）；
//   string_info/text_info → 字符串；date_info 起始端/单端 → "YYYY-MM"；
//   day_info（出生日期）→ "YYYY-MM-DD"（组件自己截到月）；location_info（籍贯）→ "省/市/县"；
//   confirm_info（同步更新在线简历开关）→ true/false（多岗投递务必先关）
//   date_info 结束端没有注册字段：年份走分片 Select 的 onChange（写入 YYYY-01），
//   月份必须开一次面板真实点击（本引擎已内置兜底）；「至今」= 块内 checkbox。
//
// ⚠️ 铁律不变：绝不点提交/投递/下一步类按钮（「添加/删除本条」是重复块管理，不算提交）。
// ⚠️ 绝不要调 block 级的 _set_ —— 签名不同，会把整块写成标量（实测毁掉 15 行项目）。
// ⚠️ 形状要求：evaluate 按“函数体”执行 → 必须以 **顶层 return** 结束（本文件是 async IIFE 返回值）。
var CONFIG = __CONFIG__;

return (async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const STEP = CONFIG.stepDelayMs || 240;
  let FKEY = null;
  const fkey = el => { if (FKEY) return FKEY; for (const k of Object.keys(el)) if (/^__reactInternalInstance\$|^__reactFiber\$/.test(k)) { FKEY = k; break; } return FKEY; };
  const norm = s => String(s == null ? '' : s).replace(/[\s\u3000]/g, '').replace(/[（(].*?[)）]/g, '').replace(/[:：*＊]/g, '').toLowerCase();
  const isField = p => !!(p && p._set_ && p._get_ && p.fieldInfo);
  const isSel = p => !!(p && Array.isArray(p?.options) && typeof p.onChange === 'function');
  const safe = fn => { try { const v = fn(); return v === undefined ? null : v; } catch (e) { return { __err: String(e && e.message || e).slice(0, 80) }; } };

  // ---------- fiber 根（apply-form 容器） ----------
  const rootFiber = () => { const s = document.querySelector('[class*="apply-form"]') || document.body; const k = fkey(s); let f = s[k]; if (!f) return null; while (f.return) f = f.return; return f; };

  // ---------- 全表 store：从字段 fiber 往上爬（O(深度)；全树 DFS 在 15 行的大表上会超时） ----------
  let STORE = null;
  function findStore() {
    for (const el of document.querySelectorAll('[class*="apply-field-"] input, [class*="apply-field-"] textarea, [class*="apply-field-"]')) {
      const k = fkey(el); if (!k) continue; let f = el[k], d = 0;
      while (f && d++ < 80) { const p = f.memoizedProps;
        if (p && p.blockInfo && typeof p._get_values_ === 'function') return p; f = f.return; }
    }
    return null; }
  const storeVals = () => safe(() => { if (!STORE) STORE = findStore(); return STORE && STORE._get_values_(); });

  // ---------- 字段实例（按 stateNode 去重，渲染顺序≈DOM 顺序） ----------
  function collectFields() {
    const rf = rootFiber(); if (!rf) return [];
    const out = [], seen = new Set(); const st = [rf]; let g = 0;
    while (st.length && g++ < 200000) { const f = st.pop(); if (!f) continue;
      if (isField(f.memoizedProps)) { const id = f.stateNode || f.memoizedProps; if (!seen.has(id)) { seen.add(id); out.push(f); } }
      let c = f.child, kids = []; while (c) { kids.push(c); c = c.sibling; } for (let i = kids.length - 1; i >= 0; i--) st.push(kids[i]); }
    return out;
  }
  const hostDom = fb => { const q = [fb]; let g = 0; while (q.length && g++ < 600) { const c = q.shift(); if (!c) continue; if (c.stateNode instanceof HTMLElement) return c.stateNode; if (c.child) q.push(c.child); if (c.sibling) q.push(c.sibling); } return null; };
  // bool_info / 远程搜索下拉的 fieldInfo.options 是空的，选项只在内层 Select 的 props 上
  const selOptionsOf = dom => { if (!dom) return []; const found = [];
    for (const el of [dom, ...dom.querySelectorAll('input,textarea,label,div')].slice(0, 400)) { const k = fkey(el); if (!k) continue;
      let f = el[k], d = 0; while (f && d++ < 14) { const p = f.memoizedProps; if (isSel(p)) { if (!found.includes(p.options)) found.push(p.options); break; } f = f.return; } }
    return found; };

  function buildModel() {
    const m = collectFields().map(f => { const inf = f.memoizedProps.fieldInfo;
      const optsSrc = (Array.isArray(inf.options) && inf.options.length) ? inf.options : [].concat(...selOptionsOf(hostDom(f)));
      return { p: f.memoizedProps, dom: hostDom(f), blockId: inf.blockId, fid: inf.id, label: inf.name, type: inf.type, req: !!inf.isRequired,
        opts: optsSrc.filter(o => o && String(o.label != null ? o.label : (o.name != null ? o.name : '')) !== '')
          .map(o => ({ label: String(o.label != null ? o.label : (o.name != null ? o.name : '')), value: o.value !== undefined ? o.value : (o.id !== undefined ? o.id : o.code) })) }; });
    const ctr = new Map(); m.forEach(x => { const kk = x.blockId + '§' + x.fid; x.occ = ctr.get(kk) || 0; ctr.set(kk, x.occ + 1); });
    return m;
  }
  let model = buildModel();
  const target = st => { let hits = model.filter(m => (!st.blockId || m.blockId === st.blockId) && String(m.fid) === String(st.fid));
    if (!hits.length) hits = model.filter(m => (!st.blockId || m.blockId === st.blockId) && norm(m.label) === norm(st.fid));
    return hits[st.occ || 0] || (hits.length === 1 ? hits[0] : null); };
  const storeGet = (blockId, occ, key) => { const v = storeVals(); if (!v || v.__err) return undefined;
    const arr = v[blockId]; if (!Array.isArray(arr)) return undefined; const r = arr[occ] || {}; return key ? r[key] : r; };

  // ---------- 重复块按钮（「添加」/「删除本条」是行管理，不是提交） ----------
  const SUBMIT_RE = /提交|投递|申请并|确认|发送|支付|删除全部|下一步|完成|submit|apply now|send|confirm|pay/i;
  function blockRootOf(blockId) { const m = model.find(x => x.blockId === blockId); const el = m && m.dom; return el ? el.closest('[class*="apply-block-"]') : null; }
  function clickAdd(blockId, n) { const br = blockRootOf(blockId); if (!br) return { ok: false, why: '找不到区块 ' + blockId };
    const btn = [...br.querySelectorAll('button')].find(e => (e.textContent || '').trim() === '添加' && !SUBMIT_RE.test(e.textContent || ''));
    if (!btn) return { ok: false, why: '找不到「添加」按钮' };
    for (let i = 0; i < n; i++) btn.click();
    return { ok: true, n }; }
  async function delLast(blockId, n) { const br = blockRootOf(blockId); if (!br) return { ok: false, why: '找不到区块 ' + blockId };
    for (let i = 0; i < n; i++) {
      const btns = [...br.querySelectorAll('button')].filter(e => (e.textContent || '').trim() === '删除本条');
      if (!btns.length) return { ok: i > 0, why: '第 ' + (i + 1) + ' 次找不到「删除本条」', n: i };
      btns[btns.length - 1].scrollIntoView({ block: 'center' });
      btns[btns.length - 1].click();
      await sleep(STEP * 2);
    }
    return { ok: true, n }; }

  // ---------- 月份分片兜底：开一次面板真实点击（12 项小列表；onChange 写月份会清空 endDate） ----------
  const OPT_LEAF = '[class*="sd-Menu-content-item"],[class*="option-label"],[class*="sd-Select-common-item"]';
  const leaves = () => { const m = new Map();
    document.querySelectorAll(OPT_LEAF).forEach(e => { if (e.querySelector(OPT_LEAF)) return; const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { const t = (e.textContent || '').replace(/\s+/g, '').trim(); if (t && !m.has(t)) m.set(t, e); } });
    return m; };
  async function pickMonthByPanel(blk, month) {
    const trig = [...blk.querySelectorAll('label[class*="sd-Select-container"]')][3];   // 第 4 个分片 = 结束月
    if (!trig) return { ok: false, why: '找不到结束月份分片' };
    trig.scrollIntoView({ block: 'center' }); await sleep(150);
    trig.click(); await sleep(700);
    let hit = leaves().get(String(month));
    if (!hit) { await sleep(700); hit = leaves().get(String(month)); }
    if (!hit) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); return { ok: false, why: '面板里没有月份 ' + month }; }
    hit.click(); await sleep(STEP * 2);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); await sleep(200);
    return { ok: true };
  }

  // ---------- date_info 整行：起始端 _set_；结束端 年=分片 onChange、月=面板兜底；至今=checkbox ----------
  async function setDateRow(m, start, end) {
    const notes = [];
    const blk = m.dom && m.dom.closest('[class*="apply-field-"]');
    if (!blk) return { ok: false, why: '找不到字段块 DOM' };
    m.p._set_(start); notes.push('start=' + start); await sleep(STEP);
    const wantNow = (end === '至今' || !end);
    const cb = blk.querySelector('input[type=checkbox]');
    if (cb && cb.checked !== wantNow) { (cb.closest('label') || cb.parentElement).click(); notes.push('至今→' + wantNow); await sleep(STEP * 2); }
    if (!wantNow) {
      const sels = [];   // ⚠️ 切完「至今」必须重新收集（React 重渲染，旧 fiber props 失效）
      [...blk.querySelectorAll('input,label,div')].forEach(e => { const k = fkey(e); if (!k) return;
        let f = e[k], d = 0; while (f && d++ < 16) { const p = f.memoizedProps; if (isSel(p)) { if (!sels.includes(p)) sels.push(p); break; } f = f.return; } });
      if (sels.length < 4) return { ok: false, why: '结束分片不足(n=' + sels.length + ')', note: notes.join(' ') };
      const y = String(end).slice(0, 4), mo = +String(end).slice(5, 7);
      try { sels[2].onChange(y); notes.push('endY=' + y); } catch (e) { return { ok: false, why: '年份分片 EXC', note: notes.join(' ') }; }
      await sleep(STEP * 2);
      const r = await pickMonthByPanel(blk, mo);
      notes.push(r.ok ? 'endM=' + mo + '(面板)' : 'endM✗' + r.why);
      if (!r.ok) return { ok: false, why: r.why, note: notes.join(' ') };
    }
    return { ok: true, note: notes.join(' ') };
  }

  // ---------- 必填错误残留（程序写入后 DOM 文本可能滞后，以 store 为准，这里只做提示） ----------
  const requiredErrors = () => [...new Set([...document.querySelectorAll('[class*="apply-field-"]')]
    .filter(b => (b.innerText || '').indexOf('必填项未填写') >= 0)
    .map(b => { const t = (b.querySelector('[class*="title-"]') || {}).innerText || ''; return t.replace(/\s+/g, '').replace('必填项未填写', ''); }))];

  // ---------- STORE 模式：整表落盘，给 30_verify / 人工核对 ----------
  if (CONFIG.mode === 'store') return { mode: 'store', url: location.href, values: storeVals(), requiredErrors: requiredErrors() };

  // ---------- DUMP 模式：一次拿到全部字段的 id/类型/必填/选项/当前值（零开面板） ----------
  if (CONFIG.mode === 'dump') {
    const byBlock = {};
    model.forEach(x => { (byBlock[x.blockId] = byBlock[x.blockId] || []).push({ fid: x.fid, label: x.label, occ: x.occ, type: x.type, req: x.req,
      val: safe(() => x.p._get_()), opts: x.opts.length <= 20 ? x.opts : x.opts.slice(0, 5).concat([{ label: '…共' + x.opts.length }]) }); });
    return { mode: 'dump', url: location.href, nFields: model.length, byBlock };
  }

  // ---------- FILL 模式 ----------
  const results = [];
  for (const st of (CONFIG.steps || [])) {
    if (st.a === 'add') { const r = clickAdd(st.blockId, st.n || 1);
      if (r.ok) { await sleep(600); model = buildModel(); }              // ⚠️ add 后必须等重渲染再重建模型
      results.push({ ...st, ok: r.ok, why: r.why }); continue; }
    if (st.a === 'delLast') { const r = await delLast(st.blockId, st.n || 1);
      if (r.ok) { await sleep(400); model = buildModel(); }
      results.push({ ...st, ok: r.ok, why: r.why, deleted: r.n }); continue; }
    const m = target(st);
    if (!m) { results.push({ ...st, ok: false, why: '字段不在模型 ' + st.blockId + '/' + st.fid + ' occ' + (st.occ || 0) }); continue; }

    if (st.a === 'daterow') {
      const r = await setDateRow(m, st.start, st.end);
      await sleep(STEP);
      const gotS = storeGet(st.blockId, m.occ, 'startDate'), gotE = storeGet(st.blockId, m.occ, 'endDate');
      const ok = String(gotS) === String(st.start) && String(gotE) === String(st.end === '至今' ? '至今' : st.end);
      results.push({ ...st, label: m.label, occ: m.occ, ok, note: r.note || r.why, store: { startDate: gotS, endDate: gotE } });
      continue;
    }

    const before = safe(() => m.p._get_());
    if (typeof before === 'string' && typeof st.v === 'string' && before.trim() === st.v.trim()) { results.push({ ...st, ok: true, skipped: true, label: m.label, occ: m.occ }); continue; }
    const filled = before !== null && before !== '' && !(Array.isArray(before) && !before.length);
    if (st.onlyIfEmpty && filled) { results.push({ ...st, ok: true, kept: true, label: m.label, occ: m.occ, after: before }); continue; }

    let payload = st.v, note = '';
    const isDate = /date_info|day_info/.test(m.type);
    if (m.type === 'bool_info') {
      const o = m.opts.find(x => String(x.label) === String(st.v)) || m.opts.find(x => norm(x.label) === norm(st.v));
      if (!o) { results.push({ ...st, ok: false, label: m.label, why: 'bool 无此选项（不猜）', opts: m.opts.map(x => x.label) }); continue; }
      payload = o.value; note = 'bool→' + JSON.stringify(o.value);
    } else if (isDate && /^\d{4}-\d{1,2}(-\d{1,2})?$/.test(String(st.v))) {
      payload = st.v; note = 'date直写';
    } else if (m.opts.length) {
      // 选项闸门：只认「原文相等」或「归一化相等」，包含/近义一律拒绝（上层去问用户）
      const o = m.opts.find(x => String(x.label) === String(st.v)) || m.opts.find(x => norm(x.label) === norm(st.v));
      if (!o) { results.push({ ...st, ok: false, label: m.label, why: '选项里没有该值（不猜）', opts: m.opts.map(x => x.label).slice(0, 30) }); continue; }
      payload = o.value; note = '选项→' + JSON.stringify(o.value);
    } else {
      payload = st.v; note = '文本直写';
    }
    const after = safe(() => { m.p._set_(payload); return m.p._get_(); });
    safe(() => m.p._validate_ && m.p._validate_());
    await sleep(STEP);
    const domVal = m.dom ? ((m.dom.querySelector('[class*="display-value"]') || {}).textContent || (m.dom.querySelector('input,textarea') || {}).value || '').trim() : '';
    const want = String(Array.isArray(st.v) ? st.v.join(',') : st.v);
    const got = typeof after === 'object' && after ? JSON.stringify(after) : String(after);
    const ok = got.indexOf(want) >= 0 || domVal.indexOf(want) >= 0 || got === want || !!st.force;
    results.push({ blockId: st.blockId, fid: st.fid, occ: st.occ || 0, label: m.label, type: m.type, v: st.v, ok, note, after, domVal: domVal.slice(0, 40) });
  }
  return { mode: 'fill', url: location.href, wrote: results.filter(r => r.ok).length, bad: results.filter(r => !r.ok).length, results, requiredErrors: requiredErrors() };
})();
