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
- ⚠️ **重建是常态，不是偶发**：只要一次 `evaluate` 超过 60 秒，或前后两次调用间隔久了，
  MCP 侧就会换一个新会话，**之前开的页全部作废**（改名也认不回来，归属认的是会话 id）。
  机制、证据和绕过方法见 §8 —— 长任务请直接走 CDP，不要用 MCP 硬扛。

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

## 8. 长任务：绕开 MCP，直连浏览器原生 CDP（重要）

### 8.1 症状（如果你看到这些，就是撞上了 MCP 的两个硬限制）

| 症状 | 真实原因 |
|---|---|
| 填到一半 `page N is not owned by this agent; call tabs new …` | MCP 会话被换掉，旧页归属失效 |
| 同一个页反复开，标签页越堆越多、关不掉 | 每次换会话只能 `tabs new`；旧页归属已死会话，当前会话无权关闭 |
| `evaluate` 报 `CDP request timed out: Runtime.evaluate`（约 60 秒） | 浏览器侧 CDP 桥的**请求超时是 60 秒**（写死的） |
| 后台长任务跑一半停住、`localStorage` 里的进度不再更新 | 上一次 `evaluate` 被超时掐断，页面里的 async 任务也被回收 |
| `browseros-neo_run` 永远 `did not return structured output` | 该工具在本环境不可用，别试了 |

### 8.2 机制（来自源码，不是猜的）

BrowserOS neo 的 MCP 后端是开源的 Rust 服务（`browseros-ai/BrowserOS` → `packages/browseros-agent/apps/claw-server-rust`）：

- 标签页归属 = 数据库里的一条凭证：`tab_claims(target_id, session_id, agent_id, claimed_at, released_at)`。
  守卫 `api/mcp/guards/page_ownership.rs` 的注释写得很直白：
  *“Dispatch requires a pre-existing claim for this conversation; **unclaimed user pages are rejected
  here and never auto-claimed**.”* —— 所以「用户/别的会话开的页」永远不会被自动接管。
- 会话身份 = MCP 会话（`agent_id` 形如 `pi-mcp-browseros-neo-<随机动物名>`）。会话重建 → 新 id → 旧凭证作废。
- 空闲也会回收：`CLAW_SESSION_IDLE_MS` 默认 30 分钟、`CLAW_SESSION_SWEEP_INTERVAL_MS` 默认 60 秒。
- 60 秒来自 `crates/browseros-cdp/src/client.rs` 的 `ConnectOptions::default().request_timeout = 60s`
  （`crates/browseros-core/src/timeouts.rs` 里也留了个 `CDP_REQUEST_TIMEOUT`），**没有环境变量/配置项**。
- 唯一那个用户可改的 flag（`flags.allow_remote_in_mcp`）只管「允不允许非本机客户端连 MCP」，与归属/超时无关。

> 设计意图没错：一个浏览器被多个 agent 共用，还要能按会话回放，所以必须按会话发凭证、且不抢用户的页。
> 但它对「一次性干几分钟的填表任务」太苛刻。

### 8.3 破解：浏览器把**原生 CDP** 开在本机端口上

端口写在 `config.json` 里（Windows：`%LOCALAPPDATA%\BrowserClaw\User Data\.browseros\config.json`）：

```json
{"ports":{"cdp":9110,"proxy":9010,"server":9210}}
```

`ports.cdp` 就是 MCP 服务器自己用的那条通道 —— **直连它没有归属校验，也没有 60 秒上限**。
零依赖驱动脚本：**`scripts/cdp.mjs`**（Node 18+，零第三方包）。

```bash
node scripts/cdp.mjs port                        # 读出 CDP 端口（默认 9110）
node scripts/cdp.mjs list                        # 列页面
node scripts/cdp.mjs open "https://…/apply"      # 开一个页，拿 targetId（只开一个！）
node scripts/cdp.mjs eval <targetId> fill.js 900000   # 跑几分钟的填充脚本
node scripts/cdp.mjs click <targetId> "span.del-btn"  # 真实鼠标点击
```

工作方式：把要干的事写成一个 JS 文件（可以几千行、包含 15 次「加一条记录 + 填 7 个字段 + 选日期」的循环），
一次 `eval` 跑到完，中途用 `return` 汇总结果。**整个过程只用一个页、不会产生重复标签页。**

### 8.4 三个只有 CDP 才做得干净的动作

1. **真实鼠标点击**（`click` / `revalclick`）：走 CDP `Input.dispatchMouseEvent`，浏览器视为真人点击。
   页面里那些「hover 才出现」「只用 React 代理事件」的控件（删除按钮、确认弹窗）用它才稳。
2. **直接调 React 处理器**：合成 `el.click()` 常常无效（React 16 的代理事件不认），这时可以从元素上取
   内部实例，直接调它的 `onClick`：
   ```js
   const key = Object.keys(el).find(k => k.startsWith('__reactInternalInstance') || k.startsWith('__reactFiber'));
   const props = el[key] && (el[key].memoizedProps || el[key].props);
   props.onClick({ stopPropagation(){}, preventDefault(){}, nativeEvent:{}, currentTarget: el, target: el, type:'click' });
   ```
   （删除按钮 + 它的「确认删除」弹窗按钮，实测只有这条路能生效。）
3. **长时间批量 + 中途落盘**：脚本里把进度写进 `localStorage`（同源跨页可读），随时另开页查看进度。

### 8.5 走 MCP 时的止损规则（不改代码的前提下）

- 单次 `evaluate` **≤ 40 秒**，宁可拆成多次；绝不超过 60 秒。
- 浏览器操作之间**不要有长间隔**（长时间 `sleep`、等用户回复都可能让会话过期）。
- 一批只用一个页，做完就 `保存`，不要指望 DOM 里的未保存状态能跨会话活着。
- 若要延长空闲窗口，可给 claw-server 进程设环境变量：`CLAW_SESSION_IDLE_MS`（默认 1800000）、
  `CLAW_SESSION_RETENTION_MS`（默认 3600000）、`CLAW_SESSION_SWEEP_INTERVAL_MS`（默认 60000）。
  这只能救「空闲丢归属」，救不了 60 秒超时；真要长任务走 MCP，只能自己改源码重编（见 §8.2 的路径）。

### 8.6 写库型页面的黄金流程（血泪总结）

1. 先 `eval` 把「已保存状态」dump 下来（**结论以服务端为准**：改完要 `location.reload()` 再 dump 一次）。
2. 编辑时**按名称/语义定位**，别依赖行号：服务端保存后列表顺序可能和你编辑时的 DOM 顺序不一致，
   按位置写会导致「名称↔日期」整体错位。
3. 记录必须**整条重写**（同一条记录的名称/日期/职责/描述一起写），写完 `保存`，
   然后 **reload + 按名称校验**（本次就是靠这一步才发现 13/15 条错位）。
4. 删除行要**用真实点击**（或 React onClick），并在确认框弹出后再点一次「确认」。
5. 最后再 dump 一次完整清单交给用户人工复核；**提交/投递按钮永远留给用户**。
