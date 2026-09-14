# 策略库：控件配方 / 启发式 / 工具技巧

> 全部结论来自两次真机实测：`app.mokahr.com`（自定义组件重型）与 `www.selenium.dev/.../web-form.html`（原生控件全类型），
> 并在 2026-09 对照 Chrome 扩展「牛客网申助手 1.0.8」的抽取/填写链路做了扩充。
>
> **7 大 ATS 框架（antd / Element / ATSX / moka / 北森 / Hotjob / 飞书）的识别、下拉、日历配方
> 单独放在 `references/component-recipes.md`**；本节只讲通用启发式与工具技巧。

## 1. 控件配方（怎么点、怎么写）

> 已全部固化进 `scripts/20_fill.js`（`setNative` / `simulateType` / `setContentEditable` /
> `clickReal` / `fillCustomSelect` / `calendarPick`）。下面这些片段是「读代码前的速览」，
> 改脚本时以脚本为准；框架相关的选择器见 `component-recipes.md`。

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

// ④ 自定义下拉（antd / Element / mokahr sd-Select / 飞书 ud__select / 北森 phoenix…）
//    真实鼠标序列开面板（React 代理事件不认 el.click()）
for (const t of ['pointerdown','mousedown','mouseup','click']) el.dispatchEvent(new MouseEvent(t, {bubbles:true, clientX, clientY}));
await sleep(260);
// 面板 = 「离触发元素最近的可见弹层」；选项只取叶子/单子包裹层
const opt = rankOptions(want, collectOptions(panel, cfg.option_selector))[0];
// 只有 score >= 0.98（原文相等 / 归一化后相等）才点；包含与缩写匹配只进 suggestions
opt.el.scrollIntoView({block:'center'}); clickReal(opt.el);
// 校验：读 *显示值*（display_value_selector），不要读 input.value（自定义组件常为空）
// 读值铁律：display_value_selector → select.selectedOptions → el.value；
// 只有自定义组件才去猜外层容器文字（否则裸 input 会把字段标签当成值）

// ⑤ 只读日期框（input readonly + 日历图标）—— 只 click() 不会弹！必须补鼠标序列
inp.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
inp.dispatchEvent(new MouseEvent('mouseup',   {bubbles:true}));
inp.click();
// 面板里：◀◀/▶▶ 每次 ±N 年；月名可能是 '一月'…'十二月' 或 '1月' 或 'Jan'
// ⚠️ 日期预置不能只看字段的框架标签：混合框架页面上会选错预置。
//    20_fill.js 的做法：打开面板后，看「哪套预置的选择器真的出现在这个面板上」来选（presetScore）。
// ⚠️ 时间粒度自适应：画像只存最细的（1999-09-15），组件要多粗填多粗（1999-09 / 1999）。
//    calendarPick 支持 stopAt 并返回实际走到的粒度；**绝不拿 01 去凑日号**（要更细就问用户）。
// ⚠️ 找不到目标日不要退化成「最近的可用日」，直接失败并问用户（calendarPick 已如此）

// ⑥ 复选框：值语义映射（是/否、true/false、1/0）→ 需要勾就 click，需要去掉也 click
```

**弹层选项查找规则**（`collectOptions` + `rankOptions`）：容器取 `option_container_selector` 里**可见、非黑名单、
离触发元素最近**的那个；选项只收「无子元素或只有一个同文子元素」的叶子/包裹层，文本 1–80 字符；
打分：原文相等 1.0 / 归一化相等 0.98 / 包含 0.5–0.8 / 中文缩写按序包含 0.45。
**只有 ≥0.98 才会点击**，其余进 `suggestions` 交给用户。

## 2. 字段名与必填的启发式（扫描器怎么想）

> 扫描器现在产出两组名字：`label`（显示用，给人看）与 **`labelNorm`（去噪声，给匹配用）**。
> 字典匹配、站点记忆、问答记忆一律走 `labelNorm`；`label` 只用于报告。

字段名候选顺序（可信度从高到低）：
1. `field-title`：从控件包裹层之外向上找，取该层第一个「不含控件、文字 ≤40」的子元素
   → 命中 `<div class="title-*">意向工作城市</div>` 这类结构（自定义组件里最可靠）
2. `aria-label` / `aria-labelledby` / `label[for]`
3. `wrapping-label`：包裹控件的 `<label>` 文本 —— **注意**：自定义组件里它常常就是“当前选中值”（如「北京市」），
   所以要先排除「与控件自身值/placeholder 相同」的候选
4. 框架 `level2_class` 命中的标签（最准；命中就跳过 5）
5. 各层祖先的第一行文字（由外向内，同样排除自身值）
6. `placeholder` / `title` / `name` / `id`（机器名兜底）
显示用字段名 = 候选里第一个长度 ≤24 的；否则用第一个候选。

**标签归一化**（`labelNorm`，与 `jaa_lib.norm_label` 必须一致）：
去 `（必填）(必填)（可选）(可选)（选填）(选填)必填选填可选添加编辑` → 去**整段括号内容** →
去行首编号与 `+` → 去空白/标点/大小写。
实测：`毕业时间（必填）` 之前匹配不上，现在能直接命中 `education.end`。

**区块与重复块**：扫描器还产出 `section`（区块标题）与 `block`（重复块序号）。
多段经历靠 `(section, block)` 定记录序号 —— 见 `component-recipes.md` §6。

必填判定：
- `required` / `aria-required=true` / `data-required=true` → high
- 控件 class 含 `required-*` → high
- **框架信号**：`.ant-form-item-required`（antd）、`.el-form-item.is-required`（Element）→ high
- 向上 7 层内，任一祖先满足「文字 <150 且里面控件数 ≤4（字段级，不是区块级）且不含『选填/非必填』」，
  且该祖先含 `*`/「必填」字样或存在 `[class*=required|asterisk]` 或 `[data-required]` → medium
  （**必须让用户确认**）

> 实测：mokahr 的下拉比文本框多一层 `Dropdown-container`，所以层数要给够；
> 而「申请信息」这种同区块里另一个字段是必填时，会给同区块的选填字段带来**误判**
> （实测「推荐码」被误判为必填）→ 所以 medium 一律进 todo 让人确认，不要直接信。

## 3. 文件上传（`<input type=file>` 不在无障碍树里）

**首选（2026-09 定稿）：文件选择器拦截，一步到位**——对 React 受控 file input 也可靠：

```bash
# 触发元素表达式文件（返回「点击上传」那个 span/button）：
#   (() => [...document.querySelectorAll('span')].find(e => e.textContent.trim()==='点击上传'))()
node scripts/cdp.mjs uploadc <targetId> <触发元素.js> "E:/path/agent.pdf"
```
> 拦截模式：`Page.setInterceptFileChooserDialog(true)` → 真实点击触发元素 → 等 `Page.fileChooserOpened`
> → `DOM.setFileInputFiles({backendNodeId})` → 浏览器走**原生 change** → React onChange 收到。
> 回读验证：CDP eval 读附件区文本是否出现文件名。
>
> ⚠️ **不要用 `DOM.setFileInputFiles` 直接设 input**（`cdp.mjs upload` 旧命令）：不触发 change，
> 且 React 受控组件在下一帧重置 input —— 文件静默丢失（汇川实测）。

备选（老站 / MCP 侧、file input 非受控时）：

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
- **不要真的点击上传按钮**（弹系统文件框，自动化会卡住；除非用了 uploadc 的拦截模式）；
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
- ⚠️ **后台标签页的定时器会被冻结**：`eval` 里含 `await sleep()` 的脚本会**永久挂起**（看起来像 CDP 超时）。
  跑异步脚本前先 `node scripts/cdp.mjs front <id>`；详见 §8.7。
- ⚠️ **重建是常态，不是偶发**：只要一次 `evaluate` 超过 60 秒，或前后两次调用间隔久了，
  MCP 侧就会换一个新会话，**之前开的页全部作废**（改名也认不回来，归属认的是会话 id）。
  机制、证据和绕过方法见 §8 —— 长任务请直接走 CDP，不要用 MCP 硬扛。

### 8.7 后台标签页会**冻结定时器** —— 含 `await sleep()` 的脚本会永久挂起（必看）

这是 2026-09-14 在赛力斯（zhiye）与 mokahr 上**独立踩到两次**的问题，会伪装成"CDP 超时"：

| 现象 | 真因 |
|---|---|
| `Runtime.evaluate` 跑到几分钟/几十分钟才报 `rpc timeout`，脚本明明不慢 | 目标页**不在前台**时，Chrome 冻结后台页的 `setTimeout` / `requestAnimationFrame`：脚本里第一个 `await sleep(300)` 就再也不返回 |
| 同一个脚本改成**全同步**就能跑完 | 同步代码不受冻结影响，所以"看起来像是脚本的错" |
| 下拉/日历面板"点开后读不到任何选项"、`offsetParent` 正常却读不到 | 面板要在下一帧渲染，而后台页没有帧 |

**解法（推荐用 `wake`，它比 `front` 强）**：
0. **`node scripts/cdp.mjs wake <targetId>`** —— `bringToFront` + `Page.setWebLifecycleState('active')` + `Emulation.setFocusEmulationEnabled` 三连，
   并回读 `document.visibilityState / hidden / hasFocus` 让你确认是否真的活了。
   ⚠️ **只 `bringToFront` 不够**：窗口被遮挡/最小化时 `document.visibilityState` 仍然是 `hidden`（实测），
   面板照样不渲染、定时器照样被节流。**跑异步脚本前先 `wake`，并检查它回读出来的 `visibility` 是不是 `visible`**。
1. 退一步至少 `node scripts/cdp.mjs front <targetId>`（内部是 `Page.bringToFront`）；
   注意 `cdp.mjs click / clickn / revalclick / seq / type` 会自动 bringToFront，**`eval` 不会** —— 批量填表前手动唤醒一次。
2. 写脚本时把「等面板出现」改成**轮询 + 硬上限**，并且别把关键路径押在单次 `sleep` 上。

> 并发跑多个站点/多个子任务时特别容易中招：A 站的脚本把标签切到前台，B 站的异步脚本就被冻住。
> 结论：**多任务并发时，每个站点跑之前都要 `wake` 自己那页**（窗口被遮挡时 `front` 不够）。

**推论（很重要，会改变你的处置动作）**：`Runtime.evaluate` 报超时**不等于**页内脚本停了 ——
超时只是**本地等待放弃**；浏览器侧那个 async 任务常常还在继续跑，甚至最终跑完。
实测（hotjob）：一次填充脚本"超时"报错后，**它自己把 15 个字段填完了**。
所以看到超时的第一动作不是重跑，而是：
1. `eval` 一个「只读回读」脚本（或 `15_dump_state.js`）看**目标字段是不是已经写好了**；
2. 确认没写好再重跑 —— 直接重跑容易写出重复记录或把已填值翻来覆去覆盖。

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
  **时间粒度自适应产生的截断不算冲突**：表单 `1999-09`、画像 `1999-09-15` → 报 `OK`（截断）而非 `≠≠`；
  只有「表单比画像更细」或两者不同年月才报冲突；
- 是否题：`是/有/true/yes/1/on` 视为真；
- 选项型：**闸门在编译阶段**（`40_build_mapping.py`）——值不在页面选项里就**不写进 mapping**，
  而是进 `*-todo.md` 变成 `option-choice` 阻塞项，附「建议值 + 全部选项」。
  包含匹配（`contains`）与中文缩写匹配（`subsequence`）**只作建议**，永远不自动改值。
  自定义下拉的选项靠 `OPTS.probeOptions=true` 先探测，或用 `--probe` 合并探测结果。
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
   ⚠️ **两者对表达式的返回形状要求不同**：`revalclick` 要**单个元素**，`clickn` 要**元素数组**。
   给 `revalclick` 返回 `[el]` 会得到 `expression returned no element`（静默什么都没点）；反之同理。
   同理：表达式返回的元素若**当前不可见**（`getBoundingClientRect()` 全 0，例如页面停在"只读摘要视图"、编辑表单在 DOM 里但被隐藏），
   会报 `element has zero size (hidden?)` 并点到 (0,0) —— 先切回可编辑视图再动手。
   ⚠️ **`clickn` / `revalclick` 的表达式必须返回「元素」或「元素数组」**，不能返回字符串/数字 ——
   返回字符串时工具拿到的是 `[null]`／`did not return an element`，表现为**静默什么都没点**。
   实测踩过：把待选值当参数塞进表达式（`() => WANT`），6 个字段一个都没点中，排查半天。
   **要传参数就先 `window.__WANT = …` 设一次，再让表达式只返回元素。**
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

### 8.8 混合模式标准流程（2026-09-14 汇川自建站实测定稿；SKILL.md §2 的执行依据）

> 实测背景：react-aria + Tailwind 自建站，9 区块长表单（54→243 字段）、15 个重复项目块、
> react-aria 多选/级联/搜索树弹层、contenteditable 日期分片、受控 file input。
> 一次会话内 MCP 重建 **3 次**（含一次由 `browseros-neo_run` 连续报错触发）；CDP 全程无中断。

**分工决策表**（先判类型，再选通道）：

| 控件/任务 | 通道 | 要点 |
|---|---|---|
| 页面脚本（扫描/批量直写/状态导出） | CDP `eval` | 输出直落盘；MCP evaluate 有 5000 字符截断，别用来跑脚本 |
| 文本 / textarea / 原生 `<select>` / 隐藏 `<input type=date>` | CDP `eval` 批量 | native setter + `input`/`change`；逐字段回读 `OK/MISMATCH`；date input 直写后分片显示自动联动 |
| radio / 开关 / 自定义按钮 | CDP `revalclick`/`clickn`（真实点击） | **合成 `click()` 会假成功**：DOM `checked=true` 但不进 React store，重渲染即丢（实测踩中） |
| popover 多选/级联/搜索树/日历 | MCP `act` | 真实输入 + 遮挡检测 + diff 回读；开面板→点选项→点面板外空白关闭（Esc/「取消」常被 fixed header 遮挡） |
| contenteditable 日期分片 | CDP `focus` + MCP `act type` | 合成 `KeyboardEvent` 无效、合成 `beforeinput(insertText)` 可用但不稳；**真实键盘最稳**：focus 年段后一次 type 8 位 `20240901`，逐段自动流转 |
| 受控 `<input type=file>` | CDP `uploadc`（文件选择器拦截） | `DOM.setFileInputFiles` 直设**不触发 change** 且 React 下一帧重置 input——文件静默丢失（实测踩中） |
| 滚动/等待 | CDP eval 或 MCP `act scroll`/`wait` | sticky 底栏会盖内容，交互前 `scrollIntoView({block:'center'})` |

**MCP 三条红线**（保证不撞 60s / 不丢归属）：

1. **MCP 只用单步原语**（`tabs`/`snapshot`/`act`/`wait`），页面脚本一律 CDP `eval`；
   确需 MCP `evaluate` 时单次 ≤ 40 秒（60s 限制留 20s 余量）。
2. **MCP 调用保持连续**（间隔 < 30 分钟空闲回收阈值）；长批处理交 CDP，MCP 只做短交互。
3. **CDP 兜底**：报 `page N is not owned by this agent` 时不重开页、不丢状态——
   `node scripts/cdp.mjs eval/click/revalclick <targetId> …` 直接接管同一页继续干。

**实测数据（混合 vs 纯 CDP vs 纯 MCP）**：

- 批量 45 文本字段：CDP 一次 eval ~5s（MCP evaluate 会被 5000 字符截断 → 捞 tool-output 多一步）。
- 30 个 date input：CDP 一次 eval ~3s。
- 加 14 个重复块：CDP 合成 click ×14 ~12s（注意 §5 坑表「找按钮误点其他区块」）。
- 单步 MCP act（click/type）：每次 ~1-3s 工具往返 + agent 思考时间；质量高（遮挡拦截 + diff 自验证）。
- 附件：`uploadc` 拦截模式一次成功；`upload` 直设模式 0% 成功（React 重置）。

**经验法则**：能用 CDP 批量的用 CDP；需要「看页面再决定点哪」的交互用 MCP act；
分片键入用 CDP focus + MCP type；受控上传用 `uploadc`；MCP 一死立即 CDP 接管，绝不重开页面重填。
