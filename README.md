# job-application-autofill

**Resume / job-application autofill for AI agents.** Point it at any recruiting portal or application
form; it scans the page, marks required fields, uploads your resume to trigger the site's own
parse-and-prefill, compiles values from your candidate profile, fills the fields **through the site's
own widgets** (custom dropdowns, date pickers, file inputs), verifies programmatically, and hands
the result back to you for review.

> **It never submits.** Buttons matching *submit / apply / send / next / pay / delete* are hard-blocked
> inside the fill script. When anything is ambiguous it **asks the user** — it does not guess.

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
  optional per-character simulated typing, `contenteditable`, native `<select>`, checkbox/radio groups,
  **custom dropdowns** via a real mouse-event sequence (`pointerdown→mousedown→mouseup→click`) with
  panel discovery and a non-panel blocklist, **cascader / tree-select** level-by-level, and read-only
  date inputs driven by an 8-preset calendar engine (year grid → month aliases → day).
  A `probeOptions` mode opens dropdowns **read-only** and returns every option text.
- **Option gate, never a guess** — option matching only auto-picks on *exact* or *normalized-equal*
  (whitespace/punctuation/full-width insensitive) text. Contains (北京→北京市) and Chinese-abbreviation
  (北大→北京大学) matches are emitted as **suggestions** and become `option-choice` questions instead.
  The calendar engine likewise refuses to fall back to "nearest available day".
- **Adaptive time granularity** — the profile stores only the finest date (`1999-09-15`). Year-only,
  year-month, and full-date components all get filled: the filler reads the component's granularity
  (`type`, plus `placeholder`/`name`/`id` regex hints — deliberately *not* the label) and truncates,
  reporting which precision was dropped. The reverse (page wants a day, profile has only a year-month)
  becomes a `date-granularity` question — it never invents a day by defaulting to `01`.
- **Composite year+month widgets** — `mode: 'period'` fills 2/3/4-segment controls (year-month,
  year-month-day, start~end), trying `2023 / 2023年` and `09 / 9 / 9月 / 09月` spellings per segment,
  and is idempotent.
- **Compiled mapping + questions** (`40_build_mapping.py`) — turns `scan + probe + dictionary + profile + memory`
  into `mapping.json` (uid → value) **and** a `todo.md` list of things a human must answer.
- **Programmatic verification** (`30_verify.py`) — format checks (phone/email/ID/date), consistency
  against the profile, completeness (required + attachments + page errors), an **option gate**
  (is the filled value actually one of the page's options?), and unmapped fields — grouped by section/record.
- **Continuous memory** (`90_memory.py`) — three layers:
  1. `dictionary.json` — canonical field keys ↔ every wording they appear as, plus **question→answer memory**
  2. `sites/<host>.json` — per-site `label → canonical`, section/block, control kind, recipe,
     observed option samples, learned **value→option** map, ok/fail counters
  3. `runs.jsonl` — append-only run log
- **Long jobs go straight to CDP** (`cdp.mjs`) — the agent-side MCP tools cap `evaluate` at 60s and scope
  page ownership to the MCP session, so a multi-minute fill loses its tabs mid-run. `scripts/cdp.mjs` talks
  to the browser's own CDP port (default `127.0.0.1:9110`, read from the browser's `config.json`) instead:
  no ownership guard, no 60s cap, one tab (`open` … `close`), and real `Input.dispatchMouseEvent` clicks for
  hover-only controls. See `references/strategies.md` §8.
- **Tested against a real browser** — `tests/browser_e2e.py` drives `tests/fixtures/form-lab.html` (a synthetic
  form with mokahr-style `sd-Select`, antd-style `ant-select`/`ant-picker`, a native `<select>`, two education
  blocks, a year+month segmented pair and a submit button) through the whole pipeline, and asserts the dropdowns
  really selected, the calendar really reached the target day, a year-month-only picker was truncated to `1999-09`,
  the segmented pair got `2023年` + `9月`, both education records took profile record 1 and 2, the submit button was
  never clicked, a near-miss option produced a suggestion only, and a re-run is idempotent.
- **Privacy by design** — personal data never enters the repo: the profile and all memory live in the
  skill's own `data/` directory (the runtime environment), which is gitignored. Override with `$JAA_DATA_DIR`.

## Requirements

- An agent with browser tools (tested with the `browseros-neo` MCP server: `tabs_new`, `evaluate`,
  `snapshot`, `upload`). Any Playwright/CDP-capable setup can run the JS scripts instead.
- Python 3.8+ (stdlib only — no pip install).

## Quick start

```bash
# 1) first run creates ./data (the runtime env dir, gitignored) and seeds profile + runtime dictionary
python scripts/40_build_mapping.py --scan examples/example.scan.json     # will tell you what's missing

# 2) in your browser tools: open the target page and run the scanner
#    evaluate(page, <scripts/10_scan_form.js>)  ->  save the JSON to data/runs/<host>-scan.json

# 3) compile mapping + the "ask the user" list
python scripts/40_build_mapping.py --scan data/runs/<host>-scan.json
#    exit code 2 = there are blocking questions -> ask the user, then:
#    python scripts/90_memory.py add-qa --question "<question text>" --answer "<answer>"

# 4) fill in the browser
#    evaluate(page, <scripts/20_fill.js with MAPPING from mapping.json>, timeout=120000)

# 5) verify, then hand the report to the human
#    evaluate(page, <scripts/15_dump_state.js>)  -> data/runs/<host>-state.json
python scripts/30_verify.py --state data/runs/<host>-state.json --scan data/runs/<host>-scan.json \
    --mapping data/runs/<host>-mapping.json

# 6) record what was learned
python scripts/90_memory.py record --host <host> --scan ... --mapping ... --fill-result '{...}' --notes "..."

# 7) optional: real-browser end-to-end self-test (opens one tab, closes it, SKIPs without a browser)
python tests/browser_e2e.py
```

## Layout

```
scripts/10_scan_form.js       # page: scan controls, infer names, detect framework/section/block, mark required
scripts/15_dump_state.js      # page: export current field values/required/errors
scripts/20_fill.js            # page: fill (submit buttons blocked) + probeOptions
scripts/30_verify.py          # local: state vs profile/dictionary checks (incl. option gate)
scripts/40_build_mapping.py   # local: compile mapping + human-question list
scripts/90_memory.py          # local: site memory / Q&A memory / aliases / option map / run log
scripts/cdp.mjs               # local (Node): drive the browser over its native CDP port — for long jobs
scripts/jaa_lib.py            # local: label/option normalization, dictionary matching, format checks
dev/check_js.js               # local (Node): parse the page scripts as evaluate function bodies
tests/fixtures/form-lab.html  # synthetic form (mokahr sd-Select + antd ant-select/ant-picker + native select)
tests/browser_e2e.py          # real-browser end-to-end run against the fixture (auto-SKIPs without a browser)
references/component-recipes.md# 7 ATS frameworks: dropdowns, cascaders, calendars, panel filtering
references/strategies.md      # general heuristics, tool gotchas, CDP workarounds
references/adapters/mokahr.md # site-specific notes (mokahr ATS)
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
| Never invent a value | unmapped/missing/ambiguous → `todo.md`; `20_fill.js` records `failed` with a reason instead of guessing |
| Never silently pick a near-miss option | option gate in `40_build_mapping.py` + `scoreOption` threshold 0.98 in `20_fill.js`; contains/abbreviation matches are suggestions only |
| Never fall back to an approximate date | `calendarPick()` returns `false` instead of picking the nearest enabled day |
| Never invent date precision | the profile stores the finest date; the filler only *truncates* (1999-09-15 → 1999-09 → 1999) and reports the drop. A page needing a finer level than the profile has becomes a `date-granularity` question — it never defaults the day to `01` |
| Never write into a field it could not read back | every write is followed by a read-back; a mismatch is reported as `failed`, not swallowed |
| Consent checkboxes (privacy/terms) stay untouched | not filled unless the user explicitly asks |
| Personal data never enters the repo | `jaa_lib.DATA_DIR` = `<runtime env>/data` (gitignored), override with `$JAA_DATA_DIR` |
| Read-only or locked fields are reported, not forced | `20_fill.js` fails loudly with `readOnly=...` |

## Supported / not yet supported

**Verified working:** `input`/`textarea`/`select`/`checkbox`/`radio`, `type=date|month|color|range`,
custom dropdowns (`role=combobox`, antd, Element, ATSX, mokahr `sd-Select`, Beisen phoenix,
Feishu `ud__select`), cascader/tree-select, read-only date inputs whose calendar opens on
`mousedown/mouseup/click` (8 built-in presets), `contenteditable` rich text, file inputs
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
> 遇到不确定（字段名认不出、选项对不上、控件写不进）**一律问你，不猜、不静默**。

### 六步流程

1. **扫描**：`scripts/10_scan_form.js` → 控件类型 + 字段名候选 + **归一化字段名** + 必填（带可信度）+
   选项 + **区块 / 重复块 / 组件框架 / 日期粒度**；多段经历拿到 `block = 0,1,2…`
2. **编译**：`scripts/40_build_mapping.py` → `mapping.json`（uid→值）＋ `todo.md`（必须问你的清单）。
   自研下拉先跑 `20_fill.js` 的 `OPTS.probeOptions = true` 探测真实选项，再用 `--probe` 并进来。
   日期字段写成 `{v, granularity}`：值保留画像完整精度，粒度是页面要求
3. **问你**：把阻塞项一次问完（含 `option-choice`：值对不上时列出建议 + 页面全部选项；
   含 `date-granularity`：页面要年月日但画像只有年月）；
   答案用 `add-qa` / `add-alias` / **`add-option`** 记进记忆（下次自动命中）
4. **填入**：`scripts/20_fill.js`（带提交拦截；选项只在「原文相等 / 归一化相等」时才点，
   包含与中文缩写匹配只给建议；日期按组件粒度自适应截断并如实上报；写不进去会明确报错）
5. **校验**：`scripts/15_dump_state.js` + `scripts/30_verify.py --scan ...`
   （格式 / 与画像一致性 / 完整性 / **选项闸门** / 未映射；按区块与第几段分组；
   时间粒度截断单独列一行，**不算冲突**）
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
