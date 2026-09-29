# job-application-autofill

**Resume / job-application autofill for AI agents.** Point it at any recruiting portal or application
form; it scans the page, marks required fields, uploads your resume to trigger the site's own
parse-and-prefill, compiles values from your candidate profile, fills the fields **through the site's
own widgets** (custom dropdowns, date pickers, file inputs), verifies programmatically, and hands
the result back to you for review.

> **It never submits.** Buttons matching *submit / apply / send / next / pay / delete* are hard-blocked
> inside the fill script. Evidence-backed uncertain values are tentatively prefilled and explicitly
> marked for a final review; unsupported personal facts are left blank rather than invented.
>
> **Personal data can never reach this repo.** Everything personal lives in the gitignored
> `<runtime>/data/`; site notes must use placeholders. The leak guard builds a denylist from the
> profile itself (name / phone / birth date / native place / school / employer / local paths) and
> fails the test suite if any of it shows up in a publishable file — see
> [Leak guard](#leak-guard-personal-data-must-never-reach-the-repo).

**最近更新（v1.5.0）**
- 🕊️ **低打扰预填 + 填后集中确认**：`40_build_mapping.py` 默认 review-first；有来源的中置信度字段和唯一、足够相近的页面选项先暂填，附来源/置信度/理由，统一放进最终复核清单。
- 🧭 无事实来源、选项并列/相似度过低、日期精度不足、附件缺失等内容仍留空，但不阻塞其它字段继续填；绝不代猜专利/奖项/同意等个人事实。
- ✅ 填充和程序校验完成后一次提供「接受全部 / 修改指定字段 / 保持留空」；提交按钮仍硬拦截。旧式填前阻塞可显式 `--strict`。
- 🧪 selftest 覆盖唯一候选暂选、并列候选留空、事实题不编造与 strict 兼容；e2e 检查暂定标记贯穿到填充结果。

**最近更新（v1.4.0）**
- 📥 **站点沉淀同步**：新增 5 份 adapter 笔记 —— i.zhaopin.com（Vue2+iView 在线简历，组件直写）、
  www.zhipin.com（自研 Vue2 组件库）、zhaopin.yaoji.cn（飞书妙搭/aPaaS + shadcn/ui Radix）、
  recruit.pg.com.cn（Moka 自建域名，双语按钮）、job.chinatelecom.com.cn（大易 WinTalent）；
  mokahr 笔记追加景嘉微/虎牙实测（select 写标签原文、提交按钮文案闸门、个人中心进度页）。
- 🗓️ **日期输入改为「有控件先用组件」**：识别到日期组件（antd/Element/iView/ATSX/飞书/fusion/mokahr/shadcn）
  或只读日期框，就先开日历面板选（年→月→日）再回读校验；文本直写只在组件不可用/面板打不开时回退，
  并在 `detail` 里注明。原生 `type=date|month` 走值 setter（`showPicker()` 需要用户手势，脚本点不出 OS 日历）。
  配方见 `references/component-recipes.md §12`；e2e 用 `__dateWrites` 断言可写组件走面板而非直写。
- 🔧 **Moka fiber 修正**：`select` 写标签原文（`option.value` 会假成功）、双语按钮文案归一、
  `skipOptionProbe`/`skipRequiredErrors` 提速开关、`focus→input→blur` 触发组件自校验。
- 🧪 漂移守卫新增 3 条日期契约检查（组件优先分支位置 / e2e 夹具覆盖可写组件路径）。

**最近更新（v1.3.0）**
- 🔀 **执行模式改为 MCP-first**：默认全流程走 `browseros-neo`（tabs/wait/evaluate/act/upload）；
  `scripts/cdp.mjs` 降级为显式备用（仅 ownership 丢失、真实交互连续失败、受控上传失败时接管同一页）。
- ⏱️ **超时治理**：页面脚本默认 18s 业务预算（`20_fill.js` 的 `maxRunMs`/`maxJobs`、`25_mokahr_fiber.js` 的
  `maxRunMs`/`maxSteps`），预算用尽返回 `deferred` 而非假失败；MCP `evaluate` 调用 timeout ≤25s；
  探测（probeOptions）默认 16s 预算并沿用 localStorage 断点缓存；add/delLast 部分完成后按剩余数续做，不重复增删。
- 🧪 真机 e2e 新增短批次协议验证（maxJobs 触发 `budgetExceeded`/`deferred`，主填充同页续完）。

**最近更新（v1.2.0）**
- 🛡️ **新增泄漏守卫**：`scripts/95_lint_notes.py`（`--fix` 一键脱敏）+ `tests/selftest.py` 第 11 组把画像取值当黑名单扫可发布文件；沉淀（`90_memory.py record`）时自动提醒 —— 站点公开选项表这类真实值用 `jaa-leak-allow` 显式豁免。
- 📓 **新增 `references/adapters/_TEMPLATE.md`**：新站点笔记从已脱敏的骨架起步，从源头避免把「本次填了什么」写进会发布的文件。
- 🧭 SKILL.md 新增**铁律 4：个人数据只许进 `data/`，仓库里只写占位符**；已验证站点清单刷新为 10 个。

**Languages:** [中文说明](#中文说明) ・ English above

---

## Why

Job applications, campus recruiting portals, registration forms — the same chore over and over:
the same ~30 facts, re-typed into a different DOM every time. This skill turns that into a
repeatable pipeline, and **learns the label→value mapping per site** so the second visit costs
almost nothing.

## Features

- **Generic scanner** (`10_scan_form.js`) — finds controls (native *and* custom widgets), infers each
  field's name from `aria-label` / `label[for]` / wrapping label / nearest field-title element /
  framework `level2_class`, emits both a display `label` and a noise-stripped `labelNorm`, and
  detects required fields (attribute, `*`, "必填", `.ant-form-item-required`, `.el-form-item.is-required`)
  with a *confidence* level attached. It also identifies the **front-end framework**
  (antd / Element / ATSX / Moka / Beisen / Hotjob / Feishu), the **section** a control lives in, and
  the **repeat-block index** — so multi-entry education/experience blocks map to profile record 1, 2, …
- **Widget-native filling** (`20_fill.js`) — text via native prototype setters (React/Vue compatible),
- `scripts/25_mokahr_fiber.js` — **component-API fast path (try first on any site)**: React-fiber component-API writes (`_set_`), zero dropdown panels. `dump` decides in ~3s whether the site supports it; if not, fall back to the generic pipeline. Modes: dump / fill / store.
  optional per-character simulated typing, `contenteditable`, native `<select>`, checkbox/radio groups,
  **custom dropdowns** via a real mouse-event sequence (`pointerdown→mousedown→mouseup→click`) with
  panel discovery and a non-panel blocklist, **cascader / tree-select** level-by-level, and date
  pickers (read-only or editable) driven by an 8-preset calendar engine (year grid → month aliases → day).
  Any recognized date-picker component goes through its calendar panel first — a text write into a
  controlled picker input can be a display-only "fake success" — and only falls back to a verified
  text write when no component signal exists or the panel cannot be opened.
  A `probeOptions` mode opens dropdowns **read-only** and returns every option text.
- **Option gate with provisional judgment** — exact/normalized values fill directly. A unique page option scoring ≥0.60 may be temporarily chosen from actual page options and is marked for final confirmation; ties or weak matches stay blank. The calendar engine never falls back to the nearest available day.
- **Adaptive time granularity** — the profile stores only the finest date (`1999-09-15`). Year-only,
  year-month, and full-date components all get filled: the filler reads the component's granularity
  (`type`, plus `placeholder`/`name`/`id` regex hints — deliberately *not* the label) and truncates,
  reporting which precision was dropped. The reverse (page wants a day, profile has only a year-month)
  becomes a `date-granularity` question — it never invents a day by defaulting to `01`.
- **Composite year+month widgets** — `mode: 'period'` fills 2/3/4-segment controls (year-month,
  year-month-day, start~end), trying `2023 / 2023年` and `09 / 9 / 9月 / 09月` spellings per segment,
  and is idempotent.
- **Compiled prefill + final review** (`40_build_mapping.py`) — turns `scan + probe + dictionary + profile + memory`
  into a usable `mapping.json` plus a `todo.md` review sheet. Evidence-backed medium-confidence matches and unique close option matches are marked provisional; unsupported facts and ambiguous/weak choices stay blank. Default mode continues filling; `--strict` restores fill-before-confirm blocking.
- **Programmatic verification** (`30_verify.py`) — format checks (phone/email/ID/date), consistency
  against the profile, completeness (required + attachments + page errors), an **option gate**
  (is the filled value actually one of the page's options?), and unmapped fields — grouped by section/record.
- **Continuous memory** (`90_memory.py`) — three layers:
  1. `dictionary.json` — canonical field keys ↔ every wording they appear as, plus **question→answer memory**
  2. `sites/<host>.json` — per-site `label → canonical`, section/block, control kind, recipe,
     observed option samples, learned **value→option** map, ok/fail counters
  3. `runs.jsonl` — append-only run log
- **BrowserOS MCP first, resumable by design** — the normal path uses `browseros-neo` for opening tabs,
  waiting for rendering, scanning, uploads, widget interaction, and verification. Page scripts are run as
  short `evaluate` batches (default budget ~18s, below the MCP 30s transport cap); `20_fill.js` returns
  `deferred` work and can be run again on the same page. `scripts/cdp.mjs` is an explicit fallback only
  for MCP ownership loss, unsupported file-chooser flows, or a proven MCP interaction failure.
- **Tested against a real browser** — `tests/browser_e2e.py` drives `tests/fixtures/form-lab.html` (a synthetic
  form with mokahr-style `sd-Select`, antd-style `ant-select`/`ant-picker`, a native `<select>`, two education
  blocks, a year+month segmented pair and a submit button) through the whole pipeline, and asserts the dropdowns
  really selected, the calendar really reached the target day, a year-month-only picker was truncated to `1999-09`,
  the segmented pair got `2023年` + `9月`, both education records took profile record 1 and 2, the submit button was
  never clicked, a near-miss option produced a suggestion only, and a re-run is idempotent.
- **Privacy by design** — personal data never enters the repo: the profile and all memory live in the
  skill's own `data/` directory (the runtime environment), which is gitignored. Override with `$JAA_DATA_DIR`.

## Requirements

- **An agent with browser tools**, preferably the `browseros-neo` MCP server (`tabs`, `wait`, `snapshot`,
  `evaluate`, `act`, `upload`). Python 3.8+ is required for the local compiler and verifier. Node 18+
  is optional and only needed for the CDP fallback in `scripts/cdp.mjs`.

## Quick start

```bash
# 1) first run creates ./data (the runtime env dir, gitignored) and seeds profile + runtime dictionary
python scripts/40_build_mapping.py --scan examples/example.scan.json     # will tell you what's missing

# 2) in browseros-neo MCP: open the page, wait for the form, then scan it with a short evaluate call
#    tabs new <url> → wait(for="selector", value="form, input, textarea") → evaluate(page, <10_scan_form.js>)
#    save the returned JSON to data/runs/<host>-scan.json

# 3) compile a provisional mapping + a final review sheet (default keeps going even if review items remain)
python scripts/40_build_mapping.py --scan data/runs/<host>-scan.json
#    use --strict only if the user explicitly wants confirmation before filling
#    python scripts/40_build_mapping.py --scan data/runs/<host>-scan.json --strict

# 4) in browseros-neo MCP: run 20_fill.js with the mapping and a short budget
#    evaluate(page, <scripts/20_fill.js with MAPPING, maxRunMs=18000>, timeout=25000)
#    if the result has deferred entries, repeat the same call on the same page until deferred is empty

# 5) verify in browseros-neo MCP with another short evaluate call, then save the JSON locally
#    evaluate(page, <scripts/15_dump_state.js>)  -> data/runs/<host>-state.json
python scripts/30_verify.py --state data/runs/<host>-state.json --scan data/runs/<host>-scan.json \
    --mapping data/runs/<host>-mapping.json

# 6) present actual field values + provisional reasons + unresolved blanks to the user once;
#    apply requested edits with --answers, recompile/re-fill idempotently, and verify again.

# 7) record what was learned (after review)
python scripts/90_memory.py record --host <host> --scan ... --mapping ... --fill-result '{...}' --notes "..."

# 8) optional: real-browser end-to-end self-test (opens one tab, closes it, SKIPs without a browser)
python tests/browser_e2e.py
```

## Layout

```
scripts/10_scan_form.js       # page: scan controls, infer names, detect framework/section/block, mark required
scripts/15_dump_state.js      # page: export current field values/required/errors
scripts/20_fill.js            # page: fill (submit buttons blocked) + probeOptions
scripts/30_verify.py          # local: state vs profile/dictionary checks (incl. option gate)
scripts/40_build_mapping.py   # local: compile prefill mapping + post-fill review list (optional --strict)
scripts/90_memory.py          # local: site memory / Q&A memory / aliases / option map / run log
scripts/95_lint_notes.py      # local: leak lint for publishable files (profile-driven) + --fix redaction
scripts/cdp.mjs               # local Node fallback: take over the same page only when MCP cannot continue
scripts/jaa_lib.py            # local: label/option normalization, dictionary matching, format checks, leak scan
dev/check_js.js               # local (Node): parse the page scripts as evaluate function bodies
tests/fixtures/form-lab.html  # synthetic form (mokahr sd-Select + antd ant-select/ant-picker + native select)
tests/browser_e2e.py          # real-browser end-to-end run against the fixture (auto-SKIPs without a browser)
references/component-recipes.md# 7 ATS frameworks: dropdowns, cascaders, calendars, panel filtering
references/strategies.md      # general heuristics, MCP-first workflow, timeout handling, CDP fallback
references/adapters/mokahr.md # site-specific notes (mokahr ATS)
references/adapters/_TEMPLATE.md # sanitized skeleton for a new site note (placeholders only)
assets/canonical-fields.spec.json  # canonical field dictionary seed (no personal data)
assets/platform-selectors.json     # framework selectors + date presets (single source of truth)
assets/profile.template.json       # candidate profile template
examples/                     # sanitized sample scan/mapping/todo
tests/selftest.py             # no-browser test suite (incl. leak guard + config drift guard)
```

## Safety model

| Rule | Where enforced |
|------|----------------|
| Never click submit/apply/send/pay/delete/next | `SUBMIT_RE` + `assertSafe()` in `20_fill.js`; reported as `submit_buttons_untouched` |
| Never invent personal facts | no evidence / tied candidate / low-similarity option → keep blank and continue; every sourced provisional value is marked with its reason for final review |
| Never silently choose an option | exact/normalized matches fill directly; a unique approximate option scoring ≥0.60 may be temporarily selected from the page's actual choices, but is marked for final confirmation; ties or weaker matches stay blank |
| Never block the whole form on a review item | default `40_build_mapping.py` compiles a prefill plus a final review list; `--strict` opts into old fill-before-confirm blocking |
| Never fall back to an approximate date | `calendarPick()` returns `false` instead of picking the nearest enabled day |
| Never invent date precision | the profile stores the finest date; the filler only *truncates* (1999-09-15 → 1999-09 → 1999) and reports the drop. A page needing finer precision leaves that field blank for final review; it never defaults the day to `01` |
| Never write into a field it could not read back | every write is followed by a read-back; a mismatch is reported as `failed`, not swallowed |
| Consent checkboxes (privacy/terms) stay untouched | not filled unless the user explicitly asks |
| Personal data never enters the repo | `jaa_lib.DATA_DIR` = `<runtime env>/data` (gitignored), override with `$JAA_DATA_DIR`. Enforced by the **leak guard**: `jaa_lib.sensitive_tokens()` builds a denylist from `data/profile.json` + Q&A memory, and any of those values (name / phone / email / birth date / native place / school / major / employer / resume filename / local path) found in a publishable file fails `tests/selftest.py`. Run `python scripts/95_lint_notes.py` (or `--fix`) after writing site notes; a line that legitimately needs a real value (e.g. the site's own public option list) opts out with a `jaa-leak-allow` comment |
| Read-only or locked fields are reported, not forced | `20_fill.js` fails loudly with `readOnly=...` |

### Leak guard (personal data must never reach the repo)

Anything you learn while filling a form (name, phone, birth date, native place, school, employer,
resume filename, local paths) belongs in the gitignored `<runtime>/data/`. Site notes under
`references/adapters/` are **published**, so they must use placeholders.

The guard does not rely on remembering that: `jaa_lib.sensitive_tokens()` derives a denylist **from
your own profile + Q&A memory**, and both the test suite and the lint tool check every publishable
file against it.

```bash
python scripts/95_lint_notes.py                      # scan (exit 2 on hits), excludes gitignored data/
python scripts/95_lint_notes.py --fix                # rewrite hits as placeholders (<姓名> <手机号> <YYYY-MM-DD> …)
python scripts/95_lint_notes.py --paths references/adapters/<host>.md   # just the note you wrote
python scripts/95_lint_notes.py --list-tokens        # show the current denylist
python tests/selftest.py                             # group 11 enforces the same thing
```

- Dates get word boundaries, so an example date written in the docs is never confused with a real
  birthday whose year-month happens to match.
- A line that legitimately needs a real value (e.g. the site's own public province→city option list)
  opts out explicitly with a `jaa-leak-allow` comment; the report lists every exempted line so the
  escape hatch stays auditable.
- `python scripts/90_memory.py record …` runs the check on that site's note automatically and prints
  the fix command, so leakage is caught at sedimentation time.
- Scanning nothing is an error, never a pass: a wrong `--repo` path exits 3 instead of printing OK.

## Supported / not yet supported

**Verified working:** `input`/`textarea`/`select`/`checkbox`/`radio`, `type=date|month|color|range`,
custom dropdowns (`role=combobox`, antd, Element, ATSX, mokahr `sd-Select`, Beisen phoenix,
Feishu `ud__select`), cascader/tree-select, date pickers (read-only or editable) whose calendar opens on
`mousedown/mouseup/click` (8 built-in presets, component panel first with a verified text-write fallback),
`contenteditable` rich text, file inputs
(paired with the browser tool's `upload`), multi-entry record blocks, composite year+month
segment controls, and adaptive time granularity (year / year-month / full date).

**Needs a site adapter or a human:** self-rolled widgets whose class names carry no semantics,
virtual-scroll dropdowns where the target is off-screen, canvas/slider CAPTCHAs, forms inside iframes,
multi-step wizards (re-scan each step), fields locked by a previous resume parse, and Chinese
abbreviations (北大→北京大学) — those only ever produce a suggestion; teach the site once with
`90_memory.py add-option` to make them instant next time.

## License

MIT — see [LICENSE](LICENSE).

---

## 中文说明

**简历投递 / 网申自动填表 skill**：给它任意一个招聘网站或申请页 URL，它会扫描页面、标出必填项、
上传简历触发站点自带的解析预填、从候选人画像编译取值、**用站点自己的组件**（自定义下拉、日期控件、
文件上传）自动填入，程序化校验后交给你审核。

> **绝不代替你提交**：脚本内硬拦截 *提交/投递/立即申请/发送/下一步/支付/删除* 类按钮；
> 有来源的不确定项先暂填并注明依据，填充与校验完成后再集中让你确认/修改；没有事实依据的个人问题留空而不编造。

### 六步流程

1. **扫描**：`scripts/10_scan_form.js` → 控件类型 + 字段名候选 + **归一化字段名** + 必填（带可信度）+
   选项 + **区块 / 重复块 / 组件框架 / 日期粒度**；多段经历拿到 `block = 0,1,2…`
2. **编译暂定映射**：`scripts/40_build_mapping.py` 默认 review-first，产出 `mapping.json`（uid→值）与
   `todo.md`（填后复核清单）。画像/记忆有证据的内容先填；唯一且相似度 ≥0.60 的实际页面选项可暂选并标注。
   并列/过弱候选、无来源的个人事实、日期精度不足则留空，继续其它字段。自研下拉可先 `--probe`。
3. **填入**：`scripts/20_fill.js`（带提交拦截；只点页面的原文/归一化选项，暂选值已转换为页面选项原文；
   日期优先用组件；写不进去会明确报错）。此阶段不为普通复核项打断用户。
4. **校验**：`scripts/15_dump_state.js` + `scripts/30_verify.py --scan ...`
   （格式 / 与画像一致性 / 完整性 / **选项闸门** / 未映射；按区块与第几段分组；时间粒度截断不算冲突）
5. **最终确认**：将实际填入值与来源、暂定项与理由、留空缺口及页面错误一次性交给用户；让用户选择「接受全部 / 修改指定项 / 保持留空」。
   有修改时用 `--answers` 重编、同页幂等重填并复核。脚本绝不代提交；需要旧式填前确认可用 `--strict`。
6. **沉淀**：`scripts/90_memory.py record` → 站点记忆（字段→取值 + 区块/块 + 控件配方 + 选项目录 +
   「简历值→页面选项」对照 + 成功失败计数）+ 运行日志

### 日期与时间粒度（只存最细的）

画像里的日期只填**最细的一份**（`personal.birth_date: 1999-09-15`），不需要另填 `birth_ym`——
它由 `canonical-fields.spec.json` 的 `derive` 声明自动从 `birth_date` 截断而来。填充时：

| 页面组件 | 行为 |
|---|---|
| 年月日（`type=date` / 全日期面板） | 填 `1999-09-15` |
| 年月（`type=month` / 只到月的面板 / `placeholder="请选择年月"`） | 填 `1999-09`，回报里注明丢了「day」精度 |
| 年份（`placeholder="年份"`） | 填 `1999` |
| 年月分片（两个下拉） | `{v, mode:'period'}` 逐段填 |
| 页面要年月日、画像只有年月 | 进 `date-granularity` todo 问你，**绝不拿 01 凑日号** |

### 七大 ATS 组件配方

`assets/platform-selectors.json` 是权威配置，`references/component-recipes.md` 是说明书：
识别 antd / Element / ATSX / Moka / 北森 / Hotjob / 飞书，并按框架取下拉选项容器、日期面板预设与弹层黑名单。
扫描器与填充器各自内嵌它需要的部分（`evaluate` 读不到本地文件），`tests/selftest.py` 有**漂移守卫**
保证三份一致：改了一边不改另一边会直接测试失败。

### 自检

```bash
node dev/check_js.js scripts/10_scan_form.js scripts/20_fill.js scripts/15_dump_state.js  # 语法
python tests/selftest.py            # 60+ 项无浏览器单测（含泄漏守卫 / 漂移守卫 / 选项闸门 / 多段经历）
python scripts/95_lint_notes.py     # 可发布文件里的个人数据检查（画像取值当黑名单）；--fix 一键脱敏
python tests/browser_e2e.py         # 真机端到端（合成表单；无浏览器时自动 SKIP）
```

### 三层记忆（越用越快）

| 文件 | 内容 |
|------|------|
| `dictionary.json` | 规范字段字典（canonical ↔ 各种叫法）＋ **问答记忆（问题→答案）** |
| `sites/<host>.json` | 该站点：字段名 → canonical、区块/块、控件类型、配方、选项目录、「值→选项」对照、成功/失败次数 |
| `runs.jsonl` | 每次运行一行，便于统计哪些字段总失败 |

### 隐私

所有个人数据（`profile.json`、三层记忆、运行快照）都放在 **运行环境自己的 `data/` 目录**：
即 skill 安装目录（或仓库检出目录）下的 `data/`，已被 `.gitignore` 忽略；
可用环境变量 `JAA_DATA_DIR` 指到别处。
仓库里只有代码、字段规范、模板与脱敏样例，**可以直接公开**。

**怎么保证不再漏**（2026-09-18 补强）：写站点笔记/配方时很容易把「本次填了什么」写进去 ——
所以泄漏守卫不再只扫手机号/邮箱/路径三种正则，而是**拿 `data/profile.json` + 问答记忆里的真实取值当黑名单**，
逐个去可发布文件里比对（姓名/生日/籍贯/院校/专业/单位/简历文件名/本机路径目录均在内）。
- `python scripts/95_lint_notes.py`：扫描并报告（有命中 → 退出码 2）；`--fix` 一键换占位符；
  `--list-tokens` 看当前黑名单；`--paths <file>` 只查刚写的那个文件
- `python scripts/90_memory.py record ...`：沉淀时会**自动**对 `references/adapters/<host>.md` 跑一遍并提醒
- 站点自己的公开数据（如「省→市」选项表）确实要写真实值时，在该行加注释 `jaa-leak-allow` 显式豁免（报告里会单列篇免行数）