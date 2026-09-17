# adapter: career.honor.com（荣耀招聘 / 北森 wecruit）

> 实测于 2026-09-11，校招（`postType=campus`）。站点内核是**北森 wecruit**（API 前缀 `/wecruit/`），
> 前端是自研 antd 3.x 单页应用，**不是** mokahr。
> ⚠️ 这个站是「先补在线简历 → 才能投递」，而且简历表单有 100+ 字段、**每次操作整表重渲染**，
> 单次浏览器调用很容易超过 60 秒 → 长任务请走 `scripts/cdp.mjs`（见 references/strategies.md §8），
> 否则 MCP 会话会被换掉、页归属丢失（本站在实测中因此堆了十几个标签页）。

## 1. URL 地图

| 页面 | URL |
|---|---|
| 职位详情 | `/SU{suiteKey}/pb/posDetail.html?postId={postId}&postType=campus` |
| 职位详情 + **自动弹出投递弹窗** | `…&showDeliver=1` ⭐ 免点击「立即投递」 |
| 账号中心 | `/SU{suiteKey}/pb/account.html#/account`（`#/myDeliver` 我的投递） |
| **在线简历编辑器** | `/SU{suiteKey}/pb/resumeOperation.html?resumeId={id}&recruitType=1&tid={templateId}&pid={postId}&lang=1` |

关键：`showDeliver` 是登录回调 + `componentDidMount` 里读的查询参数，
带它访问职位详情页 → 自动 `deliveryCheck()` → 直接把申请弹窗 `fastSendShow` 打开。
**不需要点「立即投递」**，天然满足"不点提交类按钮"的约束。

## 2. 投递流程（两步，缺一不可）

1. **先补在线简历**：申请弹窗会显示 `简历完整度：中文 N%` 和
   `当前职位投递要求：中文简历完整度达到100%`；不满 100% 时按钮区显示「不符合投递要求」，**提交必然失败**。
2. 弹窗里勾两个同意框 → 点「确认提交」（**留给用户点**）。

弹窗内容（很小）：内推码 6 个单字符 input（`#stepInput1..6`，可空）+ 简历卡片 + 编辑入口 + 两个协议 checkbox + 确认提交。

## 3. 在线简历编辑器（真正的大表单）

- 分区：个人基本信息 / 教育经历 / 语言能力 / 获奖经历 / 荣耀亲属 / 工作经历 / 项目经验 /
  专业技能 / 论文著作 / 个人专利 / 专业资格认证 / 培训经历 / 计算机能力。带「必填」的分区是硬门槛。
- **左侧第一个区块是「上传简历」**：`input[type=file]`（accept 空）→ 上传 PDF 后弹确认框
  「上传新简历将替换现有简历内容，请确认是否继续」→ 点「继续」触发解析。
  实测：一份 PDF 简历把完整度 **0% → 53%**，姓名/邮箱/电话/教育/专业/若干项目/照片全部自动填好。
- **解析会顺带抽取 PDF 内嵌图片当证件照**（实测 `PIC_1_Im0.jpg` 295×413），照片字段不用再手动传。
- 每个分区都有自己的「保存」（`form-list-save-btn`，平时 `display:none`），
  底部那个 `button.ant-btn`（唯一可见的「保存」）是全表单保存 → **点它才会落库**。
- 保存后服务端 `finishPercentCn` 才是真的：`/wecruit/delivery/templateResume/get/{suiteKey}?postId=…`
  （POST，query 里必须带 `postId`，只放 body 会返回 `isExist:false`）。

## 4. 控件配方

```js
// ① antd 3.x Select（证件类型/民族/政治面貌/渠道/工作地/编程语言…）
sel.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); // 必须先 mousedown
sel.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
sel.click(); await sleep(400);
const dd = document.getElementById(sel.getAttribute('aria-controls')); // ⭐ 用 aria-controls 精确定位，
// 别用「最后一个可见 .ant-select-dropdown」——页面上常同时挂着十几个下拉
[...dd.querySelectorAll('li')].find(x=>x.innerText.trim()===text).click();

// ② 省市/国家地区「级联」= .cascader-plugins-wrap 里两个 Select（省 → 市）
//    最高学历毕业院校所在国家/地区 也是这种两级控件（首级是省/国家混合字典，没有单独「中国」项）

// ③ 日期：antd CalendarPicker，且 input 是 readonly（只能点面板，别想输入）
//    出生日期 / 获奖时间 / 项目起止时间 都是这种；选完 input.value 形如 2020-09-01

// ④ 文本框（ant.design 受控）：走原生 setter + input/change/blur
```

## 5. 日期控件的四个坑（都踩过）

1. **input 是 `readonly`** → 只能点开面板选，`setVal()` 一律无效。
2. **年份面板不可靠**：`.ant-calendar-year-select` → `.ant-calendar-year-panel-year` 的点击经常不生效
   （尤其是要跨年代时）。**更稳的是标题栏的 `‹` / `›` 翻页按钮**：`.ant-calendar-prev-year-btn` /
   `.ant-calendar-next-year-btn` / `-prev-month-btn` / `-next-month-btn`，每次只走一年/一月，连点即可到达。
   本次跨 7 年（2026 → 2019）就是靠连点 7 次「上一年」修好的。
3. **日期格子要用真点击或至少补 mousedown/mouseup**：
   ```js
   const d = [...p.querySelectorAll('.ant-calendar-date')]
     .filter(e => !e.classList.contains('ant-calendar-last-month-cell')
               && !e.classList.contains('ant-calendar-next-month-btn-day'))
     .find(e => e.innerText.trim() === '1');
   d.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); d.click();
   ```
4. **表单有自洽约束：结束时间必须晚于开始时间**。
   若先填了大数（如开始 2026）再去改另一个人已经填过的值，新的会被静默拒绝（面板关掉但值不变）。
   正确顺序：**先清空/改小「结束时间」，再改「开始时间」，最后回填结束时间**。
   另外「同年同月同日」也会被拒（本例仓库写 `2020-09 ~ 2020-09`，最后落到 `2020-09-30`）。
5. **改完必须重新定位 input**：React 重渲染会替换节点，`const inp = …querySelector('input')` 拿到的引用
   读出来是旧值（表现为"明明看着改好了，回读还是旧值"）→ 每次回读都重新 `querySelector`。

## 6. 列表行（教育/项目/获奖/论文/专利/技能…）的增删

- 新增：`div.add-more-btn`，文本分别是「添加新的项目经验 / 获奖经历 / 论文著作 / 个人专利 / 专业技能 /
  计算机能力 / 工作经历 / 专业资格认证 / 培训经历」。**新增后它后面所有 `.ant-form-item` 的下标都会漂移**，
  必须重新按标签 dump；稳妥做法是按「名称」定位而不是按行号。
- 删除：每条记录里有一个 `<span class="del-btn"><i class="iconfont icondelete-can"></i></span>`。
  **合成 `click()` 不触发**（React 代理事件不认），要直接调它的 React 处理器：
  ```js
  const k = Object.keys(del).find(k => k.startsWith('__reactInternalInstance') || k.startsWith('__reactFiber'));
  del[k].memoizedProps.onClick({ stopPropagation(){}, preventDefault(){}, nativeEvent:{}, currentTarget:del, target:del, type:'click' });
  ```
  然后会弹「确认删除该记录吗？ / 确认删除 / 算了，再想想」——**「确认删除」也不是 `<button>`**，
  同样要沿节点向上找带 `onClick` 的 React 节点去调（或用 CDP `Input.dispatchMouseEvent` 真点击）。
- **空记录会被服务端丢弃**：把一条记录的所有字段清空后保存，刷新即消失（可用于安全地清掉垃圾行）。
- ⚠️ **保存后服务端列表顺序可能与你编辑时的 DOM 顺序不同**：按行号写数据会导致
  「名称↔日期」整体错位（本例 15 条里错了 13 条）。正确做法：
  **每条记录的名称+日期+职责+描述一起写 → 保存 → `location.reload()` → 按名称逐条校验**。

## 7. 字段坑

- 「是否为学生干部」「是否为学生干部(本科)」「是否有亲属在荣耀工作」：
  **前两个是 Select，第三个才是 radio** —— 别看标签文字猜控件类型，先 `querySelector('.ant-select-selection')`。
- 「获奖类型*」是**纯文本**（placeholder `如奖学金、竞赛比赛等，若无则填写为无`），不是下拉；
  「获奖时间/获奖级别/获奖等级」是它的兄弟字段（级别=`国际级/国家级/省市级/校院级`，等级=`特等/一等/二等/三等/其他`）。
- 「论文名称*」placeholder = `如不涉及则填写为无`。
- 「照片*」在无障碍树里是一个 `input`（隐藏），值域是文件 id，别当成文本字段。
- 学历字典用「硕士研究生」（不是「硕士」）；学位用「硕士」；本科/学士同理。
- 「个人成就」是 **textarea**（不是 input），用 `querySelector('input')` 会拿到 null。

## 8. 拿选项字典（不用点开每个下拉）

页面加载时会拉一个字典 JSON（27 个字典，约 911 KB）：

```
https://wecruit-cdn.hotjob.cn/files/oline/HONOR/{hash}.json   ← hash 从 performance.getEntriesByType('resource') 里找 .json
```

常用 key：`0/199` 证件类型、`0/619` 国籍、`0/120401` 国家地区(含中国各省)、`0/72` 民族、`0/194` 政治面貌、
`0/209` 婚姻状况、`0/606` 学历、`0/435` 学位、`0/437` 语种、`0/126801` 编程语言、`0/126901` 掌握程度、
`0/100606` 学习成绩排名、`0/104788` 获奖级别、`0/104782` 获奖等级、`0/100429` 应聘渠道来源、`0/103401` 意向工作地。

## 9. 会话坑 → 直接上 CDP

- 本站在 MCP 下**几乎必然触发会话重建**：字段多、单次操作慢，批量填充必然 >60 秒。
  症状 = 填一半报 `page N is not owned by this agent`、标签页越开越多。
- 结论：**这个站一次到位地用 `scripts/cdp.mjs`**（`node scripts/cdp.mjs open <编辑器URL>` 开 **一个**页，
  之后所有 `eval / click / revalclick` 都指向它），全程不会再出现归属问题。
- `evaluate` 里别对整个 `document.querySelectorAll('div')` 跑 `innerText` 正则（会卡到超时），
  用 `div.add-more-btn`、`span.del-btn` 这类精确选择器。
