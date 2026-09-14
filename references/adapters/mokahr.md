# Adapter: mokahr（app.mokahr.com 系网申，多家公司共用）

> 实测：2026-09 某公司校招申请页（mokahr ATS）。通用扫描器在这个站点上已经能自动识别
> 42 个控件 / 15 个必填，字段名基本正确；本文件只记「通用规则覆盖不到」的部分。

## 1. 结构与组件

| 层 | 特征 |
|----|------|
| 区块 | `[class*="apply-block-"]`，标题在 `[class*="blockTitle-"]`；教育背景/实习经历是可多条区块（带「添加」按钮）。
扫描器已内置这套选择器（`platform-selectors.json` 的 `mokahr` 布局预设），能给出 `section` 与 `block` |
| 字段块 | `[class*="apply-field-"]`，字段名在 `[class*="title-"]` 内层 span → 通用扫描器的 `field-title` 正好命中 |
| 必填 | `[class*="required-asterisk"]`（空 span，无文字）→ 通用必填判定靠 `[class*=required]` / `[class*=asterisk]` 命中，置信度 medium |
| 下拉 | `sd-Select-container` + `sd-Dropdown-dropdown` 面板 + `sd-Select-common-item` 选项；值显示在 `sd-Input-display-value-*` |
| 日期 | `date_info`（年/月 两组，`month-range-select`）；`day_info`（只读 input + `sd-picker-addon`，点开是「年 + 月」面板，日期预设 `mokahr`） |
| 文件 | `input[type=file]`（name=resumeKey）默认隐藏，需显形后再 upload |
| 校验提示 | 必填项失焦后出现文字「必填项未填写」→ 可当自检信号（`15_dump_state.js` 会抓进 `error`） |

## 2. 通用规则覆盖不到的坑

1. **「出生日期 (年龄)」是「年月」粒度**：选完月份即结束，选不到「日」，显示成 `1999-09 (27岁)`。
   → 画像里照常只填最细的 `personal.birth_date: 1999-09-15`；填充器会按组件粒度自适应截断成 `1999-09`
   并在回报里注明「组件只到 month，day 精度未填入」。**不要**为此另填 `birth_ym`，也不需要 adapter。
2. **复数年月分片控件**（毕业时间、就读时间、起止时间）：一个字段由 2–5 个 select 组成
   ×（年、月、年、月…），通用扫描器会把它拆成多个 uid（这是对的）。
   → 编译期的「重复 canonical」会只留一个 uid 并把它写进 `*-todo.md` 提示区；
   在 mapping 里对它写 `{ v: "2027-06", mode: 'period' }`，`fillCompositeDate` 会向上找
   「控件数 2–8 的字段块」，按 DOM 顺序分成 `[年,月]` / `[年,月,日]` / `[年,月,年,月]` 逐段填，
   每段还会试 `2023 / 2023年`、`09 / 9 / 9月 / 09月` 这类写法（mokahr 的选项就是「9月」）。
   ⚠️ 首次用先看 `failed` 的逐段原因；分片识别不对就在本文件记下字段块的 CSS 选择器（必要时补进 `OVERRIDE`）。
3. **简历解析会锁字段**：上传简历后 mokahr 自动解析并回填，`毕业时间/最高学历` 等变成 `[disabled]`。
   → **先上传解析、再补空缺**，顺序不能反；被锁的字段写不进去要如实报错。
4. **教育背景会自动增条**：含 2 段学历的简历解析后会直接生成 2 条教育条目，不需要点「添加」。
   扫描器会给这两条打上 `block = 0 / 1`，`40_build_mapping.py` 据此把画像 `education[0]` / `education[1]`
   分别填到两段（不再靠「谁先出现谁就是 0」硬猜）。详见 `examples/example.scan.json`（脱敏样例里
   就带了两段教育背景）。
5. **草稿行为**：表单值会**异步落库**（实测：页面/浏览器关闭后再打开，大部分值还在），
   但**邮箱与简历附件会丢**，且刚填完立刻新开标签页可能是空的。
   → 每步落盘；重进页面后重跑扫描/映射/填充（幂等）补齐。
6. **账号级在线简历**：重新打开申请页时，教育背景区块已经从账号里的在线简历带出内容。
7. **必填误判（旧版问题，1.1.0 已修）**：旧版只看「祖先里有没有星号」，「申请信息」区块里必填的
   `意向工作城市` 会让同区块的 `推荐码` 也被判成必填。现在改成**标签行判定**（`labelRowOf`：
   先看框架 `level2_class` 命中的标签行、再看它所在字段行里的 `[class*=required|asterisk]`），
   两者分属不同的 `.apply-fields-*` 行 → 不再互相污染。
   → 若某个站仍出现 medium 误判，说明星号挂在了区块层而不是字段行 → 在本文件记下来，
   并用扫描器顶部的 `OVERRIDE.layout` 指定更窄的 `level2_class`。
8. **`monthConfig` 是字符串的预置**（antd 的 `antCalendarWithYearSelect`）表示「点它打开月份网格」；
   mokahr 的日期预置里 `decadeSelector` 与 `yearPanelSelector` 都是 `sd-basic-selector-year`，
   所以点「年」会同时起到「翻年代」和「打开年网格」两个作用 —— 已实测可用。

## 3. 该站点可命中的规范字段

（下面的对应关系来自通用字段规范 `assets/canonical-fields.spec.json`；用户在各站点的实际命中与配方记录在 `$JAA_DATA_DIR/memory/`）

`意向工作城市→job.intended_city`、`推荐码→job.referral_code`、`姓名/手机号码/邮箱/性别/出生日期→personal.*`、
`最高学历→personal.highest_degree`、`所在地→personal.location`、`招聘信息获取渠道→job.source_channel`、
`学校名称/专业名称/学历/就读时间→education.*`、`公司名称/职位名称/工作职责→experience.*`；
5 道「是否」题与「您使用微博的频率」属于**站点特有问答**，存在 `dictionary.json → qa`。

## 4. 参考样例（examples/）

- `example.scan.json`：脱敏后的扫描结果样例（清空了个人的已填值，替换了 URL/公司/文件名；
  含新的 `labelNorm / section / block / framework / options` 字段与两段教育背景）
- `example.mapping.json` / `example.todo.md`：编译产物与「必须问用户」清单样例

---

# 追加：宇通集团 IT 岗表单（2026-09-14 实测，214+ 控件 / 15 区块）

比新浪那份大得多（个人信息 20 项 + 教育背景×2 + 学生干部 + 学术成果 + 项目经验 + 实习 + 语言 + 专业技术资格 + 获奖×6 + 自我描述 + 家庭背景 + 申明）。
以下是**通用扫描器/填充器在这个站点上必须知道的补充**（对应的代码修复已经落进 `scripts/`，见 §5）。

## 1. 下拉（sd-Select）的四个坑（都已在 20_fill.js 修好，但换站点前要知道机制）

| 现象 | 真因 | 处理 |
|---|---|---|
| 「点开后读不到任何可见选项」（**最坑**） | `PANEL_ROOT_SEL` 里有 `[class*="Dropdown"]`，会匹配到触发元素**自己的外层容器** `sd-Dropdown-container`（距离 0）→ 程序以为"面板已经开着"，**根本不去点**，然后在空壳里找选项 | `nearestPanel`/`openPanel` 必须排除「是触发元素的祖先或后代」的候选，并要求候选里**真的含选项元素** |
| 合成 `pointerdown→mousedown→mouseup→click` 打不开 | mokahr 的 Select 用**单个 `click`** 才正常打开；四连发会让面板刚开就进 `sugar-popup-move-leave` 离场动画，而带 `-leave` 的面板会被可见性过滤掉 | mokahr 走 `trigger.click()`；`isRealVisible` 增加「宽松模式」接受 leave 面板 |
| 大列表（**本科专业 816 项 / 研究生专业 558 项**）必挂，小列表正常 | 面板渲染要 **>400ms**；若只等一次就判"没打开"，兜底会再点一下，**正好把刚开的面板关掉**，然后死等 | 打开后必须**轮询等待**（本例 9s 上限），不要只 sleep 一次 |
| 面板 rect 常在 `top=-4415` 这种离触发元素几千像素的位置 | 面板是 body 级 portal，滚动后定位与触发元素脱节 | **不要**用"距离上限"筛候选，只按距离排序后取最近十几个 |

## 2. 读取（回读）的坑：mokahr 是「一行多字段」布局

`身高/体重/家庭电话/期望月薪` 这些**裸 input** 的回读，不能先去外层找 `display-value` —— 会读到**同一行别的字段**的显示值
（实测：身高/体重/家庭电话的回读全变成了「男」，期望月薪变成「是」）。
→ `readDisplay` 已改为：**非自定义组件优先用 `el.value`**；`DISPLAY_STOP_SEL` 增加 `[class*="apply-field-"]` 等字段边界，
避免 `displayNodeIn` 一路走到同一行的兄弟字段。

## 3. 本表单特有的控件

| 字段 | 控件形态 | 打法 |
|---|---|---|
| 籍贯 / 现居住地 | **不是级联**：Tabs（省份 / 城市 / 县区）+ `sd-Tag-container > span.sd-Tag-text` 卡片列表（省份是 `辽宁`/`安徽` 这种**简称**，市是 `大连市`，县是 `平遥县`） | 依次点 tab → 点精确文本卡片；读完 `sd-Input-display-value` 回读（显示成 `山西 晋中市 平遥县` / `辽宁 大连市`） |
| 就读时间 / 起止时间 / 获奖时间 | 年月**分片**：每个分片是一个 sd-Select，选项是 `sd-Menu-content-item`（**注意不是** `sd-Select-common-item`，年份列表 1926–2126） | 直接按 uid 逐个填分片年/月最稳（`mode:'period'` 在这个站会因字段块控件数 >8 而找不到块） |
| 本科专业 / 研究生专业 | 800+ 项的大下拉（虚拟/超长列表） | `trigger.click()` + 轮询；选项叶子是 `div.option-label-*`，**点叶子**不要点 `sd-Select-common-item` 容器 |
| 学术成果 | 11 个**自由文本框**（学术类型/专利类型/专利名称/专利号/论文级别/作者类型/期刊名称/论文名称/项目级别/项目名称/角色），可「添加」多条 | 按条填：专利一条、论文一条；不相干的字段留空 |
| 获奖经历 / 学生干部经历 | 可「添加」的重复块（按钮在 blockTitle 行右侧） | 先点「添加」凑够条数（`[class*="apply-fields-"]` 就是一条），再逐条按 placeholder（`年`/`月`）与字段标题定位 |
| 出生日期 (年龄) | 仍是**年月**粒度（显示 `1999-09 (27岁)`） | 画像照常给 `birth_date`；组件只能到月，别拿 01 去凑日号（本条与新浪一致） |
| 我承诺… | 承诺勾选框，扫描器抓不到 | **留给用户勾**（铁律：不代替用户做承诺类操作） |
| 上传 | 4 个 `input[type=file]`：上传照片 / 上传简历(name=resumeKey) / 上传附件 / 最高学历成绩单 | `cdp.mjs upload` + 表达式取 `document.querySelectorAll('input[type=file]')[i]`；上传成功后 `input.files` 会被站点清空，**以字段块文本里的文件名 + 「继续上传 xxx 12KB」为准**，别以为失败 |
| 最高学历=硕士 | 会**动态多出**「研究生专业」这个必填字段 | 填完最高学历后**重新扫描**，不要用旧 scan 的 uid |

## 4. 顺序与幂等

1. **先上传简历触发解析**（预填 姓名/手机/邮箱/技能/最高学历/毕业时间/两段教育/3 条项目经验），再补空缺；顺序反了会覆盖。
2. 每轮**重新扫描**（本 skill 现在会在扫描开头清掉上一轮的 `data-jaa-*` 标记 —— 见 §5）。
3. 填完跑一遍 `15_dump_state.js` + `30_verify.py`；本表单标 `*` 的必填共 ~50 个（含两段教育各 11 项）。

## 5. 本次顺带修掉的 skill 通用 bug（换站点也受益）

1. `10_scan_form.js`：扫描前**清理旧的 `data-jaa-*` 标记**。否则 SPA 重渲染后同一个 `data-jaa-uid="f36"` 会同时挂在两个不同字段上
   （实测：f36 同时是「本科专业」和「毕业时间(禁用)」）→ 填充会**静默填错字段**。
2. `20_fill.js`：新增统一入口 `openPanel()`（排除祖先/后代候选 + 真的含选项 + mokahr 单 click + 轮询等待 + 失败重试）；
   `visiblePanels` 增加 leave 面板的宽松兜底；`readDisplay` 裸 input 优先 `el.value`。
3. `40_build_mapping.py`：① 站点记忆里的 `education.school#1` 不再被二次追加变成 `#1#1`；
   ② 同一个 canonical **不允许混用 block / 出现顺序两种编号**；③ 预扫一遍让"有 block"的数组记录先占号，
   否则个人信息区的「毕业时间」会先占掉 `education.end#0`，把真·硕士段挤到 `#1`。
4. `jaa_lib.py`：`match_qa` ① 空字段名不再匹配（旧版 `'' in 任意问题` 恒真，会把 qa 第一条答案写进所有无标签控件；
   实测在本表单上会把「微博使用频率」的答案写进 30+ 个无标签控件）；② 包含匹配要求长度比 ≥0.75，
   防「最高学历」命中「该学历是否您的最高学历？」。
5. `20_fill.js`：`probeOptions` 模式允许 `MAPPING` 为空（旧版直接早退，探测根本跑不了）；探测按
   「区块+字段名+重复块」去重，同一个下拉不再重复开合（mokahr 的 sd-Select 会登记 input/箭头/图标三条）。
6. `cdp.mjs`：新增 `front <id>`（`Page.bringToFront`）—— **后台标签页里 rAF/定时器被节流，很多面板根本不会渲染**，
   长批量填表前先 front 一下。


---

# 追加（2026-09-14 九坤 UBITALENT 实测，已泛化为默认首选策略）：React16 组件 API 直写 —— 下拉/日期的根治方案

> **本节策略已升级为全站默认**：任何站点先跑 `scripts/25_mokahr_fiber.js` 的 `dump`（约 3 秒），
> `nFields ≥ 10` → 走快路径；`nFields = 0` / 异常 / fill 大面积「字段不在模型」→ 回退通用八步，
> 并在 `references/adapters/<host>.md` 记一句「无组件 API，走通用方案」，下次不再试。

> 此前 mokahr 站「下拉选不中/读不到选项」反复出现的根因：**站点是 React 16**，
> fiber 键是 `__reactInternalInstance$xxx`（不是 `__reactFiber$`），一切依赖
> `__reactFiber$` 的 fiber 方案在这个站上天然失灵；而开面板读 DOM 选项又受
> portal/动画/大列表轮询拖累。**正确姿势：根本不开面板。**
> 配套脚本：`scripts/25_mokahr_fiber.js`（dump / fill / store 三种模式）。

## 1. 字段组件 API（一次全量读 + 直写，零面板零坐标）

从任意 `[class*="apply-field-"]` 内的 input 沿 fiber `.return` 上爬（≤40 层），
能找到**字段组件**的 `memoizedProps`，上面挂着整套表单 API：

```
props.fieldInfo = { id, blockId, name, type, isRequired, options:[{label,value}] }
props._get_()   → 读当前值          （= store.getValue(fieldId, rowCtx)）
props._set_(v)  → 写值（推荐主路径）  （= store.setValue(fieldId, v, rowCtx)）
props._validate_()
```

- **读选项**：`fieldInfo.options`；若为空（bool_info、远程搜索下拉），从字段块内
  input 上爬 ≤14 层找 Select 组件（`Array.isArray(props.options) && props.onChange`）拿。
- **写值**：`_set_(option.value)`，与用户点选同一条链路（触发联动+校验）。
- **全表校验**：任一 block 组件（`props.blockInfo && props._get_values_`，从字段 fiber
  上爬 ~13 层）的 `_get_values_()` 返回**整个表单 store** —— 一次调用即可核对全部值。
  ⚠️ 从字段往上爬是 O(深度)；从根做全树 DFS 在 15 行项目的大表上会超时扫不到。

## 2. 各控件类型的取值形状（实测）

| fieldInfo.type | 控件 | _set_ 参数 | 备注 |
|---|---|---|---|
| `select` | sd-Select | `option.value`（字符串，如 '上海市'/'男'） | |
| `bool_info` | 是/否 | **数字 1/0**（options 里带） | 传 true 会显示空 |
| `string_info` / `text_info` | 输入框/多行 | 字符串 | 不用 React setter hack |
| `date_info`（起止年月） | 4 个分片 select | **起始端** `_set_("YYYY-MM")` 直接可用 | 结束端见下 |
| `date_info`（单端，如获奖时间） | 2 个分片 | `_set_("YYYY-MM")` | |
| `day_info`（出生日期） | 日历 | `_set_("1999-09-02")` | 组件自己截到月，显示 `1999-09 (27岁)` |
| `location_info`（籍贯） | Tabs+Tag | `"山西省/晋中市/平遥县"` | |
| `file_upload` | 上传 | 不可 set，走 DOM.setFileInputFiles | |
| `confirm_info`（同步更新在线简历） | 开关 | `_set_(false)` | 多岗投递务必关 |

## 3. date_info 的「结束端/至今」（唯一死角）

结束端**没有注册字段**（store 键 `endDate`，但 fieldInfo 里查不到），且日期组件
`w`（onStartChange/onEndChange 所在对象）是渲染闭包里的局部对象——fiber 实例、
hooks 链上都找不到，只有 4 个分片 Select 的 `onChange` 闭包能触达：

- **结束年份**：`sels[2].onChange("2026")` → store `endDate="2026-01"` ✓（月份默认 1）
- **结束月份**：`sels[3].onChange(任何值)` → **会把 endDate 清空** ✗（闭包读
  `w.endYearAndMonth` 的时序错乱，先月后年也不行）
- **可靠兜底**：年份走 `sels[2].onChange()`，月份**开面板真实点击**（12 项小列表，
  单 click 开面板 → 找可见叶子 `[class*="sd-Menu-content-item"]` 精确文本 → click）
- **「至今」**：块内 `input[type=checkbox]` 的 label `.click()`，store 存字符串 `"至今"`

## 4. 坑

1. ⚠️ **绝不要调 block 级的 `_set_`**：签名是 `setValue(blockId, k, v)`，实测把
   `projectInfo` 从 15 行数组写成了数字 5，且**异步落库**（草稿被污染、重载后全空，
   只能重传简历重填）。字段级 `_set_` 才是安全的。
2. 必填星号判定：`bool_info` 字段的 `data-jaa-required` 会误报 0；以
   `fieldInfo.isRequired`（组件 API 读到的）为准。
3. 「添加」重复块：区块根 `[class*="apply-block-"]` 里 `button` 文本 === '添加'
   连点 n 次；**add 后必须 `await sleep(~600)` 再重建模型**，否则新行不在模型里。
4. 写后校验用 store（`_get_values_()`）而不是 `_get_()`（后者原样回显写入值，
   组件炸了也看不出来）；DOM 的「必填项未填写」在程序写入后会残留，但都是隐藏的，
   以 store 为准。
5. 换岗位（同站第二份申请）：草稿独立，简历/照片/邮箱要重传重填；
   「同步更新在线简历」默认勾选，**两份申请都会被反向覆盖**，先 `_set_(false)`。

## 5. ⚠️ 大坑（实测）：同会话切换岗位申请页 = 草稿清零

- 同一 SPA 标签页里从岗位 A 的 `#/job/<A>/apply` 直接 hash 切到岗位 B 的
  `#/job/<B>/apply`（或反向），**两份草稿都会被重置**（只剩姓名/手机，
  简历附件也丢）——比「重开丢邮箱/照片」严重得多。
- 规则：**一个岗位一个标签页**。填完 A 就停在 A 页让用户提交；要填 B 就
  `cdp.mjs open` 开**新的标签页**操作，绝不 hash 互切。
- 若已踩坑：重传简历触发解析 → 重跑 fill（引擎幂等，2 分钟恢复）。
