---
name: job-application-autofill
description: 面向简历投递 / 校招网申的自动填表 skill（站点无关）。给定用户提供的招聘网站或申请页链接：扫描表单与必填项（含区块/多段经历/组件框架识别）→ 上传简历触发解析预填 → 用画像与记忆编译字段映射（选项对不上一律只出建议）→ 用站点内置组件（自定义下拉、级联、日期日历、文件上传）自动填入 → 程序化校验后交用户审核；并把「字段名→取值」持续沉淀成可复用的问答记忆、选项对照与站点记忆，下次投递越用越快。内置 antd/ElementUI/ATSX/Moka/北森/Hotjob/飞书 七大 ATS 框架的控件与日历配方。遇到不确定一律问用户、绝不猜测，且**绝不代替用户提交**。当用户要投简历、填网申/校招申请表/报名/登记表/求职申请，或给出 URL 说「帮我填一下」「帮我投」时使用。
version: 1.1.0
metadata:
  verified_sites: "app.mokahr.com（自定义组件重型表单）、selenium web-form（原生控件全类型）"
  data_dir: "<运行环境>/data（skill 安装目录下，已 gitignore）；可用 $JAA_DATA_DIR 覆盖"
  framework_recipes: "antd / element(ElementUI+Plus) / atsx / mokahr / beisen / hotjob / feishu"
---

# 简历投递 / 网申自动填表（job-application-autofill）

面向**简历投递与校招网申**：对任意招聘网站的用户表单做「看清结构 → 上传简历触发解析 → 编译取值 →
用站点内置组件填入 → 程序校验 → 交用户审核」。站点差异靠 **adapters 文档 + 记忆**吸收，流程与站点无关。

**执行模式（2026-09 定稿）：CDP 快填充 + MCP 复杂交互的混合模式**——CDP（`scripts/cdp.mjs`）负责
扫描、批量直写、真实点击、上传、状态导出（无 60s 限制、无会话归属问题、输出直落盘）；
MCP（`browseros-neo`）只做单步交互（tabs 开页、snapshot 看结构、act 点弹层/下拉/键入分片）——
它有遮挡检测与 diff 回读，对复杂组件成功率最高，但**必须遵守三条红线**（只跑单步原语、
evaluate ≤ 40s、会话重建后用 CDP 接管而不是重开页），详见 §2 开头的分工表。

## 0. 三条铁律（先读）

1. **绝不代替用户提交**。不点「提交 / 投递 / 立即申请 / 确认 / 下一步 / 发送 / 支付 / 删除」类按钮；
   脚本内有 `SUBMIT_RE` 拦截，扫描/填充只写字段。是否提交、何时提交，永远由用户决定。
2. **不确定就问，不许猜**。字段名认不出、选项对不上、必填判定存疑、日期控件写不进去 → 一律进
   `*-todo.md` 让用户回答；**禁止**凭常识填一个「大概是这个」的值，也禁止静默失败。
   选项匹配的安全线（三方一致：`20_fill.js`、`jaa_lib.py`、`40_build_mapping.py`）：
   **只有「原文相等」与「去空格/标点/全角、转小写后相等」才自动选**；
   包含匹配（北京→北京市）与中文缩写（北大→北京大学）**只进 suggestions 让用户选**。
   日历同理：找不到目标日**不**退化成「当天≤15 取第一个可用日」。
3. **值要能解释来源**。每个字段都记录 `canonical / source ∈ {profile, site-memory, qa, user-answer, manual}`；
   校验报告里要能说清「这个值是哪来的」。

## 1. 准备（只做一次）

- 工具：`browseros-neo` MCP（tabs/snapshot/act/wait）+ `scripts/cdp.mjs`（CDP 直连）+ 本机 `python`
- ⚠️ **执行模式：CDP 与 MCP 混合，各管一段**（详见 §2 开头的分工表与三条红线）：
  - **CDP（`scripts/cdp.mjs`，默认端口 9110）= 快通道**：页面脚本注入（扫描/批量填值/导出状态）、
    真实点击（clickn/revalclick）、文件选择器拦截上传（uploadc）、聚焦（focus）。
    无归属校验、无 60 秒上限、输出直落盘。MCP 会话重建后依然可用，是**兑底通道**。
  - **MCP act = 交互通道**：单步点击/键入/滚动/快照（`tabs/snapshot/act/wait`）。
    自带遮挡检测与 diff 回读，对「复杂按钮、自定义下拉、级联、搜索树、contenteditable 分片键入」成功率最高。
  - **MCP 限制（源码级，无配置可改，详见 `references/strategies.md` §8）**：
    `evaluate` 60 秒硬超时 + 会话回收（一次超 60s 或空闲 30min 即换会话，旧页归属全丢）。
    `browseros-neo_run` 在本环境不可用（structured output 失败），别试。
- **数据目录**：默认就是本 skill 运行环境自己的 `data/`（即 `scripts/` 的同级目录；
  从仓库直接跑就是 `<repo>/data/`）。首次运行会创建它，并从 `assets/` 播种
  `profile.json` 与运行期 `memory/dictionary.json`；可用 `$JAA_DATA_DIR` 指到别处。
  该目录在 `.gitignore` 里 → **画像、别名、问答记忆、站点记忆、运行快照都不会进仓库**。
- 用户画像：`<数据目录>/profile.json`（模板见 `assets/profile.template.json`；跨站点复用，只改 `job.*`）
- 简历文件（可选，用于解析预填）：建议先复制到 ASCII 安全路径再上传
- 站点适配笔记：`references/adapters/<host>.md`（有就照做，没有就自己摸索后补一份）
- **组件配方库**：`assets/platform-selectors.json`（权威配置）+ `references/component-recipes.md`（说明书）。
  七大框架的 detect / 下拉选项容器 / 日期面板预设 / 弹层黑名单都在这里。
  扫描器与填充器各自**内嵌**了它需要的部分（`evaluate` 里没法读本地文件）；两边必须同步，
  `tests/selftest.py` 第 7 节是漂移守卫，改了资产忘了改脚本会直接测试失败。
- 改脚本后先自检：`node dev/check_js.js scripts/10_scan_form.js scripts/20_fill.js scripts/15_dump_state.js`
  （把脚本按 evaluate 的「函数体」形状解析一遍）；
- 全量回归（无需浏览器）：`python tests/selftest.py`；
- **真机端到端**（需要浏览器开着 CDP，会新开一个页并在跑完后关掉）：`python tests/browser_e2e.py`
  —— 它拿 `tests/fixtures/form-lab.html` 这个合成表单（mokahr 式 sd-Select + antd 式 ant-select/ant-picker
  + 原生 select + 两段教育背景 + 一个提交按钮）验证「下拉真的选对 / 日历真的点到目标日 /
  两段经历各取画像第 1、2 条 / 提交按钮一次没被点 / 近似选项只给建议不自动点选 / 重跑幂等」。

## 2. 流程（八步）

设 `SKILL=<本 skill 的安装目录>`（例如 pi 的 `~/.pi/agent/skills/job-application-autofill`）。
数据目录默认是 `$SKILL/data/`（也是运行环境），脚本会自动创建。

### ⚡ 执行模式分工（先读：CDP 快填充 + MCP 复杂交互，MCP 永不超限）

| 任务 | 通道 | 命令 |
|---|---|---|
| 打开表单页 | MCP（拿归属） | `tabs new <url>` |
| 等待渲染 | MCP | `wait for=text "提交意向"` |
| 扫描打 uid / 导出状态 | **CDP** | `node scripts/cdp.mjs eval <targetId> scripts/10_scan_form.js > data/runs/<host>-scan.json` |
| 批量直写（text/textarea/原生 select/隐藏 date input） | **CDP**（一次 eval 几十字段，~秒级） | 生成的批量脚本 + `cdp.mjs eval` |
| 真实点击（radio/自定义按钮/删除·添加） | **CDP** | `clickn`（元素数组）/ `revalclick`（单元素）|
| popover 下拉/级联/搜索树/日历 | **MCP act**（开面板→点选项→点外部关） | `act click` → `snapshot/diff` → `act click` |
| 日期分片键入（contenteditable spinbutton） | **CDP focus + MCP act type**（或纯 CDP `type`） | `cdp.mjs focus <segment>` → MCP `act type "20240901"` |
| 附件上传（React 受控 file input） | **CDP** `uploadc`（文件选择器拦截） | `node scripts/cdp.mjs uploadc <targetId> <触发元素.js> <file>` |
| 状态导出/校验 | **CDP** | `cdp.mjs eval 15_dump_state.js` + `30_verify.py` |

**MCP 三条红线（保证不超 60s / 不丟页面归属）**：
1. **MCP 只用单步原语**（act/snapshot/wait/tabs），**永不跑页面脚本**——脚本一律走 CDP eval；
   确需 MCP evaluate 时单次 ≤ 40 秒（留 20s 余量）。
2. **连续操作**：MCP 调用间隔不超 30 分钟（长批处理交给 CDP，MCP 只做短交互）。
3. **CDP 兑底**：MCP 会话一旦重建（报 `page N is not owned by this agent`），不重开页面——
   改用 `node scripts/cdp.mjs eval/click/revalclick <targetId> ...` 接管同一页继续干，
   需要交互快照时再用 `tabs new` 重开新页（并立即用 CDP 把已填状态重放到新页）。

> targetId 获取：`node scripts/cdp.mjs list`（按 URL 片段找）；
> 页面长、sticky 底栏会盖住内容 → 交互前先 `scrollIntoView({block:'center'})`（CDP eval 或 act scroll），
> 否则 MCP act 会报 `covered by header.fixed/div.absolute` 拒绝点击（这是保护，不是故障）。

### ① 拿到网站并确认范围
用户给 URL。若用户没给，就问：
- 要填哪个页面（URL）？
- 用的哪份简历/画像？
- 有没有**这次特有的问题**（是否题、意向、渠道等）？
> 别自己假设「大概是求职网申」。

### ② 打开并扫描
```bash
browseros-neo_tabs new <url>                      # MCP 开页拿归属；等表单渲染（wait for=text 关键区块名）
node $SKILL/scripts/cdp.mjs list                 # 拿 targetId
# CDP 注入扫描器（输出直落盘，无 5000 字符截断；几秒完成）
node $SKILL/scripts/cdp.mjs eval <targetId> $SKILL/scripts/10_scan_form.js > data/runs/<host>-scan.json
```
扫描结果含：`uid / kind / label / labelNorm / labels[] / required / requiredConfidence / options`，
以及 **`section`（区块）/ `block`（重复块序号）/ `framework`（组件框架）/ `filled`**，
顶层还有 `platform.framework` 与分好类的 `summary`（`byKind / byFramework / bySection / multiBlock`）。
>
> **多段经历**（教育背景/实习经历可加条）会拿到 `block = 0,1,2…`；同一字段名在不同块里是**不同的 uid**，
> 这正是后面能把画像第 1/2 条分别填对的关键。
> ⚠️ **uid 生命周期**：页面重渲染/加删块后旧 uid 会丢失或漂移，结构一变就重扫；
> 同 uid 双元素会让 querySelector 静默错位（`10_scan_form.js` 开头会清旧标，但重渲染仍可能产生新节点）——
> 填完一区块后用 CDP 读值回验，不信 a11y 树瞬时状态。

> **🚀 默认策略：先试快路径，失败再回退通用方案。**
> `scripts/25_mokahr_fiber.js`（组件 API 直写）对**任何表单**都可以先试——
> `dump` 模式 3 秒内返回全量组件模型（`fieldInfo._set_/_get_/options/isRequired`）：
> - **dump 出 `nFields ≥ 10`** → 该站是「组件 API 可达」的（React 站点常见，mokahr/北森系等），
>   整个流程走快路径：读选项/写值**零开面板**（select/bool/text/日期直写组件 API），
>   `store` 一次读整表做权威校验。下拉/日期从此不再是薄弱环节。
> - **dump 出 `nFields = 0` 或异常** → 站点没有暴露字段组件 API（Vue/原生表单/服务端渲染），
>   **回退到上面的通用八步**（DOM 扫描 + 面板交互）。
> 快路径的取值形状与配方见 `references/adapters/mokahr.md`《React16 组件 API 直写》一节。
> 回退判据（满足其一即回退，**不要反复重试快路径**）：dump 返回 `nFields=0`；fill 连续 2 步以上
> 「字段不在模型」；同一字段写入后 `store` 回读始终为空。回退后把该站记进
> `references/adapters/<host>.md`（「无组件 API，走通用方案」），下次不再浪费时间试。
>
> 组件框架认错/没认出时，用脚本顶部的 `OVERRIDE = { framework, layout, extraControlSelector }` 覆盖，
> 并在 `references/adapters/<host>.md` 里记下来。

### ③ 编译映射 + 生成「必须问用户」清单
```bash
python $SKILL/scripts/40_build_mapping.py --scan data/runs/<host>-scan.json
```
产出 `data/runs/<host>-mapping.json`（uid→值）与 `data/runs/<host>-todo.md`。
退出码 **2 = 有阻塞项**（必填缺值 / 未映射 / 需要附件 / **选项对不上** / **页面要的日期粒度比画像更细**），
此时**不要继续填**。
> 日期字段在 mapping 里会写成 `{ "v": "1999-09-15", "granularity": "month" }`：值保留画像的完整精度，
> `granularity` 是「这个字段在页面上要哪一级」，填充器据此截断（见 ⑥）。

### ③′ （可选，强烈建议）先探测自定义下拉的真实选项
表单里若有 `kind = custom-select / cascader / tree-select`，先跑一次**只读探测**，
把真实选项拿到手，这样选项闸门（③）就能在填之前判掉「值对不上」的情况：

```js
// 把 scripts/20_fill.js 顶部的 MAPPING 留空，改成：
const OPTS = { probeOptions: true };
```
```bash
node $SKILL/scripts/cdp.mjs eval <targetId> <改好的 20_fill.js> > data/runs/<host>-probe.json
```
```bash
python $SKILL/scripts/90_memory.py record-probe --host <host> \
    --scan data/runs/<host>-scan.json --probe data/runs/<host>-probe.json
python $SKILL/scripts/40_build_mapping.py --scan data/runs/<host>-scan.json \
    --probe data/runs/<host>-probe.json
```
> probe 只 `click` 触发元素并在读完后按 Esc 关弹层，**不会选中任何项**，也不会碰提交类按钮。

### ④ 问用户（用 ask_user_question，别自己猜）
把 todo 里阻塞项**一次性**问完（每题 2–4 个选项，自由文本让用户直接打字）。
`todo` 里每项带 `type`：

| type | 含义 | 怎么问 |
|---|---|---|
| `unmapped-required` | 必填但字典/记忆都不认识这个字段名 | 直接问值；拿到后 `add-alias`+`add-qa` |
| `missing-required` | 认识字段但画像里没值 | 问值；必要时补进 `profile.json` |
| `file` | 需要附件路径 | 问文件路径，走 ⑤ |
| `option-choice` | **值不在页面选项里**（自定义下拉尤其常见） | 列出「建议值（含匹配依据）+ 页面全部选项」，让用户选一个 |
| `date-granularity` | **页面要的时间粒度比画像更细**（要年月日、画像只有年月） | 让用户补到更细的日期；**不要**拿 `01` 去凑日号 |

拿到答案后：
```bash
# 站点特有的问答，记进「问答记忆」，下次自动命中
python $SKILL/scripts/90_memory.py add-qa --question "您使用微博的频率" --answer "高频：…≥20天"
# 字段名是新的叫法，补进字典别名
python $SKILL/scripts/90_memory.py add-alias --canonical personal.phone --alias "考生手机号"
# 用户选定了某个选项 → 记下「简历值 → 页面选项」的对照，下次同站直接命中，不再问
python $SKILL/scripts/90_memory.py add-option --host <host> \
    --label "意向工作城市" --value "北京" --option "北京市"
# 然后用用户答案重建映射
python $SKILL/scripts/40_build_mapping.py --scan data/runs/<host>-scan.json --answers '{"f15":"高频：…"}'
```

### ⑤ 上传附件（若表单要简历/证件）
React 受控的 `input[type=file]`（现令大多数站）**不能**直接 `DOM.setFileInputFiles`——不触发 change、
且 React 在下一帧重置 input，文件静默丢失。一律走**文件选择器拦截**（真实用户链路）：
```bash
# 1) 写触发元素表达式（返回「点击上传」那个 span/button；自动 scrollIntoView）
#    例：(() => [...document.querySelectorAll('span')].find(e => e.textContent.trim()==='点击上传'))()
node $SKILL/scripts/cdp.mjs uploadc <targetId> <触发元素.js> "E:/path/agent.pdf"
```
> 拦截模式自动：Page.setInterceptFileChooserDialog → 真实点击触发元素 → 等 fileChooserOpened →
> DOM.setFileInputFiles({backendNodeId}) → 浏览器走原生 change → React onChange 收到。
> 回读验证：CDP eval 读附件区文本是否出现文件名。

### ⑥ 自动填入（混合循环：CDP 批量 + MCP 交互）
按字段类型分派到正确的通道，**每一步都是短操作，MCP 永不接近 60s 上限**：

```bash
# ── A. CDP 批量直写（一次 eval 几十字段，秒级）：
#    文本/textarea（native setter + input/change）、原生 <select>（selectedOptions 对号入座）、
#    隐藏的原生 <input type=date>（直写后分片显示自动联动）
node $SKILL/scripts/cdp.mjs eval <targetId> data/runs/_fill_batch.js

# ── B. CDP 真实点击（radio / 自定义按钮 / 添加·删除块；合成 click() 不进 React store，必须真实点击）
node $SKILL/scripts/cdp.mjs clickn <targetId> data/runs/_radios.json 500      # 元素数组逐个点
node $SKILL/scripts/cdp.mjs revalclick <targetId> data/runs/_one_btn.js 600   # 单元素

# ── C. MCP act 交互（popover 下拉/级联/搜索树/日历——MCP 的遮挡检测与 diff 回读在这里最有价值）
#    开面板：act click <触发器 ref>（先 CDP scrollIntoView 或 act scroll 避开遮挡）
#    选选项：snapshot/diff 拿 ref → act click；树/级联逐级点
#    关面板：点面板外空白（click_at）；Esc 和「取消」常被 fixed header 遮挡，别依赖

# ── D. 日期分片（contenteditable spinbutton）：CDP 聚焦 + 真实键入
node $SKILL/scripts/cdp.mjs focus <targetId> data/runs/_seg_f9.js   # focus 年段
#   然后 MCP act type "20240901"（8 位连输，逐段自动流转；月/日段同理）
#   也可纯 CDP：node scripts/cdp.mjs type <targetId> <seg.js> <text.txt>（已支持 contenteditable）
```

CDP 批量脚本的生成方式：把 `mapping.json` 按「控件类型」分派——文本类用 native setter 链
（`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set` + `dispatchEvent('input'/'change')`），
写完**逐字段回读**（`value === 目标值 ? 'OK' : 'MISMATCH'`）并把结果留在 stdout 里。
返回 `{failed, bad}` 必须逐条解释；`skipped` = 已是目标值（幂等可重跑）。

MAPPING 的值可以是字符串，也可以是带指令的对象：
```js
{ "f3": "张三",
  "f7": { v: "北京市", block: 0 },                     // 指定重复块
  "f9": { v: "2027-06", granularity: 'month' },        // 日期：页面要年月（编译期自动带上）
  "f11": { v: "2027-06", mode: 'period' } }            // 「年+月」分片控件
```
常用开关（`20_fill.js` 顶部 `OPTS`）：`dryRun`（只报计划）、`simulateTyping`（逐字符模拟输入，对付只认 keydown 的联想框）、
`suggestContainsMatch`（包含/缩写匹配只进建议）、`scrollIntoView`、`panelTimeoutMs`。
> 选项匹配的安全线：**只有「原文相等」或「去空格/标点/全角后相等」才会点击**；
> 包含匹配（0.5–0.8）与中文缩写（0.45，如 北大→北京大学）**只产出 suggestions**。

> **时间粒度**：画像只存最细的（`birth_date: 1999-09-15`），年月/年份粒度的组件自动截断，
> 并在 `detail` 里注明丢了哪一级；反过来要求更细时进 todo（`date-granularity`）而不是编造。
> 详见 `references/component-recipes.md §3`。

### ⑦ 程序校验 + 交给用户审核
```bash
node $SKILL/scripts/cdp.mjs eval <targetId> $SKILL/scripts/15_dump_state.js > data/runs/<host>-state.json
python $SKILL/scripts/30_verify.py --state data/runs/<host>-state.json \
    --mapping data/runs/<host>-mapping.json --scan data/runs/<host>-scan.json
```
报告 A 格式 / B 与画像一致性 / C 完整性（必填+报错+附件）/ **D 选项闸门（下拉的值真的在页面选项里吗）** /
E 未映射项 / F 结论，并按「区块 + 第几段」分组，多段经历一眼可见。
给了 `--scan` 才会做 D；自定义下拉的选项记得先用 ③′ 的 `--probe` 并进扫描结果。
> verify 报告若出现大量「时间不一致」，先看是不是把项目/教育起止日期误匹配到了 `personal.birth_date`
> （无归一化标签的分片控件常见误报）——用 CDP 按结构化审计（label→控件）复核后再下结论。
**把报告摘要 + 每个字段的值和来源，连同「我未提交」一起交给用户**，让用户自己在浏览器里核对。

### ⑧ 沉淀经验（这是本 skill 的价值所在）
```bash
python $SKILL/scripts/90_memory.py record --host <host> \
    --scan data/runs/<host>-scan.json --mapping data/runs/<host>-mapping.json \
    --fill-result '<20_fill.js 的返回 JSON>' --notes "本次学到的控件配方/坑"
python $SKILL/scripts/90_memory.py lookup --host <host>
```
- `<数据目录>/memory/sites/<host>.json`：该站点的**字段名 → canonical/问答 + 区块/块 + 控件类型 +
  成功/失败次数 + 选项样本 + 「简历值→页面选项」对照（`option_map`） + 配方**
- `<数据目录>/memory/dictionary.json`：运行期字典 = 仓库里的**字段规范**（`assets/canonical-fields.spec.json`）
  ＋ 你学到的别名 ＋ **qa 问答记忆**
- `<数据目录>/memory/runs.jsonl`：每次运行一行（可统计哪些字段老失败）
- 站点有特殊组件（自定义下拉/日历/分片年月控件）→ 写一份 `references/adapters/<host>.md`；
  若发现某个组件库的系统性配方，补进 `references/component-recipes.md` 与 `assets/platform-selectors.json`
  （**记得同步脚本内嵌副本，否则漂移守卫会失败**）。

## 3. 脚本与资产一览

| 脚本 | 在哪跑 | 作用 |
|------|--------|------|
| `scripts/10_scan_form.js` | 页面 (evaluate) | 通用扫描：控件/字段名候选/**归一化字段名**/必填判定/选项 + **区块 section**、**重复块 block**、**组件框架 framework**；打 `data-jaa-*` 标记 |
| `scripts/15_dump_state.js` | 页面 (evaluate) | 导出当前已填状态（值/必填/报错/附件/区块/块/框架） |
| `scripts/20_fill.js` | 页面 (evaluate) | 通用填充：React/Vue 原生 setter + 模拟输入 + contenteditable + 七大框架下拉/级联 + 日期日历引擎 + 年月分片 + **选项只读探测（probeOptions）**；**带提交按钮拦截** |
| `scripts/25_mokahr_fiber.js` | 页面 (evaluate) | **组件 API 快路径（默认首选，任何站先试）**：沿 `__reactInternalInstance$`/`__reactFiber$` 找字段组件的 `fieldInfo/_get_/_set_`，读选项/写值**零开面板**；`dump`（3 秒判「该站可不可走快路径」）/`fill`（set·daterow·add·delLast）/`store`（整表校验）三模式；不可达时回退通用方案；含提交拦截与选项闸门 |
| `scripts/30_verify.py` | 本地 | 状态 vs 画像/字典 校验（格式/一致性/完整性/**选项闸门**/未映射，按区块分段） |
| `scripts/40_build_mapping.py` | 本地 | 编译 uid→值 的映射 + 待问用户清单；**多段经历按 (区块,块) 定记录序号**；**选项对不上就阻塞不猜** |
| `scripts/90_memory.py` | 本地 | 站点记忆 / 问答记忆 / 别名 / **选项对照 `add-option`** / **选项目录 `record-probe`** / 运行日志 |
| `scripts/cdp.mjs` | 本地（Node 18+） | **CDP 直连快通道（默认 127.0.0.1:9110）**：`eval`（脚本注入/批量填值/状态导出，无 60s 限制）、`click/revalclick/clickn/seq`（真实鼠标点击）、`type`（真实键盘，支持 contenteditable 分片）、`focus`（定位聚焦任意元素）、`uploadc`（文件选择器拦截上传）、`upload`（旧式直设）、`port/list/open/close/wake/front/shot`；无归属校验——**主填充通道 + MCP 失效后的兑底** |
| `scripts/jaa_lib.py` | 本地 | 共用：字典匹配、**标签归一化 `norm_label`**、画像取值、**选项打分 `score_option/rank_options/best_option`**、**占位符过滤 `is_placeholder`**、格式校验 |
| `dev/check_js.js` | 本地（Node） | 开发自检：把三个页面脚本按 evaluate 的「函数体」形状解析一遍 |
| `tests/browser_e2e.py` | 本地（Node+browser） | **真机端到端**：拿 `tests/fixtures/form-lab.html`（合成表单）跑完整链路，验证下拉/日历/多段经历/提交拦截/选项闸门/幂等；无浏览器时自动 SKIP |

| 资产 / 文档 | 作用 |
|---|---|
| `assets/canonical-fields.spec.json` | 字段规范（canonical key ↔ 常见写法），只含规范、不含个人数据 |
| `assets/profile.template.json` | 画像模板（首次运行拷成 `data/profile.json`） |
| **`assets/platform-selectors.json`** | **七大 ATS 框架的 detect / 下拉选项容器 / 日期预设 / 弹层黑名单**（权威副本） |
| **`references/component-recipes.md`** | 上面那份配置的说明书：开→采→配→点→回读、日历引擎、三级定位、框架注意事项 |
| `references/strategies.md` | 通用启发式 + MCP/CDP 工具技巧 + 校验判定 |
| `references/adapters/<host>.md` | 单站点适配笔记（选择器、坑、顺序要求） |

## 4. 支持度与边界（诚实说明）

**已验证可用**：`input/textarea/select/checkbox/radio`、`type=date/month/color/range`、
自定义下拉（`role=combobox`、antd、Element、mokahr `sd-Select`、ATSX、北森 phoenix、飞书 `ud__select`）、
只读日期框弹出的日历面板（8 套内置预设）、级联/树形下拉（按 `/` 拆级逐级精确命中）、
`contenteditable` 富文本、文件上传（配合 upload 工具）。

**新增可用（1.1.0）**：
- **多段经历**：识别重复块并把画像第 N 条写进第 N 段（不再靠出现顺序硬猜）
- **选项闸门**：值不在页面选项里就阻塞在 `*-todo.md`（带建议 + 全部选项），不静默乱填
- **选项探测**：`probeOptions` 只读读出自定义下拉的真实选项，供编译阶段判闸门
- **时间粒度自适应**：画像只存最细的日期；组件要年/年月/年月日都能填，
  多余精度按组件粒度截断并如实上报；页面要得更细时进 todo（**绝不拿 01 凑日号**）
- **年月分片控件**：`mode: 'period'` 逐段填（2 片 = 年月，3 片 = 年月日，4 片 = 起止），
  每段会试 `2023/2023年`、`09/9/9月/09月` 这类写法

**需要 adapter 或问用户**：
- 自研组件（类名无语义）→ 读不到选项，如实报 failed；用 probe + adapter 补配方
- 虚拟滚动的超长下拉（目标项不在首屏，且框架没配 `search_input_selector`）→ 不猜，如实报 failed
- canvas/图片型验证码、滑块验证、iframe 内的表单
- 需要跨页/分步向导的表单（每步都要重新扫描）
- 只读/被上次简历解析锁定的字段（写不进去 → 如实报错）
- **中文缩写**（北大 → 北京大学）：只能进建议列表，不会自动选——想一次命中就把它写进站点记忆（`90_memory.py add-option`）

## 5. 常见坑

| 坑 | 现象 | 处理 |
|---|---|---|
| 标签页归属 | `page N is not owned by this agent` | 一律 `tabs new` 自己的页（cookie 共享，登录态复用）。**但根因是 MCP 会话被换掉**：单次 `evaluate` 超过 60 秒、或长时间空闲都会触发；长任务改用 `scripts/cdp.mjs`（见 §8） |
| evaluate 代码形状 | 返回 `undefined` | 代码按“函数体”执行，脚本必须**顶层 `return`**；别包成没 return 的 IIFE |
| 输出截断 | 结果只到 5000 字符 | 完整结果在 `.browseros/tool-output/evaluate-*.txt` |
| `browseros-neo_run` 不可用 | `did not return structured output` | 用 `evaluate`；要跑几分钟就用 `scripts/cdp.mjs eval <targetId> <脚本文件>` |
| 批量填充跑到一半就断 | `CDP request timed out: Runtime.evaluate`（约 60 秒） | 单次 `evaluate` ≤ 40 秒；整段的批量任务改走 `scripts/cdp.mjs`（无超时），中途把进度写进 `localStorage` 便于续做 |
| 标签页越开越多且关不掉 | 每次会话重建只能 `tabs new`，旧页归属已死会话 | 用 `scripts/cdp.mjs open` 只开**一个**页；残留页请用户手动关（或重启浏览器） |
| 静态草稿 | 有的站不存草稿、有的异步存 | 每步落盘；重进页面后重跑扫描+填充（幂等） |
| 自定义组件取不到值 | `input.value` 是空 | 值在显示层：`readDisplay` 按框架 `display_value_selector` → `[class*=display-value]` → 最近 label 文本依次兜底 |
| 弹层里点错了 | 同一页有多个已渲染的隐藏下拉 / tooltip / 日历面板 | 面板取「离触发元素最近的**可见**弹层」，并用 `isNonPanel` 黑名单排除 tooltip/日期面板；选项只取叶子 |
| 合成 `el.click()` 没反应 | React 代理事件不认 | `clickReal()` 发 `pointerdown→mousedown→mouseup→click`（带坐标）；仍不行走 `scripts/cdp.mjs click`，或直接调 `__reactFiber` 上的 `onClick`（`strategies.md` §8.4） |
| 选项文本对不上 | 「北京」vs「北京市」 | 归一化相等（0.98）才自动点；包含（0.5–0.8）与中文缩写（0.45）**只进 suggestions**；用 `add-option` 记下对照后下次直接命中 |
| 多段经历填串了 | 两段「学校名称」抢同一条画像 | 扫描器给 `block` 0/1…，编译器按 `(区块, 块)` 定记录序号；若 `summary.multiBlock = 0` 说明没识别出重复块 → 补 `layout.group_class` |
| 必填判定 | 星号在字段块里，不在控件上 | 扫描器做「字段块 + 星号/必填字样 + 框架信号（`.ant-form-item-required` / `.el-form-item.is-required`）」三级判定，标注 `requiredConfidence`；medium/low 一律列进 todo 让人工确认 |
| 字段名带噪声 | 「毕业时间（必填）」匹配不上字典 | 扫描器同时给 `label`（给人看）与 `labelNorm`（去噪声）；字典/记忆一律走 `labelNorm` |
| 合成 click 假成功（radio/React 受控组件） | `r.click()` 后 `checked=true`、回读也有值，**但没进 React store**——页面一重渲染勾选就丢 | radio/开关一律真实点击（`cdp.mjs revalclick/clickn`）；填完后再做一次「重渲染后回读」（如删加块/翻页）验证状态仍在 |
| uid 漂移/丢失 | 加删块、翻区块后旧 `[data-jaa-uid]` 找不到，或同 uid 出现双元素 | 结构一变就重扫；填充脚本写完立即回读（`value === 目标值 ? OK : MISMATCH`）；定位优先用 aria-label/placeholder 等结构属性，uid 只作短生命周期句柄 |
| 找按钮误点其他区块 | 「找『+ 添加一项』向上爬容器」会爬到区块共享祖先，点到**别的区块**的添加按钮（实测误加 2 个教育块） | 按钮查找限定在目标区块容器内（`h2 → closest(区块容器)` 的后代），爬层上限 ≤8 且逐层校验容器归属 |
| MCP act 报 covered | `Element is covered by header.fixed / div.absolute`（sticky 底栏、日期组透明覆盖层盖住目标） | 这是**保护不是故障**：先 `scrollIntoView({block:'center'})`（CDP eval 或 act scroll）再 act；被日期组覆盖层盖住的分片改走 `focus + type` 键入 |
| 弹层关不掉 | Esc 派发无效；「取消」按钮被 fixed header 遮挡点不到 | 点面板外空白坐标（`act click_at` 视口空白处）；弹层内出现「清空」按钮 = 已选中的可靠信号 |
| 搜索框 fill 追加不替换 | act fill 后值变成「旧+新」拼接 | 再 fill 一次带 `clear:true`；或 click → Ctrl+A → type |
| 附件上传静默丢 | `DOM.setFileInputFiles` 后 `input.files` 下一帧变空（React 重置），页面无文件名 | 用 `cdp.mjs uploadc`（文件选择器拦截模式，真实 change 链路）；回读附件区文本确认文件名出现 |
| a11y 树/diff 显示延迟 | 触发器已选中，snapshot 里仍显示「请选择…」 | 验证以 CDP 读 DOM/store 为准，不信瞬时 a11y 文本 |
| 后台页定时器冻结 | 含 `await sleep()` 的 eval 永久挂起，伪装成超时 | 先 `node scripts/cdp.mjs front <id>`（详见 strategies.md §8.7） |

## 6. 交付物

```
<运行环境>/data/                 # 本 skill 自带的运行数据目录（已 gitignore，个人数据只放这里）
├─ profile.json                          # 用户画像
├─ memory/dictionary.json                # 运行期字典（规范 + 学到的别名 + 问答记忆）
├─ memory/sites/<host>.json              # 站点记忆（字段→取值 + 区块/块 + 控件配方 + 选项样本 + option_map + 成败计数）
├─ memory/runs.jsonl                     # 运行日志
└─ runs/<host>-{scan,probe,mapping,state,todo}   # 每次运行的快照、探测结果与待确认清单
```

仓库内只有可公开的东西：`scripts/`、`references/`、`examples/`、`dev/`、
`assets/{canonical-fields.spec.json, profile.template.json, platform-selectors.json}`、`tests/selftest.py`。
`tests/selftest.py` 有 10 组无浏览器自检，其中两组是硬约束：
- **泄漏守卫**：仓库里出现手机号/邮箱/本机路径/记忆文件就直接失败；
- **漂移守卫**：`10_scan_form.js` / `20_fill.js` 内嵌的框架配置必须与 `assets/platform-selectors.json` 逐项一致。
