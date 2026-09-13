# adapter: sokon.zhiye.com（赛力斯校招 / 北森「门户 2022」+ phoenix）

> 实测 2026-09-13（岗位 jobAdId `aa9d021d-4f2f-4508-9da4-310ede92824a`，`/form` 全流程 + 26 个必填填完）。
> **同族站点见 `cxmt.zhiye.com.md`**（同一套「门户 2022」+ phoenix + `.form-item--phoenix` + div 版单选 + `.phoenix-calendar`）。
> 本文档**只写差异与新增结论**；两站相同的部分（URL 地图无 apply 直链、必须点「立即投递」、三层字段结构、
> `.phoenix-selectList` 选项类名、`.phoenix-calendar` 年→月选择、隐私政策弹窗、日期是年月粒度、
> `DOM 写入 ≠ 站点状态`、空弹层可见性过滤等）一律以 cxmt 那份为准，不复述。

## 0. 一句话差异表（sokon vs cxmt）

| 维度 | cxmt | **sokon（本站）** |
|---|---|---|
| 必填标记 | 启发式 + 「必填」字样 | **`.form-item__title > a.form-item__required`**（`<i class="icon-cus-bitian">`）→ 100% 可靠，别用启发式 |
| 写值成功率最高的一招 | 真实键盘 `Input.dispatchKeyEvent`（逐字符） | ⭐ **字段组件 fiber 上的 `onChange({text, value})`**（见 §2）——比点选/键盘都稳 |
| div 版单选 | `cdp.mjs clickn` 真实点击 radioItem | **同样必须真实点击**（合成事件无效）；但**改值更稳的方式也是 §2 的 onChange** |
| 民族（`.list-data-container`） | 可点选 | ❌ **点文字/图标都无效**（`isForbidExpand=true` 短路、icon 无 handler、`onChangeCheck` 也不落值）→ 只能 §2 |
| 省市区（`.area-data-container`） | 省市级联，点选 | ⚠️ **只有下钻能点、叶子点了不落值** → 逐级点下钻收集 id，再用 §2 写值 |
| 草稿持久化 | 「草稿会持久化」（部分） | ❌ **不存服务端草稿**：另开同 URL 新标签页 = 除账号手机号外全空（实测 2 次） |
| 通用扫描器可用性 | 会误判（作者已列出 3 处） | **误判 7 处**（见 §1），必须用 §1 的站点专用扫描器 |

## 1. `10_scan_form.js` 在本站的 7 处失灵（必须用站点专用扫描器）

1. 页头搜索框 → 被当成"搜索职位关键词"（还标成必填/medium）
2. `+86` 区号 → 被当成独立 text 字段
3. textarea 的 `0/2000` 字数计数器 → 变成字段名（placeholder 兜底取到 bottomBar）
4. 「学校名称」是 `.phoenix-auto-complete-container` → 字段名变成 `请输入`（low 必填误报）
5. **`span>div` 版单选（性别/婚否/是否接受岗位调剂）完全扫不到**（页面没有 `input[type=radio]`）
6. 所有 `.phoenix-select`（下拉/日期/级联）→ 字段名一律变成 `请选择`（placeholder），字典/记忆匹配全废
7. `summary.multiBlock = 0`（教育经历两条记录识别不出来）

**站点专用扫描器配方**（本次实现见 `data/runs/sokon.zhiye.com-scan.js`，脚本内不要读本地文件）：
```
① 逐块遍历  .form-item.form-item--phoenix（DOM 顺序 = 视觉顺序）
② label     = box.querySelector('.form-item__text').innerText（叶子，精确）
③ required  = !!box.querySelector('.form-item__required')  → confidence high
④ kind：box 里有 .phoenix-radio-group → radio-group；input[type=file] → file；
        textarea → textarea；.phoenix-select 且 label 含 日期|时间 → date-picker；
        否则 .phoenix-select → custom-select；否则内部 input → text
⑤ section   = heads = [id*="_Recruitment_"]（文字≤20、不含 .form-item、可见），
              用 compareDocumentPosition 取「控件之前最近的一个」
              ⚠️ 该选择器也会命中 `..._addButton`（"添加教育经历"），它排在区块字段之后，不影响"取前一个"
⑥ block     = 同区块内**字段名重复出现的序号**；仅当该区块出现重复才启用，否则 -1
              （教育经历 7 个字段各出现 2 次 → block 0/1；实习/在校职务/获奖等单段 → -1）
⑦ 若要把 uid 写进 DOM 给 20_fill.js 用：同时给「容器 .phoenix-select」和「内部 input」打同一个 uid 会让
   querySelector 命中容器；本站自己写填充器时**按 .form-item 反查**最省事
⑧ 生成 scan.json 后**手工消歧同名 labelNorm**：教育经历区块内 开始时间→入学时间、结束时间→毕业时间
   （否则 40_build_mapping 会把它们匹配到 experience.start/end → 误报"必填缺值"）
```

## 2. ⭐ 核心写值配方：字段组件 fiber 的 `onChange({text, value})`

本站每个字段最终都挂在一个"字段组件"上，其 props 含 `cmp_name / cmp_label / cmp_data / validators / onChange`。
`onChange` 的实现是 `function(t,n){a.handleChange(s,t,e,n)}` → **公开调用形式就是 `onChange({text, value})`**。

```js
// 从任意控件元素向上找字段组件
const anchor = box.querySelector('.phoenix-select') || box.querySelector('.phoenix-radio-group') || box.querySelector('input,textarea');
const k = Object.keys(anchor).find(x => x.startsWith('__reactInternalInstance') || x.startsWith('__reactFiber'));
let f = anchor[k], fc = null;
const label = box.querySelector('.form-item__text').innerText.trim();
for (let i = 0; i < 45 && f; i++, f = f.return) {
  const p = f.memoizedProps || {};
  if (p.cmp_name && p.cmp_label === label && typeof p.onChange === 'function') { fc = p; break; }
}
fc.onChange({ text: '汉族', value: '1' });   // 写进 React state
```

实测各控件形态的调用（README：**value 必须是页面选项自己的 code/id，不是文本**）：

| 控件 | 调用 | value 怎么拿 |
|---|---|---|
| text / textarea | `onChange({text:'李昊田', value:'李昊田'})` | 同 text |
| div 版单选 | `onChange({text:'是', value:'1'})` | 从 `.phoenix-radio` 元素向上读 fiber 的 `props.value`（男=0/女=1/保密=2；是=1/否=0） |
| 日期（`.phoenix-date-picker`） | `onChange({text:'1999-09-02', value:'1999-09-02'})` | 同 text；**年月粒度控件传 `2024-09` 即可，不用碰日历** |
| 普通下拉 `.phoenix-selectList` | `onChange({text:'共青团员', value:'x'})` | 开面板 → 目标项 label 元素向上读 fiber `props.data` → `data.code` |
| `.list-data-container`（民族） | 同上 | 同上（`data.code`） |
| `.area-data-container`（省市区） | `onChange({text:'山西省,晋中市,平遥县', value:'140000,1407,140709'})` | **逗号连接**；逐级点下钻并记录每级 `data.id` |
| **多选**省市区（期望工作城市） | `onChange({text:'上海市', value:'3100', textlist:[{value:'3100',text:'上海市'}]})` | 同上；**多选必须带 `textlist`**，否则模型收了值但显示层（标签）不渲染 |
| **多选**显示层 | 值渲染成 `li.phoenix-select__tagItem > span.phoenix-select__tag`，**`.phoenix-select__calcEle` 是空的** | 回读/校验要读 `.phoenix-select__tag`（否则会误报"没填进去"） |

读值（本站正确读法，供 dump_state / verify 使用）：
```
radio-group → box 内 .phoenix-radio--checked 的那个 .phoenix-radio__radio-text
custom-select/date → 先 [.phoenix-select__tag]（多选标签，join ','）→ 再 .phoenix-select__calcEle → 再 placeHolder(排除"请选择")
file → input.files[].name
text/textarea → input.value
```
⚠️ 通用 `15_dump_state.js` 在本站会**读不准**（实测）：radio 值读成空、多选读成空、file 读成 `C:\fakepath\...`。
→ 用 `data/runs/sokon.zhiye.com-dump-state.js` 那套读法。

## 3. 弹层行为（决定"能不能靠点选"）

| 弹层 | 出现于 | 结论 |
|---|---|---|
| `.phoenix-selectList` | 政治面貌/最高学位/学历/学习形式/培养方式/期望从事职业/期望月薪/获奖级别/语言类型/掌握程度… | ✅ 真实鼠标点 **`.phoenix-selectList__listItem` 内的 `.phoenix-selectList__singleLabel`** 即选中并关面板（实测）。<br>⚠️ 点 `listItem` 本身（中心点）可能落在图标区 → 不生效；`clickn` 必须返回**内层 label 元素**。<br>⚠️ 面板里有搜索框（`.phoenix-selectList__searchWrapper input`），长列表可先输入过滤；列表是"虚拟列表"但通常是全渲染（可用 holder 高度 ÷ 单项高度估总数）。 |
| `.list-data-container` | **民族**（仅此一个） | ❌ 点文字/图标都不落值：label onClick 源码是 `if(!isForbidExpand && onClickLabel) …`，实测 `isForbidExpand=true` → 短路；`.icon-container` 上没有 onClick；直接调组件 `onChangeCheck(data)` 也不落值 → 只能 §2 |
| `.area-data-container` | 籍贯 / 现居住地 / 期望工作城市 | ⚠️ 点击省 → 下钻出市列（有效）；但**叶子节点 `status===NoChild` 同样短路**、icon 无 handler → 逐级点下钻收集 `data.id`，最后用 §2 提交 |
| `.phoenix-date-picker`（内含 `.phoenix-calendar`） | 出生日期 / 起止时间 / 获奖时间 / 获得时间 | 日历可点（年面板 `.phoenix-calendar-year-panel-year` → 月面板 → `.phoenix-calendar-date`，头部 `.phoenix-calendar-year-select` / `.phoenix-calendar-month-select`，翻页 `prev/next-year|month-btn`）；但 §2 直接写值更快更稳 |

## 4. 上传（本站有 3 个 `input[type=file]`）

| index | 位置 | 作用 |
|---|---|---|
| `[0]` | 页顶「上传简历」解析区（拖拽/点击上传） | **只有它触发一键解析预填**（本例解析出 姓名/邮箱/性别/最高学位 + 2 段教育）；不显形也能用 `DOM.setFileInputFiles` 直接设 |
| `[1]` | 个人信息·证件照 | 限图片 accept |
| `[2]` | 简历附件 | 纯附件，**不解析** |

- ⚠️ 顺序：**先 `[0]` 触发解析，再传 `[1]/[2]`** —— 传 `[0]` 会**清空**已选的"简历附件"。
- ⚠️ `node scripts/cdp.mjs upload <id> <expr> <file>`：第 3 个参数是**文件路径**；多写一个数字会被当成第二个文件（踩过）。
- ⚠️ 附件在**刷新/换页后丢失**（本站不存服务端草稿 → 连正文一起丢）。

## 5. 本站特有的坑（新增）

1. **后台标签页里 `setTimeout` 被冻结 → 含 `await sleep()` 的脚本永久挂起**
   症状：`cdp.mjs eval`（脚本里有 await）一直不返回，直到自设 timeout 报 `rpc timeout … Runtime.evaluate`；同步脚本却正常。
   解法：跑异步脚本前先 `node scripts/cdp.mjs front <id>`（bringToFront）。本次先后踩 2 次。
2. **开弹层会把字段本身盖住、并触发页面滚动** → `scrollIntoView` 后再取坐标仍可能点空；
   `cdp.mjs type` 会报 `focus landed elsewhere`。
   解法：每次交互前 `Escape + body.click` 关干净（以 `visiblePanels().length === 0` 为前置断言），
   并且"取坐标 → 点击 → 回读"分多次调用（每次自己重新取坐标）。
3. **`.phoenix-select` 的合成 `mousedown/mouseup/click` 能开面板**（开面板不需要真实点击），
   但**选中选项、div 单选必须真实鼠标**（`cdp.mjs clickn`）。
4. **`input[data-jaa-uid]` 同 uid 出现在"容器 + 内部 input"两处**时，`querySelector` 命中的是容器 →
   自写填充器请从 `.form-item__text` 反查字段块，或先 `[data-jaa-uid="x"]` 再 `closest('.form-item')`。
5. **改值后浏览器不做任何自动保存请求**：本站草稿既不在服务端，也不落 localStorage → 值只活在当前页内存。
6. 富文本/长文本用 §2 的 onChange 一次写入即可，**不需要** cxmt 那套 `execCommand('insertText')` 反复重试
   （本站没有 cxmt 的"幽灵写入"问题；反而 `execCommand` 不触发 React 的 onChange）。
7. 用 fiber 读字段模型还能顺手拿到**站点自己的校验规则**（`props.validators`：`presence/format/email/length/numericality`
   + 中文提示原文）→ 交付前可以逐条对照"站点会怎么拦"，比猜校验有用。

## 6. 检查清单（sokon 版）

1. `cdp.mjs clickn` 真实点「立即投递」→ 确认落在 `/form?fromPage=job&jobAdId=…&userId=…`
2. `cdp.mjs front`（必做，否则后面异步脚本全挂）
3. 上传简历到 `input[type=file][0]` → 等 15~30s → 回读解析预填
4. 跑站点专用扫描器 → `-scan.json`（并手工消歧教育经历的 开始/结束时间 → 入学/毕业时间）
5. probe 真实选项（`20_fill.js` + `probeOptions:true`；`.area-data-container` 的省列表要另补）
6. `40_build_mapping.py --scan --probe [--answers]` → mapping + todo
7. 用 §2 的 `onChange({text,value})` 批量写值；能点选的（`.phoenix-selectList`）优先真实点击并回读
8. `cdp.mjs upload` 传证件照 + 简历附件
9. 站点专用 dump（§2 的读值表）→ `30_verify.py`
10. **提交/暂存按钮永远留给用户**；并明确告知：**刷新即丢**（本站无服务端草稿）
