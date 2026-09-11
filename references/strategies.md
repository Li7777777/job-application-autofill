# 策略库：控件配方 / 启发式 / 工具技巧

> 全部结论来自两次真机实测：`app.mokahr.com`（自定义组件重型）与 `www.selenium.dev/.../web-form.html`（原生控件全类型）。

## 1. 控件配方（怎么点、怎么写）

```js
// ① 普通文本 / textarea / 数字 / color / range —— 用原生 setter，React/Vue 才认
const setNative = (el, val) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
    : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur',   { bubbles: true }));
};

// ② 原生 select —— 按选项文本匹配，改 value 后派发 change
const o = [...el.options].find(x => x.text.trim() === want);
el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true }));

// ③ 单选组 radio-group —— 文本要从「自己的 label / label[for] / 自己的父节点」取，
//    不能从整个组的容器取（否则会把两项文字拼在一起 → 匹配错项）
const radioText = e => CLEAN(
  e.closest('label')?.innerText ||
  (e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.innerText : '') ||
  e.parentElement?.innerText || e.value);
target.click();   // 点 input 或它的 label 都行

// ④ 自定义下拉（antd / mokahr sd-Select / role=combobox）
el.click(); await sleep(450);                       // 打开
const opt = findOption(want);                       // 见下方查找规则
opt.scrollIntoView({block:'center'}); opt.click();  // 选中
// 校验策略：读 *显示值*（display-value 或最近 label 文本），不要读 input.value（常为空）

// ⑤ 只读日期框（input readonly + 日历图标）—— 只 click() 不会弹！必须补鼠标序列
inp.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
inp.dispatchEvent(new MouseEvent('mouseup',   {bubbles:true}));
inp.click();
// 面板里：◀◀/▶▶ 每次 ±1 年；月份是叶子节点（'一月'…'十二月' 或 '1'..'12'）
// 选完月若出现「日」面板再选日；有些网站该控件只有“年月”粒度 → 如实告知用户

// ⑥ 复选框：值语义映射（是/否、true/false、1/0）→ 需要勾就 click，需要去掉也 click
```

**弹层选项查找规则**（`findOption`）：遍历可见的 `[role=option] / li / [class*=option|item|cell] / div / span`，
只取「无子元素或只有一个同文子元素」的叶子/包裹层，文本 1–40 字符，且**不是提交类元素**；
先精确匹配，再（可选）包含匹配；同一时刻通常只有一个是可见弹层，取最后一个可见的即可。

## 2. 字段名与必填的启发式（扫描器怎么想）

字段名候选顺序（可信度从高到低）：
1. `field-title`：从控件包裹层之外向上找，取该层第一个「不含控件、文字 ≤40」的子元素
   → 命中 `<div class="title-*">意向工作城市</div>` 这类结构（自定义组件里最可靠）
2. `aria-label` / `aria-labelledby` / `label[for]`
3. `wrapping-label`：包裹控件的 `<label>` 文本 —— **注意**：自定义组件里它常常就是“当前选中值”（如「北京市」），
   所以要先排除「与控件自身值/placeholder 相同」的候选
4. 各层祖先的第一行文字（由外向内，同样排除自身值）
5. `placeholder` / `title` / `name` / `id`（机器名兜底）
显示用字段名 = 候选里第一个长度 ≤24 的；否则用第一个候选。

必填判定：
- `required` 属性 / `aria-required=true` → high
- 控件 class 含 `required-*` → high
- 向上 6 层内，任一祖先满足「文字 <150 且里面控件数 ≤4（字段级，不是区块级）且不含『选填/非必填』」，
  且该祖先含 `*`/「必填」字样或存在 `[class*=required]` → medium（**必须让用户确认**）

> 实测：mokahr 的下拉比文本框多一层 `Dropdown-container`，所以层数要给够；
> 而「申请信息」这种同区块里另一个字段是必填时，会给同区块的选填字段带来**误判**
> （实测「推荐码」被误判为必填）→ 所以 medium 一律进 todo 让人确认，不要直接信。

## 3. 文件上传（`<input type=file>` 不在无障碍树里）

```js
// 第一步：显形 + 起个能被 a11y 树读到的名字
const inp = document.querySelector('input[type=file]');
inp.setAttribute('aria-label', 'RESUME_FILE_INPUT');
inp.setAttribute('tabindex', '0');
inp.style.cssText = 'display:block;opacity:1;position:relative;width:200px;height:24px;visibility:visible;';
inp.scrollIntoView({block:'center'});
```
```text
第二步：browseros-neo_snapshot(mode=interactive) → 找 button "RESUME_FILE_INPUT" [ref=eN]
第三步：browseros-neo_upload(page, ref="eN", file="<简历文件的绝对路径>")
```
- 对「上传」按钮的 ref 调 upload 会报 `Node is not a file input element`；
- **不要真的点击上传按钮**（弹系统文件框，自动化会卡住）；
- 中文路径先复制到 ASCII 安全目录（`%TEMP%\\wfa\\`）；文件名保留中文没问题（HR 会看到）。

## 4. 工具技巧

**输出截断取全**（evaluate 结果 >5000 字符会被截断，但完整内容落盘）：
```python
import glob, os, json
d = r"%LOCALAPPDATA%\BrowserClaw\Application\<ver>\.browseros\tool-output"
f = max(glob.glob(os.path.join(d, "evaluate-*.txt")), key=os.path.getmtime)
raw = open(f, encoding="utf-8").read()
obj = json.loads(raw[raw.index('{"url"'):raw.rindex('}')+1])   # 按自己的 JSON 头尾裁剪
```
**evaluate 的代码形状**：按“函数体”执行 → 脚本必须**顶层 `return`**。
**等待渲染**：`browseros-neo_wait(for="selector", value="form, [class*=apply-field], input")` 比 sleep 可靠。
**关闭弹层**：`Escape` 不一定管用，点别的字段最稳。
**`browseros-neo_run` 在本环境不可用**（`did not return structured output`）→ 用 evaluate。

## 5. 标签页与会话

- 用户自己的标签页不属于 agent：`snapshot/evaluate` 有时能读，但 `upload/download` 会报
  `page N is not owned by this agent` → **统一 `tabs new` 开自己的页**（同窗口共享 cookie，登录态直接复用）。
- 会话/工具会话可能被重建，`page id` 会失效 → 失效就重新 `tabs new` + 重新扫描（脚本幂等，代价很小）。
- 用 `name_session` 给会话取名（如 `form autofill`），便于多任务并存。

## 6. 提交拦截（硬性）

```js
const SUBMIT_RE = /提交|递交|投递|立即申请|确认申请|完成投递|发送|submit|apply now|send|下一步|next|完成|发布|支付|pay|删除|delete|取消|cancel/i;
const assertSafe = el => !(el.tagName === 'BUTTON' || (el.getAttribute('type')||'') === 'submit'
                            || SUBMIT_RE.test((el.innerText||'').trim().slice(0, 30)));
```
- 所有会 `click()` 的地方（弹层选项、单选、复选框）都先过 `assertSafe`；
- 填充结束后顺手报告页面上的提交类按钮清单（证明「原封未动」），交给用户自己点。

## 7. 校验的一致性判定

- 文本：归一化（去空白/大小写/标点）后相等，或一方包含另一方；
- 日期：抽数字成 `YYYY-MM` 再比，允许 `2027 | 6` / `2027年6月` / `2027-06-01` 互相匹配；
- 是否题：`是/有/true/yes/1/on` 视为真；
- 选项型：若画像值不在页面选项里 → 不静默写入，报「选项不匹配」让用户确认；
- 必填：以扫描的 `required` 为准，但 medium/low 的可信度要在报告里标出来。
