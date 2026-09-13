# adapter: wecruit.hotjob.cn（ATL新能源 / 北森系 hotjob 门户）

> 实测于 2026-09-13/14，站点 = **hotjob（前程无忧系）托管门户 + 底层 antd v3**。
> 岗位详情：`/SU<code>/pb/posDetail.html?postId=<postId>&postType=campus`
> 简历/申请表：`/SU<code>/pb/resumeOperation.html?tid=…&recruitType=1&pid=<postId>&qTid=…&lang=1[&resumeId=…]`

## 1. 流程地图（关键！进阶顺序不是普通 ATS）

```
职位详情页  →  点 [button.deliver]「立即投递」（真实鼠标点击）
            →  弹 ant-modal「申请职位」：
                 · 「当前【2027届秋季校园招聘】项目下最多可投递2个职位」
                 · 「当前职位投递要求：中文简历完整度达到100%。」
                 · 简历为空时：resumeEmpty + 只给一个按钮「创建完整简历」
                   （简历未满 100% 时没有可投的按钮 → 想投必须先补简历）
            →  点「创建完整简历」→ **window.open 新标签页** resumeOperation.html
            →  在简历页填到 100% → 回到详情页点「立即投递」才是真正的提交（⛔ 不由 agent 点）
```

- **没有 apply 直链**：`resumeOperation.html` 必须由「创建完整简历」带参数打开（`tid/pid/qTid/resumeId`，`resumeId` 是服务端建的简历 id）。
- **一份简历服务本项目所有职位**：投第二个职位复用同一份简历（所以只需建一次）。
- **没有「志愿顺序 / 第一志愿」控件**（全页文本搜「志愿」为空）；志愿 = 投递职位的先后，最多 2 个，最后提交时由站点记录。
- 简历页是**单页长表单**（10 个 `.form-cell` 区块 + 左侧 `.ant-anchor-link-title` 锚点导航），不是分步向导 → **一次扫描即可**，无需每步重扫。

### 1.1 「完整度」与「保存」（实测 2026-09-14）

- **完整度只按必填字段算**，显示在编辑视图左上角「简历完整度 N%」：空简历 0% → **上传简历自动解析后 43%**
  → 填完所有能确定的字段 82%（缺 3 个校区 + 本科年级排名 + 2 个口语能力 + 成绩单）→ 补齐后 **100%**。
- 页面**不会自动存**：编辑视图里的值只在 React state 里，**必须点底部的全局「保存」**才会落库。
  - 页面上有 **10 个「保存」按钮**：每个区块各 1 个 `.ant-btn.save-btn.form-list-save-btn`（默认 `offsetParent === null`，hover 才显形）
    + 底部 1 个全局 `.ant-btn`（`offsetParent !== null`）。要保存就点**唯一可见的那个**：
    `[...document.querySelectorAll('button.ant-btn')].filter(b => b.innerText.trim() === '保存' && b.offsetParent !== null).pop()`
  - ⚠️ 每个「保存」旁边就是「**清空**」——**别点错**（一次清空一个区块）。
  - ⚠️ 「保存」**不是提交投递**（`SUBMIT_RE` 里没有「保存」），但也别频繁点；点一次即可。
- 点「保存」后页面会**切换成服务端渲染的只读摘要视图**（"编辑简历" + 逐字段「字段名：值」列表，证件号码显示为 `******`），
  底部两个按钮：**「编辑」/「立即投递」**。这个摘要视图是**验证「值真的落库了」的最佳证据**（比任何 DOM 回读都硬）。
  点「编辑」可回到可编辑表单（完整度显示 100%）。
- 右侧/底部的「立即投递」在这两个视图里都会出现 → **agent 一律不点**。

## 2. 结构：扫描器踩的坑（本页必看）

```
.form-cell#11 个人基本信息        ← 区块（id 是数字：#11/#12/#14/#123/#40/#20/#15/#45/#43/#18）
  └ .ant-row.ant-form-item        ← 字段容器（group_class 用 .ant-form-item 就行）
      ├ .ant-form-item-label > label   ← 真实字段名（如「国籍/地区*」）
      └ .ant-form-item-control
          ├ input.ant-input                                ← 文本
          ├ .ant-select > .ant-select-selection > .ant-select-selection__rendered
          │     ├ .ant-select-selection__placeholder       ← 「请选择国籍/地区」
          │     ├ .ant-select-selection-selected-value     ← 选中值（**与搜索框是兄弟**）
          │     └ .ant-select-search > .ant-select-search__field__wrap > input.ant-select-search__field
          ├ .ant-calendar-picker > input.ant-calendar-picker-input (readonly)
          ├ .ant-radio-group > label.ant-radio-wrapper > input.ant-radio-input(value=0/599/604)
          └ input[type=file]（藏在 .ant-upload-drag / .ant-upload-select 里）
```

### 2.1 扫描器在本站的 3 个系统性失灵（已在脚本里修，勿回退）

| # | 症状 | 根因 | 修法（已提交进 `10_scan_form.js`） |
|---|---|---|---|
| 1 | 所有 `ant-select` 的 `label` 变成 placeholder（「请选择国籍/地区」） | `labelCandidates` 的 `level2_class` 向上只找 4 层，`.ant-select-search__field` 到 `.ant-form-item` 要 5~6 层 → 只能回退到 placeholder；且 `fieldTitle()` 的占位符黑名单是**整串正则** `/^(请选择\|请选\|…)$/`，匹配不上「请选择国籍/地区」 | `fieldTitle()` 改成**前缀**匹配 + 跳过 `[class*=placeholder]` 节点 + 排除当前选中值节点（`displayValueNode`） |
| 2 | 扫描/回读时 `ant-select` 的值永远读成空 | antd v3 的 `.ant-select-selection-selected-value` 与 `input` 是**兄弟**（分别在 `__rendered` 与 `search__field__wrap` 里），旧 `readDisplay` 只在 `el.parentElement` 里找 | 新增 `displayNodeIn(el, sels)`：沿祖先找 ≤6 层（遇到 `.ant-select` 等控件根就停），跳过 placeholder 节点与「请选择…」文本；`10_scan_form.js` / `15_dump_state.js` / `20_fill.js` 三处同步 |
| 3 | 下拉全部报「点开后没读到任何可见选项」 | `openPanel()` 里 `const optSel = '(' + optionSel + '),' + OPT_PROBE_SEL` —— **带括号的选择器列表在 `querySelector` 里是语法错误** → `hasOpts()` 恒为 false → 永远找不到面板 | 去掉括号：`optionSel + ',' + OPT_PROBE_SEL` |

| 4 | 控件内层嵌套深（`input` 距 `.ant-form-item` 6~7 层）→ `level2_class` 的 4 层向上循环够不到 label | 同上（不同触发点） | `labelCandidates` 增加 **`level2-in-group`**：先 `el.closest(group_class)` 再在其中查 `level2_class` 的候选（本次实测：加上后 74 个字段 **`noLabel: []`**，全部字段名原生正确） |

> ⚠️ 本站会**把全部 26+ 个 `.ant-select-dropdown` 预渲染在 DOM 里**（只有当前打开的那个不是 `-hidden`）。
> 因此判定「面板」必须用 `:not(.ant-select-dropdown-hidden)` + 可见性，并取**离触发元素最近**的那个（`nearestPanel` 已这么做）。

### 2.2 手动定位字段的可靠写法（通用扫描器失灵时的兜底）

```js
const items = [...document.querySelectorAll('.ant-form-item')];      // 顺序 = 页面顺序
const labelOf = it => (it.querySelector('.ant-form-item-label')?.innerText || '').replace(/\s+/g,' ').trim();
// 例：学校/学历/第一专业 在 DOM 里成对出现（显示值 div + 隐藏 id input），
//     「所在校区」是纯文本 input，不要当 autocomplete 去开下拉。
```

## 3. 控件配方

### 3.1 下拉（antd v3 single select）
```js
// 开：点 .ant-select（不是点 input！）；面板: .ant-select-dropdown:not(.ant-select-dropdown-hidden)
// 选项: li.ant-select-dropdown-menu-item（37 个省份一次全渲染，无虚拟滚动）
const trg = input.closest('.ant-select');
trg.dispatchEvent(pointerdown/mousedown/mouseup/click 带坐标);   // 合成 click 也能开，但 clickReal 更稳
[...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) li.ant-select-dropdown-menu-item')]
  .find(o => o.innerText.trim() === '辽宁省')                     // 精确匹配才点
```
- **省/市级联（学校所在城市 / 籍贯）**：一个 form-item 里 **2 个独立 `.ant-select`**（省 → 市），市的下拉要**先选省**才有选项：
  - 辽宁省 → `沈阳市/大连市/鞍山市/抚顺市/本溪市/丹东市/锦州市/营口市/辽阳市/铁岭市/葫芦岛市/盘锦市/朝阳市/阜新市/其它`
  - 山西省 → `太原市/大同市/临汾市/运城市/长治市/晋城市/阳泉市/朔州市/晋中市/忻州市/吕梁市/其它`
  - 注意：`data-jaa-uid` 只标在每个 `.ant-select` 的**内部 search input** 上，且无 label（`labelNorm` 为空）→ 按 `siteSubIndex`(0=省,1=市) 区分，建议在 scan 里改名成 `（省）/（市）`。
- **学校 / 第一专业 / 专业**：是「输入框 + 服务端字典」型（`.ant-input` 或 `.ant-select-search__field`），**必须先输入关键词**再选：
  - 打开时列表可能只给已选中的那一条（实测 `大连海事大学` 只读到 1 个选项）；
  - **不要清空重填**：站点「上传简历」解析后会把 `学校` 的显示值 + 隐藏 id（如 `0/20000/20001/20007/20437`）配对好，重填会破坏 id 绑定；
  - `probe` 只采到字典**前 100 项**（`maxOptionScan`），所以 `第一专业/学校` 的选项闸门会误报「值不在选项里」——这类字段以**页面显示值**为准。

### 3.2 日期（antd v3 `.ant-calendar`，**年月日**粒度，只读框）
```js
// 打开：click input.ant-calendar-picker-input → 面板 .ant-calendar
// 年：click .ant-calendar-year-select → 面板 .ant-calendar-year-panel-cell(文本=年份) → 点目标年
// ⚠️ 点完年份会**回到日面板**（不是月份面板）！
// 月：必须再 click .ant-calendar-month-select → .ant-calendar-month-panel-month
//     月份格子文本是**中文数字**「一月…十二月」（不是「1月」）
// 日：click .ant-calendar-date（文本=日号），排除 last-month/next-month/outside/disabled
```
- 已修进 `20_fill.js → calendarPick()`：`state==='month'` 且月份格子不可见时，先看头部月份；不是目标月就**点一次 `cfg.monthConfig`（`.ant-calendar-month-select`）**展开月份面板，再选月。
  （修之前：`1999-09-02` 被写成 **`1999-01-02`** —— 月份没选成、直接点了日号。）
- 站点自己的日期格式：`YYYY-MM-DD`，且**用简历解析预填的日期都是 `-01`**（如毕业时间 `2027-06-01`）。这是站点行为，不是我造的精度；保持原样即可（幂等判定按数字前缀比较，`2027-06` 与 `2027-06-01` 相容）。

### 3.3 单选（性别 / 是否接受调剂）—— 扫描器登记不到，必须真实点击
```html
<label class="ant-radio-wrapper"><span class="ant-radio"><input type="radio" class="ant-radio-input" value="0/599/604">
  <span class="ant-radio-inner"></span></span><span>男</span></label>
```
- 用 `node scripts/cdp.mjs seq <id> steps.json 900`，步骤表达式：
  `[...document.querySelectorAll('.ant-radio-wrapper')].find(e => e.innerText.trim() === '男')`
- 选中态判定：`.ant-radio` 上有 `ant-radio-checked`。
- ⚠️ 扫描器把它们标成 `data-jaa-uid` 为空（只登记了 `input[type=radio]` 两个 hidden input，未成为字段）→ 不在 MAPPING 里，别指望 `20_fill.js` 填。

### 3.4 文件上传（4 个 `input[type=file]`，全部 `offsetParent === null`）
| index | 字段 | 说明 |
|---|---|---|
| 0 | 上传简历（拖拽区 `.uploadDragResume`） | **先做这一步**：`DOM.setFileInputFiles` 后站点自动解析并预填（本次 43%） |
| 1 | 成绩单 * | 必填 |
| 2 | 简历附件 * | 必填（我用同一份 PDF） |
| 3 | 照片（证件照） | `accept="image/jpeg,"`，站点解析简历时已自动带出 `PIC_1_Im0.jpg` |

```bash
node scripts/cdp.mjs upload <id> expr_input.js "C:\...\<简历>.pdf"   # 第三个参数是文件路径
```
- 上传后该 `<input>` 会被 React 重渲染替换 → **`data-jaa-uid` 标记会消失**（`15_dump_state.js` 里该 uid 直接不见了），验证时按表单块文本核对（如 `简历附件* <简历文件名>.pdf`）。
- 上传简历解析会「顺手建条目」：本次自动新增 **2 条教育经历 + 2 条语言能力(CET-4/CET-6) + 3 条项目经验**（项目描述很长，来自 PDF）。

## 4. 这个表单的必填清单（实测）

个人基本信息：`姓名 性别 国籍/地区 民族 证件类型 证件号码 出生日期 学校所在城市(省+市) 籍贯(省+市) 移动电话 电子邮箱 最高学历 毕业院校 毕业时间 最高学历毕业院校所在校区 专业 是否2027届应届毕业生 招聘信息来源渠道 是否接受调剂 GPA绩点 成绩单* 简历附件*`
教育经历（每段）：`学校 学历 所在校区 开始时间 结束时间 学习形式 院系 第一专业 年级排名`
语言能力（每条）：`证书等级(语种+证书) 口语能力`
选填：`婚姻状况 紧急联系方式 照片 评价内容 专业描述 专业课程 研究课题 项目结束时间 项目职责 CET-4 得分`

- 「是否接受实习」在本站**不存在**（别去找）。
- `专业描述` 是站点解析写进去的（`成绩:4.1/5 排名:1/22 证书:CET-4 CET-6 …`），无 label 必填标记，别覆盖。
- 「口语能力」虽然提示「仅为个别有语言能力要求的岗位做参考」但**带 `*`**，必须问用户。
- 「招聘信息来源渠道」12 个选项里，**没有「公司官网」字样** → 用户的「公司官网」= `企业官网/微信公众号`。

## 4.1 本轮回填实战补充（2026-09-14 第二轮）

- **自由文本字段（校区）写入**：`nativeSetter + input/change/blur` 一次同步搞定，回读 `el.value` 一致；
  不需要 `execCommand`，也没有 phoenix 那种幽灵写入。
- **同一个页面可以同时开两个 `.ant-select-dropdown`**（合成点击不会触发 antd 的 outside-click 关闭）：
  我第一次连续选 f69/f73 时，第 2 次的面板查找到的是**第一个面板里已经被选过的那个同文本选项** → 点了个空。
  正确做法：**在离触发元素最近的那个可见面板里找选项**（`nearest` 面板，按 rect 中心距），或者每次选完先
  在 `document.body` 上派发 `mousedown/mouseup/click` 把面板关掉。
- **文件字段按 label 定位**（上传后 `data-jaa-uid` 会被 React 换掉，uid 不再可靠）：
  ```js
  [...document.querySelectorAll('input[type=file]')].find(el => {
    const it = el.closest('.ant-form-item'); const lab = it && it.querySelector('.ant-form-item-label');
    return lab && lab.innerText.includes('成绩单');
  })
  ```
  上传后用 `form-item.innerText` 回读文件名（`成绩单* transcript.pdf transcript.pdf`）。
- **`15_dump_state.js` 对本站 file 字段会报「必填附件未上传」**：HTTP 上传走站点自己的链路，
  `input.files.length` 一直是 0、`data-jaa-uid` 也会被重渲染抹掉 → 以**表单块文本 + 保存后的摘要视图**为准。
- **`30_verify.py` 对 `学校 / 第一专业` 会报「值不在页面选项里」**：这两个是服务端字典（`probe` 只采到前 100 项，
  `maxOptionScan` 截断），且值是**站点解析预填**的 → 属误报。
- **重扫会丢 `data-jaa-*` 标记**：React 一重渲染（点保存、切编辑视图）那些属性就没了 →
  `15_dump_state.js` 返回 0 个字段、`30_verify.py` 会「假绿」。**下结论前先重跑一次 `10_scan_form.js`。**

## 4.2 可重复条目（项目经验 / 实习经历 / 奖励活动…）怎么加行、怎么填

「项目经验」区块的结构与配方（本轮实测为 3 → 15 条）：

```html
<div class="form-cell" id="40">                    <!-- 区块：⚠️ id 是纯数字 -->
  <div class="tit-wrap">…项目经验…</div>
  <div class="form-cell-right">
    <div class="form-cell-inner">                  <!-- 一行 = 一个 .form-cell-inner -->
      <div id="40_206_0">
        <div class="ant-row ant-form-item">…开始时间…</div>   <!-- 只读 antd 日历 -->
        <div class="ant-row ant-form-item">…结束时间…</div>
        …项目名称(input) / 项目描述(textarea) / 项目职责(textarea)
      </div>
    </div>
    …（每行一个 .form-cell-inner）…
    <div class="add-more"><div class="add-more-btn">添加新的项目经验</div></div>
  </div>
</div>
```

- **⚠️ 区块 id 是纯数字，CSS 里必须写 `[id="40"]`，不能写 `#40`**（`#40 .add-more` 是**非法选择器**，
  `querySelector` 直接抛 `SyntaxError`；`cdp.mjs seq` 只会报 `no-rect`，很容易误判成「元素不可见」）。
- **行定位（千万别按下标猜语义）**：`[...document.querySelectorAll('[id="40"] .form-cell-inner')]` →
  行内按 `placeholder` 找控件，最稳：
  `row.querySelector('input[placeholder="请选择开始时间"]')` / `input[placeholder="请填写项目名称"]` /
  `textarea[placeholder="请填写项目描述"]` / `textarea[placeholder="请填写项目职责"]`。
- **加行**：对 `[id="40"] .add-more` 连点 N 次（真实鼠标点击，每次点完等 ~1s）；点完 `nInners` 从 3 → 15。
  **先把行加满、再填内容**（避免「填一行 → 加一行」时前一行被重渲染）。
- **文本字段**：`nativeSetter + input/change/blur` 一次同步写入即可，`textarea` 里的 `
` **能保留**
  （回读 `value.length` 与换行数完全一致）；本站没有 phoenix 那种幽灵写入（延迟复验后仍在）。
- **日期（开始/结束时间）**：走 §3.2 的三步（年 → ⚠️再点 `month-select` → 日），一年一个月一天共 3 次点击；
  写不进去就按「失败」报，别猜。
- **⚠️ 站点校验：结束时间必须「晚于」开始时间**。实测：`开始=2020-09-01` 时点「2020 年 9 月 1 日」**写不进去**
  （输入框仍为空、单元格不选中），改成 `2020-10-01` 立刻成功。同月视为不合法 → 遇到「起止同月」的数据要**如实上报**，
  不要偷偷改成下个月。
- **清除一个已填的日期**：`input` 同级的 `i.ant-calendar-picker-clear`（`opacity: 0`，鼠标 hover 才显形，
  但坐标点击有效）→ 真实点击它即可清空（回读 `value === ''`）。

## 5. 教训 / 坑

1. **后台标签页会「假死」**：Chrome 对被遮挡/后台的标签页会**挂起 requestAnimationFrame** 并节流 `setTimeout`
   （intensive throttling → 1 个定时器/分钟）。症状有二：
   ① 页内脚本 `await sleep()` 变成分钟级（一次 `eval` 跑 600s 都跑不完，且**超时后页内 async IIFE 还在继续跑**——
   我第二次填充就是这样"超时"后自己完成的，别急着重跑，先回读）；
   ② **antd 下拉/日历面板根本不渲染**（`seq` 点开 trigger 后 `no-element`，等 4s 也没面板）。
   `Page.bringToFront` **不够**（窗口被遮挡/最小化时 `document.visibilityState` 仍是 `hidden`）。真正的解法：
   ```js
   await rpc(sock, 'Page.setWebLifecycleState', { state: 'active' });
   await rpc(sock, 'Emulation.setFocusEmulationEnabled', { enabled: true });
   // 校验：Runtime.evaluate → document.visibilityState === 'visible' && document.hasFocus() === true
   ```
   已加进 `scripts/cdp.mjs wake <id>`（本 skill 自带）。**交互式长脚本前先 `wake`。**
2. **页面里的异步填充脚本杀不掉**：`Runtime.evaluate` 超时只是 Node 侧断开，页内 promise 继续执行。超时后别急着重跑，先 `ex_inventory.js` 回读现状，避免重复点击。
3. **弹层不会自动关**：Esc 关不掉 `.ant-select-dropdown`；要 `document.body` 上派发 mousedown+mouseup+click 才关。连续填多个下拉时，上一个没关会污染下一个的面板判定。
4. **简历「完整度」是站点算的**：本地这份简历 43% → 82%（我填完能确定的全部字段后）。缺的 18% 就是 QUESTIONS.md 里那 4 组（校区×3 / 本科年级排名 / 口语能力×2 / 成绩单）。
5. **不要清空已由解析预填的字段**（学校/专业/第一专业/项目名称/项目描述）：值 + 隐藏 id 是配对的，重填会破坏绑定或触发 React 重渲染丢数据。
6. **草稿持久化**：解析后的简历存在服务端（URL 里出现了 `resumeId=`），刷新页面内容还在；但**文件类字段（成绩单/简历附件/照片）刷新后要复核**（实测「简历附件」上传后 `input.files.length` 归 0，值在服务端）。
