// scripts/15_dump_state.js —— 通用状态导出（依赖 10_scan_form.js 打的 data-jaa-* 标记）
// 用法：填完后整段粘进 browseros-neo_evaluate(page=<id>)；结果为 JSON，存 data/runs/<host>-state.json
// ⚠️ 必须以 **顶层 return** 结束。

const CLEAN = s => (s || '').replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim();

const readValue = el => {
  if (!el) return '';
  if (el.tagName === 'SELECT') return CLEAN(el.selectedOptions?.[0]?.text || el.value);
  if ((el.getAttribute('type') || '') === 'checkbox') return el.checked ? '是' : '否';
  if ((el.getAttribute('type') || '') === 'radio') return el.checked ? (el.closest('label')?.innerText || el.value) : '';
  if (el.value) return CLEAN(el.value);
  const box = el.closest('[class*="Select"],[class*="select"],label') || el.parentElement;
  return CLEAN((box?.innerText || '').split('\n')[0] || '');
};

const uids = [...new Set([...document.querySelectorAll('[data-jaa-uid]')].map(e => e.getAttribute('data-jaa-uid')))];
const fields = uids.map(uid => {
  const els = [...document.querySelectorAll(`[data-jaa-uid="${uid}"]`)];
  const el = els[0];
  const kind = el.getAttribute('data-jaa-kind') || 'text';
  const value = kind === 'radio-group'
    ? els.filter(e => e.checked).map(e => CLEAN(e.closest('label')?.innerText || e.value)).join(' | ')
    : readValue(el);
  const errBox = el.closest('[class*="field"],[class*="Field"],[class*="form-item"],label,div');
  const errText = CLEAN((errBox?.innerText || '')).match(/(必填|不能为空|请填写|请输入|required|invalid)/i)?.[0] || '';
  return {
    uid, kind,
    label: el.getAttribute('data-jaa-label') || '',
    required: el.getAttribute('data-jaa-required') === '1',
    requiredConfidence: el.getAttribute('data-jaa-reqconf') || null,
    value,
    file: kind === 'file' ? [...(el.files || [])].map(f => f.name) : undefined,
    error: errText || null
  };
});

return JSON.stringify({
  url: location.href,
  host: location.host,
  at: new Date().toISOString(),
  fields
});
