# adapter：i.zhaopin.com（智联招聘 在线简历「我的简历」）

URL：`https://i.zhaopin.com/resume`（登录态在浏览器 profile；未登录会跳 `passport.zhaopin.com/login`）
框架：**Vue2 + iView（`ivu-*` 类）**，外层容器 `.student` = 学生版简历（右侧有「切换到学生版/社招版」）。
`platform-selectors.json` 的七大框架都识别不到 → 走 DOM + 组件直写；**不要**试 React fiber 快路径。

## 模块容器（回读定位用）

| 模块 | 容器 | 备注 |
|---|---|---|
| 个人优势 | `.zp-evalution` | 学生版默认空，站点诊断会提示「未填写自我评价」 |
| 求职意向 | `.resume-wanna-wrapper` | 逐岗不同，别自动改 |
| 教育经历 | `.resume-job-exp-wrapper`（**含「教育经历」文本的那个**，工作/实习经历共用同一 class！） | 必填 |
| 工作/实习经历 | `.resume-job-exp-wrapper`（另一个） | |
| 项目经历 | `.resume-project-exp-wrapper` | 见下 |
| 培训/语言/技能/证书 | `.resume-training-exp-wrapper` / `.zp-wrap` / `.professional-skills` / `.zp-certificate` | |
| 学生干部经历 | `.student-cadre-index` | **全站只允许 1 条** |
| 附件 | `.picture-enclosure` | 最多 10 个 |

## ⚠️ 判断「有没有保存成功」不能用渲染条数

项目模块**默认只渲染 2 条**，其余折叠，要点 `.show-all`（文本「查看全部」）才展开全部 `li`。
本次就因此把 4 条成功保存误判成失败，差点重复提交。权威判据二选一：
1. 组件数据：从 `.resume-project-exp-wrapper` 的 `__vue__` 往上找 `$props.ProjectExperience`（数组），比长度；
   条目里带 `path: "Resume[5].ProjectExperience[n]"`，可直接定位。
2. 展开后数 `.project-exp-pre-item`；或比对 `.project-exp-pre-item-title span` 的 `title` 属性（列表标题会被截断，`title` 才是全名）。

## 项目经历：组件直写（最省事的路子）

点 `.project-exp-add`（文本「添加项目经历」）→ 出现 `.project-exp-edit-wrapper`，它的 `__vue__` 就是表单组件：

```js
c.proExpProjectName = '<项目名>';        // 必填
c.proExpProjectDesc = '<描述>';          // 必填，站点无长度报错（实测 500+ 字 OK）
c.startDate = new Date(Y, M-1, 1).getTime();  // ← epoch 毫秒，月份首日 00:00 本地时区
c.toToday = true;  c.endDate = "";            // 「至今」
// 或 c.toToday = false; c.endDate = new Date(Y2,M2-1,1).getTime();
document.querySelector('.project-exp-edit-btns-sure').click();   // 「保存并更新」
```
- 字段只有 名称 / 时间(起止) / 描述 —— **没有**角色、公司（`affiliatedCompany` 字段存在但要求先有工作经历）、业绩栏
  → 角色/成果要写进描述（用 `• 成果：…` 一行，与原导入条目风格一致）。
- 时间格式：`new Date(2026,2,1).getTime() === 1772294400000`，与站点已存值逐位相符，可放心按此算。
- 每条一次保存请求；中途页被回收也不会重复（先按标题前缀去重再写）。

## 学生干部经历：结构性限制（重要）

- **只能 1 条**：存成功后「添加」入口直接消失，只剩 `.student-cadre-index__list-edit`（编辑）。
- 字段只有：**干部类别**（团委 / 校学生会 / 院学生会 / 学生社团 / 班级）+ **干部职级**
  （主席 / 副主席 / 主席助理 / 秘书长 / 书记 / 社长 / 部长 / 班长 / 干事 / 其他）+ **任职时间**（选填，年月）。
- **没有组织名称、没有职责描述** → 简历里「哪个组织的什么岗位、做了什么」全被压成两个枚举值。
  选项对不上的经历（如「创新实验室负责人」）**不要硬塞**：列 `todo` 问用户，或把细节放到项目经历/个人优势。
- 表单容器 `.cadre-edit-index__form`，但**保存钮在外层** `.cadre-edit-index__buttons-sure`（在 `__form` 里找不到按钮）。

### iView Select 必须用真实事件序列，且要限定作用域

```js
// ✔ 只在这个 select 自己的下拉里找选项
var box = selects[i];                       // .zpfe-iview-select
var it  = box.querySelectorAll('.ivu-select-item');   // 下拉就在 box 内
['mouseenter','mousedown','mouseup','click'].forEach(ev =>
   target.dispatchEvent(new MouseEvent(ev,{bubbles:true,cancelable:true,view:window})));
```
- 单纯 `target.click()` **不生效**（选了却没写进去，报错「*请选择干部类别」）。
- 全局 `document.querySelectorAll('.ivu-select-dropdown')` 会命中**另一个未展开**的下拉，
  于是「点了 ok 但值没变」——必须在所属 `box` 内找，并用 `.ivu-select-selected-value` 的文本回读校验。

## 教育经历

`.edu-edit-panel`（点条目上的「编辑」打开），组件 `$data.eduInfo`：
`eduSchoolName / eduMajorV / eduBackground`(3=硕士,4=本科)` / eduBackgroundTranslation / eduFullTime`(「统招」)`
/ degreeCertificate`(1=有学位证书)` / newEduSchoolId / newEduMajorSmallType / eduStartDateFormat / eduEndDate / eduOverseaseExperience`。
- **没有**在校经历、GPA、专业排名文本栏 → 智联教育能补的只有时间/学制类字段。
- 改毕业月份：`dp.__vue__.$emit('input','YYYY-MM-01')` **且**同时写 `c.eduInfo.eduEndDate`（epoch）
  与 `c.eduInfo.eduEndDateFormat`（`new Date(y,m-1,1).toISOString()`），再点 `.save-btn`（保存并更新）。
  只 emit 时 `eduInfo` 可能仍是旧值；只改 `eduInfo` 时输入框显示不变 —— 两处都要写。
- 教育/工作经历共用 `.resume-job-exp-wrapper`，选择容器要用**文本包含「教育经历」**过滤。

## 专业技能 / 证书 / 语言能力 / 个人优势（第二轮实测）

**专业技能** `.professional-skills`：每条 = 技能名称（`input[maxlength=50]`）+ 使用时长（`input[type=number]`，**单位月**，84 会显示成「7年」）+ 掌握程度（`.ivu-radio-wrapper` 一般/良好/熟练/精通）。
保存钮 `button.edit-panel-bottom-save-btn`。实测连填 12 条无上限报错、无重复校验（重复会提示「*专业技能重复，请重新输入」）。

**证书** `.zp-certificate`：添加控件是 `div.zp-certificate-addFirst`（**带 icon 子节点**，用「叶子 + 文本包含」的写法会漏掉它）。
证书名称是**远程词典搜索**：`focus → 原生 setter + input 事件 → 等 ~2.2s → 在 `.ivu-select-item` 里按精确文本命中 → 派发 mouse 序列`。
面板**只有名称一栏**（没有成绩、没有获得时间）→ CET 分数、发证年月无处可写，只能留在个人优势/证书附件里。
⚠️ 词典只收职业/等级资格证：搜「专利」只有「专利代理师资格证」，**不能**用来记自己的国家专利；发明/软著同理无处归类 → 宁可留空也别硬塞。

**语言能力**：根容器要取 `.zp-wrap`（文本以「语言能力」开头的那个）—— `.zp-language` 里只有标题，**没有添加钮**，在它里面找会得到空表单。
字段：语种（21 项枚举）+ 听说能力 + 读写能力（后两个必填，选项 一般/良好/熟练/精通）+ 获得证书（可选，带「删除」）。
⚠️ 保存钮是 `a.save-btn.zp-blue-button`（**`<a>` 不是 `<button>`**）→ 用 `q("button")` 找会漏。

**个人优势** `.zp-evalution`：单个 textarea，**上限 500 字**（占位符明确写「不要填写手机号、QQ、微信等联系方式」→ 别把联系方式塞进去）；
保存钮 `button.zp-evalution-edit-btn__sure`；旁边挂着「AI 助手帮你改：立即优化 / 首次体验免费」浮层与 `elp-overlay-dialog`，**一律不点**。
填完后站点右侧「简历诊断」从 2 个优化项降为 1 个，可当外部校验信号。

## 通用坑：保存钮标签名各模块都不一样

`button.project-exp-edit-btns-sure` / `button.zp-evalution-edit-btn__sure` / `button.edit-panel-bottom-save-btn` / `a.save-btn` …
最稳的写法：**取「叶子节点且文本 == 保存并更新」的最后一个**，再派发 `mouseenter→mousedown→mouseup→click`：
```js
var sv = [...root.querySelectorAll('*')].filter(e => !e.children.length && e.textContent.trim() === '保存并更新').pop();
```
另一个坑：**多个模块的面板会同时打开**，此时全局 `document.querySelectorAll('.ivu-select-item')` 会命中别的模块的下拉
（表现成「点了 ok 但值没变」）→ 选项必须在**该模块根节点内**找，必要时先把它模块的「取消」关掉。

## 其他坑

- PC 网页版**没有删除入口**：`.resume-project-exp-wrapper` 下 `[class*=del]` 一个都没有，编辑面板只有
  「保存并更新 / 取消」。要删条目只能去智联 App（或改字段凑合）→ 发现重复时如实告诉用户，不要试图调接口删。
- 表单里的日期输入 `input.ivu-input` 是 iView DatePicker；`type=month` 时 `$emit('input','2018-09-01')` 显示成「2018-9」。
- `.ivu-select-dropdown` 有时 `offsetParent===null`（被判定不可见）但选项其实已渲染 → 找选项**不要用 `vis()` 过滤**，直接在该 select 作用域里按文本命中再派发事件。
- 站点会插「AI 简历优化 / AI 助手帮你改」浮层（`isAiIng`），**别点**，也不要把 AI 建议当作用户数据。
- 「切换学生版/社招版」「上传附件」「预览/下载简历」等按钮均非本次范围；提交类动作一律不点。
