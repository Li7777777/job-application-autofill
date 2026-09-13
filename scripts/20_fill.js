// scripts/20_fill.js —— 通用表单填充器（与站点无关，靠 10_scan_form.js 打的 data-jaa-* 标记定位）
// 用法：改好 MAPPING 后整段粘进 browseros-neo_evaluate(page=<id>, timeout=120000)
//   返回 { ok, skipped, failed, suggestions, probed, notes, log }
//   ok / skipped / failed / suggestions 都是 {uid,label,value,detail}
//
// 铁律：
//   * 只写表单字段，**绝不点击提交/发送/投递类按钮**（SUBMIT_RE 拦截）
//   * 不确定就报 failed + 给出 suggestions，让上层去问用户，不做猜测式点击
//   * 每个字段写后回读校验；已是目标值的跳过（幂等）
//   * 选项匹配只认「精确」与「归一化后相等」，**包含/近义一律只给建议不落笔**
//
// 设计来源：逆向「牛客网申助手」的填表链路并重写：
//   · 原生 setter（React/Vue 受控组件）＋ per-char 模拟输入 ＋ contenteditable
//   · 7 大组件框架（antd/ElementUI/Moka/北森/Hotjob/ATSX/飞书）的下拉开合与选项采集
//   · 日期面板预设（年/月/日导航 + 月名别名 + 十年级翻页）
//   · 弹层可见性过滤 + 非弹层黑名单（tooltip/日期面板等）
// 配套：assets/platform-selectors.json（本文件内嵌其「选择器+日期预设」部分，见 tests/selftest.py 漂移守卫）
//
// ⚠️ 形状要求：evaluate 按“函数体”执行 → 必须以 **顶层 return** 结束。

// ======== MAPPING：key 用 10_scan_form.js 给的 uid（'f12'），或直接写字段名兜底 ========
// 值可以是字符串，也可以是 { v: 值, block: 重复块序号, mode: 'date'|'period'|'select' }
// 例：{ "f3": "张三", "f5": "zhangsan@example.com", "f7": { v: "北京市", block: 0 } }
// 推荐流程：`python scripts/40_build_mapping.py --scan data/runs/<host>-scan.json`
const MAPPING = {};

// ======== 选项 ========
const OPTS = {
  dryRun: false,             // true = 只报计划，不落笔
  probeOptions: false,       // true = 只开下拉把选项读出来放进 probed，不选任何东西
  simulateTyping: false,     // true = 逐字符模拟键盘输入（对付只认真实 keydown 的富文本/联想框）
  typingDelayMs: 12,
  panelWaitMs: 40,           // 打开弹层后的轮询间隔
  panelTimeoutMs: 1200,      // 等弹层出现的最长时间
  settleMs: 260,             // 每次交互后的静默等待
  verifyDelayMs: 120,        // 写入后回读前的等待
  scrollIntoView: true,      // 交互前把元素滚到视口中间
  allowNormalizedMatch: true,// 允许「去空格/标点/大小写后相等」视为同一选项（不是猜）
  suggestContainsMatch: true,// 包含/缩写匹配只进 suggestions（给用户选），绝不自动点击
  fillCompositeDate: true,   // 允许处理「年+月」分片组合控件
  maxOptionScan: 200,
  closeOverlaysWithEscape: true
};
// ================================================================================

// ======== 平台配置（与 assets/platform-selectors.json 保持同步） ========
const JAA_PLATFORM = JSON.parse(String.raw`
{
  "frameworks": {
    "antd": {
      "trigger_selector": ".ant-select-selector, .ant-select, .ant-cascader-picker, .ant-picker, .ant-input",
      "option_container_selector": ".ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-dropdown:not(.ant-dropdown-hidden), .ant-cascader-dropdown:not(.ant-select-dropdown-hidden)",
      "option_selector": ".ant-select-dropdown-menu-item, .ant-select-item-option, .ant-select-item, .ant-cascader-menu-item, .ant-menu-item, li[role=\"option\"]",
      "search_input_selector": ".ant-select-search__field, .ant-select-selection-search-input",
      "display_value_selector": ".ant-select-selection-item, .ant-select-selection-selected-value, .ant-select-selection__rendered, .ant-cascader-picker-label",
      "tree": { "wrapper": ".ant-select-tree-wrapper, .ant-select-tree-list, .ant-tree", "node": ".ant-select-tree-treenode, li[role=\"treeitem\"]", "title": ".ant-select-tree-title, .ant-tree-node-content-wrapper", "switcher": ".ant-select-tree-switcher, .ant-tree-switcher" },
      "date_preset": "antPicker"
    },
    "element": {
      "trigger_selector": ".el-input__inner, .el-select__wrapper, .el-input, .el-date-editor",
      "option_container_selector": ".el-select-dropdown:not(.is-hidden), .el-dropdown-menu, .el-popper:not([style*=\"display: none\"])",
      "option_selector": ".el-select-dropdown__item, .el-dropdown-menu__item, .el-cascader-node",
      "search_input_selector": ".el-select__input, .el-input__inner",
      "display_value_selector": ".el-select__selected-item, .el-select__placeholder, .el-input__inner",
      "tree": { "wrapper": ".el-tree, .el-cascader-panel", "node": ".el-tree-node, .el-cascader-node", "title": ".el-tree-node__label, .el-cascader-node__label", "switcher": ".el-tree-node__expand-icon, .el-cascader-node__postfix" },
      "date_preset": "elDatePicker"
    },
    "atsx": {
      "trigger_selector": ".atsx-select-selection, .atsx-select, .atsx-date-picker",
      "option_container_selector": ".atsx-select-dropdown:not(.atsx-select-dropdown-hidden)",
      "option_selector": "li[role=\"option\"], .atsx-select-item-option",
      "search_input_selector": ".atsx-select-search input, input",
      "display_value_selector": ".atsx-select-selection-item, .atsx-select-selection__rendered",
      "date_preset": "fusionRangePanel"
    },
    "mokahr": {
      "trigger_selector": "[class*=\"sd-Select-container\"], [class*=\"sd-Select-\"], [class*=\"sd-Input-display-value\"]",
      "option_container_selector": "[class*=\"sd-Dropdown-dropdown-\"]",
      "option_selector": "[class*=\"sd-Menu-content-item\"], [class*=\"sd-Select-common-item\"]",
      "search_input_selector": "[class*=\"sd-Select\"] input",
      "display_value_selector": "[class*=\"sd-Input-display-value\"], [class*=\"sd-Select-common-item\"]",
      "date_preset": "mokahr"
    },
    "beisen": {
      "trigger_selector": ".phoenix-selectList, .list-data-container, .area-data-container, [class^=\"form-item__text\"]",
      "option_container_selector": "[class=\"phoenix-selectList__list\"], .list-data-container, .area-data-container",
      "option_selector": "[class*=\"phoenix-selectList__listItem\"], .list-item-container, .area-item-name",
      "search_input_selector": "input[type=\"text\"]",
      "display_value_selector": "[class*=\"phoenix-selectList__selected\"], .list-selected-value",
      "date_preset": "fusionRangePanel"
    },
    "hotjob": {
      "trigger_selector": ".ant-select-selector, .ant-select, .form-cell-inner",
      "option_container_selector": ".ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-dropdown:not(.ant-dropdown-hidden)",
      "option_selector": ".ant-select-dropdown-menu-item, .ant-select-item-option, .ant-menu-item, li[role=\"option\"]",
      "search_input_selector": ".ant-select-search__field, .ant-select-selection-search-input",
      "display_value_selector": ".ant-select-selection-item, .ant-select-selection-selected-value",
      "date_preset": "antCalendarWithYearSelect"
    },
    "feishu": {
      "trigger_selector": ".ud__select, .ud__picker-dateInput, .throne-biz-date-range-picker-input",
      "option_container_selector": ".ud__select__dropdown:not(.ud__select__dropdown-hidden)",
      "option_selector": ".ud__select__list__item",
      "search_input_selector": "input",
      "display_value_selector": ".ud__select__selector__text, .ud__select__selection",
      "tree": { "wrapper": ".ud__tree, .ud__tree__list", "node": ".ud__tree__node", "title": ".ud__tree__node__label", "switcher": ".ud__expandButton, .ud__tree__node__expandIcon" },
      "date_preset": "feishu"
    }
  },
  "date_presets": {
    "antCalendarWithYearSelect": { "yearPanelSelector": ".ant-calendar-year-select", "yearElementSelector": ".ant-calendar-year-panel-cell:not(.ant-calendar-year-panel-cell-disabled):not(.ant-calendar-year-panel-last-decade-cell):not(.ant-calendar-year-panel-next-decade-cell)", "yearFilterClasses": false, "decadeSelector": ".ant-calendar-year-panel-decade-select-content", "nextDecadeBtn": ".ant-calendar-year-panel-next-decade-btn", "prevDecadeBtn": ".ant-calendar-year-panel-prev-decade-btn", "monthConfig": ".ant-calendar-month-select", "monthElementSelector": ".ant-calendar-month-panel-month", "dayElementSelector": ".ant-calendar-date", "yearRetryTimes": 60, "monthRetryTimes": 12 },
    "antPicker": { "yearPanelSelector": ".ant-picker-year-btn", "yearElementSelector": ".ant-picker-cell-in-view", "yearFilterClasses": false, "decadeSelector": ".ant-picker-decade-btn", "nextDecadeBtn": ".ant-picker-header-super-next-btn", "prevDecadeBtn": ".ant-picker-header-super-prev-btn", "monthConfig": ".ant-picker-month-btn", "monthElementSelector": ".ant-picker-cell", "dayElementSelector": ".ant-picker-cell", "yearRetryTimes": 60, "monthRetryTimes": 12 },
    "elDatePicker": { "yearPanelSelector": ".el-date-picker__header-label:not([style*=\"display: none\"])", "yearElementSelector": ".el-year-table a.cell, .el-year-table span.cell, .el-year-table .el-date-table-cell", "yearFilterClasses": ["disabled"], "decadeSelector": ".el-date-picker__header-label:not([style*=\"display: none\"])", "nextDecadeBtn": ".el-date-picker__next-btn:has(button:not([style*=\"display: none\"])) button:not([style*=\"display: none\"]), .el-date-picker__next-btn:not(:has(button))", "prevDecadeBtn": ".el-date-picker__prev-btn:has(button:not([style*=\"display: none\"])) button:not([style*=\"display: none\"]), .el-date-picker__prev-btn:not(:has(button))", "monthConfig": null, "monthElementSelector": ".el-month-table a.cell, .el-month-table span.cell, .el-month-table .el-date-table-cell", "dayElementSelector": ".el-date-table td.available", "yearRetryTimes": 40, "monthRetryTimes": 12 },
    "antDateRange": { "yearPanelSelector": ".ant-calendar-year-select", "yearElementSelector": ".ant-calendar-year-panel-year", "yearFilterClasses": true, "decadeSelector": ".ant-calendar-year-panel-decade-select-content", "nextDecadeBtn": ".ant-calendar-year-panel-next-decade-btn", "prevDecadeBtn": ".ant-calendar-year-panel-prev-decade-btn", "monthConfig": { "prevMonthSelector": ".ant-calendar-prev-month-btn", "nextMonthSelector": ".ant-calendar-next-month-btn" }, "monthElementSelector": ".ant-calendar-month-select", "dayElementSelector": ".ant-calendar-date", "yearRetryTimes": 60, "monthRetryTimes": 12 },
    "mokahr": { "yearPanelSelector": "[class^=\"sd-basic-selector-year\"]", "yearElementSelector": "[class^=\"sd-basic-year-item\"]", "yearFilterClasses": true, "decadeSelector": "[class^=\"sd-basic-selector-year\"]", "nextDecadeBtn": "[class*=\"sd-Icon-icondoubleRight\"]", "prevDecadeBtn": "[class*=\"sd-Icon-icondoubleLeft\"]", "monthConfig": "[class^=\"sd-basic-selector-month\"]", "monthElementSelector": "[class^=\"sd-basic-year-item\"]", "dayElementSelector": "[class*=\"sd-basic-date-item\"]", "yearRetryTimes": 60, "monthRetryTimes": 12 },
    "feishu": { "yearPanelSelector": ".ud__picker-panel-header-btn", "yearElementSelector": ".ud__picker__cell-interactive-area", "yearFilterClasses": null, "decadeSelector": null, "nextDecadeBtn": ".ud__picker-panel-header-inner > button:nth-child(1)", "prevDecadeBtn": ".ud__picker-panel-header-inner > button:nth-child(2)", "monthConfig": null, "monthElementSelector": ".ud__picker__cell-interactive-area", "dayElementSelector": ".ud__picker__cell-interactive-area", "yearRetryTimes": 60, "monthRetryTimes": 12 },
    "fusionRangePanel": { "yearPanelSelector": null, "yearElementSelector": ".next-calendar-panel-header-full .next-calendar-btn", "yearFilterClasses": false, "decadeSelector": null, "nextDecadeBtn": ".next-calendar-btn-next-year", "prevDecadeBtn": ".next-calendar-btn-prev-year", "monthConfig": null, "monthElementSelector": ".next-calendar-table td.next-calendar-cell", "dayElementSelector": "", "yearRetryTimes": 30, "monthRetryTimes": 12 }
  },
  "non_panel_blocklist": ["tooltip", "toast", "notification", "message", "loading", "spinner", "date-picker", "datepicker", "date-panel", "date-table", "time-picker", "timepicker", "time-panel", "time-spinner", "picker-panel", "picker__popper", "calendar", "md-picker", "el-picker", "ant-picker", "ant-calendar", "ud-picker", "ux-calendar", "rc-picker"],
  "date_granularity_hints": {
    "day":   ["yyyy[-/.年]?mm[-/.月]?dd", "yyyymmdd", "年月日", "具体日期"],
    "month": ["yyyy[-/.年]?mm(?![-/.月]?dd)", "yyyymm", "年\\s*月", "年月"],
    "year":  ["yyyy(?![-/.年]?mm)", "年份"]
  }
}
`);

// ——— 时间粒度自适应：画像存最细的，组件要多粗就填多粗；**绝不凭空补精度** ———
const GRAN_RANK = { year: 1, month: 2, day: 3 };
const GRAN_PATTERNS = ['day', 'month', 'year'].map(g => [g, (JAA_PLATFORM.date_granularity_hints[g] || []).map(s => { try { return new RegExp(s, 'i'); } catch (e) { return null; } }).filter(Boolean)]);

const dateParts = v => {
  const n = String(v === null || v === undefined ? '' : v).match(/\d+/g);
  if (!n) return null;
  return [parseInt(n[0], 10), n.length >= 2 ? parseInt(n[1], 10) : null, n.length >= 3 ? parseInt(n[2], 10) : null];
};
const dateGranularityOf = v => {
  const p = dateParts(v);
  if (!p) return null;
  return p[2] !== null ? 'day' : (p[1] !== null ? 'month' : 'year');
};
const truncateDate = (v, g) => {
  const p = dateParts(v);
  if (!p) return v;
  const [y, m, d] = p;
  const pad = (x, n) => String(x).padStart(n, '0');
  if (g === 'year') return pad(y, 4);
  if (g === 'month') return m === null ? pad(y, 4) : `${pad(y, 4)}-${pad(m, 2)}`;
  if (m === null) return pad(y, 4);
  return d === null ? `${pad(y, 4)}-${pad(m, 2)}` : `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
};
const dateVariants = v => {                       // 由细到粗
  const p = dateParts(v);
  if (!p) return [];
  const out = [];
  if (p[2] !== null && p[1] !== null) out.push(truncateDate(v, 'day'));
  if (p[1] !== null) out.push(truncateDate(v, 'month'));
  out.push(truncateDate(v, 'year'));
  return [...new Set(out)];
};
const dateDigits = v => String(v === null || v === undefined ? '' : v).replace(/\D/g, '');

// 组件「接受」到哪一级（故意不看 label）
const componentGranularity = el => {
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

const PANEL_ROOT_SEL = '.ant-select-dropdown, .ant-picker-dropdown, .ant-calendar-picker-container, .ant-dropdown, .ant-cascader-dropdown, .el-popper, .el-select-dropdown, .el-picker-panel, .atsx-select-dropdown, [class*="sd-Dropdown-dropdown"], [class*="ud__select__dropdown"], [class*="picker-panel"], [class*="picker__panel"], [class*="picker__dropdown"], [class*="next-calendar"], .phoenix-selectList, .list-data-container, [role="listbox"], [role="dialog"], [class*="dropdown"], [class*="Dropdown"]';

// —— 基础工具 ——
const CLEAN = s => (s || '').replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SUBMIT_RE = /提交|递交|投递|立即申请|确认申请|完成投递|发送|submit|apply now|send|继续|下一步|next|完成|发布|支付|pay|删除|delete|取消|cancel/i;

const safeQ = (sel, root) => { try { return [...(root || document).querySelectorAll(sel)]; } catch (e) { return []; } };
const q1 = (sel, root) => { try { return (root || document).querySelector(sel); } catch (e) { return null; } };

const assertSafe = el => {
  if (!el) return false;
  if (el.tagName === 'BUTTON') return false;
  if ((el.getAttribute('type') || '').toLowerCase() === 'submit') return false;
  if (SUBMIT_RE.test(CLEAN(el.innerText || '').slice(0, 30))) return false;
  return true;
};

// 可见性：不仅看自身，还要看祖先（过渡类动画、hidden 类名、opacity:0）
const LEAVE_CLASSES = ['-leave', '-leave-active', '-leave-to', '-exit'];
const isRealVisibleCore = (el, ignoreLeave) => {
  if (!el) return false;
  let n = el, hop = 0;
  while (n && hop < 12) {
    let st;
    try { st = getComputedStyle(n); } catch (e) { return false; }
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    if (st.opacity === '0' && (!st.animationName || st.animationName === 'none')) return false;
    if (!ignoreLeave && n.classList) for (const c of n.classList) if (LEAVE_CLASSES.some(x => c.includes(x))) return false;
    if (typeof n.className === 'string' && /hidden/i.test(n.className)) return false;
    n = n.parentElement; hop++;
  }
  const r = el.getBoundingClientRect();
  return r.width >= 2 && r.height >= 2;
};
const isRealVisible = el => isRealVisibleCore(el, false);

const isNonPanel = el => {
  const sig = (((el && el.className && el.className.toString) ? el.className.toString() : '') + ' ' + (el && el.id || '')).toLowerCase();
  if (JAA_PLATFORM.non_panel_blocklist.some(k => sig.includes(k))) return true;
  const table = q1('table', el);
  if (table) {
    const heads = safeQ('th', table).map(t => CLEAN(t.textContent).toLowerCase());
    const weeks = [['日', '一', '二', '三', '四', '五', '六'], ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa']];
    if (weeks.some(w => heads.filter(h => w.includes(h)).length >= 5)) return true;
  }
  return false;
};

const waitFor = async (fn, tries = 30, interval = OPTS.panelWaitMs) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await sleep(interval); }
  return false;
};

const scrollIntoView = async el => {
  if (!OPTS.scrollIntoView || !el) return;
  try { el.scrollIntoView({ block: 'center', inline: 'center' }); await sleep(40); } catch (e) {}
};

// 真实鼠标序列：pointerdown → mousedown → mouseup → click（带坐标，React/Vue 事件委托才认）
const clickReal = async (el, delay = 8) => {
  if (!el) return false;
  await scrollIntoView(el);
  const r = el.getBoundingClientRect();
  const cx = r.left + Math.max(0, r.width) / 2, cy = r.top + Math.max(0, r.height) / 2;
  const o = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, screenX: cx, screenY: cy, button: 0, buttons: 1 };
  try { el.focus && el.focus(); } catch (e) {}
  try { el.dispatchEvent(new PointerEvent('pointerdown', o)); } catch (e) { el.dispatchEvent(new MouseEvent('mousedown', o)); }
  await sleep(delay);
  el.dispatchEvent(new MouseEvent('mousedown', o)); await sleep(delay);
  el.dispatchEvent(new MouseEvent('mouseup', o)); await sleep(delay);
  el.dispatchEvent(new MouseEvent('click', o));
  await sleep(delay * 2);
  return true;
};

const closeOverlays = async () => {
  if (!OPTS.closeOverlaysWithEscape) return;
  try { (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); } catch (e) {}
  try { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch (e) {}
  try { document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch (e) {}
  try { document.body.click(); } catch (e) {}
  await sleep(60);
};

// —— React/Vue 受控写入原语 ——
const nativeSetter = el => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
    : el.tagName === 'SELECT' ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  const d = Object.getOwnPropertyDescriptor(proto, 'value');
  return d && d.set ? d.set : null;
};

const setNative = async (el, val) => {
  try { el.focus && el.focus(); } catch (e) {}
  try { el.select && el.select(); } catch (e) {}
  try {
    const set = nativeSetter(el);
    if (set) set.call(el, val); else el.value = val;
  } catch (e) { try { el.value = val; } catch (e2) { return false; } }
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { try { el.setAttribute('value', val); } catch (e) {} }
  el.dispatchEvent(new Event('input', { bubbles: true, cancelable: false, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {}
  return true;
};

const simulateType = async (el, val, delay = OPTS.typingDelayMs) => {
  const isInput = el.tagName === 'INPUT', isArea = el.tagName === 'TEXTAREA', isEditable = el.isContentEditable;
  if (!isInput && !isArea && !isEditable) return false;
  await setNative(el, '');
  await sleep(10);
  for (let i = 0; i < val.length; i++) {
    const ch = val[i];
    const code = ch.length === 1 ? 'Key' + ch.toUpperCase() : ch;
    try { el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, code, bubbles: true, cancelable: true, composed: true })); } catch (e) {}
    try { el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, code, bubbles: true, cancelable: true })); } catch (e) {}
    const partial = val.substring(0, i + 1);
    if (isInput || isArea) { const set = nativeSetter(el); if (set) set.call(el, partial); else el.value = partial; }
    else el.textContent = partial;
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: false, composed: true }));
    try { el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, code, bubbles: true, cancelable: true })); } catch (e) {}
    await sleep(delay);
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};

const setContentEditable = async (el, val) => {
  try {
    el.focus();
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = window.getSelection(); if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  } catch (e) {}
  await sleep(10);
  try { el.textContent = val; } catch (e) {}
  el.dispatchEvent(new Event('input', { bubbles: true, cancelable: false, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {}
  return true;
};

// —— 文本归一化与选项打分（**只用于排序建议**，不用于自动点击） ——
const toHalf = s => String(s || '').replace(/[\uff01-\uff5e]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
const normText = s => toHalf(s).replace(/[\s\u200b-\u200f\ufeff]/g, '').replace(/[·・.,，。、;；:：!！?？'"“”‘’()（）\[\]【】<>《》\-—_/\\|]/g, '').toLowerCase();

const scoreOption = (want, text) => {
  const w = CLEAN(want), t = CLEAN(text);
  if (!w || !t) return { score: 0, why: 'empty' };
  if (w === t) return { score: 1, why: 'exact' };
  const nw = normText(w), nt = normText(t);
  if (nw && nw === nt) return { score: 0.98, why: 'normalized-equal' };
  if (!OPTS.suggestContainsMatch || !nw || !nt) return { score: 0, why: 'no-exact' };
  if (nt.includes(nw) || nw.includes(nt)) {
    const ratio = Math.min(nw.length, nt.length) / Math.max(nw.length, nt.length);
    return { score: 0.5 + 0.3 * ratio, why: 'contains' };
  }
  // 中文缩写（北大 → 北京大学）：只进建议，永远低于自动采用阈值
  const isSubseq = (short, long) => { let i = 0; for (const ch of long) { if (short[i] === ch) i++; if (i >= short.length) return true; } return false; };
  if (nw.length >= 2 && nw.length < nt.length && isSubseq(nw, nt)) return { score: 0.45, why: 'subsequence' };
  if (nt.length >= 2 && nt.length < nw.length && isSubseq(nt, nw)) return { score: 0.4, why: 'subsequence' };
  return { score: 0, why: 'no-exact' };
};

const rankOptions = (want, options) => options
  .map(o => ({ text: o.text, el: o.el, ...scoreOption(want, o.text) }))
  .sort((a, b) => b.score - a.score);

// —— 弹层与选项采集 ——
const OPT_PROBE_SEL = '[role="option"], [role="menuitem"], [role="treeitem"], li, [class*="option"], [class*="Option"], [class*="item"], [class*="Item"], [class*="cell"], [class*="Cell"]';

const panelOK = (p, loose) => {
  if (!isRealVisibleCore(p, loose)) return false;
  if (p.querySelector('input,textarea,select,button,[role="combobox"]')
      && !/dropdown|popper|dialog|panel|list|menu|picker|calendar|container|select/i.test(p.className || '')) return false;
  return true;
};
// 严格（排除正在离场动画的面板）优先；一个都没有时退一步接受带 -leave/-exit 类但**确实在屏上**的面板
// —— 实测 mokahr 的 sd-Dropdown 会在刚打开时就被加上 leave 类，严格过滤会让它直接“读不到选项”。
const visiblePanels = sel => {
  const strict = safeQ(sel).filter(p => panelOK(p, false));
  if (strict.length) return strict;
  return safeQ(sel).filter(p => panelOK(p, true));
};

const nearestOf = (el, cands) => {
  if (!cands.length) return null;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bestD = Infinity;
  for (const c of cands) {
    const cr = c.getBoundingClientRect();
    const d = Math.hypot((cr.left + cr.width / 2) - cx, (cr.top + cr.height / 2) - cy);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
};

const nearestPanel = (el, sel) => {
  // ⚠️ 关键过滤：面板不可能是触发元素自己的**祖先或后代**。
  // 实测 mokahr：PANEL_ROOT_SEL 里的 [class*="Dropdown"] 能匹配到触发元素外层的
  // `sd-Dropdown-container`（它就是触发元素的祖先、距离 0）→ 会被误判成“面板已经开着”，
  // 于是程序不去点开，却在那个空壳里找选项 → 报“点开后读不到任何可见选项”。
  const cands = visiblePanels(sel).filter(p => p !== el && !p.contains(el) && !el.contains(p));
  return nearestOf(el, cands);
};

// 统一的「打开弹层」入口（所有下拉/级联/探测都走它）
//   ① 已经开着就别再点：有些组件库再点一下是「关掉」（否则下一条字段必然读不到选项）
//   ② mokahr(sd-Select) 实测：**单个合成 click** 才会正常打开；
//      pointerdown→mousedown→mouseup→click 那套序列会让面板刚打开就进入 leave 动画，
//      而 leave 面板会被可见性过滤掉 → 现象就是「点开后读不到任何可见选项」。
//   ③ 其余站点：真实鼠标序列（clickReal）+ 轮询等待
const openPanel = async (el, trigger, containerSel, optionSel) => {
  // 只有「真的含选项元素」的才算是下拉面板（否则会把触发元素自己的外层容器当成面板）
  const optSel = optionSel ? optionSel + ',' + OPT_PROBE_SEL : OPT_PROBE_SEL;
  const find = () => {
    // 先按距离筛，只对最近的几个候选做 querySelector ——
    // 否则在长表单上每个候选都全树扫一遍，会慢到分钟级（实测 14 个字段跑到 30 分钟超时）。
    const tr = trigger.getBoundingClientRect();
    const tcx = tr.left + tr.width / 2, tcy = tr.top + tr.height / 2;
    const scan = sel => {
      let list;
      try { list = document.querySelectorAll(sel); } catch (e) { return []; }
      const near = [];
      for (const p of list) {
        if (p === trigger || p.contains(trigger) || trigger.contains(p)) continue;
        const r = p.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        // ⚠️ 不要用「距离上限」筛掉候选：mokahr 的面板是 portal，滚动后它的 rect 常常离
        // 触发元素几千像素（实测 top=-4415，而触发元素在视口里），一卡上限就“读不到选项”。
        // 只按距离排序、只对最近的十几个做 querySelector，性能就够。
        const d = Math.hypot((r.left + r.width / 2) - tcx, (r.top + r.height / 2) - tcy);
        near.push([p, d]);
      }
      near.sort((a, b) => a[1] - b[1]);
      return near.slice(0, 12).map(x => x[0]);
    };
    for (const sel of [containerSel, PANEL_ROOT_SEL]) {
      for (const p of scan(sel)) {
        if (!isRealVisibleCore(p, true)) continue;   // 宽松可见：mokahr 刚打开的面板会带 -leave 类
        let has = false;
        try { has = !!p.querySelector(optSel); } catch (e) {}
        if (has) return p;
      }
    }
    return null;
  };
  let p = find();
  if (p || OPTS.dryRun) return p;
  // ① mokahr(sd-Select) 实测：**单个合成 click** 才会正常打开；
  //    pointerdown→mousedown→mouseup→click 那套序列会让面板刚打开就进入 leave 动画，
  //    而 leave 面板会被可见性过滤掉 → 现象就是「点开后读不到任何可见选项」。
  if (fwOf(el) === 'mokahr') {
    try { trigger.click(); } catch (e) {}
    // ⚠️ 必须**轮询等待**，不能只等一次就判死：大列表面板（专业 816 项 / 研究生专业 558 项）
    // 渲染要 >400ms；一次判定失败后会走下面的通用兜底再点一下，那一下正好把刚打开的面板关掉，
    // 然后就一直“读不到选项”（小列表能过、大列表必挂）。
    await waitFor(() => { p = find(); return !!p; }, Math.ceil(OPTS.panelTimeoutMs / OPTS.panelWaitMs), OPTS.panelWaitMs);
  }
  // ② 通用：真实鼠标序列
  if (!p) {
    await clickReal(trigger, 10);
    await waitFor(() => { p = find(); return !!p; }, Math.ceil(OPTS.panelTimeoutMs / OPTS.panelWaitMs), OPTS.panelWaitMs);
    p = p || find();
  }
  return p;
};

const panelRootOf = el => el && (el.closest(PANEL_ROOT_SEL) || el);

const collectOptions = (root, optionSel) => {
  if (!root) return [];
  const sels = (optionSel || '').split(',').map(s => s.trim()).filter(Boolean);
  const out = [];
  const push = e => {
    const text = CLEAN(e.innerText || e.textContent);
    if (!text || text.length > 80) return;
    if (isNonPanel(e)) return;
    if (out.some(o => o.el === e)) return;
    out.push({ el: e, text });
  };
  for (const sel of sels) {
    for (const e of safeQ(sel, root)) {
      if (!isRealVisible(e)) continue;
      const kids = [...e.children].filter(c => CLEAN(c.innerText || c.textContent));
      if (kids.length > 1) continue;                       // 只要叶子 / 单子包裹层
      if (kids.length === 1 && CLEAN(kids[0].innerText || kids[0].textContent) === CLEAN(e.innerText || e.textContent)) { push(kids[0]); continue; }
      push(e);
      if (out.length >= OPTS.maxOptionScan) return out;
    }
    if (out.length) break;
  }
  return out;
};

// —— 平台配置解析 ——
const fwOf = el => (el && el.getAttribute && el.getAttribute('data-jaa-framework')) || null;
const cfgOf = el => JAA_PLATFORM.frameworks[fwOf(el)] || null;
const detectFrameworkFromEl = el => {
  for (const [name, cfg] of Object.entries(JAA_PLATFORM.frameworks)) {
    for (const sel of [cfg.trigger_selector, cfg.option_container_selector]) {
      for (const s of (sel || '').split(',').map(x => x.trim())) {
        if (!s) continue;
        try { if (el.matches(s) || el.closest(s)) return name; } catch (e) {}
      }
    }
  }
  return null;
};
const cfgFor = el => cfgOf(el) || JAA_PLATFORM.frameworks[detectFrameworkFromEl(el)] || null;
const triggerOf = (el, cfg) => {
  if (!cfg || !cfg.trigger_selector) return el;
  for (const s of cfg.trigger_selector.split(',').map(x => x.trim()).filter(Boolean)) {
    try { const t = el.matches(s) ? el : el.closest(s); if (t) return t; } catch (e) {}
  }
  return el;
};

// 显示层节点：antd v3 的 `.ant-select-selection-selected-value` 与搜索框是**兄弟**，
// 旧版只在 `el.parentElement` 里找 → antd v3 的下拉一律读成空值。
// 现在沿祖先找（≤6 层，遇到控件根就停），排除 placeholder 节点与“请选择…”占位文本。
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

const readDisplay = el => {
  if (!el) return '';
  const kind = el.getAttribute('data-jaa-kind') || '';
  const isCustom = ['custom-select', 'cascader', 'tree-select', 'popup-picker'].includes(kind);
  const t = (el.getAttribute('type') || '').toLowerCase();
  if (t === 'checkbox') return el.checked ? '是' : '否';
  if (el.tagName === 'SELECT') return CLEAN(el.selectedOptions?.[0]?.text || el.value);
  // ⚠️ 裸 input/textarea 的值就在 el.value 上，**必须先用它**：
  // mokahr 的字段是「一行多个」布局，若先去外层找 display-value，
  // 会读到同一行**别的字段**的显示值（实测：身高/体重/家庭电话的回读全都变成了「男」）。
  if (!isCustom && el.value) return CLEAN(el.value);
  const cfg = cfgFor(el);
  if (cfg && cfg.display_value_selector) {
    const n = displayNodeIn(el, cfg.display_value_selector.split(',').map(x => x.trim()));
    if (n) return CLEAN(n.innerText);
  }
  if (el.value) return CLEAN(el.value);
  if (!isCustom) return '';
  const dv = displayNodeIn(el, ['[class*="display-value"]','[class*="selection-item"]','[class*="selected-value"]','[class*="value-text"]','[class*="select__selected"]']);
  if (dv) return CLEAN(dv.innerText);
  const fallback = (el.parentElement && el.parentElement.closest('[class*="Select"],[class*="select"],[class*="Input"],[class*="input"],label')) || el.parentElement;
  return CLEAN((fallback?.innerText || '').split('\n')[0] || '');
};

// —— 日期面板导航（移植自牛客插件的日历年月日引擎） ——
const MONTH_ALIASES = m => ([
  ['一月', '1月', '01', '1', 'jan', '01月'], ['二月', '2月', '02', '2', 'feb', '02月'],
  ['三月', '3月', '03', '3', 'mar', '03月'], ['四月', '4月', '04', '4', 'apr', '04月'],
  ['五月', '5月', '05', '5', 'may', '05月'], ['六月', '6月', '06', '6', 'jun', '06月'],
  ['七月', '7月', '07', '7', 'jul', '07月'], ['八月', '8月', '08', '8', 'aug', '08月'],
  ['九月', '9月', '09', '9', 'sep', '09月'], ['十月', '10月', '10', '10', 'oct', '10月'],
  ['十一月', '11月', '11', '11', 'nov', '11月'], ['十二月', '12月', '12', '12', 'dec', '12月']
][m - 1] || []).map(normText);

const yearsIn = t => { const m = String(t || '').match(/(19|20)\d{2}/g); return m ? m.map(Number) : []; };
const firstYear = t => { const y = yearsIn(t); return y.length ? y[0] : null; };
const lastYear = t => { const y = yearsIn(t); return y.length ? y[y.length - 1] : null; };
const monthIn = t => {
  const s = CLEAN(t);
  let m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/); if (m) return Number(m[2]);
  m = s.match(/(\d{1,2})\s*月/); if (m) return Number(m[1]);
  const aliases = [['一月', 1], ['二月', 2], ['三月', 3], ['四月', 4], ['五月', 5], ['六月', 6], ['七月', 7], ['八月', 8], ['九月', 9], ['十月', 10], ['十一月', 11], ['十二月', 12]];
  for (const [k, v] of aliases) if (s.includes(k)) return v;
  m = s.match(/^(\d{1,2})$/); if (m) { const v = Number(m[1]); if (v >= 1 && v <= 12) return v; }
  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (m) return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase()) + 1;
  return null;
};

const yearCells = (box, cfg, vis = isRealVisible) => {
  const cells = safeQ(cfg.yearElementSelector, box).filter(vis);
  const f = cfg.yearFilterClasses;
  if (f === false || f == null) return cells;
  if (f === true) return cells.filter((c, i) => i !== 0 && i !== cells.length - 1);
  if (Array.isArray(f)) return cells.filter(c => !f.some(cl => c.closest('.' + cl)));
  return cells;
};

// 打开日期面板：真实鼠标序列 + 等预设里的任一选择器可见
// union 预设 = 所有预置的选择器合集，这样**不依赖框架识别**也能找到面板
const PRESET_KEYS = ['yearPanelSelector', 'yearElementSelector', 'decadeSelector', 'monthElementSelector', 'monthConfig', 'dayElementSelector'];
const UNION_DATE_PRESET = (() => {
  const u = {};
  for (const k of PRESET_KEYS) {
    const vals = Object.values(JAA_PLATFORM.date_presets).map(p => p[k]).filter(v => typeof v === 'string' && v);
    if (vals.length) u[k] = [...new Set(vals)].join(', ');
  }
  return u;
})();

const presetScore = (panel, p) => {
  if (typeof p === 'string') p = JAA_PLATFORM.date_presets[p] || null;
  if (!p) return 0;
  let s = 0;
  for (const k of PRESET_KEYS) {
    const sel = p[k];
    if (typeof sel !== 'string' || !sel) continue;
    try { if (safeQ(sel, panel).some(isRealVisible)) s += 1; } catch (e) {}
  }
  return s;
};

// 候选顺序：本字段框架的预设 → 其他框架的预设 → 所有预设。
// ⚠️ 不能只信框架：同一个页面上 mokahr 的表单里完全可能嵌一个 antd 的日期控件
// （实战：页面上 mokahr 控件多 → 字段被判为 mokahr，但生日用的是 antd picker）。
const presetCandidates = el => {
  const out = [];
  const push = n => { if (n && !out.includes(n) && JAA_PLATFORM.date_presets[n]) out.push(n); };
  const fw = fwOf(el) || detectFrameworkFromEl(el);
  if (fw && JAA_PLATFORM.frameworks[fw]) push(JAA_PLATFORM.frameworks[fw].date_preset);
  for (const cfg of Object.values(JAA_PLATFORM.frameworks)) push(cfg.date_preset);
  for (const k of Object.keys(JAA_PLATFORM.date_presets)) push(k);
  return out;
};

const openDatePanel = async (el, cfg) => {
  await clickReal(el, 10);
  const probe = () => {
    for (const k of PRESET_KEYS) {
      const s = cfg[k];
      if (typeof s !== 'string' || !s) continue;
      if (safeQ(s).some(isRealVisible)) return true;
    }
    return !!nearestPanel(el, PANEL_ROOT_SEL);
  };
  await waitFor(probe, Math.ceil(OPTS.panelTimeoutMs / OPTS.panelWaitMs), OPTS.panelWaitMs);
  // 面板根：优先用预设选择器附近的可见弹层
  const anchors = [];
  for (const k of PRESET_KEYS) {
    if (cfg[k] && typeof cfg[k] === 'string') for (const e of safeQ(cfg[k])) if (isRealVisible(e)) anchors.push(e);
  }
  if (anchors.length) {
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bestD = Infinity;
    for (const a of anchors) {
      const ar = a.getBoundingClientRect();
      const d = Math.hypot((ar.left + ar.width / 2) - cx, (ar.top + ar.height / 2) - cy);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best) return panelRootOf(best);
  }
  return nearestPanel(el, PANEL_ROOT_SEL);
};

// 核心：在 container 里把日历导航到 dateStr（YYYY[-MM[-DD]]）。读不到目标单元格就返回 false，绝不猜。
// 返回：实际达到的粒度字符串（'day'|'month'|'year'）或 false（失败）。
// stopAt 指定「填到哪一级就收手」——组件只到年月时不要把日也要求上。
async function calendarPick(container, dateStr, cfg, stopAt) {
  if (typeof cfg === 'string') cfg = JAA_PLATFORM.date_presets[cfg] || null;
  if (!cfg || !container) return false;
  const nums = String(dateStr).split(/[-/.]/).map(s => parseInt(s, 10));
  const Y = nums[0], M = nums[1], D = nums[2];
  const yearOk = Number.isFinite(Y) && Y >= 1900 && Y <= 2100;
  const monthOk = Number.isFinite(M) && M >= 1 && M <= 12;
  const dayOk = Number.isFinite(D) && D >= 1 && D <= 31;
  if (!yearOk && !monthOk && !dayOk) return false;

  let box = container;
  let yearTries = cfg.yearRetryTimes || 60;
  let monthTries = cfg.monthRetryTimes || 12;
  let state = yearOk ? 'year' : (monthOk ? 'month' : 'day');
  let guard = 0;
  let openedYearPanel = false;
  let openedMonthPanel = false;
  let achieved = 'year';        // 已经选到哪一级（选到月之后置 'month'）
  // 月面板与日面板用同一个选择器时（antd v4 的 .ant-picker-cell），
  // 裸数字无法区分“3 月”和“3 日” → 只认 “月/一月/Jan” 这类写法，避免点错面板
  const monthSelShared = (cfg.monthElementSelector || '') !== '' && cfg.monthElementSelector === cfg.dayElementSelector;
  const DAY_DROP = /disabled|last-month|next-month|prev-month|not-current|other-month|outside|forbidden/i;

  while (guard++ < 240) {
    if (cfg.subContainerSelector) { const s = q1(cfg.subContainerSelector, box); if (s) box = s; }

    if (state === 'year') {
      // 只有在「单元格文本真的能解出年份」时才当成年份网格（否则可能在日面板上）
      const cells = yearCells(box, cfg).filter(c => firstYear(CLEAN(c.innerText || c.textContent)) != null);
      if (!cells.length) {
        const opener = cfg.yearPanelSelector ? safeQ(cfg.yearPanelSelector, box).filter(isRealVisible)[0] : null;
        if (opener && !openedYearPanel) { openedYearPanel = true; await clickReal(opener, 6); await sleep(60); continue; }
        state = monthOk ? 'month' : 'day'; continue;
      }
      const hit = cells.find(c => firstYear(CLEAN(c.innerText || c.textContent)) === Y);
      if (hit) {
        await clickReal(hit, 6); await sleep(60);
        if (stopAt === 'year') return 'year';
        state = 'month'; continue;
      }
      const shown = lastYear(CLEAN(cells[cells.length - 1].innerText || cells[cells.length - 1].textContent))
        ?? firstYear(CLEAN(cells[0].innerText || cells[0].textContent));
      if (shown == null) return false;
      const btn = Y >= shown ? q1(cfg.nextDecadeBtn, box) : q1(cfg.prevDecadeBtn, box);
      if (!btn) return false;
      await clickReal(btn, 6); await sleep(50);
      if (--yearTries <= 0) return false;
      continue;
    }

    if (state === 'month') {
      if (!monthOk) { state = 'day'; continue; }
      const cells = safeQ(cfg.monthElementSelector, box).filter(isRealVisible);
      if (!cells.length) {
        // antd v3（antCalendarWithYearSelect）：选完年份后会**回到日面板**，月份面板必须先点
        // `.ant-calendar-month-select` 才展开。旧版直接 state='day' → 点了日号但月份还是默认的 1 月
        // （实测把 1999-09-02 写成了 1999-01-02）。这里：头部已经是目标月就直接进日面板；
        // 否则点一次月份开关（只点一次，避免死循环），仍拿不到月份格子才退到日面板。
        const headTxt0 = CLEAN((q1(cfg.decadeSelector, box) || {}).innerText || '') + ' ' + CLEAN(box.innerText || '');
        if (monthIn(headTxt0) === M) { state = 'day'; continue; }
        const opener = (typeof cfg.monthConfig === 'string' && cfg.monthConfig) ? safeQ(cfg.monthConfig, box).filter(isRealVisible)[0] : null;
        if (opener && !openedMonthPanel) { openedMonthPanel = true; await clickReal(opener, 6); await sleep(60); continue; }
        state = 'day'; continue;
      }
      const aliases = MONTH_ALIASES(M);
      const hit = cells.find(c => {
        const t = normText(CLEAN(c.innerText || c.textContent));
        if (!t) return false;
        if (aliases.includes(t)) return true;
        if (monthSelShared) return false;        // 与日面板共享选择器 → 不认裸数字
        return monthIn(CLEAN(c.innerText || c.textContent)) === M;
      });
      if (hit) {
        await clickReal(hit, 6); await sleep(60);
        achieved = 'month';
        if (stopAt === 'month') return 'month';
        state = 'day'; continue;
      }
      const mm = cfg.monthConfig;
      const prevSel = (mm && typeof mm === 'object' && mm.prevMonthSelector) || null;
      const nextSel = (mm && typeof mm === 'object' && mm.nextMonthSelector) || null;
      if (!prevSel || !nextSel) {
        // 没有翻月按钮：用头部文字判断当前月，判断不了就如实失败
        const headerTxt = CLEAN((q1(cfg.decadeSelector, box) || {}).innerText || '') + ' ' + CLEAN((q1(cfg.monthConfig, box) || {}).innerText || '');
        const cur = monthIn(headerTxt);
        if (cur == null) return false;
        if (cur === M) { state = 'day'; continue; }
        return false;
      }
      const headerTxt = CLEAN((q1(cfg.decadeSelector, box) || {}).innerText || '') + ' ' + CLEAN((q1(cfg.monthConfig, box) || {}).innerText || '');
      const cur = monthIn(headerTxt);
      if (cur == null) return false;
      const btn = M > cur ? q1(nextSel, box) : q1(prevSel, box);
      if (!btn) return false;
      await clickReal(btn, 6); await sleep(50);
      if (--monthTries <= 0) return false;
      continue;
    }

    // day
    if (!dayOk || !cfg.dayElementSelector) return achieved;  // 只有年月粒度 → 按已选到的粒度完成
    let cells = safeQ(cfg.dayElementSelector, box).filter(isRealVisible);
    if (!cells.length) return achieved;                      // 面板已关闭（年月粒度控件选完月即结束）
    const inView = cells.filter(c => /in-view|available|current/i.test(c.className || ''));
    if (inView.length) cells = inView;
    let dayCells = cells.filter(c => {
      const t = CLEAN(c.innerText || c.textContent);
      return t && !/[月年]/.test(t) && /\d/.test(t) && !DAY_DROP.test(c.className || '');
    });
    if (!dayCells.length) {
      dayCells = cells.filter(c => { const t = CLEAN(c.innerText || c.textContent); return t && !/[月年]/.test(t) && /\d/.test(t); });
    }
    if (!dayCells.length) return achieved;
    const hit = dayCells.find(c => parseInt(CLEAN(c.innerText || c.textContent), 10) === D);
    if (!hit) return false;                               // ⚠️ 不挑「最近的可用日」，找不到就问用户
    await clickReal(hit, 6); await sleep(60);
    return 'day';
  }
  return false;
}

// —— 各类控件填料 ——
const fillNativeSelect = async (el, want) => {
  const opts = [...el.options];
  let o = opts.find(x => CLEAN(x.text) === CLEAN(want));
  if (!o && OPTS.allowNormalizedMatch) o = opts.find(x => normText(x.text) === normText(want));
  if (!o) o = opts.find(x => x.value === want);
  if (!o) return { ok: false, detail: `原生 select 无此选项（有：${opts.slice(0, 8).map(x => CLEAN(x.text)).join('/')}${opts.length > 8 ? '…' : ''}）` };
  if (!OPTS.dryRun) {
    try { el.focus(); } catch (e) {}
    el.value = o.value;
    try { el.setAttribute('value', o.value); } catch (e) {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try { el.dispatchEvent(new Event('blur')); } catch (e) {}
  }
  await sleep(OPTS.verifyDelayMs);
  return { ok: true };
};

const fillCustomSelect = async (el, want, cfg, uid, label) => {
  const trigger = triggerOf(el, cfg);
  const optionSel = (cfg && cfg.option_selector) || '[role="option"], li, [class*="option"], [class*="item"]';
  const containerSel = (cfg && cfg.option_container_selector) || PANEL_ROOT_SEL;

  const readCurrent = () => readDisplay(el);
  if (!OPTS.probeOptions && normText(want) && normText(readCurrent()) === normText(want)) return { ok: true, note: '已是目标值' };

  let panel = await openPanel(el, trigger, containerSel, optionSel);

  let options = panel ? collectOptions(panel, optionSel) : [];
  if (!options.length && panel) options = collectOptions(panel, OPT_PROBE_SEL);
  if (!options.length && !panel) {
    // 有些站点的下拉是「点开后才增量渲染」的：再试一次并放宽容器
    if (!OPTS.dryRun) { await clickReal(trigger, 10); await sleep(OPTS.settleMs); }
    const anyPanel = nearestPanel(trigger, PANEL_ROOT_SEL);
    if (anyPanel) options = collectOptions(anyPanel, optionSel).concat(collectOptions(anyPanel, OPT_PROBE_SEL));
  }

  if (OPTS.probeOptions) {
    await closeOverlays();
    return { ok: false, probe: options.map(o => o.text) };
  }

  if (!options.length) {
    await closeOverlays();
    return { ok: false, detail: '点开后没读到任何可见选项（弹层结构不在已知配方里）→ 需要 adapter 或问用户' };
  }

  const ranked = rankOptions(want, options);
  const best = ranked[0];
  const useable = best && best.score >= 0.98 && (best.why === 'exact' || (OPTS.allowNormalizedMatch && best.why === 'normalized-equal'));

  if (!useable) {
    await closeOverlays();
    return {
      ok: false,
      detail: `弹层里没有与「${want}」完全一致的选项`,
      suggestions: ranked.filter(r => r.score > 0).slice(0, 5).map(r => r.text),
      optionsSample: options.slice(0, 12).map(o => o.text)
    };
  }

  if (!OPTS.dryRun) {
    try { best.el.scrollIntoView({ block: 'center' }); } catch (e) {}
    await clickReal(best.el, 8);
    await sleep(OPTS.settleMs);
  }
  await sleep(OPTS.verifyDelayMs);
  const now = readDisplay(el);
  if (normText(now) === normText(want)) return { ok: true, note: `→ ${now}` };
  await closeOverlays();
  return { ok: false, detail: `点击了「${best.text}」但回读显示「${now}」→ 组件未接受，需要 adapter` };
};

const fillCascader = async (el, want, cfg) => {
  const parts = String(want).split(/\s*(?:\/|>|＞|→|—|-{1,2})\s*/).map(CLEAN).filter(Boolean);
  if (parts.length < 2) return fillCustomSelect(el, want, cfg, null, null);
  const containerSel = (cfg && cfg.option_container_selector) || PANEL_ROOT_SEL;
  const optionSel = (cfg && cfg.option_selector) || '.ant-cascader-menu-item, .el-cascader-node, li[role="option"]';
  const trigger = triggerOf(el, cfg);
  if (!OPTS.dryRun) { await openPanel(el, trigger, containerSel, optionSel); await sleep(OPTS.settleMs); }
  for (const part of parts) {
    const panel = nearestPanel(trigger, containerSel) || nearestPanel(trigger, PANEL_ROOT_SEL);
    if (!panel) return { ok: false, detail: `级联面板没出现（走到「${part}」）` };
    const options = collectOptions(panel, optionSel).concat(collectOptions(panel, OPT_PROBE_SEL));
    const ranked = rankOptions(part, options);
    const best = ranked[0];
    if (!best || best.score < 0.98) {
      await closeOverlays();
      return { ok: false, detail: `级联第「${part}」级没有精确匹配`, suggestions: ranked.slice(0, 5).map(r => r.text), optionsSample: options.slice(0, 12).map(o => o.text) };
    }
    if (!OPTS.dryRun) { await clickReal(best.el, 8); await sleep(OPTS.settleMs); }
  }
  await sleep(OPTS.verifyDelayMs);
  const now = readDisplay(el);
  const joined = parts.join('');
  return (normText(now).includes(normText(parts[parts.length - 1])) || normText(joined) === normText(now))
    ? { ok: true, note: `→ ${now}` }
    : { ok: false, detail: `级联走完但回读为「${now}」` };
};

// 时间粒度自适应：画像存最细的，组件要多粗填多粗；组件要得更细就如实失败（绝不补精度）。
// wantGran 是 mapping 里带的提示（canonical 声明的粒度），优先级低于组件自身的判定。
const fillDate = async (el, want, cfg, wantGran) => {
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (type === 'time') return { ok: false, detail: '纯时间控件不在本 skill 范围' };
  const have = dateGranularityOf(want);
  if (!have) return { ok: false, detail: `值「${want}」里没有可用的年月日` };
  const target = componentGranularity(el) || wantGran || have;   // 组件 > 映射提示 > 画像粒度
  if (GRAN_RANK[target] > GRAN_RANK[have]) {
    return { ok: false, detail: `组件要求「${target}」粒度，但画像值「${want}」只有「${have}」→ 不凭空补精度，需要用户补充` };
  }
  const use = truncateDate(want, target);
  const dropNote = g => (g && g !== have ? `（组件只到「${g}」，画像的「${have}」精度未填入）` : '');
  // 回读校验：按「数字串前缀」比，允许任一方向的截断（年/年月/年月日）
  const verify = (used, extra) => {
    const now = readDisplay(el);
    const a = dateDigits(now), b = dateDigits(used);
    if (!a || !b || Math.min(a.length, b.length) < 4) return { ok: false, detail: `回读为「${now}」${extra || ''}` };
    const g = dateGranularityOf(now);
    if (a.startsWith(b) || b.startsWith(a)) return { ok: true, note: `→ ${now}${dropNote(g)}${extra ? '（' + extra + '）' : ''}`, truncated: g !== have };
    return { ok: false, detail: `回读为「${now}」，与目标「${use}」不符${extra ? '（' + extra + '）' : ''}` };
  };

  // ① 原生 input[type=month|week|date|datetime-local]
  if (type === 'month' || type === 'week' || type === 'date' || type === 'datetime-local') {
    await setNative(el, use);
    await sleep(OPTS.verifyDelayMs);
    return verify(use, `原生 ${type}`);
  }
  // ② 可写的文本框 → 先按目标粒度直写，不行再试其它粒度
  if (!el.readOnly && (type === 'text' || type === '')) {
    for (const v of [use, ...dateVariants(want).filter(x => x !== use)]) {
      await setNative(el, v);
      await sleep(OPTS.verifyDelayMs);
      const a = dateDigits(readDisplay(el)), b = dateDigits(v);
      if (a && b && Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) {
        return { ok: true, note: `→ ${readDisplay(el)}${dropNote(dateGranularityOf(readDisplay(el)))}（直写 ${v}）`, truncated: dateGranularityOf(readDisplay(el)) !== have };
      }
    }
  }
  // ③ 只读 / 自有面板：走日历引擎
  let panel = await openDatePanel(el, UNION_DATE_PRESET);
  if (!panel) return { ok: false, detail: '点击后没有出现可识别的日期面板 → 需要 adapter' };
  // 用「哪个预置的选择器真的出现在这个面板上」来选预置，而不是只信字段的框架标签
  const cands = presetCandidates(el).map(n => ({ n, s: presetScore(panel, n) })).sort((a, b) => b.s - a.s);
  const tried = [];
  let achieved = null, used = null;
  for (const c of cands.slice(0, 3)) {
    if (c.s === 0 && tried.length) break;          // 完全不匹配的不再试
    const got = await calendarPick(panel, use, c.n, target);
    if (got) { achieved = got; used = c.n; break; }
    tried.push(c.n + '(' + c.s + ')');
    if (cands.filter(x => x.s > 0).length > tried.length) {
      // 上一次可能点到一半 → 关掉重开，避免半途状态干扰下一个预置
      await closeOverlays();
      const p2 = await openDatePanel(el, UNION_DATE_PRESET);
      if (!p2) break;
      panel = p2;
    }
  }
  if (!achieved) {
    await closeOverlays();
    return { ok: false, detail: `日历面板里找不到 ${use}（试过预置：${tried.join(' / ') || '无可用预置'}；不按「最近可用日」猜）` };
  }
  await sleep(OPTS.verifyDelayMs);
  const r = verify(use, `预置 ${used}，日历走到 ${achieved}`);
  if (r.ok && achieved !== target) {
    r.note += `；⚠️ 日历只支持到「${achieved}」，「${target}」级的位没能填`;
  }
  return r;
};

// 复合「年+月」分片控件：在同一字段块内按 DOM 顺序取 2 或 4 个分片
const COMPOSITE_PIECE_SEL = 'select, [role="combobox"], [class*="Select-container"], [class*="sd-Select"], .el-select__wrapper, .ant-select-selector, input[readonly], input[type="text"], input:not([type])';
const fillCompositeDate = async (el, want, cfg) => {
  // 字段块 = 向上找「控件数 2..8」的最近容器（分片控件必然同在一个字段块里）
  let box = el.parentElement, hop = 0;
  while (box && hop < 8 && box !== document.body) {
    const n = box.querySelectorAll('input,textarea,select,[role="combobox"],[class*="Select-container"],.el-select__wrapper,.ant-select-selector').length;
    if (n >= 2 && n <= 8) break;
    box = box.parentElement; hop++;
  }
  if (!box) return { ok: false, detail: '找不到字段块，无法做分片年月填充' };
  const pieces = [...new Set(safeQ(COMPOSITE_PIECE_SEL, box).filter(isRealVisible).map(p => (cfg ? triggerOf(p, cfg) : p)))];
  if (pieces.length < 2) return { ok: false, detail: '字段块里没有足够的分片控件' };

  // 值可能是「起 ~ 止」（4 片）或单个日期（2/3 片）
  const halves = String(want).split(/\s*(?:~|～|至|—|->|-{2})\s*/).filter(Boolean);
  const A = dateParts(halves[0]);
  const B = halves.length > 1 ? dateParts(halves[1]) : null;
  const yearV = y => [`${y}`, `${y}年`];
  const monthV = m => [`${String(m).padStart(2, '0')}`, `${m}`, `${m}月`, `${String(m).padStart(2, '0')}月`];
  const dayV = d => [`${String(d).padStart(2, '0')}`, `${d}`, `${d}日`];

  let plan;
  if (pieces.length >= 4) {
    if (!B) return { ok: false, detail: `这是「起止」分片控件（${pieces.length} 片），但值「${want}」只有一个日期 → 需要用户补全起止` };
    plan = [yearV(A[0]), monthV(A[1]), yearV(B[0]), monthV(B[1])];
  } else if (pieces.length === 3) {
    plan = [yearV(A[0]), monthV(A[1]), A[2] !== null ? dayV(A[2]) : null];
  } else {
    plan = [yearV(A[0]), monthV(A[1])];
  }

  // 幂等预检：各片段都已经读到目标值就直接跳过
  const pieceEq = (piece, variants) => {
    const now = readDisplay(piece), a = dateDigits(now);
    if (!a) return false;
    return (variants || []).some(v => {
      const b = dateDigits(v);
      if (!b) return false;
      if (a === b) return true;
      return a.length <= 2 && b.length <= 2 && parseInt(a, 10) === parseInt(b, 10);
    });
  };
  const limit = Math.min(plan.length, pieces.length);
  if (limit > 0 && plan.slice(0, limit).every((v, i) => v && pieceEq(pieces[i], v))) {
    return { ok: true, skipped: true, note: '各片段已是目标值' };
  }

  const results = [];
  for (let i = 0; i < Math.min(plan.length, pieces.length); i++) {
    const piece = pieces[i];
    const variants = plan[i];
    if (!variants || variants.some(v => v === null)) { results.push({ ok: false, detail: `第 ${i + 1} 段的年/月/日在画像里没有值` }); continue; }
    let last = null, done = false;
    for (const v of variants) {
      if (piece.tagName === 'SELECT') last = await fillNativeSelect(piece, v);
      else {
        const pcfg = cfgFor(piece) || cfg;
        last = await fillCustomSelect(piece, v, pcfg, null, null);
        if (!last.ok) {                       // 年分片常常是只读输入：试直接写
          await setNative(piece, v);
          await sleep(OPTS.verifyDelayMs);
          const dv = readDisplay(piece);
          if (dv && dateDigits(dv).includes(dateDigits(v))) last = { ok: true, note: `第 ${i + 1} 段直写 → ${dv}` };
        }
      }
      if (last && last.ok) { done = true; break; }
    }
    results.push(done ? last : (last || { ok: false, detail: '没有可用的写法' }));
  }
  const bad = results.findIndex(r => !r.ok);
  return bad >= 0
    ? { ok: false, detail: `分片第 ${bad + 1} 段失败：${results[bad].detail || '未知'}` }
    : { ok: true, note: `复合年月分片已逐段填入（${results.length} 段）` };
};

const fillCheckbox = async (el, want) => {
  const truthy = /^(1|true|yes|是|有|y|on|打勾|勾选)$/i.test(CLEAN(want));
  if (el.checked !== truthy) { if (!OPTS.dryRun) { await clickReal(el.closest('label') || el, 6); } }
  const now = el.checked;
  if (!OPTS.dryRun && now !== truthy) return { ok: false, detail: `点击后 checked=${now}，期望 ${truthy}` };
  return now === truthy ? { ok: true, note: `checked=${now}` } : { ok: false, detail: `checked=${now}` };
};

const radioText = e => CLEAN(
  e.closest('label')?.innerText ||
  (e.id ? q1(`label[for="${(window.CSS && CSS.escape) ? CSS.escape(e.id) : e.id}"]`)?.innerText : '') ||
  e.parentElement?.innerText || e.value);

// ======== 主流程 ========
return (async () => {
  const log = [], ok = [], skipped = [], failed = [], suggestions = [], notes = [];
  const probed = {};
  const byUid = (uid, block) => {
    const sel = block === undefined || block === null || block < 0
      ? `[data-jaa-uid="${uid}"]`
      : `[data-jaa-uid="${uid}"][data-jaa-block="${block}"], [data-jaa-uid="${uid}"]`;
    return safeQ(sel);
  };

  const entries = Object.entries(MAPPING).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(typeof v === 'object' && (v.v === undefined || v.v === null || v.v === '')));
  // ⚠️ probeOptions 模式允许 MAPPING 为空（纯只读探测，不写任何字段）
  if (!entries.length && !OPTS.probeOptions) return { ok, skipped, failed, suggestions, probed, notes: ['MAPPING 为空：先跑 10_scan_form.js 拿 uid'], log };

  // 解析目标元素 → 按 DOM 顺序处理（父级下拉/级联先于子级）
  const jobs = [];
  for (const [key, rawVal] of entries) {
    const val = (typeof rawVal === 'object') ? rawVal.v : rawVal;
    const want = String(val);
    const block = (typeof rawVal === 'object' && Number.isFinite(rawVal.block)) ? rawVal.block : null;
    const mode = (typeof rawVal === 'object' && rawVal.mode) ? rawVal.mode : null;
    const granHint = (typeof rawVal === 'object' && rawVal.granularity) ? rawVal.granularity : null;
    let els = /^f\d+$/.test(key) ? byUid(key, block) : [];
    if (!els.length) els = safeQ('[data-jaa-uid]').filter(e => CLEAN(e.getAttribute('data-jaa-label')) === CLEAN(key) || CLEAN(e.getAttribute('data-jaa-label-norm')) === CLEAN(key));
    if (block !== null && block >= 0) {
      const exact = els.filter(e => e.getAttribute('data-jaa-block') === String(block));
      if (exact.length) els = exact;
    }
    if (!els.length) { failed.push({ uid: key, label: key, value: want, detail: '找不到该字段（uid 过期？重新跑 10_scan_form.js）' }); continue; }
    jobs.push({ key, want, mode, gran: granHint, el: els[0], uid: els[0].getAttribute('data-jaa-uid') || key });
  }
  jobs.sort((a, b) => {
    const p = a.el.compareDocumentPosition(b.el);
    if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  for (const job of jobs) {
    const { want, mode, gran, el } = job;
    const uid = el.getAttribute('data-jaa-uid');
    const label = el.getAttribute('data-jaa-label') || job.key;
    const kind = el.getAttribute('data-jaa-kind') || 'text';
    const section = el.getAttribute('data-jaa-section') || '';
    const block = el.getAttribute('data-jaa-block');
    const cfg = cfgFor(el);
    const row = extra => Object.assign({ uid, label, value: want, section, block: block === null ? -1 : Number(block) }, extra || {});
    const rec = (bucket, extra) => bucket.push(row(extra));

    try {
      if (kind === 'file') { rec(failed, { detail: '文件字段：请用 browseros-neo_upload（见 references/strategies.md §3 的显形技巧）' }); continue; }

      const before = readDisplay(el);
      if (OPTS.dryRun) { rec(skipped, { detail: 'dryRun：只报计划，未落笔' }); continue; }
      const dateLike = kind === 'date' || kind === 'date-picker' || kind === 'date-range';
      const alreadyOk = dateLike
        ? (dateDigits(before) && dateDigits(want) && Math.min(dateDigits(before).length, dateDigits(want).length) >= 4
           && (dateDigits(before).startsWith(dateDigits(want)) || dateDigits(want).startsWith(dateDigits(before))))
        : (before && normText(before) === normText(want));
      if (!OPTS.probeOptions && alreadyOk) {
        rec(skipped, { detail: `已是 ${before}` }); continue;
      }

      // 显式 mode 优先（站点 adapter / 人工指定）
      let r;
      if (mode === 'composite' || (mode === 'period' && OPTS.fillCompositeDate)) r = await fillCompositeDate(el, want, cfg);
      else if (kind === 'checkbox') r = await fillCheckbox(el, want);
      else if (kind === 'radio-group' || kind === 'radio') {
        const radios = safeQ(`[data-jaa-uid="${uid}"]`).filter(e => (e.getAttribute('type') || '').toLowerCase() === 'radio');
        const target = radios.find(e => radioText(e) === want)
          || (OPTS.allowNormalizedMatch && radios.find(e => normText(radioText(e)) === normText(want)))
          || radios.find(e => CLEAN(e.value) === want);
        if (!target) {
          r = { ok: false, detail: `组内没有精确匹配项`, suggestions: radios.map(radioText).filter(Boolean).slice(0, 8) };
        } else { if (!OPTS.dryRun) await clickReal(target.closest('label') || target, 6); r = target.checked ? { ok: true, note: `checked=${target.checked}` } : { ok: false, detail: '点击后仍未选中' }; }
      }
      else if (kind === 'select') r = await fillNativeSelect(el, want);
      else if (kind === 'cascader') r = await fillCascader(el, want, cfg);
      else if (kind === 'tree-select') r = await fillCascader(el, want, cfg);
      else if (kind === 'date' || kind === 'date-picker') r = await fillDate(el, want, cfg, gran);
      else if (kind === 'date-range') {
        const halves = safeQ('input', el.closest('[class*="range"],[class*="Range"],fieldset,label') || el.parentElement).filter(isRealVisible);
        const se = String(want).split(/\s*(?:~|～|至|—|->|->|-{1,2})\s*/).filter(Boolean);
        if (halves.length >= 2 && se.length >= 2) {
          const r1 = await fillDate(halves[0], se[0], cfg, gran);
          const r2 = await fillDate(halves[1], se[1], cfg, gran);
          r = (r1.ok && r2.ok) ? { ok: true, note: `${se[0]} ~ ${se[1]}` } : { ok: false, detail: `起=${r1.detail || 'ok'}；止=${r2.detail || 'ok'}` };
        } else r = { ok: false, detail: '日期区间控件：没找到成对的两半输入，需要 adapter 或问用户' };
      }
      else if (kind === 'rich-text') r = { ok: await setContentEditable(el, want) };
      else if (kind === 'custom-select' || kind === 'popup-picker') r = await fillCustomSelect(el, want, cfg, uid, label);
      else if (kind === 'color' || kind === 'range') { await setNative(el, want); r = { ok: true }; }
      else {
        // 纯文本
        if (el.readOnly) r = { ok: false, detail: '只读字段，无法写入' };
        else if (OPTS.simulateTyping) r = { ok: await simulateType(el, want) };
        else r = { ok: await setNative(el, want) };
        if (r.ok) {
          await sleep(OPTS.verifyDelayMs);
          const now = readDisplay(el);
          if (normText(now) !== normText(want)) r = { ok: false, detail: `写入后回读为「${now}」` };
        }
      }

      if (r && r.probe !== undefined) {
        probed[uid] = r.probe;
        notes.push(`${label}: 探测到 ${r.probe.length} 个候选选项（未选择）`);
      } else if (r && r.ok) rec(r.skipped ? skipped : ok, { detail: r.note || `→ ${readDisplay(el)}` });
      else {
        rec(failed, { detail: (r && r.detail) || '未知原因', suggestions: (r && r.suggestions) || [], optionsSample: (r && r.optionsSample) || [] });
        if (r && r.suggestions && r.suggestions.length) suggestions.push(row({ detail: `建议值：${r.suggestions.join(' / ')}`, suggestions: r.suggestions }));
      }
    } catch (e) {
      rec(failed, { detail: '异常: ' + (e && e.message ? e.message : String(e)) });
    }
    await sleep(80);
  }

  if (OPTS.probeOptions) {
    // 去重：同一个「字段」（同区块 + 同字段名 + 同重复块）在 DOM 里可能有多个可点元素
    // （mokahr 的 sd-Select 会同时登记 input / 下拉箭头 span / 箭头里的 icon 三条），
    // 只真开一次下拉，其余同 key 的 uid 直接复用选项，避免同一个下拉被反复开合。
    const probeKey = el => [
      el.getAttribute('data-jaa-section') || '',
      el.getAttribute('data-jaa-label-norm') || el.getAttribute('data-jaa-label') || '',
      el.getAttribute('data-jaa-block') || ''
    ].join('|');
    const probedKeys = new Map();   // key -> options[]
    const allProbeEls = safeQ('[data-jaa-kind="custom-select"], [data-jaa-kind="popup-picker"]').map(e => [e.getAttribute('data-jaa-uid'), e]);
    let opened = 0;
    for (const [uid, el] of allProbeEls) {
      if (probed[uid]) continue;
      const key = probeKey(el);
      if (probedKeys.has(key)) { probed[uid] = probedKeys.get(key); continue; }
      try {
        const cfg = cfgFor(el);
        const trigger = triggerOf(el, cfg);
        const panel = await openPanel(el, trigger, (cfg && cfg.option_container_selector) || PANEL_ROOT_SEL, (cfg && cfg.option_selector) || OPT_PROBE_SEL);
        const opts = panel ? collectOptions(panel, (cfg && cfg.option_selector) || OPT_PROBE_SEL) : [];
        probed[uid] = opts.map(o => o.text);
        probedKeys.set(key, probed[uid]);
        opened++;
        await closeOverlays();
      } catch (e) { probed[uid] = []; probedKeys.set(key, []); }
    }
    log.push(`probe: 控件 ${allProbeEls.length} 个 / 实际打开下拉 ${opened} 次（其余按 区块+字段名+块 去重复用）`);
  }

  return {
    ok, skipped, failed, suggestions, probed, notes,
    log: [
      `写入成功 ${ok.length} / 跳过 ${skipped.length} / 失败 ${failed.length}${OPTS.probeOptions ? ' / probe 模式' : ''}`,
      ...failed.map(f => `FAIL ${f.label}: ${f.detail}`),
      ...suggestions.map(s => `SUGGEST ${s.label}: ${s.detail}`)
    ]
  };
})();
