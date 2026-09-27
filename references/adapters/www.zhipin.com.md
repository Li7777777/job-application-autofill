# adapter：www.zhipin.com（BOSS直聘 在线简历编辑页）

URL：`https://www.zhipin.com/web/geek/resume`（登录态在浏览器 profile 里，无需重新登录）
框架：自研 Vue2 组件库（`ui-form` / `ui-select` / `ui-cascader` / `datepicker-pannel`），**没有** antd/el-/moka 类名，
`platform-selectors.json` 里七大框架都识别不到 → 用 DOM 扫描 + 面板点击的通用方案，**不要**试组件 API 快路径。

## ⚠️ 标签页归属：BOSS 的页在并发环境下几秒就被回收

实测（<cwd>=邮箱环境，BrowserOS 多 agent 同时开页）：`tabs new` 打开的 zhipin 页在
**下一次工具调用之间**经常整页消失，报 `Unknown page N` / `CDP error: No target with given id found`；
只有 `pages.list()` 轮询时它能在，一做 `evaluate`/`wait` 就更容易没。结论：

- **一次调用做完「开页 + 干活 + 回报」**，不要把页面留给下一次调用；
- `browser.wait(for=selector)` 反而更容易踩空 → 用 `newPage()` → `sleep(2400)` → `evaluate` 的**无 wait** 序列；
- 每个 run 外面套 2–3 次重试（失败就重新 `newPage`），**别复用上一次调用拿到的 pageId**；
- run 有 30s 硬上限，实测**一条经历 ≈ 8–12s**（两次年月点选 + 保存回读），
  所以 **每次调用只塞 2 条**（内部 deadline ≤ 20s 并给未跑的条目打 `notrun`，靠幂等跳过续跑）。
- 保存是**每条一次 POST**，中途页死也已落库 → 重跑安全（先按「名称精确匹配」跳过已存在条目）。

## 区块与入口（回读用）

| 区块 | 容器 class | 添加入口 |
|---|---|---|
| 工作/实习经历 | `.resume-workExpList` | `h3.title .link-add` |
| 项目经历 | `.resume-projectExpList` | 同上 |
| 教育经历 | `.resume-educationExpList` | 同上 |
| 资格证书 | `.resume-certificationList` | 同上 |
| 社团/组织经历 | `.resume-clubExpList` | 先点「自定义添加」里的 `.custom-add-item`（文本含「社团」）→ 区块才出现 |
| 志愿者服务经历 | `.resume-volunteerExpList` | 同上（文本含「志愿者」） |

- 点卡片只是**在前端插入区块**，空区块不会被保存（刷新后就没了）→ 必须填完并点「完成」。
- 每条记录是 `ul > li`，`li .name` = 标题、`li .period` = 起止、`li .role-name` = 角色；行内操作是
  `.op .link-edit` / `.op .link-delete`（**删除/提交类按钮一律不点**）。
- 回读计数用 `.name` 的数量，别用 `ul > li`（下拉面板里也全是 `li`，会把计数污染成 6、11 这种假数）。

## 字段与真实限制（扫描时 req 标记会骗人）

**项目经历**：项目名称\*、项目角色\*（`例如: UI 设计师`）、项目链接（选填）、开始/结束年月、
项目描述\*（textarea，**0/3000**）、项目业绩（选填，**0/1000**）。
- **结束时间虽标 `req=false`，不填就保存失败**（表单留着不开不关、`li` 数不变）→ 必须有起止。
- 进行中项目点结束面板里的 **`.totoday`（"至今"）**，写入后 input 显示当前年月、卡片显示「至今」。
- 英文长标题（79 字符）可以过，无长度报错。

**教育经历**：学历（`ui-cascader`）、学校名称\*（`.ui-suggest` 需从院校库命中）、专业（suggest）、
时间段（年份区间 `ui-select`）、专业排名（下拉，选项见下）、
主修课程（`ui-select-multiple`，**上限 5 门**，且只能从站点预设课程表里选 → 画像没有真实课表时**必须问用户**）、
在校经历（textarea **0/300**）、毕业设计/论文题目、毕业设计/论文描述。
站点公开的「专业排名」选项表：前1% / 前3% / 前5% / 前10% / 前15% / 前20% / 前30% / 前40% <!-- jaa-leak-allow -->

- 「新增」表单只有前 5 项 + 在校经历；**专业排名/主修课程/毕设两项只在「编辑」已有条目时才出现** →
  补教育经历要走 `.link-edit`，不能走 `.link-add`。
- 学历 cascader：点 `.ui-cascader-selection` → 等 ~600ms（300ms 会取到 `display:none` 的旧面板）→
  `.ui-cascader-menu` 是**两级面板并列**，第一面板点 `本科`（带 `.ui-select-item-arrow` 表示有子级），
  再在最后一个可见面板点 `全日制`；hidden 变成 `<码>,1`（例 `203,1`）、`.ui-cascader-label` 显示「本科 / 全日制」。
  只存 `203`（没选学制）时卡片看起来正常但编辑框显示为空 —— 这是常见缺失项。

**社团/组织经历**：社团/组织名称\*、担任角色\*（**≤12 字，超了报「担任角色不得超过12字」**）、
时间段、经历描述\*（textarea **0/300**）。
- 角色想写「部长（新媒体运营 / 摄制）」会因空格算字数被拒 → 去掉空格压到 12 字内，
  或把限定信息挪进描述。

**志愿者服务经历**（字段与社团**不同**，别照抄）：项目名称\*（占位符「例如: 中国红十字会」，填组织/赛事名）、
服务时长\*（**两个 `ui-select`**：数字 1–30 + 单位 `小时/天/周/月/年`）、时间段（标 `req=false` 但
**不填报「请选择项目时间」**）、项目描述\*（textarea）。没有「担任角色」字段 → 角色写进描述句首。

## 控件配方

- 年月面板：`.datepicker-wrap` → 点 input 出 `.datepicker-pannel.datepicker-month`，
  头部 `.month-year-btn`（文本「2026年」）点它切到 `.datepicker-year`（头部文本「2020 - 2029年」，
  `.prev`/`.next` 翻十年）→ 点 `.cell.year` → 回月面板点 `.cell.month`（**索引 = 月份-1**，
  `disabled` 表示超出今天）。未来年月一律 disabled（当前是 <YYYY-MM> 时，之后的月份不可点）。
- 原生 `select` 之外全部是自研组件：`setV()` 走 `HTMLInputElement/TextAreaElement` 的原生 value setter
  + `input`/`change` 事件即可写进 Vue（项目/教育/社团/志愿者的文本域与文本框都验过，无假成功）。
- 点「完成」= 单条经历的保存（POST），不是投递/提交整表；「取消」是 `btn-outline`，可安全用于放弃一次编辑。

## 建议执行顺序（已验证）

①教育（走 `.link-edit` 补排名/学历/毕设/在校经历）→ ②项目（按 `.link-add` 逐条 2 条/调用）→
③社团（点卡片建区块）→ ④志愿者（点卡片建区块）。
画像里 `endDate` 为空的项目：站点强制要结束时间，**不要拿「至今」凑**历史项目，
问用户要「获奖/发表同月」之类的依据后再写（本次用户口径即如此）。
