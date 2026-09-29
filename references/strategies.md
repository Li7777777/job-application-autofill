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
// ⚠️ 找不到目标日不要退化成「最近的可用日」，直接失败并列入最终确认（calendarPick 已如此）

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
> （实测「推荐码」被误判为必填）。medium/low 必填置信度应标记到最终复核清单，
> **不要在填充前打断用户**；有可靠画像来源的值仍可暂填，最终让用户决定是否必填。

## 3. 文件上传（优先 browseros-neo_upload，CDP 备用）

**首选：MCP file input 上传**——先用 MCP `evaluate` 给真实 `input[type=file]` 加可读的
`aria-label`、`tabindex` 并滚动到视口，然后 `snapshot(mode="interactive")` 找到真实 file input，
调用 `browseros-neo_upload`。上传后用 `snapshot` 或短 `evaluate` 回读附件区文件名。

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
- MCP 上传必须使用真实 file input 的 ref；对「上传」按钮 ref 调 `upload` 会报 `Node is not a file input element`。
- 不要点击会弹系统文件框的普通上传按钮；先找真实 `input[type=file]`。MCP 明确无法触发 change 时，
  才用 CDP `uploadc` 拦截文件选择器，并用 MCP 回读页面状态。
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
- 会话/工具会话可能被重建。先用 MCP 在原 page 续跑；若 page ownership 丢失，用 `scripts/cdp.mjs list`
  找同一 targetId 接管，不要用 CDP `open` 重开页面。
- 用 `name_session` 给会话取名（如 `form autofill`），便于多任务并存。
- MCP 页面操作之间不要长时间空置；等待渲染用 `browseros-neo_wait(for="selector")`，不要在
  `evaluate` 里写长 `sleep`。后台标签页可能冻结定时器，交互前先用 MCP 保证页面可见。
- 单次 MCP `evaluate` 的 transport timeout ≤25 秒；页面脚本默认 `maxRunMs=18000`。返回 `deferred`
  就在同一 page 重跑；不要把 timeout 当成失败，也不要立刻重复写入。

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
- 选项型：精确/归一化相等直接使用；编译阶段可把**唯一且相似度 ≥0.60**的页面候选暂选为页面原文，写入 mapping 并标记最终复核；候选并列或相似度更低则留空，放入最终清单。填充器仍只精确点击页面选项，不在 DOM 阶段猜测。自定义下拉先用 `OPTS.probeOptions=true` 探测，或用 `--probe` 合并结果。
- 必填：以扫描的 `required` 为准，但 medium/low 的可信度要在报告里标出来。

## 8. CDP 备用通道（MCP 优先，明确失败后才接管）

MCP 是默认执行路径。下面的 CDP 说明只用于 MCP 无法继续时的故障恢复：先保留同一页面和状态，
再通过本机 CDP 找到同一 targetId 接管；不要为了追求速度主动跳过 MCP。

### 8.1 何时启用备用通道

| 现象 | 处理 |
|---|---|
| 普通字段、扫描、校验可以由 MCP `evaluate` 在 25 秒内完成 | 继续使用 MCP，不启用 CDP |
| `20_fill.js` 返回 `deferred` | 在同一 page 用相同 mapping 重跑，依靠幂等跳过已完成字段 |
| MCP 报 `page N is not owned by this agent` | 用 `cdp.mjs list` 找原 targetId，接管同一页，不 `open` |
| MCP 对某控件连续真实点击/键入失败 | 先 `snapshot/diff` 复核状态；仍失败再用 CDP 真实输入 |
| MCP `upload` 对真实 file input 仍未触发 change | 用 CDP `uploadc`，再用 MCP 回读 |
| 页面确实需要超过多个 MCP 短批次且无法安全拆分 | 记录原因后才用 CDP `eval`，完成后回到 MCP 校验 |

遇到 MCP timeout 时，第一动作是 MCP 只读回读 `15_dump_state.js` 或小型状态查询。页面任务可能已
完成一部分；确认状态后再续跑，避免重复添加经历块或反复覆盖字段。

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

> 这些限制说明为什么要做短批次和同页接管，不是把 CDP 设为默认。普通扫描、字段填充和校验应先走 MCP；
> 只有短批次仍不能完成时，才使用下面的 CDP fallback。

### 8.3 备用通道：通过浏览器原生 CDP 接管同一页面

端口写在 `config.json` 里（Windows：`%LOCALAPPDATA%\BrowserClaw\User Data\.browseros\config.json`）：

```json
{"ports":{"cdp":9110,"proxy":9010,"server":9210}}
```

`ports.cdp` 对本机浏览器页面没有 MCP 的页面归属检查，也不受 MCP evaluate 传输超时限制。
零依赖驱动脚本：**`scripts/cdp.mjs`**（Node 18+，零第三方包）。接管时只使用同一 targetId：

```bash
node scripts/cdp.mjs port                        # 读取备用 CDP 端口
node scripts/cdp.mjs list                        # 找 MCP 正在使用的同一页面
node scripts/cdp.mjs eval <same-targetId> fill.js 600000
node scripts/cdp.mjs click <same-targetId> "span.del-btn"  # MCP act 连续失败时才用
```

完成 CDP 接管后，回到 MCP 做 `snapshot` 或短 `evaluate` 校验；只有确认 MCP 无法继续时才保留长任务。

### 8.4 备用通道能处理的动作

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

### 8.5 MCP 短批次的止损规则

- 单次 MCP `evaluate` 的 transport timeout ≤25 秒；页面脚本 `maxRunMs` 默认 18000ms，宁可多次短调用。
- `20_fill.js` 返回 `deferred` 不算失败：同一 page、同一 mapping 重跑，已完成字段会被跳过。
- `probeOptions` 以约 16 秒为默认预算，并把已读分组增量缓存到 localStorage。
- MCP 操作之间不要长时间空置；等待渲染用 `wait(for="selector")`，不要在页面脚本里长时间 `sleep`。
- timeout 后先做只读状态回读；确认未完成后再续跑。ownership 丢失才进入 CDP fallback。

### 8.6 写库型页面的黄金流程（血泪总结）

1. 先 `eval` 把「已保存状态」dump 下来（**结论以服务端为准**：改完要 `location.reload()` 再 dump 一次）。
2. 编辑时**按名称/语义定位**，别依赖行号：服务端保存后列表顺序可能和你编辑时的 DOM 顺序不一致，
   按位置写会导致「名称↔日期」整体错位。
3. 记录必须**整条重写**（同一条记录的名称/日期/职责/描述一起写），写完 `保存`，
   然后 **reload + 按名称校验**（本次就是靠这一步才发现 13/15 条错位）。
4. 删除行要**用真实点击**（或 React onClick），并在确认框弹出后再点一次「确认」。
5. 最后再 dump 一次完整清单交给用户人工复核；**提交/投递按钮永远留给用户**。

### 8.8 MCP-first 标准流程

> 长表单也先拆成 MCP 短批次。下面的 CDP 只在单步 MCP 失败、ownership 丢失或上传 change 链路失败时启用。

**分工决策表**（先判类型，再选通道）：

| 控件/任务 | 首选通道 | CDP fallback |
|---|---|---|
| 页面脚本（扫描/短批次填充/状态导出） | MCP `evaluate`，timeout ≤25s | ownership 丢失或短批次持续失败时 `cdp.mjs eval` |
| 文本 / textarea / 原生 `<select>` / 日期 | MCP `evaluate(20_fill.js)`，18s 业务预算 | `cdp.mjs eval`，完成后回 MCP 校验 |
| radio / 开关 / 自定义按钮 | MCP `act` + snapshot/diff | `cdp.mjs revalclick/clickn` |
| popover 多选/级联/搜索树/日历 | MCP `act` | MCP 连续失败后 CDP 真实点击 |
| contenteditable 日期分片 | MCP `act focus/type` | CDP `focus` 后回 MCP `type` |
| 受控 `<input type=file>` | MCP `upload` 真实 file input | CDP `uploadc`，再 MCP 回读 |
| 滚动/等待 | MCP `act scroll` / `wait` | CDP 仅用于页面已失去 ownership 的恢复 |

**MCP 超时规则：**

1. MCP `evaluate` 使用 ≤25 秒的 transport timeout；脚本默认 18 秒业务预算，返回 `deferred` 就同页重跑。
2. `snapshot/diff` 是交互后的回读手段；脚本结果较大时按 section 或状态查询拆分，不为捞完整输出切换 CDP。
3. MCP timeout 后先只读回读；不要重复执行会添加记录块的操作。ownership 丢失后才用 CDP 接管。

**实测数据（当年混合模式的历史测得，是现在短批次预算的设计依据）**：

- 批量 45 文本字段：CDP 一次 eval ~5s —— 拆成 18s 短批次后 MCP evaluate 同样能吃完（按 10–15 字段/批）。
- 30 个 date input：CDP 一次 eval ~3s —— 直写型字段在单批内开销极小。
- 加 14 个重复块：CDP 合成 click ×14 ~12s（注意 §5 坑表「找按钮误点其他区块」）；现在按 `25_mokahr_fiber.js` 的 partial/add deferred 语义分批做。
- 单步 MCP act（click/type）：每次 ~1-3s 工具往返 + agent 思考时间；质量高（遮挡拦截 + diff 自验证）——这是它成为默认交互通道的原因。
- 附件：`uploadc` 拦截模式一次成功；`upload` 直设模式 0% 成功（React 重置）——MCP upload 失败时的备用顺序不变。

**经验法则**：默认走 browseros-neo MCP；页面脚本拆成短批次，交互用 `act` 并立即 `snapshot/diff` 回读。
只有 MCP 明确无法继续时，才用 CDP 接管同一页面，完成后回 MCP 校验，绝不主动重开页面重填。
