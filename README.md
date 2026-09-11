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
  field's name from `aria-label` / `label[for]` / wrapping label / nearest field-title element, and
  detects required fields (attribute, `*`, "必填"), with a *confidence* level attached.
- **Widget-native filling** (`20_fill.js`) — text via native setters (React/Vue compatible), native
  `<select>`, checkbox/radio groups, **custom dropdowns** (`role=combobox`, Ant Design, mokahr
  `sd-Select`, …) by opening the popup and clicking the option, and read-only date inputs by
  dispatching the mouse sequence that actually opens the calendar.
- **Compiled mapping + questions** (`40_build_mapping.py`) — turns `scan + dictionary + profile + memory`
  into `mapping.json` (uid → value) **and** a `todo.md` list of things a human must answer.
- **Programmatic verification** (`30_verify.py`) — format checks (phone/email/ID/date), consistency
  against the profile, completeness (required + attachments + page errors), and unmapped fields.
- **Continuous memory** (`90_memory.py`) — three layers:
  1. `dictionary.json` — canonical field keys ↔ every wording they appear as, plus **question→answer memory**
  2. `sites/<host>.json` — per-site `label → canonical`, control kind, recipe, ok/fail counters
  3. `runs.jsonl` — append-only run log
- **Long jobs go straight to CDP** (`cdp.mjs`) — the agent-side MCP tools cap `evaluate` at 60s and scope
  page ownership to the MCP session, so a multi-minute fill loses its tabs mid-run. `scripts/cdp.mjs` talks
  to the browser's own CDP port (default `127.0.0.1:9110`, read from the browser's `config.json`) instead:
  no ownership guard, no 60s cap, one tab, and real `Input.dispatchMouseEvent` clicks for hover-only
  controls. See `references/strategies.md` §8.
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
python scripts/30_verify.py --state data/runs/<host>-state.json --mapping data/runs/<host>-mapping.json

# 6) record what was learned
python scripts/90_memory.py record --host <host> --scan ... --mapping ... --fill-result '{...}' --notes "..."
```

## Layout

```
scripts/10_scan_form.js       # page: scan controls, infer names, mark required
scripts/15_dump_state.js      # page: export current field values/required/errors
scripts/20_fill.js            # page: fill (submit buttons blocked)
scripts/30_verify.py          # local: state vs profile/dictionary checks
scripts/40_build_mapping.py   # local: compile mapping + human-question list
scripts/90_memory.py          # local: site memory / Q&A memory / aliases / run log
scripts/cdp.mjs               # local (Node): drive the browser over its native CDP port — for long jobs
scripts/jaa_lib.py            # local: dictionary matching, profile lookup, format checks
references/strategies.md      # widget recipes, heuristics, tool gotchas
references/adapters/mokahr.md # site-specific notes (mokahr ATS)
assets/dictionary.seed.json   # canonical field dictionary seed (no personal data)
assets/profile.template.json  # candidate profile template
examples/                     # sanitized sample scan/mapping/todo
tests/selftest.py             # no-browser test suite
```

## Safety model

| Rule | Where enforced |
|------|----------------|
| Never click submit/apply/send/pay/delete/next | `SUBMIT_RE` + `assertSafe()` in `20_fill.js`; reported as `submit_buttons_untouched` |
| Never invent a value | unmapped/missing/ambiguous → `todo.md`; `20_fill.js` records `failed` with a reason instead of guessing |
| Consent checkboxes (privacy/terms) stay untouched | not filled unless the user explicitly asks |
| Personal data never enters the repo | `jaa_lib.DATA_DIR` = `<runtime env>/data` (gitignored), override with `$JAA_DATA_DIR` |
| Read-only or locked fields are reported, not forced | `20_fill.js` fails loudly with `readOnly=...` |

## Supported / not yet supported

**Verified working:** `input`/`textarea`/`select`/`checkbox`/`radio`, `type=date|month|color|range`,
custom dropdowns (`role=combobox`, antd, mokahr `sd-Select`), read-only date inputs whose calendar
opens on `mousedown/mouseup/click`, file inputs (paired with the browser tool's `upload`).

**Needs a site adapter or a human:** composite year/month segment controls, canvas/slider CAPTCHAs,
rich-text editors in iframes, multi-step wizards (re-scan each step), fields locked by a previous
resume parse.

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

1. **扫描**：`scripts/10_scan_form.js` → 控件类型 + 字段名候选 + 必填（带可信度）+ 选项
2. **编译**：`scripts/40_build_mapping.py` → `mapping.json`（uid→值）＋ `todo.md`（必须问你的清单）
3. **问你**：把阻塞项一次问完；答案用 `scripts/90_memory.py add-qa` 记进**问答记忆**（下次自动命中）
4. **填入**：`scripts/20_fill.js`（带提交拦截；写不进去会明确报错）
5. **校验**：`scripts/15_dump_state.js` + `scripts/30_verify.py`（格式 / 与画像一致性 / 完整性 / 未映射）
6. **沉淀**：`scripts/90_memory.py record` → 站点记忆（字段→取值 + 控件配方 + 成功失败计数）+ 运行日志

### 三层记忆（越用越快）

| 文件 | 内容 |
|------|------|
| `dictionary.json` | 规范字段字典（canonical ↔ 各种叫法）＋ **问答记忆（问题→答案）** |
| `sites/<host>.json` | 该站点：字段名 → canonical、控件类型、配方、成功/失败次数 |
| `runs.jsonl` | 每次运行一行，便于统计哪些字段总失败 |

### 隐私

所有个人数据（`profile.json`、三层记忆、运行快照）都放在 **运行环境自己的 `data/` 目录**：
即 skill 安装目录（或仓库检出目录）下的 `data/`，已被 `.gitignore` 忽略；
可用环境变量 `JAA_DATA_DIR` 指到别处。
仓库里只有代码、字段规范、模板与脱敏样例，**可以直接公开**。
