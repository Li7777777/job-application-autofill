// scripts/10_scan_form.js —— 通用表单扫描器（与站点无关）
// 用法：整段粘进 browseros-neo_evaluate(page=<id>)；结果为 JSON 字符串，存成 data/runs/<host>-scan.json
//
// 做什么：
//   1) 找出页面上所有可填控件（含原生控件 + role=combobox 之类自定义组件）
//   2) 为每个控件推断“字段名”（多来源候选，按可信度排序）
//   3) 判定是否必填（required 属性 / aria / 星号 / “必填”字样），并标注可信度
//   4) 给控件打上 data-jaa-uid / data-jaa-kind / data-jaa-label 标记，
//      这样后续 20_fill.js 可以直接按 uid 精确定位，无需重复推断
// ⚠️ 形状要求：evaluate 按“函数体”执行 → 必须以 **顶层 return** 结束。

const CLEAN = s => (s || '')
  .replace(/[\u200b-\u200f\ufeff]/g, '')
  .replace(/[*＊]/g, '')
  .replace(/^\s*必填\s*[:：]?\s*/, '')
  .replace(/\s+/g, ' ')
  .trim();

const isVisible = el => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
};

const CTRL_SEL = [
  'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image])',
  'textarea',
  'select',
  '[role="combobox"]',
  '[role="listbox"]',
  '[contenteditable="true"]',
  '.ant-select-selector',                      // antd 自定义下拉
  '[class*="Select-container"]'                // mokahr sd-Select（会取其内部的 input）
].join(',');

// 控件自身的 class 往往只有哈希，真正的语义在同层容器上（如 mokahr 的 sd-Select-container / day_info）
const clsChain = (el, n = 3) => {
  let s = (el.className || '').toString(), p = el.parentElement, i = 0;
  while (p && i < n) { s += ' ' + ((p.className || '').toString()); p = p.parentElement; i++; }
  return s;
};

// —— 推断字段名：多来源候选 ——
// 要点：自定义组件里“包裹 label 的文字”往往就是当前选中值（如 mokahr 的“北京市”）；
// 真正的字段名在更外层的字段块里 → 收集各层祖先文字、剔除“控件自身文字”，再按“由外向内”排序
// 找“字段标题”：从控件包裹层之外向上找，取该层里第一个“不含控件、文字很短”的子元素
// （mokahr 的 <div class="title-*">意向工作城市</div> 就是这种情况）
const PAGE_TITLE = () => {
  const h = document.querySelector('h1, [role="heading"][aria-level="1"]');
  return h ? CLEAN(h.innerText).slice(0, 40) : '';
};

const fieldTitle = el => {
  const pageTitle = PAGE_TITLE();
  const start = (el.closest('label') || el).parentElement;
  let node = start, hop = 0;
  while (node && hop < 6 && node !== document.body) {
    const ctrlCount = node.querySelectorAll('input,textarea,select').length;
    if (ctrlCount <= 4) {
      for (const ch of node.children) {
        if (ch.contains(el)) continue;
        if (ch.querySelector('input,textarea,select,button')) continue;
        const t = CLEAN(ch.innerText);
        if (!t || t.length > 40) continue;
        if (/^(请选择|请选|年|月|日|-|—|至|至今)$/.test(t)) continue;
        if (pageTitle && t === pageTitle) continue;          // 页面大标题不是字段名
        return t;
      }
    }
    node = node.parentElement; hop++;
  }
  return null;
};

const labelCandidates = el => {
  const out = [];
  const push = (t, src) => { t = CLEAN(t); if (t && t.length <= 60 && !out.some(o => o.t === t)) out.push({ t, src }); };
  const displayTextOf = () => {
    const box = el.closest('label') || el.parentElement;
    const v = box && box.querySelector('[class*="display-value"],[class*="selection-item"],[class*="selected-value"],[class*="value-text"]');
    return CLEAN(v && v.innerText);
  };
  const selfTexts = new Set([CLEAN(el.value), CLEAN(el.getAttribute('placeholder')), displayTextOf()].filter(Boolean));
  push(fieldTitle(el), 'field-title');          // 最可信
  push(el.getAttribute('aria-label'), 'aria-label');
  const lb = el.getAttribute('aria-labelledby');
  if (lb) push(lb.split(/\s+/).map(id => document.getElementById(id)?.innerText).join(' '), 'aria-labelledby');
  if (el.id) {
    try { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) push(l.innerText, 'label[for]'); } catch (e) {}
  }
  const wl = el.closest('label');
  if (wl && !selfTexts.has(CLEAN(wl.innerText))) push(wl.innerText, 'wrapping-label');
  const anc = [];
  let node = el.parentElement, hop = 0;
  while (node && hop < 5 && node !== document.body) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('input,textarea,select,button,svg,img,[role="combobox"]').forEach(n => n.remove());
    const lines = (clone.innerText || '').split('\n').map(CLEAN)
      .filter(t => t && t.length <= 40 && !selfTexts.has(t));
    if (lines.length) anc.push(lines[0]);
    node = node.parentElement; hop++;
  }
  anc.forEach(t => push(t, 'ancestor-text'));   // 由内向外：外侧常是页面/区块标题
  push(el.placeholder, 'placeholder');
  push(el.getAttribute('title'), 'title');
  if (el.name) push(el.name, 'name');
  if (el.id) push(el.id, 'id');
  return out;
};

// 挑“显示用字段名”：优先第一个长度合理的候选（避免把 <label> 里的选项文本一起吃进来）
const pickLabel = cands => {
  if (!cands.length) return '';
  const short = cands.find(c => c.t.length <= 24);
  return (short || cands[0]).t;
};

// —— 必填判定 ——
// 关键：容器层数因框架而异（mokahr 的下拉多一层 Dropdown-container），要走够层数；
// 同时用“这个祖先里最多 4 个控件”确保是“字段级”而不是“区块级”
const requiredInfo = el => {
  if (el.required === true || el.getAttribute('aria-required') === 'true') return { required: true, confidence: 'high', why: 'required attr' };
  const cls = clsChain(el, 3);
  if (/\brequired\b|is-required|required-/.test(cls)) return { required: true, confidence: 'high', why: 'class=required' };
  let node = el.parentElement, hop = 0;
  while (node && hop < 6 && node !== document.body) {
    const txt = (node.innerText || '');
    const ctrlCount = node.querySelectorAll('input,textarea,select').length;
    if (txt.length < 150 && ctrlCount <= 4 && !/选填|非必填|不必填/.test(txt)) {
      const firstLine = CLEAN(txt.split('\n')[0] || '');
      if (/\*|＊/.test(txt) && firstLine) return { required: true, confidence: 'medium', why: 'ancestor has *' };
      if (/必填/.test(txt)) return { required: true, confidence: 'medium', why: 'ancestor says 必填' };
      const mark = node.querySelector('[class*="required"],[class*="Required"],[data-required]');
      if (mark) return { required: true, confidence: 'medium', why: 'descendant class=required' };
    }
    node = node.parentElement; hop++;
  }
  return { required: false, confidence: 'low', why: '' };
};

// —— 控件类型 ——
const kindOf = el => {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();
  const cls = clsChain(el, 3);
  const hint = [el.getAttribute('aria-label'), el.placeholder, el.name, el.id, cls].filter(Boolean).join(' ');
  if (type === 'file') return 'file';
  if (tag === 'textarea' || el.isContentEditable) return 'textarea';
  if (tag === 'select') return 'select';
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (/date|month|datetime-local/.test(type)) return 'date';
  if (type === 'color') return 'color';
  if (type === 'range') return 'range';
  // 日期类优先于 select 类（很多日期控件的容器类名里带 select，如 month-range-select）
  if (/date_info|day_info|datepicker|date-picker|month-range|calendar|picker/i.test(cls)) return 'date-picker';
  if (/出生|生日|日期|年月|birth|date/i.test(hint) && (el.readOnly || /日期|年月|年|月/.test(el.placeholder || ''))) return 'date-picker';
  if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') return 'custom-select';
  if (el.getAttribute('aria-haspopup') === 'dialog' || el.getAttribute('aria-haspopup') === 'true') return 'popup-picker';
  if (/select|dropdown|cascader/i.test(cls) || /请选择|请选/.test(el.placeholder || '')) return 'custom-select';
  return 'text';
};

// —— 采集 ——
const CHROME_SEL = 'header,nav,footer,[role="banner"],[role="contentinfo"],[role="navigation"]';
const seen = new Set();
const rawEls = [...document.querySelectorAll(CTRL_SEL)].filter(el => {
  if (seen.has(el)) return false;
  seen.add(el);
  if (el.disabled) return false;
  if (el.getAttribute('type') !== 'file' && el.closest(CHROME_SEL)) return false;   // 跳过站点头部/导航/搜索框
  return isVisible(el) || el.getAttribute('type') === 'file';
});

// 自定义组件包装：若命中 .ant-select-selector / [class*=Select-container]，取其内部真正的 input
const primaries = [...new Set(rawEls.map(el => el.querySelector('input,textarea') || el))];

const radioGroups = new Map();
const fields = [];
let uidSeq = 0;

primaries.forEach(el => {
  const type = (el.getAttribute('type') || '').toLowerCase();
  const kind = kindOf(el);
  const labels = labelCandidates(el);
  const req = requiredInfo(el);

  if (kind === 'radio') {
    const gname = el.name || `__nogroup_${uidSeq}`;
    if (!radioGroups.has(gname)) radioGroups.set(gname, []);
    radioGroups.get(gname).push(el);
    return;
  }

  const uid = 'f' + (uidSeq++);
  const label = pickLabel(labels);
  el.setAttribute('data-jaa-uid', uid);
  el.setAttribute('data-jaa-kind', kind);
  el.setAttribute('data-jaa-label', label.slice(0, 40));
  el.setAttribute('data-jaa-required', req.required ? '1' : '0');
  el.setAttribute('data-jaa-reqconf', req.confidence);
  fields.push({
    uid, kind, label, labels,
    required: req.required, requiredConfidence: req.confidence, requiredWhy: req.why,
    value: (el.value || '').slice(0, 80),
    readOnly: !!el.readOnly,
    options: kind === 'select' ? [...el.options].map(o => CLEAN(o.text)).filter(Boolean) : null,
    tag: el.tagName.toLowerCase(), type,
    name: el.name || null, id: el.id || null
  });
});

// 单选组：合成一个字段
radioGroups.forEach((els, gname) => {
  const uid = 'f' + (uidSeq++);
  els.forEach(e => {
    e.setAttribute('data-jaa-uid', uid);
    e.setAttribute('data-jaa-kind', 'radio-group');
  });
  const labels = labelCandidates(els[0]);
  const req = requiredInfo(els[0]);
  const container = els[0].closest('fieldset, [class*="group"], [class*="radio"], form > div, form > li') || els[0].parentElement;
  const optionTexts = els.map(e => CLEAN(e.closest('label')?.innerText || e.parentElement?.innerText || e.value)).filter(Boolean);
  container?.setAttribute('data-jaa-group', uid);          // 容器用 group 属性，避免被当成字段本体
  container?.setAttribute('data-jaa-kind', 'radio-group');
  container?.setAttribute('data-jaa-required', req.required ? '1' : '0');
  container?.setAttribute('data-jaa-reqconf', req.confidence);
  fields.push({
    uid, kind: 'radio-group', label: pickLabel(labels), labels,
    required: req.required, requiredConfidence: req.confidence, requiredWhy: req.why,
    value: els.filter(e => e.checked).map(e => e.value).join(','),
    options: optionTexts, groupName: gname, count: els.length
  });
});

// 统计
const summary = {
  total: fields.length,
  required: fields.filter(f => f.required).length,
  requiredLowConfidence: fields.filter(f => f.required && f.requiredConfidence !== 'high').map(f => f.label || f.uid),
  noLabel: fields.filter(f => !f.label).map(f => f.uid),
  byKind: fields.reduce((a, f) => { a[f.kind] = (a[f.kind] || 0) + 1; return a; }, {})
};

return JSON.stringify({
  url: location.href,
  host: location.host,
  title: document.title,
  at: new Date().toISOString(),
  summary,
  fields
});
