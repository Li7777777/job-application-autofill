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

## 6. 检查清单

1. 上传简历 → 解析预填
2. 按 label 补齐文本（英文名/证件号码/学院名称…）
3. 日期用 phoenix-calendar 三层点选
4. 下拉用 `.phoenix-selectList__listItem`
5. **单选一律走 `clickn`（真实点击）**，并回读 `--checked` 验证
6. 文件用 `cdp.mjs upload`
7. `dump2.js` 式的按 label 快照做校验（别用通用扫描器）
8. **提交按钮永远留给用户**
