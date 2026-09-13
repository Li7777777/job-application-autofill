// scripts/10_scan_form.js —— 通用表单扫描器（与站点无关）
// 用法：整段粘进 browseros-neo_evaluate(page=<id>)；结果为 JSON 字符串，存成 data/runs/<host>-scan.json
//
// 做什么：
//   1) 找出页面上所有可填控件（原生控件 + role=combobox 之类自定义组件）
//   2) 为每个控件推断「字段名」（多来源候选，按可信度排序）+ 归一化名（去掉「必填/添加/编辑/全角括号」等噪声）
//   3) 判定是否必填（required 属性 / aria / 星号 / 「必填」字样 / 框架 class），并标注可信度
//   4) 识别控件所属 **区块(section)** 与 **重复块序号(block)**（多段教育/实习经历靠它区分）
//   5) 识别控件属于哪个前端组件框架（antd / ElementUI / Moka / 北森 / Hotjob / ATSX / 飞书）
//   6) 给控件打 data-jaa-* 标记，20_fill.js / 15_dump_state.js 直接按 uid 精确定位
//
// ⚠️ 形状要求：evaluate 按“函数体”执行 → 必须以 **顶层 return** 结束。
//
// 设计来源：逆向「牛客网申助手」的表单抽取链路（level1/level2/group 三级定位 +
//           getElementText 标签归一化 + 平台选择器配置），并按本 skill 的
//           「站点无关 + 不确定就问」原则重写。配套：assets/platform-selectors.json

// ======== 可选：站点适配覆盖（写进 references/adapters/<host>.md 的选择器放这里） ========
const OVERRIDE = {
  framework: null,          // 例 'mokahr'
  layout: null,             // 例 { group_class: '...', level1_class: '...', level2_class: '...' }
  extraControlSelector: ''  // 例 '.myEditor [contenteditable]'
};

// —— 先清掉上一轮扫描留下的标记 ——
// SPA（mokahr/北森这类）重渲染后旧元素会**保留旧的 data-jaa-uid**，而新扫描又用同样的 uid 字符串
// 标记新元素 → 页面上出现两个 [data-jaa-uid="f36"]，分别对应**不同字段**；
// 填充/回读用 querySelector 取到的是 DOM 里靠前的那个（可能是上一轮的）→ 会静默填错字段。
// 实测：mokahr 宇通表单上 f36 同时挂在「本科专业」和「毕业时间(已禁用)」上。
document.querySelectorAll('[data-jaa-uid]').forEach(e => {
  for (const a of Array.from(e.attributes)) if (a.name.indexOf('data-jaa-') === 0) e.removeAttribute(a.name);
});

// ======== 平台配置（与 assets/platform-selectors.json 保持同步；见 tests/selftest.py 的漂移守卫） ========
const JAA_PLATFORM = JSON.parse(String.raw`
{
  "frameworks": {
    "antd":     { "detect": [".ant-select", ".ant-select-selector", ".ant-picker", ".ant-calendar-picker", ".ant-cascader", ".ant-tree-select", ".ant-form-item", ".ant-input"] },
    "element":  { "detect": [".el-select", ".el-input", ".el-date-editor", ".el-form-item", ".el-cascader", ".el-select-dropdown"] },
    "atsx":     { "detect": [".atsx-select", ".atsx-form-item", ".atsx-date-picker", ".atsx-select-selection"] },
    "mokahr":   { "detect": ["[class*=\"sd-Select\"]", "[class*=\"sd-Input\"]", "[class*=\"apply-block-\"]", "[class*=\"sd-Dropdown\"]", "[class*=\"sd-picker\"]"] },
    "beisen":   { "detect": [".ux-standard-form", "[class*=\"phoenix-selectList\"]", "[class^=\"dl_menutit\"]", "[id*=\"_Recruitment_\"]"] },
    "hotjob":   { "detect": ["[class~=\"form-cell-inner\"]", ".set_i_content_table", ".resume_info_title"] },
    "feishu":   { "detect": [".ud__select", ".ud__picker", ".ud__form__item", ".bitable-form-item", ".ud__tree"] }
  },
  "layout_presets": {
    "antd-form":    { "group_class": ".ant-form-item", "level1_class": ".ant-card-head-title, .ant-collapse-header, h2, h3", "level2_class": ".ant-form-item-label label, .ant-form-item-label" },
    "element-form": { "group_class": ".el-form-item", "level1_class": ".el-collapse-item__header, .el-card__header, h2, h3", "level2_class": ".el-form-item__label" },
    "mokahr":       { "group_class": "[class^=\"apply-block-\"] [class^=\"apply-fields\"]", "level1_class": "[class^=\"apply-block-\"] [class^=\"blockTitle\"] span[class^=\"text-\"]", "level2_class": "[class^=\"apply-block-\"] [class^=\"title-\"]" },
    "beisen":       { "group_class": "[class~=\"ux-standard-form\"], .mainContainer > form .form_container", "level1_class": "[id*=\"_Recruitment_\"]:not(:has(*)), [class^=\"dl_menutit\"]", "level2_class": "[class^=\"form-item__text\"], .form_part_container li > label" },
    "atsx-form":    { "group_class": ".resumeEditForm-item", "level1_class": ".createFormSection-title", "level2_class": ".atsx-form-item-label" },
    "hotjob":       { "group_class": "[class~=\"form-cell-inner\"], .set_i_content_table", "level1_class": ".tit, .setTitle", "level2_class": ".ant-form-item-label, .resume_info_title" },
    "feishu":       { "group_class": ".bitable-form-item", "level1_class": ".bitable-form-item .ud__form__item__label, h2, h3", "level2_class": ".ud__form__item__label label[title], .ud__form__item__label label" }
  },
  "framework_to_layout": {
    "antd": "antd-form", "element": "element-form", "atsx": "atsx-form",
    "mokahr": "mokahr", "beisen": "beisen", "hotjob": "hotjob", "feishu": "feishu"
  },
  "date_granularity_hints": {
    "day":   ["yyyy[-/.年]?mm[-/.月]?dd", "yyyymmdd", "年月日", "具体日期"],
    "month": ["yyyy[-/.年]?mm(?![-/.月]?dd)", "yyyymm", "年\\s*月", "年月"],
    "year":  ["yyyy(?![-/.年]?mm)", "年份"]
  }
}
`);

// 从 placeholder/name/id/title 猜「组件支持到哪一级」（故意不看 label）
const GRAN_RANK = { year: 1, month: 2, day: 3 };
const GRAN_PATTERNS = ['day', 'month', 'year'].map(g => [g, (JAA_PLATFORM.date_granularity_hints[g] || []).map(s => { try { return new RegExp(s, 'i'); } catch (e) { return null; } }).filter(Boolean)]);

const dateGranularityHint = el => {
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (type === 'date' || type === 'datetime-local') return 'day';
  if (type === 'month' || type === 'week') return 'month';
  if (type === 'time') return null;
  const hint = [el.placeholder, el.getAttribute('aria-label'), el.getAttribute('title'), el.name, el.id]
    .filter(Boolean).join(' ');
  if (!hint) return null;
  for (const [g, pats] of GRAN_PATTERNS) for (const re of pats) if (re.test(hint)) return g;
  return null;
};

// —— 小工具 ——
const CLEAN = s => (s || '')
  .replace(/[\u200b-\u200f\ufeff]/g, '')
  .replace(/[*＊]/g, '')
  .replace(/^\s*必填\s*[:：]?\s*/, '')
  .replace(/\s+/g, ' ')
  .trim();

// 标签归一化（移植自牛客插件的 getElementText）：去掉「（必填）(可选) 添加 编辑 1.」等噪声，
// 让「毕业时间（必填）」与「毕业时间」落到同一个键上
const LABEL_NOISE = ['（必填）', '(必填)', '（可选）', '(可选)', '（选填）', '(选填)', '必填', '选填', '可选', '添加', '编辑'];
const stripLabelNoise = s => {
  let t = CLEAN(s);
  for (const n of LABEL_NOISE) t = t.split(n).join('');
  t = t.replace(/[（(][^）)]*[）)]/g, '');       // 整段括号内容（如「项目名称（英文）」→「项目名称」）
  t = t.replace(/\s+/g, '').replace(/^\d+[.、]/, '').replace(/^[+＋]/, '');
  return t.trim();
};

const safeQ = (sel, root) => { try { return [...(root || document).querySelectorAll(sel)]; } catch (e) { return []; } };
const q1 = (sel, root) => { try { return (root || document).querySelector(sel); } catch (e) { return null; } };

const isVisible = el => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
};

// 控件自身的 class 往往只有哈希，真正的语义在同层容器上
const clsChain = (el, n = 3) => {
  let s = (el.className || '').toString(), p = el.parentElement, i = 0;
  while (p && i < n) { s += ' ' + ((p.className || '').toString()); p = p.parentElement; i++; }
  return s;
};

// —— 框架识别 ——
const pageFramework = (() => {
  const score = {};
  for (const [name, cfg] of Object.entries(JAA_PLATFORM.frameworks)) {
    let hits = 0;
    for (const sel of cfg.detect) hits += Math.min(safeQ(sel).length, 20);
    if (hits) score[name] = hits;
  }
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return { name: OVERRIDE.framework || (best ? best[0] : null), score };
})();

const frameworkOf = el => {
  if (OVERRIDE.framework) return OVERRIDE.framework;
  let node = el, hop = 0;
  while (node && hop < 8 && node !== document.body) {
    for (const [name, cfg] of Object.entries(JAA_PLATFORM.frameworks)) {
      for (const sel of cfg.detect) { try { if (node.matches(sel)) return name; } catch (e) {} }
    }
    node = node.parentElement; hop++;
  }
  return pageFramework.name;
};

const layoutPreset = (() => {
  const presetName = JAA_PLATFORM.framework_to_layout[pageFramework.name];
  const preset = (presetName && JAA_PLATFORM.layout_presets[presetName]) || null;
  return OVERRIDE.layout || preset || { group_class: '', level1_class: '', level2_class: '' };
})();

const PAGE_TITLE = () => {
  const h = q1('h1, [role="heading"][aria-level="1"]');
  return h ? CLEAN(h.innerText).slice(0, 40) : '';
};

// —— 控件选择器 ——
const CTRL_SEL = [
  'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image])',
  'textarea',
  'select',
  '[role="combobox"]',
  '[role="listbox"]',
  '[contenteditable="true"]:not([contenteditable="false"])',
  '.ant-select-selector',
  '.el-select__wrapper',
  '[class*="Select-container"]',
  '[class*="sd-Select-"]',
  '.atsx-select-selection',
  '.ud__select',
  '.phoenix-selectList'
].join(',');

// —— 字段名推断 ——
const fieldTitle = el => {
  const pageTitle = PAGE_TITLE();
  const dvNode = displayValueNode(el);      // 当前选中值不是字段名
  const start = (el.closest('label') || el).parentElement;
  let node = start, hop = 0;
  while (node && hop < 6 && node !== document.body) {
    const ctrlCount = node.querySelectorAll('input,textarea,select,[contenteditable="true"]').length;
    if (ctrlCount <= 4) {
      for (const ch of node.children) {
        if (ch.contains(el)) continue;
        if (dvNode && (ch === dvNode || ch.contains(dvNode))) continue;
        if (ch.querySelector('input,textarea,select,button,[role="combobox"]')) continue;
        const t = CLEAN(ch.innerText);
        if (!t || t.length > 40) continue;
        // 占位符文案（「请选择国籍/地区」这种）不是字段名：前缀匹配掉，且跳过 placeholder 节点
        if (/^(请选择|请选|请填写|请输入|请上传|年|月|日|-|—|至|至今)/.test(t)) continue;
        if (/placeholder/i.test(ch.className || '')) continue;
        if (pageTitle && t === pageTitle) continue;
        return t;
      }
    }
    node = node.parentElement; hop++;
  }
  return null;
};

// 显示层节点：antd v3 的 `.ant-select-selection-selected-value` 与搜索框 input 是**兄弟**
// （在 `.ant-select-selection__rendered` 里，而 input 在 `.ant-select-search__field__wrap` 里），
// 旧版只在 `el.parentElement` 里找 → antd v3 的自定义下拉一律读成空值。
// 现在沿祖先找（≤6 层，遇到控件根就停），并排除 placeholder 节点与“请选择…”这类占位文本。
const DISPLAY_STOP_SEL = '.ant-select, .el-select, .ud__select, [class*="sd-Select"], .phoenix-select, .atsx-select, .ant-cascader-picker,'
  + ' [class*="apply-field-"], [class*="form-item"], [class*="form-cell"], [class*="field-item"]';
const DISPLAY_PLACEHOLDER_RE = /^(请选择|请选|请填写|请输入|请上传|--|—)/;
const displayNodeIn = (el, sels) => {
  const list = (sels || []).filter(Boolean);
  let n = el.parentElement, hop = 0;
  while (n && hop < 6) {
    for (const s of list) {
      for (const c of safeQ(s, n)) {
        if (c === el || c.contains(el)) continue;
        if (/placeholder/i.test(c.className || '')) continue;
        const t = CLEAN(c.innerText);
        if (t && !DISPLAY_PLACEHOLDER_RE.test(t)) return c;
      }
    }
    if (n.matches && n.matches(DISPLAY_STOP_SEL)) break;
    n = n.parentElement; hop++;
  }
  return null;
};

const displayValueNode = el => {
  const cfg = JAA_PLATFORM.frameworks[frameworkOf(el)] || {};
  const sels = [
    '[class*="display-value"]', '[class*="selection-item"]', '[class*="selected-value"]',
    '[class*="value-text"]', '[class*="selection-selected"]', '[class*="select__selected"]'
  ];
  if (cfg.display_value_selector) sels.unshift(...cfg.display_value_selector.split(',').map(s => s.trim()));
  return displayNodeIn(el, sels);
};

const labelCandidates = el => {
  const out = [];
  const push = (t, src) => { t = CLEAN(t); if (t && t.length <= 60 && !out.some(o => o.t === t)) out.push({ t, src }); };
  const dvNode = displayValueNode(el);
  const selfTexts = new Set([CLEAN(el.value), CLEAN(el.getAttribute('placeholder')), CLEAN(dvNode && dvNode.innerText)].filter(Boolean));
  push(fieldTitle(el), 'field-title');
  push(el.getAttribute('aria-label'), 'aria-label');
  const lb = el.getAttribute('aria-labelledby');
  if (lb) push(lb.split(/\s+/).map(id => document.getElementById(id)?.innerText).join(' '), 'aria-labelledby');
  if (el.id) {
    const l = q1(`label[for="${(window.CSS && CSS.escape) ? CSS.escape(el.id) : el.id}"]`);
    if (l) push(l.innerText, 'label[for]');
  }
  const wl = el.closest('label');
  if (wl && !selfTexts.has(CLEAN(wl.innerText))) push(wl.innerText, 'wrapping-label');
  // 框架提供的 level2 标签（最准）
  // ① 优先在「字段容器 group_class」里找：antd/Element 的控件内层嵌套很深
  //    （实测 hotjob 的 `.ant-select-search__field` 距 `.ant-form-item` 有 6~7 层，
  //    固定 4 层的向上循环根本够不到 label → 只能退化成 placeholder 文本）。
  if (layoutPreset.level2_class && layoutPreset.group_class) {
    const grp = el.closest(layoutPreset.group_class);
    if (grp) {
      for (const s of layoutPreset.level2_class.split(',').map(x => x.trim()).filter(Boolean)) {
        const t = q1(s, grp);
        if (t && CLEAN(t.innerText) && !t.contains(el)) { push(t.innerText, 'level2-in-group'); break; }
      }
    }
  }
  if (layoutPreset.level2_class) {
    let node = el.parentElement, hop = 0;
    while (node && hop < 4 && node !== document.body) {
      const t = q1(layoutPreset.level2_class, node);
      if (t && CLEAN(t.innerText) && !t.contains(el)) { push(t.innerText, 'level2-class'); break; }
      node = node.parentElement; hop++;
    }
  }
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
  anc.forEach(t => push(t, 'ancestor-text'));
  push(el.placeholder, 'placeholder');
  push(el.getAttribute('title'), 'title');
  if (el.name) push(el.name, 'name');
  if (el.id) push(el.id, 'id');
  return out;
};

const pickLabel = cands => {
  if (!cands.length) return '';
  const short = cands.find(c => c.t.length <= 24);
  return (short || cands[0]).t;
};

// —— 区块(section) 与 重复块(block) ——
const sectionTitles = (() => {
  const sels = [];
  if (layoutPreset.level1_class) sels.push(layoutPreset.level1_class);
  sels.push('h1,h2,h3,h4,h5,h6,legend,[role="heading"],[class*="blockTitle"],[class*="section-title"],[class*="SectionTitle"],[class*="card-head-title"],[class*="collapse-header"]');
  const out = [];
  for (const sel of sels) {
    for (const n of safeQ(sel)) {
      if (out.includes(n)) continue;
      if (!isVisible(n)) continue;
      if (n.querySelector('input,textarea,select,button,[contenteditable="true"]')) continue;
      if (n.closest('label')) continue;
      const t = stripLabelNoise(n.innerText);
      if (!t || t.length > 30) continue;
      out.push(n);
    }
    if (out.length) break;                 // 框架预设命中就不再用兜底选择器
  }
  return out;
})();

const sectionOf = el => {
  let best = null, bestIdx = -1;
  sectionTitles.forEach((node, i) => {
    if (node === el || node.contains(el)) return;
    const pos = node.compareDocumentPosition(el);
    const after = !!(pos & Node.DOCUMENT_POSITION_FOLLOWING) || !!(pos & Node.DOCUMENT_POSITION_CONTAINED_BY);
    if (after) { best = node; bestIdx = i; }
  });
  return { text: best ? stripLabelNoise(best.innerText) : '', index: bestIdx };
};

const SIGN = c => {
  const cls = [...(c.classList || [])].filter(t => t.length < 24 && !/^[0-9a-f]{8,}$/i.test(t)).sort().join('.');
  return c.tagName + '|' + cls;
};

// 一个「重复块兄弟」的字段名（优先框架 level2_class）
const blockLabelOf = node => {
  const s = layoutPreset.level2_class;
  if (s) { const t = q1(s, node); if (t && CLEAN(t.innerText)) return stripLabelNoise(t.innerText); }
  const leaf = [...node.querySelectorAll('*')].find(e => e.children.length === 0 && CLEAN(e.innerText));
  return leaf ? stripLabelNoise(leaf.innerText) : '';
};

// 把一组「同构兄弟」按「字段名重复」切分成**记录**：
// 教育背景的一条记录里有 学校名称/专业名称/学历 三个兄弟块，第二次见到「学校名称」
// 才是下一条记录的开始。只看兄弟下标会把「专业名称」误当成第 2 条记录。
const groupIntoRecords = sibs => {
  const labels = sibs.map(blockLabelOf);
  const rec = [];
  let cur = new Set(), idx = -1;
  for (let i = 0; i < sibs.length; i++) {
    const L = labels[i];
    if (idx < 0 || (L && cur.has(L))) { idx += 1; cur = new Set(); }
    if (L) cur.add(L);
    rec.push(idx);
  }
  return { rec, count: idx + 1 };
};

// block 只在「真的识别出多段」时才算数（count > 1）；否则返回 -1，
// 让 40_build_mapping.py 退回「按 canonical 出现顺序」的老策略（避免把单段表单压成一条记录）。
const blockOf = el => {
  const gs = layoutPreset.group_class;
  if (gs) {
    const g = el.closest(gs);
    if (g && g.parentElement) {
      const sibs = [...g.parentElement.children].filter(c => { try { return c.matches(gs); } catch (e) { return false; } });
      if (sibs.length >= 2 && sibs.length <= 60) {
        const { rec, count } = groupIntoRecords(sibs);
        const i = sibs.indexOf(g);
        if (i >= 0 && count > 1) return { index: rec[i], count, node: g, via: 'group_class' };
      }
    }
  }
  // 兜底：向上找「父节点里有 ≥2 个同签名兄弟」的最高层
  let node = el, hop = 0, best = null;
  while (node && node.parentElement && hop < 12 && node !== document.body) {
    const sig = SIGN(node);
    const sibs = [...node.parentElement.children].filter(c => SIGN(c) === sig && c.querySelectorAll('input,textarea,select,[contenteditable="true"]').length);
    if (sibs.length >= 2 && sibs.length <= 30) {
      const { rec, count } = groupIntoRecords(sibs);
      if (count > 1) best = { index: rec[sibs.indexOf(node)], count, node, via: 'sibling-signature' };
    }
    node = node.parentElement; hop++;
  }
  return best || { index: -1, count: 0, node: null, via: null };
};

// —— 必填判定 ——
const REQ_MARK = '[class*="required"],[class*="Required"],[class*="asterisk"],[class*="Asterisk"],[data-required]';

// 字段的「标签行」：优先框架 level2_class，其次同层第一个「不含控件、文字 ≤24」的兄弟。
// 返回的是该标签所在的**字段行**（含控件那一层），这样「空 span 的必填星号」也能被找到。
const labelRowOf = el => {
  let node = el.parentElement, hop = 0;
  while (node && hop < 4 && node !== document.body) {
    const s = layoutPreset.level2_class;
    if (s) { const t = q1(s, node); if (t && !t.contains(el) && CLEAN(t.innerText)) return t.parentElement || t; }
    for (const ch of node.children) {
      if (ch.contains(el)) continue;
      if (ch.querySelector('input,textarea,select,[role="combobox"],button,[contenteditable="true"]')) continue;
      const t = CLEAN(ch.innerText);
      if (t && t.length <= 24) return ch.parentElement || ch;
    }
    node = node.parentElement; hop++;
  }
  return null;
};

const reqFromMeta = el => {
  if (el.required === true || el.getAttribute('aria-required') === 'true') return { required: true, confidence: 'high', why: 'required attr' };
  if (el.getAttribute('data-required') === 'true') return { required: true, confidence: 'high', why: 'data-required' };
  const cls = clsChain(el, 3);
  if (/\brequired\b|is-required|required-/.test(cls)) return { required: true, confidence: 'high', why: 'class=required' };
  const fw = frameworkOf(el);
  if (fw === 'antd') {
    const box = el.closest('.ant-form-item');
    if (box && box.querySelector('.ant-form-item-required')) return { required: true, confidence: 'high', why: 'ant-form-item-required' };
  }
  if (fw === 'element') {
    const box = el.closest('.el-form-item');
    if (box && (box.classList.contains('is-required') || box.querySelector('.is-required'))) return { required: true, confidence: 'high', why: 'el is-required' };
  }
  return null;
};

const requiredInfo = el => {
  const meta = reqFromMeta(el);
  if (meta) return meta;
  // 1) 标签行（及其所在字段行）里的标记 —— 最准，能避开「同区块另一个字段必填」的误判
  const row = labelRowOf(el);
  if (row) {
    const txt = CLEAN(row.innerText || '');
    if (/\*|＊/.test(txt)) return { required: true, confidence: 'high', why: 'label row has *' };
    if (/必填/.test(txt)) return { required: true, confidence: 'high', why: 'label row says 必填' };
    if (row.querySelector(REQ_MARK)) return { required: true, confidence: 'high', why: 'label row has required marker' };
    return { required: false, confidence: 'medium', why: 'label row clean' };
  }
  // 2) 退路：字段级容器（控件数 ≤ 2；控件一多就无法把星号归给具体字段）
  let node = el.parentElement, hop = 0;
  while (node && hop < 7 && node !== document.body) {
    const txt = (node.innerText || '');
    const ctrlCount = node.querySelectorAll('input,textarea,select,[contenteditable="true"]').length;
    if (txt.length < 150 && ctrlCount <= 2 && !/选填|非必填|不必填/.test(txt)) {
      if (/\*|＊/.test(txt)) return { required: true, confidence: 'medium', why: 'ancestor has *' };
      if (/必填/.test(txt)) return { required: true, confidence: 'medium', why: 'ancestor says 必填' };
      const mark = node.querySelector(REQ_MARK);
      if (mark) return { required: true, confidence: 'medium', why: 'descendant class=required' };
    }
    node = node.parentElement; hop++;
  }
  return { required: false, confidence: 'low', why: '' };
};

// —— 控件类型 ——
const RANGE_HINT = /date-range|daterange|range-picker|rangepicker|month-range|period/i;
const kindOf = el => {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();
  const cls = clsChain(el, 3);
  const hint = [el.getAttribute('aria-label'), el.placeholder, el.name, el.id, cls].filter(Boolean).join(' ');
  const fw = frameworkOf(el);
  if (type === 'file') return 'file';
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (type === 'color') return 'color';
  if (type === 'range') return 'range';
  if (/^(date|month|datetime-local|week|time)$/.test(type)) return 'date';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (el.isContentEditable) return 'rich-text';
  // 组件框架特征
  if (/cascader/i.test(cls)) return 'cascader';
  if (q1('.ud__tree, .ant-select-tree-wrapper, .ant-tree, .el-tree, .el-cascader-panel', el) || /tree-select|treeselect/i.test(cls)) return 'tree-select';
  if (RANGE_HINT.test(cls) || (q1('.throne-biz-date-range-picker-input', el))) return 'date-range';
  if (/date_info|day_info|datepicker|date-picker|calendar|picker|month-select|year-select|basic-selector-year|basic-selector-month/i.test(cls)) return 'date-picker';
  if (/年月|出生|生日|日期|毕业时间|起止|至|birth|date|month/i.test(hint) && (el.readOnly || /[年月日]|date|month/i.test(el.placeholder || ''))) return 'date-picker';
  if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') return 'custom-select';
  if (el.getAttribute('aria-haspopup') === 'dialog' || el.getAttribute('aria-haspopup') === 'true') return 'popup-picker';
  if (/select|dropdown/i.test(cls) || /请选择|请选/.test(el.placeholder || '')) return 'custom-select';
  if (fw && /select|dropdown|picker/i.test(cls)) return 'custom-select';
  return 'text';
};

// —— 读当前显示值 ——
// ⚠️ 「显示层兜底」只能用于**自定义组件**：对裸 input/textarea，值就是 el.value，
// 去猜外层容器会把标签文字（如「出生日期 (年龄)」）当成已填值。
const CUSTOM_KINDS = ['custom-select', 'cascader', 'tree-select', 'popup-picker'];
const readDisplay = (el, kind) => {
  const t = (el.getAttribute('type') || '').toLowerCase();
  if (t === 'checkbox') return el.checked ? '是' : '否';
  if (t === 'radio') return el.checked ? CLEAN(el.closest('label')?.innerText || el.value) : '';
  if (el.tagName === 'SELECT') return CLEAN(el.selectedOptions?.[0]?.text || el.value);
  const dv = displayValueNode(el);
  if (dv && CLEAN(dv.innerText)) return CLEAN(dv.innerText).slice(0, 120);
  if (el.value) return CLEAN(el.value).slice(0, 120);
  if (!CUSTOM_KINDS.includes(kind || '')) return '';
  const box = el.closest('[class*="Select"],[class*="select"],[class*="Input"],[class*="input"],label') || el.parentElement;
  return CLEAN((box?.innerText || '').split('\n')[0] || '').slice(0, 120);
};

// —— 采集 ——
const CHROME_SEL = 'header,nav,footer,[role="banner"],[role="contentinfo"],[role="navigation"]';
const seen = new Set();
const rawEls = [...document.querySelectorAll(OVERRIDE.extraControlSelector ? CTRL_SEL + ',' + OVERRIDE.extraControlSelector : CTRL_SEL)]
  .filter(el => {
    if (seen.has(el)) return false;
    seen.add(el);
    if (el.disabled) return false;
    if (el.getAttribute('type') !== 'file' && el.closest(CHROME_SEL)) return false;
    return isVisible(el) || el.getAttribute('type') === 'file';
  });

// 自定义组件包装：若命中包装层，取其内部真正的 input
const primaries = [...new Set(rawEls.map(el => el.querySelector('input,textarea') || el))];

const radioGroups = new Map();
const fields = [];
let uidSeq = 0;

const mkField = (el, uid, kind, labels, req, extra) => {
  const label = pickLabel(labels);
  const labelNorm = stripLabelNoise(label);
  const sec = sectionOf(el);
  const blk = blockOf(el);
  el.setAttribute('data-jaa-uid', uid);
  el.setAttribute('data-jaa-kind', kind);
  el.setAttribute('data-jaa-label', label.slice(0, 40));
  el.setAttribute('data-jaa-label-norm', labelNorm.slice(0, 40));
  el.setAttribute('data-jaa-required', req.required ? '1' : '0');
  el.setAttribute('data-jaa-reqconf', req.confidence);
  if (sec.text) el.setAttribute('data-jaa-section', sec.text.slice(0, 40));
  if (blk.index >= 0) el.setAttribute('data-jaa-block', String(blk.index));
  const fw = frameworkOf(el);
  if (fw) el.setAttribute('data-jaa-framework', fw);
  return Object.assign({
    uid, kind, label, labelNorm, labels,
    labelRaw: labels.length ? labels[0].t : '',
    section: sec.text, sectionIndex: sec.index,
    block: blk.index, blockCount: blk.count, blockVia: blk.via,
    framework: fw,
    granularity: (kind === 'date' || kind === 'date-picker' || kind === 'date-range') ? dateGranularityHint(el) : null,
    required: req.required, requiredConfidence: req.confidence, requiredWhy: req.why,
    value: readDisplay(el, kind),
    filled: !!CLEAN(readDisplay(el, kind)),
    readOnly: !!el.readOnly,
    options: null,
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute('type') || '').toLowerCase(),
    name: el.name || null, id: el.id || null
  }, extra || {});
};

primaries.forEach(el => {
  const type = (el.getAttribute('type') || '').toLowerCase();
  const kind = kindOf(el);
  if (kind === 'radio') {
    const gname = el.name || `__nogroup_${uidSeq}`;
    if (!radioGroups.has(gname)) radioGroups.set(gname, []);
    radioGroups.get(gname).push(el);
    return;
  }
  const labels = labelCandidates(el);
  const req = requiredInfo(el);
  const uid = 'f' + (uidSeq++);
  fields.push(mkField(el, uid, kind, labels, req, {
    options: kind === 'select' ? [...el.options].map(o => CLEAN(o.text)).filter(Boolean) : null
  }));
});

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
  if (container) {
    container.setAttribute('data-jaa-group', uid);
    container.setAttribute('data-jaa-kind', 'radio-group');
    container.setAttribute('data-jaa-required', req.required ? '1' : '0');
    container.setAttribute('data-jaa-reqconf', req.confidence);
  }
  const f = mkField(els[0], uid, 'radio-group', labels, req, {
    options: optionTexts, groupName: gname, count: els.length,
    value: els.filter(e => e.checked).map(e => CLEAN(e.closest('label')?.innerText || e.value)).join(',')
  });
  f.filled = !!f.value;
  fields.push(f);
});

// —— 统计 ——
const byKind = {}, byFramework = {}, bySection = {};
fields.forEach(f => {
  byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  byFramework[f.framework || 'unknown'] = (byFramework[f.framework || 'unknown'] || 0) + 1;
  bySection[f.section || '(无区块)'] = (bySection[f.section || '(无区块)'] || 0) + 1;
});
const summary = {
  total: fields.length,
  required: fields.filter(f => f.required).length,
  filled: fields.filter(f => f.filled).length,
  requiredLowConfidence: fields.filter(f => f.required && f.requiredConfidence !== 'high').map(f => f.label || f.uid),
  noLabel: fields.filter(f => !f.label).map(f => f.uid),
  byKind, byFramework, bySection,
  multiBlock: fields.filter(f => f.blockCount > 1).length
};

return JSON.stringify({
  url: location.href,
  host: location.host,
  title: document.title,
  at: new Date().toISOString(),
  platform: { framework: pageFramework.name, score: pageFramework.score, layout: layoutPreset, override: OVERRIDE },
  summary,
  fields
});
