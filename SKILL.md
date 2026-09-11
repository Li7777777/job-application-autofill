---
name: job-application-autofill
description: 面向简历投递 / 校招网申的自动填表 skill（站点无关）。给定用户提供的招聘网站或申请页链接：扫描表单与必填项 → 上传简历触发解析预填 → 用画像与记忆编译字段映射 → 用站点内置组件（自定义下拉、日期控件、文件上传）自动填入 → 程序化校验后交用户审核；并把「字段名→取值」持续沉淀成可复用的问答记忆与站点记忆，下次投递越用越快。遇到不确定一律问用户、绝不猜测，且**绝不代替用户提交**。当用户要投简历、填网申/校招申请表/报名/登记表/求职申请，或给出 URL 说「帮我填一下」「帮我投」时使用。
version: 1.0.0
metadata:
  verified_sites: "app.mokahr.com（自定义组件重型表单）、selenium web-form（原生控件全类型）"
  data_dir: "<运行环境>/data（skill 安装目录下，已 gitignore）；可用 $JAA_DATA_DIR 覆盖"
---

# 简历投递 / 网申自动填表（job-application-autofill）

面向**简历投递与校招网申**：对任意招聘网站的用户表单做「看清结构 → 上传简历触发解析 → 编译取值 →
用站点内置组件填入 → 程序校验 → 交用户审核」。站点差异靠 **adapters 文档 + 记忆**吸收，流程与站点无关。

## 0. 三条铁律（先读）

1. **绝不代替用户提交**。不点「提交 / 投递 / 立即申请 / 确认 / 下一步 / 发送 / 支付 / 删除」类按钮；
   脚本内有 `SUBMIT_RE` 拦截，扫描/填充只写字段。是否提交、何时提交，永远由用户决定。
2. **不确定就问，不许猜**。字段名认不出、选项对不上、必填判定存疑、日期控件写不进去 → 一律进
   `*-todo.md` 让用户回答；**禁止**凭常识填一个「大概是这个」的值，也禁止静默失败。
3. **值要能解释来源**。每个字段都记录 `canonical / source ∈ {profile, site-memory, qa, user-answer, manual}`；
   校验报告里要能说清「这个值是哪来的」。

## 1. 准备（只做一次）

- 工具：`browseros-neo` MCP（tabs/navigate/snapshot/act/evaluate/upload）+ 本机 `python`
- **数据目录**：默认就是本 skill 运行环境自己的 `data/`（即 `scripts/` 的同级目录；
  从仓库直接跑就是 `<repo>/data/`）。首次运行会创建它，并从 `assets/` 播种
  `profile.json` 与运行期 `memory/dictionary.json`；可用 `$JAA_DATA_DIR` 指到别处。
  该目录在 `.gitignore` 里 → **画像、别名、问答记忆、站点记忆、运行快照都不会进仓库**。
- 用户画像：`<数据目录>/profile.json`（模板见 `assets/profile.template.json`；跨站点复用，只改 `job.*`）
- 简历文件（可选，用于解析预填）：建议先复制到 ASCII 安全路径再上传
- 站点适配笔记：`references/adapters/<host>.md`（有就照做，没有就自己摸索后补一份）

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
扫描结果含：`uid / kind / label / labels[] / required / requiredConfidence / options`。
> 输出超过 5000 字符会被截断 → 完整内容在 `...\.browseros\tool-output\evaluate-*.txt`，用 `references/strategies.md §4` 的 python 片段取出来落盘。

### ③ 编译映射 + 生成「必须问用户」清单
```bash
python $SKILL/scripts/40_build_mapping.py --scan data/runs/<host>-scan.json
```
产出 `data/runs/<host>-mapping.json`（uid→值）与 `data/runs/<host>-todo.md`。
退出码 **2 = 有阻塞项**（必填缺值 / 未映射 / 需要附件），此时**不要继续填**。

### ④ 问用户（用 ask_user_question，别自己猜）
把 todo 里阻塞项**一次性**问完（每题 2–4 个选项，自由文本让用户直接打字）。拿到答案后：
```bash
# 站点特有的问答，记进「问答记忆」，下次自动命中
python $SKILL/scripts/90_memory.py add-qa --question "您使用微博的频率" --answer "高频：…≥20天"
# 字段名是新的叫法，补进字典别名
python $SKILL/scripts/90_memory.py add-alias --canonical personal.phone --alias "考生手机号"
# 然后用用户答案重建映射
python $SKILL/scripts/40_build_mapping.py --scan data/runs/<host>-scan.json --answers '{"f15":"高频：…"}'
```

### ⑤ 上传附件（若表单要简历/证件）
`<input type=file>` 通常不在无障碍树里 → 先让它在页面上"显形"，快照拿 ref，再 upload：
`references/strategies.md §3`（这一步不能靠点击按钮，会弹系统文件框卡住）。

### ⑥ 自动填入
把 `mapping.json` 里的 `mapping` 填进 `scripts/20_fill.js` 的 `MAPPING`，
整段粘进 `browseros-neo_evaluate(page, ..., timeout=120000)`。
返回 `{ok, skipped, failed, notes}`：**failed 必须逐条解释**（写不进去就说写不进去），然后回到 ④ 问用户或补 adapter。

### ⑦ 程序校验 + 交给用户审核
```bash
browseros-neo_evaluate(page, <scripts/15_dump_state.js 全文>)   # 存 data/runs/<host>-state.json
python $SKILL/scripts/30_verify.py --state data/runs/<host>-state.json --mapping data/runs/<host>-mapping.json
```
报告 A 格式 / B 与画像一致性 / C 完整性（必填+报错+附件）/ D 未映射项 / E 结论。
**把报告摘要 + 每个字段的值和来源，连同「我未提交」一起交给用户**，让用户自己在浏览器里核对。

### ⑧ 沉淀经验（这是本 skill 的价值所在）
```bash
python $SKILL/scripts/90_memory.py record --host <host> \
    --scan data/runs/<host>-scan.json --mapping data/runs/<host>-mapping.json \
    --fill-result '<20_fill.js 的返回 JSON>' --notes "本次学到的控件配方/坑"
python $SKILL/scripts/90_memory.py lookup --host <host>
```
- `<数据目录>/memory/sites/<host>.json`：该站点的**字段名 → canonical/问答 + 控件类型 + 成功/失败次数 + 配方**
- `<数据目录>/memory/dictionary.json`：运行期字典 = 仓库里的**字段规范**（`assets/canonical-fields.spec.json`）
  ＋ 你学到的别名 ＋ **qa 问答记忆**
- `<数据目录>/memory/runs.jsonl`：每次运行一行（可统计哪些字段老失败）
- 站点有特殊组件（自定义下拉/日历/分片年月控件）→ 写一份 `references/adapters/<host>.md`

## 3. 脚本一览

| 脚本 | 在哪跑 | 作用 |
|------|--------|------|
| `scripts/10_scan_form.js` | 页面 (evaluate) | 通用扫描：控件/字段名候选/必填判定/选项；打 `data-jaa-*` 标记 |
| `scripts/15_dump_state.js` | 页面 (evaluate) | 导出当前已填状态（值/必填/报错/附件） |
| `scripts/20_fill.js` | 页面 (evaluate) | 通用填充：原生控件 + 自定义下拉 + 日期；**带提交按钮拦截** |
| `scripts/30_verify.py` | 本地 | 状态 vs 画像/字典 校验（格式/一致性/完整性/未映射） |
| `scripts/40_build_mapping.py` | 本地 | 编译 uid→值 的映射 + 生成待问用户清单 |
| `scripts/90_memory.py` | 本地 | 站点记忆 / 问答记忆 / 别名 / 运行日志（持续沉淀） |
| `scripts/jaa_lib.py` | 本地 | 共用：字典匹配、画像取值、格式校验 |

## 4. 支持度与边界（诚实说明）

**已验证可用**：`input/textarea/select/checkbox/radio`、`type=date/month/color/range`、
自定义下拉（`role=combobox`、antd、mokahr `sd-Select`）、只读日期框弹出的日历面板、文件上传（配合 upload 工具）。

**需要 adapter 或问用户**：
- 复合「年月区间」分片控件（多个 select 组成一个日期，如 mokahr 的就读时间/起止时间）
- canvas/图片型验证码、滑块验证、富文本编辑器（iframe）
- 需要跨页/分步向导的表单（每步都要重新扫描）
- 只读/被上次简历解析锁定的字段（写不进去 → 如实报错）

## 5. 常见坑

| 坑 | 现象 | 处理 |
|---|---|---|
| 标签页归属 | `page N is not owned by this agent` | 一律 `tabs new` 自己的页（cookie 共享，登录态复用） |
| evaluate 代码形状 | 返回 `undefined` | 代码按“函数体”执行，脚本必须**顶层 `return`**；别包成没 return 的 IIFE |
| 输出截断 | 结果只到 5000 字符 | 完整结果在 `.browseros/tool-output/evaluate-*.txt` |
| `browseros-neo_run` 不可用 | `did not return structured output` | 用 `evaluate` + 页面内 async |
| 静态草稿 | 有的站不存草稿、有的异步存 | 每步落盘；重进页面后重跑扫描+填充（幂等） |
| 自定义组件取不到值 | `input.value` 是空 | 值在显示层：读 `[class*="display-value"]` / 最近的 label 文本 |
| 必填判定 | 星号在字段块里，不在控件上 | 扫描器已做「字段块 + 星号/必填字样」判定，标注 `requiredConfidence`；medium/low 一律列进 todo 让人工确认 |
| 非 UTF-8 控制台（中文 Windows） | 打印 `❓`/emoji 时 `UnicodeEncodeError: 'gbk' codec` | `scripts/jaa_lib.py` 导入时已把本进程 stdout/stderr 重配为 UTF-8，本 skill 脚本无需处理；自写 python 片段请用 `PYTHONUTF8=1 python ...` |

## 6. 交付物

```
<运行环境>/data/                 # 本 skill 自带的运行数据目录（已 gitignore，个人数据只放这里）
├─ profile.json                          # 用户画像
├─ memory/dictionary.json                # 运行期字典（规范 + 学到的别名 + 问答记忆）
├─ memory/sites/<host>.json              # 站点记忆（字段→取值 + 控件配方 + 成败计数）
├─ memory/runs.jsonl                     # 运行日志
└─ runs/<host>-{scan,mapping,state,todo} # 每次运行的快照与待确认清单
```

仓库内只有可公开的东西：`scripts/`、`references/`、`examples/`、`assets/{canonical-fields.spec.json,
profile.template.json}`、`tests/selftest.py`。`tests/selftest.py` 里有一道**泄漏守卫**：
仓库里出现手机号/邮箱/本机路径/记忆文件就直接失败。
