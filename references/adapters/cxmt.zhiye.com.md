# adapter: cxmt.zhiye.com（长鑫存储校招 / 北森 iTalentX 门户）

> 实测于 2026-09-12。站点是**北森「门户 2022」**（`ux-recruitment-portal-2022`），
> 前端是自研 **phoenix** 组件库 + React SPA，**不是** antd 也不是 mokahr。
> 特色：**进表单必须点「立即投递」（没有直链）**；div 版单选必须真实鼠标点击；上传走 `DOM.setFileInputFiles`。

## 1. URL 地图

| 页面 | URL |
|---|---|
| 职位列表 | `/campus/jobs` |
| 职位详情 | `/campus/detail?jobAdId={jobAdId}` |
| **申请表（点「立即投递」后到达）** | `/form?fromPage=job&jobAdId={jobAdId}&userId={userId}` |

- 该站**没有任何 apply 直链**：`/campus/apply`、`/campus/personal-center` 都会被 SPA 兜底成首页。
  实测只能点详情页的「立即投递」才会进 `/form`（点它只是打开申请表，**不是提交**；但按 skill 铁律 1，
  这一步必须先问用户）。
- 名额：详情页写「每个人最多投递 2 个校园招聘职位，你还可投递 N 个」→ **一次申请一份表**，
  投第二个志愿要再走一遍「立即投递」。

## 2. 流程与控件配方

### 2.1 上传简历一键解析（先做这个，省一大半事）
```bash
node scripts/cdp.mjs upload <target> expr_resume_input.js "E:\\...\\resumes\\agent.pdf"
# expr: (() => document.querySelectorAll('input[type=file]')[0])()
```
实测一份 PDF 简历预填了 **13 项**：姓名 / 手机 / 邮箱 / 国籍 / 英语等级(四级) / 最高学历 /
两段教育经历（学校·专业·学历·起止）/ 一段项目。**其余全靠手填**。

### 2.2 字段的三层结构（通用扫描器在这里会失灵）
```
.form-item.form-item--phoenix          ← 字段容器（从 label 向上 2~4 层找，认 class 含 form-item）
  ├─ .form-item__title > label.form-item__text   ← 字段名（叶子节点，innerText 精确匹配）
  └─ .form-item__control
       ├─ input.phoenix-input__input / textarea   ← 文本
       ├─ .phoenix-select                          ← 下拉 / 日期 / 级联（都长这样！）
       ├─ .phoenix-radio-group > .phoenix-radio-group__radioItem   ← div 版单选（无 input[type=radio]）
       └─ input[type=file]                         ← 文件
```
⚠️ 通用扫描器（`10_scan_form.js`）在这个站会把**页头搜索框、`+86` 区号、`0/32766` 字数计数器**
误判成字段 → 用下面这段按 label 取字段更可靠：

```js
const boxOf = label => {
  const lab = [...document.querySelectorAll('.form-item__text')]
    .find(e => e.offsetParent !== null && (e.innerText || '').trim() === label);
  if (!lab) return null;
  let b = lab; for (let i = 0; i < 4 && b; i++) { if (b.classList?.contains('form-item')) break; b = b.parentElement; }
  return b;
};
```

### 2.3 下拉（`.phoenix-select`）
```js
const sel = box.querySelector('.phoenix-select');
const trg = sel.querySelector('.phoenix-select__inputWrapper') || sel;
['mousedown','mouseup','click'].forEach(t => trg.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true})));
await sleep(700);
// 选项渲染在 body 级 portal：
[...document.querySelectorAll('.phoenix-selectList__listItem')]
  .filter(e => e.offsetParent !== null)
  .find(e => e.innerText.trim() === want)
  → 对它再发一次 mousedown/mouseup/click
```
- 长列表（籍贯/国家）可在 `.phoenix-select` 里的 `input.phoenix-select__input` 输入关键词过滤后再找。
- 校验读**显示层**：`.phoenix-select` 的 innerText（`input.value` 常为空）。

### 2.4 单选/复选（`.phoenix-radio-group__radioItem`）⚠️ 必须真实鼠标点击
```js
// 合成 click() 完全不生效（React 代理事件不认）→ 用 CDP Input 域真点
node scripts/cdp.mjs clickn <target> expr_radios.js 450
```
`clickn` 的表达式返回**元素数组**，工具会逐个 `scrollIntoView` → 重新取坐标 → 发真实鼠标点击。
- 选中态判定：`.phoenix-radio` 上有没有 `phoenix-radio--checked`。
- 本表 15 个单选：11 个合规/健康类 + 每段教育经历的「该学历是否最高学历」和「X年学制」。

### 2.5 日期（`.phoenix-select` 打开 `.phoenix-calendar` 日历 portal）
- **不能输入**：往 `input.phoenix-select__input` 写值会被清空。
- 正确顺序：`点 sel` → `.phoenix-calendar-year-select` → 年份列表 → `.phoenix-calendar-month-select` →
  月份列表 → 点 `.phoenix-calendar-date`（数字文本）。面板里还有「今天」快捷入口。
- 面板是 body 级 portal：`[...document.body.children].reverse().find(c => c.querySelector('.phoenix-calendar'))`。

## 3. 这个表单的必填坑（实战清单）

| 字段 | 说明 |
|---|---|
| 面试站点 / 意向工作地点 | 逐岗不同（可选城市随岗位变），**不要从画像推断**，当次问用户 |
| 籍贯 | 提示「精确到省/市」→ 多半是省市级联，画像只有省时会卡住 |
| 高考总分 + 语文/数学/外语单科 + 综合学科得分 | 5 个必填数字，无法推断 → 问用户 |
| 英语等级成绩 / 英语等级文件上传 | CET 分数 + 成绩单照片，必填 → 问用户 |
| 最高学历成绩单(PDF<5M) | 必填附件 → 问用户要文件 |
| 证件照 / 简历附件 | 用画像里的照片 + 简历 PDF 直接 upload |
| 学制 | 选项是 `1年/1.5年/…/5年/大于5年`（毕业时间差可推：本科4年、硕士3年） |
| 是否有联培/交换经历、高中是否获得奥赛奖励 | 事实类，简历里没有就别猜 |
| 是否服从志愿调剂 | 偏好类，别猜 |
| 绿卡国家 / 第二国籍 | 大概率条件必填（仅外籍），中国籍一般可空 |
| 合规/健康 11 项「是否有…」 | 一般是全「否」，但**必须逐条让用户确认**（本次用户答「全部否」） |

## 4. 隐私政策弹窗

进表单会弹《北森招聘门户隐私政策》，按钮「关闭 / 我同意」。
这是**法律意义上的同意** → 按铁律 1，**先问用户**（本次用户授权代点）。
它不点会一直盖在表单上（虽然不挡 JS 填值）。

## 5. 教训（下次别犯）

1. **同名多条目字段必须按「语义」定位，不能按出现顺序** ⚠️ 本人在本表上犯过：
   教育经历里 `X年学制` / `该学历是否您的最高学历` / `学习方式` / `学院名称` 会**每条教育经历重复一遍**，
   而 DOM 顺序是**硕士在前、本科在后**（不是时间顺序）。当时按 `[0]/[1]` 下标填，
   把学制填反了（硕士填成 4年、本科填成 3年）。
   正确做法：从字段向上找到**同时含「学校名称」的条目容器**，读出学校名/学历再决定值：
   ```js
   const schoolOf = box => { let n = box;
     for (let i = 0; i < 8 && n; i++) {
       const lab = [...n.querySelectorAll('.form-item__text')].find(x => x.innerText.trim() === '学校名称');
       if (lab) return boxOf(lab).querySelector('input.phoenix-input__input').value;
       n = n.parentElement; } return ''; };
   ```
2. **上传简历解析出的值必须让用户核对**：该 PDF 解析出「英语等级=四级」，用户实际是**六级（448 分）**。
   凡是解析得来的字段（英语等级/学历/起止时间…）都要在交付清单里标 `source=parse` 提醒核对，别当已确认事实。
3. **日期控件不止生日**：`发布时间`、`获奖时间`、`授权日期` 全是 `phoenix-calendar` 日历面板，
   都要走「年 → 月 → 日」三层点选；用「下拉列表」的思路去找选项会得到 0 个选项。
4. **论文 / 获奖 / 专利 / 工作经历 / 实习 区块只有一条记录**（没找到“添加”按钮，只有“添加教育经历”），
   所以只能填最重要的一条；且其中的未知细节（影响因子/期刊类型/年度期次/奖项授予单位/评选比例/
   发明人次序/专利权人）**不要编**。
5. 条件字段会一直显示为必填样式但应该留空：`奥赛奖励详细描述`（奥赛=否时）、
   `如有…请详细说明`（对应问题答“否”时）。别为了“填满”去写无关内容。
6. **动态新增条目里的输入框，`.value` + `input` 事件写不进去** ⚠️（本人在本表上踩过）：
   点「添加项目经历」新增的条条目，`setter + input/change/blur` 看似写入、一失焦就被 React 重置。
   正确做法是模拟真实输入：
   ```js
   el.scrollIntoView({block:'center'}); el.focus(); await sleep(100);
   el.tagName === 'INPUT' ? el.select() : el.setSelectionRange(0, (el.value || '').length);
   document.execCommand('insertText', false, value);   // 会覆盖选中内容
   ```
   实测：改完后 15 个项目名称/职务/描述全部稳定落库。
7. 日期控件是 **年月（月）粒度**，不要再去找“日”格子 ⚠️（本人前面写错过，此处更正）：
   项目/获奖/教育的时间都是 `YYYY-MM`；**点完月份就已经提交**，找不到 `.phoenix-calendar-date` 是正常的。
   跨年代要用「**闭环双向导航**」（实测 2019/2020 全部能写进去）：
   ```js
   for (let i = 0; i < 20; i++) {
     const h = hdr();                       // 读标题栏：{y, m}
     if (!h || !h.y || h.y === Y) break;
     const btn = p.querySelector(h.y > Y ? '.phoenix-calendar-prev-year-btn'
                                        : '.phoenix-calendar-next-year-btn');
     if (!btn) break; ev(btn); await sleep(450); p = CAL();
   }
   // 月份同理（h.m 与 M 比大小选 prev/next-month），最后点月份格子提交
   ```
   ⚠️ 坑：点一下就读标题栏会读到**滞后一帧**的值 → 会多退一年（我遇到过 3/6 条错一位）；
   所以必须比大小双向纠正，而不是“点 N 次”。
   ⚠️ 另一个坑：写完要**回读字段文本**（`字段 box 的 innerText`，或 select 里的 `input.phoenix-select__input`）——
   别再拿 `input.phoenix-input__input` 读 date/select 字段（会得到 null，让你误判“没写进去”）。
8. **同名区块的日期要按名称定位，不能按下标**：获奖/项目都是可添加的，添加后顺序会变；
   我曾按下标填日期，结果 2021-06 挂到了“数学建模”而不是“挑战杯”（串行整条）。
   正确做法：用「获奖项 / 项目名称」文本找到条目，再在其内部找「获奖时间 / 开始时间」。
9. **论文/获奖/实习区块是可重复添加的**：存在 `添加论文/专著`、`添加获奖情况`、`添加实习经历`、
   `添加项目经历` 按钮 → 别像我一开始以为“只能填一条”。
10. 项目条目重渲染后**引用会失效**：不要先拿到 entry 容器再连续写多个字段，
   要每写一个字段都从「项目名称」重新定位条目（否则会出现“只填了第一个、其余全空”）。
10. **幽灵写入（本次真实丟数据的原因）** ⚠️：在动态新增条目里写值时，如果目标节点即将被 React 重渲染替换，
   字会写进一个即将被丢弃的节点 —— 当时 `value` 读得到，但**下一次重渲染（比如再去操作日期/下拉）就被还原掉**。
   本次 15 个项目名称/描述就这样丢过两次（页面并未重载，`navType=navigate`）。
   **实测稳定、可直接照抄的写法**（写 + 校验 + 重试 + 延迟复验）：
   ```js
   const write = async (el, v) => {
     el.scrollIntoView({block:'center'}); await sleep(150); el.focus(); await sleep(120);
     el.tagName === 'INPUT' ? el.select() : el.setSelectionRange(0, (el.value||'').length);
     document.execCommand('insertText', false, v);
     el.dispatchEvent(new Event('change', {bubbles:true}));
     await sleep(300); el.blur(); await sleep(300);
   };
   for (let k = 0; k < 3; k++) {
     if (readBack(i, '项目名称') === want) break;     // ① 每个字段都重新定位、写完立即回读
     await write(elOf(i, '项目名称'), want); await sleep(400);
   }
   // ② 全部写完后等 30~60s 再整体复验一遍（丢值都是延迟后才显形的）
   // ③ 不放心时 location.reload() 再验一次
   ```
   实测：加上「回读重试 + 延迟复验」后，15 条项目名称/职务/描述 + 6 条获奖日期全部稳定（含之前反复掉的 4 条）。

## 6. ⚠️ 本表单的两个致命特性（数据为什么会“又没了”）

### 6.1 它**不自动保存**
实测（挂 fetch/XHR 钩子后改字段）：**改完一个字段后 0 个网络请求**。
→ 所有值只活在页面内存里，**任何刷新/关页/切换会话都会丢**（除非站点在“下一步/提交”时才落库）。
→ 所以：要么填完立刻让用户提交，要么接受“重进页面要重填”。不存在“草稿”。

### 6.2 `DOM 写入 ≠ 站点状态`
| 写法 | 能改 DOM？ | 进 React state？ | 重渲染后 |
|---|---|---|---|
| `el.value = v` + `input` 事件 | ✅ | ❌ 经常不进 | **被还原** |
| `document.execCommand('insertText')` | ✅ | ❌ 经常不进 | **被还原** |
| **CDP `Input.dispatchKeyEvent` 逐字符** | ✅ | ✅ | **能存活**（实测重渲染 + 30s 后仍在） |

### 6.3 真实键盘输入的三个前提（少一个就会害人）
1. **目标页必须在浏览器前台** → 先 `Page.bringToFront`（`cdp.mjs` 现已在 click/seq/type 里自动做）。
2. **聚焦要真的落上**：JS 的 `el.focus()` 会被 React 重渲染打断（节点被换掉）→ 必须用**真实鼠标点击**聚焦，
   并**校验 `document.activeElement` 的 rect 与目标 rect 一致**（±3px）才继续；否则**直接放弃**。
   ⚠️ 本人踩过：因为没校验，按键全部打到“上一次成功聚焦的框”，
   把 **2700+ 字符串进了一个项目名称框**（比留空更糟）。
3. **清空要用 Ctrl+A**（先发 `rawKeyDown` `a` + `modifiers:2` 再发字符），不要只依赖 JS 的 `select()`。

### 6.4 推荐执行顺序（避免索引漂移）
1. **先只填“名称”字段**（名称是唯一键），每填一个就回读校验；
2. **再按名称定位**去填描述/日期等其余字段；每次都要重新定位（列表会重渲染）；
3. 最后**回读 + 等 30~60s 再回读**（丢值都是延迟后才显形），有条件就 reload 再验。

## 7. 检查清单

1. 上传简历 → 解析预填
2. 按 label 补齐文本（英文名/证件号码/学院名称…）
3. 日期用 phoenix-calendar 三层点选
4. 下拉用 `.phoenix-selectList__listItem`
5. **单选一律走 `clickn`（真实点击）**，并回读 `--checked` 验证
6. 文件用 `cdp.mjs upload`
7. `dump2.js` 式的按 label 快照做校验（别用通用扫描器）
8. **提交按钮永远留给用户**
