# 组件配方库：7 大 ATS 框架的识别 / 下拉 / 日历

> 这份文档是 `assets/platform-selectors.json` 的文字版说明书。数据来源：逆向
> Chrome 扩展「牛客网申助手 1.0.8」的表单抽取链路（它内置并会从
> `static.nowcoder.com/sparta/sparta-spider/autofill/platform-selectors.json` 热更新这份配置），
> 按本 skill 的「站点无关 + 不确定就问」原则重写并加了本地识别与可见性过滤。
>
> **单一一处真相**：`assets/platform-selectors.json` 是权威副本；`scripts/10_scan_form.js`
> （只内嵌 `detect` + `layout_presets`）与 `scripts/20_fill.js`（只内嵌选择器 + 日期预设 +
> 弹层黑名单）各自内嵌了它需要的部分。**两边必须一致**，`tests/selftest.py` 第 7 节是漂移守卫，
> 改了一边不改另一边会直接测试失败。

## 1. 框架一览（detect 选择器 → 命中什么）

| key | 库 | 典型特征 | 布局预设 |
|-----|----|----------|----------|
| `antd` | Ant Design v3/v4/v5 | `.ant-select` `.ant-picker` `.ant-calendar-picker` `.ant-cascader` `.ant-form-item` | `antd-form` |
| `element` | Element UI / Element Plus | `.el-select` `.el-input` `.el-date-editor` `.el-form-item` | `element-form` |
| `atsx` | ATSX（Moka 旧版/ATSX 系） | `.atsx-select` `.atsx-form-item` `.atsx-date-picker` | `atsx-form` |
| `mokahr` | Moka HR | `[class*="sd-Select"]` `[class*="apply-block-"]` `[class*="sd-Dropdown"]` | `mokahr` |
| `beisen` | 北森 | `.ux-standard-form` `[class*="phoenix-selectList"]` `[id*="_Recruitment_"]` | `beisen` |
| `hotjob` | Hotjob / 前程无忧系 | `[class~="form-cell-inner"]` `.set_i_content_table` | `hotjob` |
| `feishu` | 飞书招聘 | `.ud__select` `.ud__picker` `.ud__form__item` `.bitable-form-item` | `feishu` |

扫描器会给出**页面级** `platform.framework`（各框架 detect 命中数最多者）与**控件级**
`fields[].framework`（向上找 8 层内最近的匹配祖先）。填充器用控件级框架去取选择器。

> ⚠️ 站点常把 antd / Element 当**底层组件库**用（自己包一层）。这时 `framework` 会是 `antd`/`element`，
> 但布局预设不对——用 `references/adapters/<host>.md` 记 `layout`，扫描时填进 `OVERRIDE.layout`。

## 2. 下拉/级联：开 → 采 → 配 → 点 → 回读

填充器（`scripts/20_fill.js`）的标准流程，站点差异全在配置里：

1. **找触发元素**：`el.matches(closest(trigger_selector))`；找不到就用 `el` 本身。
2. **真实鼠标序列**（`clickReal`）：`pointerdown → mousedown → mouseup → click`，带 `clientX/Y`。
   React/Vue 的代理事件只认这种；纯 `el.click()` 经常没反应。
3. **等弹层**（`waitFor` 轮询，默认 1.2 s）：候选 = `option_container_selector` ∩ 可见 ∩ 不是黑名单节点，
   取**离触发元素最近**的那个（同页可能有多个已渲染的隐藏下拉）。
4. **采集选项**（`collectOptions`）：只收 `option_selector` 里的**叶子/单子包裹层**，文本 1–80 字符，
   过滤 `isNonPanel`。
5. **匹配**（`scoreOption` / `rankOptions`）：
   | 情况 | score | 会不会自动点 |
   |---|---|---|
   | 原文完全相等 | 1.00 `exact` | ✅ 点 |
   | 去空格/标点/全角、转小写后相等 | 0.98 `normalized-equal` | ✅ 点（`allowNormalizedMatch`） |
   | 一方包含另一方 | 0.5–0.8 `contains` | ❌ 只进 `suggestions` |
   | 中文缩写（北大→北京大学）按序包含 | 0.45 `subsequence` | ❌ 只进 `suggestions` |
   | 其它 | 0 | ❌ |
6. **点击**：`scrollIntoView` → `clickReal` → `settleMs`。
7. **回读**：`readDisplay`（优先框架的 `display_value_selector`，其次 `[class*=display-value]`…
   再退到 `input.value`）。**回读不等于目标值就算 failed**，不回滚、不重试式乱点。

### 2.1 级联 / 树形下拉

`kind === 'cascader'` / `'tree-select'` 时把值按 `/ > ＞ → — --` 拆级，逐级在**当前可见面板**里找精确项并点击。
某级找不到精确项 → 报 failed 并给出该级的候选。**不会**用「最像的那个」硬走完。

### 2.2 探测模式：填之前先把选项拿到手

```js
// 20_fill.js 顶部
const MAPPING = {};                       // 可以空着
const OPTS = { probeOptions: true };
```
返回值里的 `probed` 是 `{ uid: ["选项1","选项2", ...] }`，落盘后：
```bash
python scripts/90_memory.py record-probe --host <host> --scan data/runs/<host>-scan.json \
    --probe data/runs/<host>-probe.json
python scripts/40_build_mapping.py --scan data/runs/<host>-scan.json --probe data/runs/<host>-probe.json
```
好处：**自定义下拉的选项也能在编译阶段做闸门**，值对不上就进 `*-todo.md` 的 `option-choice`，
一次问完，而不是填到一半才发现「弹层里没有这个选项」。

## 3. 日期控件（时间粒度自适应）

**核心原则：画像只存最细的一份，页面要多粗就用多粗。**
`personal.birth_date` 填 `1999-09-15`，遇到「出生年月」控件自动填 `1999-09`，遇到「出生年份」自动填 `1999`，
并把「丢了哪一级精度」写进回报。反过来——页面要年月日、画像只有年月——**绝不拿 `01` 去凑日号**，
而是进 `*-todo.md` 让用户补（`date-granularity`）。

### 3.1 粒度从哪来、谁说了算

| 来源 | 说明 |
|---|---|
| 组件自身（**最优先**） | `input[type=date/month/week]` 直接定级；否则用 `placeholder/name/id/title/aria-label` 去匹配 `assets/platform-selectors.json → date_granularity_hints` 里的正则。**故意不看 label**（「出生日期」这种标签不说明控件粒度） |
| mapping 里的 `granularity` | 编译期从 canonical 声明（`canonical-fields.spec.json` 的 `granularity`，如 `education.end: month`）带过来，填充时作为兜底提示 |
| 画像值本身 | 都没有就用值自身的粒度，按最细可得来填 |

判不出来就留空 → 填充器**自适应**（先按最细试，读回是什么粒度就接受什么粒度）。

### 3.2 四条填充路径

| 形态 | 判定 | 处理 |
|---|---|---|
| 原生 `input[type=date/month/week/datetime-local]` | `kind === 'date'` | 按 type 定级后原生 setter 直写 |
| 可写文本框（`readonly` 为假） | `kind === 'date-picker'` | 按目标粒度直写；不行再依次试其它粒度，取第一个回读相符的 |
| 只读框 + 自有面板 | `kind === 'date-picker'` | 开面板 → `calendarPick(..., stopAt=目标粒度)` 年→月→日导航，填到 `stopAt` 就收手 |
| 「年 + 月」分片下拉 | adapter/人工标 `mode: 'period'` | `fillCompositeDate` 逐段填，每段还会试 `09 / 9 / 9月 / 09月` 这类写法 |

回读校验统一用「数字串前缀」比较（允许任一方向的截断）：
`1999-09` 与 `1999-09-15` 视为相容，因为前者就是后者的截断。

### 3.3 日历引擎（`calendarPick`）

移植自插件的 `G1()`，做了四处改动：

1. **预置不是靠框架标签选的，而是靠「哪个预置的选择器真的出现在这个面板上」**。
   实战教训：一个页面上 mokahr 控件占多，字段被判为 `mokahr`，但它内嵌的生日控件其实是 antd 的
   `.ant-picker-*`。只信框架会让整条日期链路空转（`yearElementSelector` 找不到任何格子）。
   所以 `fillDate` 会：打开面板 → 对每个预置计算「有几个选择器命中可见面板」（`presetScore`）→
   从高分到低分最多试 3 个 → 每次重试前先关面板再开，避免上一次点到一半的残留状态。
2. **支持 `stopAt`**：返回「实际走到哪一级」（`'day' | 'month' | 'year'`）。
   年月控件选完月就返回 `'month'`，不会傻等日面板。
3. **年面板**：按 `yearElementSelector` 找目标年（**只在单元格文本真的能解出年份时才认它是年份网格**，
   否则先点 `yearPanelSelector` 打开年份面板）；找不到就用 `nextDecadeBtn`/`prevDecadeBtn` 翻页
   （按可见年份单元格的最大值判断方向），最多 `yearRetryTimes` 次。
4. **日面板**：优先只取 `in-view / available` 的格子，并排除 `disabled / last-month / next-month / outside`
   这类类名（否则会点到上/下月的同号日期）。
   ⚠️ **插件在这里会退化成「当天≤15 取第一个可用日，否则取最后一个」——本 skill 不做这种猜测**：
   找不到目标日直接返回 `false` → 字段进 `failed`，由上层问用户。

已内置的预设（`assets/platform-selectors.json → date_presets`）：
`antCalendarWithYearSelect`、`antCalendar`、`antPicker`、`elDatePicker`、`antDateRange`、
`mokahr`、`feishu`、`fusionRangePanel`（Fusion/`.next-calendar-*`，ATSX 用）。
新增预设就加一个 key 并在框架上写 `date_preset`（记得同步 `20_fill.js` 的内嵌副本，漂移守卫会查）。

### 3.4 「年 + 月」分片控件

一个字段由 2–4 个下拉/输入组成（年、月 或 年、月、年、月）。扫描器会把它们拆成多个 uid（这是对的，
因为它们在 DOM 上确实是独立控件），编译期的「重复 canonical」逻辑会只留一个并写进提示区。要填它：

1. 先在页面上跑一次 `probeOptions`，看有几个分片、各自的选项；
2. 在 mapping 里对**保留的那个 uid** 写 `{ v: "2027-06", mode: 'period' }`（或 `'composite'`）；
3. `fillCompositeDate` 会向上找「控件数 2–8 的最近字段块」，按 DOM 顺序取分片：
   `2 片 → [年, 月]`、`3 片 → [年, 月, 日]`、`4 片 → [年, 月, 年, 月]`（此时值必须是 `起 ~ 止`，
   只有一个日期就如实失败，不会把起始复制成结束）；
4. 每段都会依次试 `2023 / 2023年`、`09 / 9 / 9月 / 09月`、`15 / 15日` 这类写法；
5. 幂等：各片段都已读到目标值就直接跳过。

> 实测 mokahr 的「毕业时间/入学时间」就是这种分片；适配笔记见 `references/adapters/mokahr.md`。
> `tests/browser_e2e.py` 里有一个真的「年+月」双下拉用例。

## 4. 写入原语（React/Vue 受控组件）

```js
// ① 原生 setter：直接改 el.value 不会触发 React 的 onChange，必须走原型上的 setter
const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
set.call(el, val);
el.setAttribute('value', val);                       // 有的库读属性
el.dispatchEvent(new Event('input',  { bubbles: true, cancelable: false, composed: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
el.dispatchEvent(new Event('blur',   { bubbles: true }));
```

- `contenteditable`（富文本）：`focus` → Range 全选 → `textContent = val` → `input` + `change`。
- **逐字符模拟输入**（`OPTS.simulateTyping = true`）：对「只认真实 keydown 的联想框/富文本」有效——
  每个字符发 `keydown → keypress → input → keyup`，并在中间同步 `value` 前缀。
  代价是慢（`typingDelayMs` × 字长），默认关闭。
- 开关类：`checkbox` 用 `clickReal(label || el)` 后回读 `checked`；`radio-group` 用
  `radioText()`（自己的 label → `label[for]` → 父节点 → value）逐项比对，**不用整组容器文字**。

## 5. 弹层可见性过滤（否则会点到 tooltip / 日期面板）

`isRealVisible(el)` 会一路上溯 12 层，排除 `display:none` / `visibility:hidden` / `opacity:0`（且无 animation）、
`class` 含 `hidden`、以及 Vue transition 的 `-leave / -leave-active / -leave-to / -exit`；最后要求
`rect.width >= 2 && rect.height >= 2`。

`isNonPanel(el)` 再用黑名单排除非下拉面板：

```
tooltip toast notification message loading spinner
date-picker datepicker date-panel date-table time-picker timepicker time-panel
time-spinner picker-panel picker__popper calendar md-picker el-picker
ant-picker ant-calendar ud-picker ux-calendar rc-picker
```

外加一条「表头里出现 ≥5 个 `日一二三四五六` / `sun..sat` / `su..sa` → 这是日历表，不是选项列表」的判定。

## 6. 布局三级定位（section / level2 / block）

插件的抽取链是 `level1_class`（区块标题）+ `level2_class`（字段名）+ `group_class`（重复块），
本 skill 照搬到扫描器里：

| 概念 | 扫描器字段 | 用途 |
|---|---|---|
| 区块标题 | `section` / `sectionIndex` | 报告分组；判断「这是教育背景还是实习经历」 |
| 字段名 | `label`（显示用）/ `labelNorm`（去噪声，用于匹配） | 字典匹配、站点记忆、问答记忆 |
| 重复块序号 | `block` / `blockCount` / `blockVia` | **多段经历**：第 1 段 / 第 2 段各自取画像的第 1/2 条 |

区块标题的来源顺序：`layout_presets[..].level1_class` → 兜底 `h1..h6, legend, [role=heading],
[class*=blockTitle|section-title|SectionTitle|card-head-title|collapse-header]`；要可见、文字 1–30、
内部无表单控件、不在 `<label>` 里。判定归属用 `compareDocumentPosition`（取控件之前最近的一个）。

重复块：优先 `group_class`；没有就用**同签名兄弟**兜底 —— 从控件往上找，「父节点里有 ≥2 个
（且 ≤30 个）同 `tagName|classList` 签名、且都含表单控件」的最高层。

⚠️ **但下标不是记录序号**：一条教育记录里有「学校名称 / 专业名称 / 学历」三个兄弟块，
第二条记录又从「学校名称」重新开始。所以扫描器按**字段名重复**切分记录：

```
兄弟序列   学校名称 专业名称 学历 | 学校名称 专业名称 学历
记录序号      0       0     0   |    1       1     1
```

判定规则：按顺序扫兄弟，当前兄弟的字段名（取 `level2_class` 或其第一个短文本叶子）已经在本记录里出现过
→ 开启下一条记录。另外 **`block` 只在真的识别出多段（`count > 1`）时才算数**，否则返回 `-1`，
让 `40_build_mapping.py` 退回「按 canonical 出现顺序取画像数组」的老策略（避免把单段表单压成一条记录）。

> 这意味着**同一张表里第 2 段教育经历**的 `学校名称` 和**第 1 段**的 `学校名称` 是两个不同的 uid，
> 且 `block` 分别是 1 和 0 → `40_build_mapping.py` 才能把 `education.0.school` 和
> `education.1.school` 分别写对（不再靠「谁先出现谁就是 0」硬猜）。
> `tests/browser_e2e.py` 的第 1 步就是拿两段教育背景验证这件事。

## 7. 标签归一化（命中率的关键）

页面上的字段名常带噪声，例如：

| 页面原文 | 归一化后（`labelNorm`） |
|---|---|
| `毕业时间（必填）` | `毕业时间` |
| `项目名称（英文）` | `项目名称` |
| `* 姓名` | `姓名` |
| `1. 手机号码` | `手机号码` |
| `教育背景 添加` | `教育背景` |

规则（`10_scan_form.js → stripLabelNoise` / `jaa_lib.py → norm_label`，两边必须一致）：
去掉 `（必填）(必填)（可选）(可选)（选填）(选填)必填选填可选添加编辑`，
去掉**整段括号内容**，去掉行首编号与 `+`，再去空白/标点/大小写。

> 注意「去掉整段括号内容」是**有意为之**：插件的 `getElementText()` 就是这么干的。
> 副作用是 `项目名称（英文）` 会退化成 `项目名称`——如果同一页同时有「项目名称」和「项目名称（英文）」，
> 两者会撞到同一个 canonical → `40_build_mapping.py` 的「重复 canonical」逻辑只保留控件类型最匹配的一个，
> 并把它记进 `*-todo.md` 的提示区让人确认。

## 8. 每个框架要特别注意的点
- **antd**：v3 与 v4/v5 的选项类名不同（`-dropdown-menu-item` vs `-item-option`），配置里都列了。
  `.ant-form-item-required` 是**必填星号**，扫描器据此判 `high` 置信度。
  日期有 `ant-calendar-*`（v3）与 `ant-picker-*`（v4/v5）两套预设。
- **Element**：`.is-required` 在 `.el-form-item` 上；`.el-select__wrapper`（Plus）与
  `.el-input__inner`（UI2）都要试。`el-popper` 里混着非下拉面板，所以要 `:not([style*="display: none"])`。
- **ATSX**：`.atsx-date-picker-period-month-label` 是「年月」周期控件；日期面板是 Fusion 的 `.next-calendar-*`。
- **mokahr**：`sd-Select-container` 触发、`sd-Dropdown-dropdown-*` 面板、`sd-Menu-content-item` 选项；
  值显示在 `sd-Input-display-value-*`（**`input.value` 常为空**）；必填星号是空的
  `[class*="required-asterisk"]`（只能靠 `[class*=required]` 命中 → `medium`）。详见 `adapters/mokahr.md`。
- **北森**：`.phoenix-selectList__list` / `.phoenix-selectList__listItem`；省市是 `.area-data-container` 两级列表。
- **Hotjob**：底层是 antd，但布局类名是自己的（`.form-cell-inner` / `.resume_info_title`）。
- **飞书**：`.ud__select__dropdown:not(.ud__select__dropdown-hidden)`；日期在 `.ud__picker-dateInput`，
  区间在 `.throne-biz-date-range-picker-input`；树形选择是 `.ud__tree*`。

## 9. 读「当前值」的铁律（踩过坑）

`readDisplay()` 的顺序必须是这样，不能倒：

1. 框架的 `display_value_selector`（值可能在一个 `<div>` 里）
2. `<select>` → `selectedOptions[0].text`
3. `el.value`
4. **只有「自定义组件」（`data-jaa-kind` ∈ custom-select / cascader / tree-select / popup-picker）**
   才去猜外层容器的文字

第 4 步不能对裸 `input/textarea` 生效。否则一个空的只读日期框会把**字段标签**（如「出生日期 (年龄)」）
当成本字段的值上报 → 校验器报「格式非法」、幂等判定误判为「已是目标值」而跳过。
`10_scan_form.js` / `15_dump_state.js` / `20_fill.js` 三份实现必须一致。

对应的另一个坑：**报错文案只能在叶子文本节点里找**，并且要排除控件自身的
`placeholder / [class*=selection] / <option>`，否则 `<select>` 里的「请选择」会被当成校验错误
（`15_dump_state.js → errorOf`）。

## 10. 这套配置什么时候不管用

- 组件是**自研**的（类名没有语义）→ 扫描器给 `custom-select`，填充器读不到选项 → 报 failed。
  出路：`probeOptions` 看选项原文 + 写一份 `references/adapters/<host>.md`。
- 下拉是**虚拟滚动**（只渲染可见项）→ 目标项不在首屏。配置里没有 `search_input_selector` 的框架
  只能靠滚动；目前填充器**不做滚动猜测**，会如实报 failed 并附上已读到的选项。
- 面板在 **iframe** 里 → `evaluate` 的 `document` 看不到；需要 `scripts/cdp.mjs eval` 指定 frame，
  或在 `OVERRIDE.extraControlSelector` 里换思路。
- 站点用 **canvas** 画表格（部分在线简历编辑器）→ 无解，只能走站点自己的「导入简历」入口。
