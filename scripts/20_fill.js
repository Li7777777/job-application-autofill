// scripts/20_fill.js —— 通用表单填充器（与站点无关，靠 10_scan_form.js 打的 data-jaa-* 标记定位）
// 用法：改好 MAPPING 后整段粘进 browseros-neo_evaluate(page=<id>, timeout=120000)
//   返回 { ok, skipped, failed, notes, log }
//   ok / skipped / failed 都是 {uid,label,value,detail}
//
// 铁律：
//   * 只写表单字段，**绝不点击提交/发送/投递类按钮**（SUBMIT_RE 拦截）
//   * 不确定就报 failed 并说明原因，让上层去问用户，不做猜测式点击
//   * 每个字段写后回读校验；已是目标值的跳过（幂等）
//
// ⚠️ 形状要求：evaluate 按“函数体”执行 → 必须以 **顶层 return** 结束。

// ======== MAPPING：key 用 10_scan_form.js 给的 uid（'f12'），或直接写字段名兜底 ========
// 例：{ "f3": "<姓名>", "f5": "<邮箱>", "f7": "<男|女>" }
// 推荐流程：`python scripts/40_build_mapping.py --scan data/runs/<host>-scan.json`
//           → 复制它产出的 data/runs/<host>-mapping.json 里的 "mapping" 粘到这里
const MAPPING = {};

// ======== 选项 ========
const OPTS = {
  dryRun: false,        // true = 只报计划，不落笔
  sleepMs: 450,         // 每次开合下拉的等待
  allowIncludes: true   // 精确文本匹配不到时，允许“包含”匹配
};
// ================================================================================

const CLEAN = s => (s || '').replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SUBMIT_RE = /提交|递交|投递|立即申请|确认申请|完成投递|发送|submit|apply now|send|继续|下一步|next|完成|发布|支付|pay|删除|delete|取消|cancel/i;

const assertSafe = el => {
  if (!el) return false;
  if (el.tagName === 'BUTTON') return false;
  const t = (el.getAttribute('type') || '').toLowerCase();
  if (t === 'submit' || t === 'button' && false) return false;
  if (SUBMIT_RE.test(CLEAN(el.innerText || '').slice(0, 30))) return false;
  return true;
};

const setNative = (el, val) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
    : el.tagName === 'SELECT' ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  desc.set.call(el, val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
};

const radioText = e => CLEAN(
  e.closest('label')?.innerText ||
  (e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.innerText : '') ||
  e.parentElement?.innerText || e.value);

const readValue = el => {
  if (!el) return '';
  if (el.tagName === 'SELECT') return CLEAN(el.selectedOptions?.[0]?.text || el.value);
  if (el.value) return CLEAN(el.value);
  const box = el.closest('[class*="Select"],[class*="select"],[class*="Input"],[class*="input"],label') || el.parentElement;
  return CLEAN((box?.innerText || '').split('\n')[0] || '');
};

const eq = (a, b) => CLEAN(a) === CLEAN(b);
const looseEq = (a, b) => {
  a = CLEAN(a); b = CLEAN(b);
  return a === b || a.startsWith(b) || b.startsWith(a) || a.includes(b) || b.includes(a);
};

// 找可见弹层里的候选选项
const findOption = (want, { exact = true } = {}) => {
  const SEL = [
    '[role="option"]', '[role="listbox"] li', '[role="menu"] li', 'li',
    '[class*="option"]', '[class*="Option"]', '[class*="item"]', '[class*="Item"]',
    '[class*="cell"]', '[class*="Cell"]', 'div', 'span'
  ].join(',');
  const pops = [...document.querySelectorAll(SEL)].filter(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') return false;
    // 只要叶子/近叶子节点，且不是提交类
    if (!assertSafe(el)) return false;
    const txt = CLEAN(el.innerText);
    if (!txt || txt.length > 40) return false;
    if (el.children.length > 0 && !/option|item|cell/i.test(el.className || '')) {
      const kidTexts = [...el.children].map(c => CLEAN(c.innerText)).filter(Boolean);
      if (kidTexts.length === 1 && kidTexts[0] === txt) return true;   // 包裹层
      return false;
    }
    return true;
  });
  const norm = t => CLEAN(t);
  let hit = pops.find(el => norm(el.innerText) === CLEAN(want));
  if (!hit && !exact) hit = pops.find(el => norm(el.innerText).includes(CLEAN(want)) || CLEAN(want).includes(norm(el.innerText)));
  return hit || null;
};

return (async () => {
  const log = [], ok = [], skipped = [], failed = [], notes = [];
  const byUid = uid => [...document.querySelectorAll(`[data-jaa-uid="${uid}"]`)];

  const entries = Object.entries(MAPPING).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return { ok, skipped, failed, notes: ['MAPPING 为空：先跑 10_scan_form.js 拿 uid'], log };

  for (const [key, rawVal] of entries) {
    const want = String(rawVal);
    let els = /^f\d+$/.test(key) ? byUid(key) : [];
    if (!els.length) {   // 兜底：按 label / 文字匹配
      els = [...document.querySelectorAll('[data-jaa-uid]')].filter(e => CLEAN(e.getAttribute('data-jaa-label')) === CLEAN(key));
    }
    if (!els.length) { failed.push({ uid: key, label: key, value: want, detail: '找不到该字段（uid 过期？重新跑 10_scan_form.js）' }); continue; }

    const el = els[0];
    const uid = el.getAttribute('data-jaa-uid');
    const label = el.getAttribute('data-jaa-label') || key;
    const kind = el.getAttribute('data-jaa-kind') || 'text';
    const before = readValue(el);

    if (!OPTS.dryRun && eq(before, want)) { skipped.push({ uid, label, value: want, detail: `已是 ${before}` }); continue; }

    try {
      if (kind === 'file') { failed.push({ uid, label, value: want, detail: '文件字段：请用 browseros-neo_upload（见 references/upload.md 的显形技巧）' }); continue; }

      if (kind === 'checkbox') {
        const truthy = /^(1|true|yes|是|y|on)$/i.test(want);
        if (el.checked !== truthy) { if (!OPTS.dryRun) el.click(); }
        const now = el.checked;
        (now === truthy ? ok : failed).push({ uid, label, value: want, detail: `checked=${now}` });
        continue;
      }

      if (kind === 'radio-group') {
        const radios = els.filter(e => (e.getAttribute('type') || '').toLowerCase() === 'radio');
        if (!radios.length) { failed.push({ uid, label, value: want, detail: '找不到 radio 元素（标记过期？重跑 10_scan_form.js）' }); continue; }
        const target = radios.find(e => radioText(e) === want)
          || radios.find(e => radioText(e).includes(want) || CLEAN(e.value) === want);
        if (!target) { failed.push({ uid, label, value: want, detail: `组内没有匹配项（有 ${radios.map(radioText).join('/')}）` }); continue; }
        if (!OPTS.dryRun) target.click();
        (target.checked ? ok : failed).push({ uid, label, value: want, detail: `checked=${target.checked}` });
        continue;
      }

      if (kind === 'select') {
        const optsList = [...el.options];
        let o = optsList.find(x => CLEAN(x.text) === want) || optsList.find(x => CLEAN(x.text).includes(want)) || optsList.find(x => x.value === want);
        if (!o) { failed.push({ uid, label, value: want, detail: `原生 select 无此选项（有：${optsList.slice(0, 6).map(x => CLEAN(x.text)).join('/')}…）` }); continue; }
        if (!OPTS.dryRun) { el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true })); }
        const now = readValue(el);
        (eq(now, want) || looseEq(now, want) ? ok : failed).push({ uid, label, value: want, detail: `→ ${now}` });
        continue;
      }

      if (kind === 'custom-select' || kind === 'popup-picker') {
        if (!OPTS.dryRun) {
          el.click();
          await sleep(OPTS.sleepMs);
          const opt = findOption(want, { exact: true }) || (OPTS.allowIncludes ? findOption(want, { exact: false }) : null);
          if (!opt) {
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            notes.push(`${label}: 点击后未找到文字为「${want}」的选项`);
            failed.push({ uid, label, value: want, detail: '弹层里没有该选项 → 需要快照看选项原文，或问用户' });
            continue;
          }
          opt.scrollIntoView({ block: 'center' });
          opt.click();
          await sleep(OPTS.sleepMs);
        }
        const now = readValue(el);
        (looseEq(now, want) ? ok : failed).push({ uid, label, value: want, detail: `→ ${now}` });
        continue;
      }

      if (kind === 'date' || kind === 'date-picker') {
        const type = (el.getAttribute('type') || '').toLowerCase();
        let v = want;
        if (type === 'date') v = want.slice(0, 10);
        if (type === 'month') v = want.slice(0, 7);
        if (!OPTS.dryRun && !el.readOnly) setNative(el, v);
        const now = readValue(el);
        if (looseEq(now, want)) ok.push({ uid, label, value: want, detail: `→ ${now}` });
        else failed.push({ uid, label, value: want, detail: `日期控件未写入（readOnly=${!!el.readOnly}，现显示 ${JSON.stringify(now)}）→ 需要日历适配或问用户` });
        continue;
      }

      // 默认：文本
      if (el.readOnly && kind !== 'date-picker') { failed.push({ uid, label, value: want, detail: '只读字段，无法写入' }); continue; }
      if (!OPTS.dryRun) setNative(el, want);
      const now = readValue(el);
      (looseEq(now, want) ? ok : failed).push({ uid, label, value: want, detail: `→ ${now}` });
    } catch (e) {
      failed.push({ uid, label, value: want, detail: '异常: ' + (e && e.message ? e.message : String(e)) });
    }
    await sleep(120);
  }

  return {
    ok, skipped, failed, notes,
    log: [
      `写入成功 ${ok.length} / 跳过 ${skipped.length} / 失败 ${failed.length}`,
      ...failed.map(f => `FAIL ${f.label}: ${f.detail}`)
    ]
  };
})();
