// scripts/15_dump_state.js —— 通用状态导出（依赖 10_scan_form.js 打的 data-jaa-* 标记）
// 用法：填完后整段粘进 browseros-neo_evaluate(page=<id>)；结果为 JSON，存 data/runs/<host>-state.json
// 导出：值 / 必填 / 页面报错 / 附件 / 区块 / 重复块序号 / 组件框架 —— 供 30_verify.py 逐项对账
// ⚠️ 必须以 **顶层 return** 结束。

const CLEAN = s => (s || '').replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
const safeQ = (sel, root) => { try { return [...(root || document).querySelectorAll(sel)]; } catch (e) { return []; } };
const q1 = (sel, root) => { try { return (root || document).querySelector(sel); } catch (e) { return null; } };

// ⚠️ 「显示层兜底」只对自定义组件用：裸 input/textarea 的值就是 el.value，
// 否则会把字段标签文字当成已填值上报（会让校验器误报“格式非法”）。
const CUSTOM_KINDS = ['custom-select', 'cascader', 'tree-select', 'popup-picker'];
// 显示层节点：antd v3 的 `.ant-select-selection-selected-value` 与搜索框是**兄弟**（同在
// `.ant-select-selection__rendered` 里，而 input 在 `.ant-select-search__field__wrap` 里），
// 旧版只在 `el.parentElement` 里找 → antd v3 的下拉一律读成空值（会把已填的当成未填）。
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

const readValue = el => {
  if (!el) return '';
  const t = (el.getAttribute('type') || '').toLowerCase();
  if (t === 'checkbox') return el.checked ? '是' : '否';
  if (t === 'radio') return el.checked ? CLEAN(el.closest('label')?.innerText || el.value) : '';
  if (el.tagName === 'SELECT') return CLEAN(el.selectedOptions?.[0]?.text || el.value);
  if (el.value) return CLEAN(el.value);
  if (!CUSTOM_KINDS.includes(el.getAttribute('data-jaa-kind') || '')) return '';
  const dv = displayNodeIn(el, ['[class*="display-value"]','[class*="selection-item"]','[class*="selected-value"]','[class*="value-text"]','[class*="select__selected"]']);
  if (dv) return CLEAN(dv.innerText);
  const fallback = (el.parentElement && el.parentElement.closest('[class*="Select"],[class*="select"],[class*="Input"],[class*="input"],label')) || el.parentElement;
  return CLEAN((fallback?.innerText || '').split('\n')[0] || '');
};

// 报错文案：只在**叶子文本**里找，且排除控件自身的 placeholder/选中项/选项，
// 否则 <select> 里的「请选择」这类提示会被当成错误。
const ERR_RE = /(必填项未填写|不能为空|请填写|请输入|请选择|格式不正确|校验失败|required|invalid)/i;
const errorOf = el => {
  let node = el.parentElement, hop = 0;
  while (node && hop < 5 && node !== document.body) {
    if (node.querySelectorAll('input,textarea,select,[contenteditable="true"]').length <= 4) {
      for (const leaf of node.querySelectorAll('*')) {
        if (leaf.children.length) continue;
        if (leaf === el || el.contains(leaf)) continue;
        if (leaf.tagName === 'OPTION' || leaf.tagName === 'SCRIPT' || leaf.tagName === 'STYLE') continue;
        if (leaf.closest('select,option,[class*="placeholder"],[class*="Placeholder"],[class*="display-value"],[class*="selection"],[class*="selected"]')) continue;
        const t = CLEAN(leaf.innerText);
        if (!t || t.length > 40) continue;
        const m = t.match(ERR_RE);
        if (m) return m[0];
      }
    }
    node = node.parentElement; hop++;
  }
  return '';
};

const uids = [...new Set(safeQ('[data-jaa-uid]').map(e => e.getAttribute('data-jaa-uid')))];
const fields = uids.map(uid => {
  const els = safeQ(`[data-jaa-uid="${uid}"]`);
  const el = els[0];
  const kind = el.getAttribute('data-jaa-kind') || 'text';
  const value = kind === 'radio-group'
    ? els.filter(e => e.checked).map(e => CLEAN(e.closest('label')?.innerText || e.value)).join(' | ')
    : readValue(el);
  const block = el.getAttribute('data-jaa-block');
  return {
    uid, kind,
    label: el.getAttribute('data-jaa-label') || '',
    labelNorm: el.getAttribute('data-jaa-label-norm') || '',
    section: el.getAttribute('data-jaa-section') || '',
    block: block === null ? -1 : Number(block),
    framework: el.getAttribute('data-jaa-framework') || null,
    required: el.getAttribute('data-jaa-required') === '1',
    requiredConfidence: el.getAttribute('data-jaa-reqconf') || null,
    value,
    filled: !!CLEAN(value),
    file: kind === 'file' ? [...(el.files || [])].map(f => f.name) : undefined,
    error: errorOf(el) || null
  };
});

return JSON.stringify({
  url: location.href,
  host: location.host,
  at: new Date().toISOString(),
  fields
});
