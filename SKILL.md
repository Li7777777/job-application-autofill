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

- 工具：`browseros-neo` MCP（tabs/navigate/snapshot/act/evaluate/upload）+ 本机 `python`
- ⚠️ **长任务必备**：`scripts/cdp.mjs` —— 直连浏览器原生 CDP 端口（默认 9110）驱动页面。
  MCP 侧对 `evaluate` 有 60 秒硬超时、且会话一重建就丢失标签页归属（详见 `references/strategies.md` §8）；
  凡是「一次要填十几条记录 / 跑几分钟」的站，直接用它，别用 MCP 硬扑。
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

### ① 拿到网站并确认范围
用户给 URL。若用户没给，就问：
- 要填哪个页面（URL）？
- 用的哪份简历/画像？
- 有没有**这次特有的问题**（是否题、意向、渠道等）？
> 别自己假设「大概是求职网申」。

### ② 打开并扫描
```
browseros-neo_tabs new <url>                      # 必须用 agent 自己的标签页（见 references/strategies.md §5）
# 等表单渲染出来再扫
browseros-neo_evaluate(page, <scripts/10_scan_form.js 全文>)   # 返回 JSON；存 data/runs/<host>-scan.json
```
扫描结果含：`uid / kind / label / labelNorm / labels[] / required / requiredConfidence / options`，
以及本版新增的 **`section`（区块）/ `block`（重复块序号）/ `framework`（组件框架）/ `filled`**，
顶层还有 `platform.framework` 与分好类的 `summary`（`byKind / byFramework / bySection / multiBlock`）。
> 输出超过 5000 字符会被截断 → 完整内容在 `...\.browseros\tool-output\evaluate-*.txt`，用 `references/strategies.md §4` 的 python 片段取出来落盘。
>
> **多段经历**（教育背景/实习经历可加条）会拿到 `block = 0,1,2…`；同一字段名在不同块里是**不同的 uid**，
> 这正是后面能把画像第 1/2 条分别填对的关键。
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
```
browseros-neo_evaluate(page, <改好的 20_fill.js 全文>, timeout=120000)   # 只开下拉读选项，不选任何东西
# 把返回的 probed 存成 data/runs/<host>-probe.json
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
`<input type=file>` 通常不在无障碍树里 → 先让它在页面上"显形"，快照拿 ref，再 upload：
`references/strategies.md §3`（这一步不能靠点击按钮，会弹系统文件框卡住）。

### ⑥ 自动填入
把 `mapping.json` 里的 `mapping` 填进 `scripts/20_fill.js` 的 `MAPPING`，
整段粘进 `browseros-neo_evaluate(page, ..., timeout=120000)`。
返回 `{ok, skipped, failed, suggestions, probed, notes, log}`：
- **`failed` 必须逐条解释**（写不进去就说写不进去），`suggestions` 是「弹层里有这些相近项」——拿它去问用户，
  **不要**把建议值直接回填进 MAPPING。
- `skipped` = 回读发现已经是目标值（幂等，可安全重跑）。

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
browseros-neo_evaluate(page, <scripts/15_dump_state.js 全文>)   # 存 data/runs/<host>-state.json
python $SKILL/scripts/30_verify.py --state data/runs/<host>-state.json \
    --mapping data/runs/<host>-mapping.json --scan data/runs/<host>-scan.json
```
报告 A 格式 / B 与画像一致性 / C 完整性（必填+报错+附件）/ **D 选项闸门（下拉的值真的在页面选项里吗）** /
E 未映射项 / F 结论，并按「区块 + 第几段」分组，多段经历一眼可见。
给了 `--scan` 才会做 D；自定义下拉的选项记得先用 ③′ 的 `--probe` 并进扫描结果。
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
| `scripts/30_verify.py` | 本地 | 状态 vs 画像/字典 校验（格式/一致性/完整性/**选项闸门**/未映射，按区块分段） |
| `scripts/40_build_mapping.py` | 本地 | 编译 uid→值 的映射 + 待问用户清单；**多段经历按 (区块,块) 定记录序号**；**选项对不上就阻塞不猜** |
| `scripts/90_memory.py` | 本地 | 站点记忆 / 问答记忆 / 别名 / **选项对照 `add-option`** / **选项目录 `record-probe`** / 运行日志 |
| `scripts/cdp.mjs` | 本地（Node 18+） | **直连浏览器原生 CDP（默认 127.0.0.1:9110）**：`port/list/open/close/eval/click/revalclick/type/upload/seq`；无归属校验、无 60 秒上限 —— 长任务、真实鼠标点击、React `onClick` 场景用它 |
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
