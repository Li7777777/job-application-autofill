# recruit.inovance.com（汇川技术招聘官网）适配笔记

实测日期：2026-09-14 ｜ 岗位：【27校招 - 数字化】全栈工程师（苏州）
表单：`/#/jobs/<jobId>/apply`，9 区块分步向导，有「展开全部区块」按钮可一次全显。

## 技术栈
- React 18 + react-aria + Tailwind。**无 mokahr 式组件 API**（fiber 里无 fieldInfo/_set_）→ 快路径不可用，走通用 DOM 方案。
- 数据标记：react-aria 用 `data-slot`（popover-trigger / popover-dialog / radio / list-box-item…）+ `aria-controls` 关联弹层；表单字段自研 class：`select__trigger`、`popover__trigger`、`date-input-group__segment`、`list-box-item`。

## 组件配方（按字段类型）

| 类型 | 字段 | 填法 |
|---|---|---|
| 原生 `<select>`（可见，背后原生元素） | 性别/手机号类型/证件类型/政治面貌/民族/院校类型/语言/学历/学习形式/期望月薪/了解渠道（13 个） | native setter + input/change 事件，一次批量直写 |
| 文本/textarea | 姓名/手机/邮箱/证件号/兴趣爱好/项目名称/职务/项目描述 | 同上 |
| react-aria 多选 popover | 意向工作地点（最多 3 个） | 真实点击开面板 → 点 option → 点面板外空白关闭（值选中即同步，取消/Esc 不回滚） |
| react-aria 级联 popover | 籍贯（省/市/县）、教育块城市（省/市/区，**必须选到区**） | MCP `snapshot/act` 逐级点文本 span；叶子点击后自动关面板。省文本若不在 a11y 树，先用短 `evaluate` 精确定位；仍不可操作才用 CDP 取坐标。 |
| react-aria 可搜索树 | 专业类别（类目树：根节点→学科类） | 面板内搜索框 act fill（**会追加，需 clear:true**）→ 搜「电子信息」「计算机」等类目名（搜专业名如「人工智能」无结果）→ 点叶子行 |
| 日期分片（毕业/教育起止） | `date-input-group__segment` contenteditable spinbutton | 首选 MCP `focus/type` 真实键入 8 位 `20240901`（逐段自动流转）；透明覆盖层导致 covered 时先滚动/聚焦重试，仍失败才用 CDP `focus` 后回 MCP `type`。 |
| 项目块起止时间 | 隐藏/可见 **原生 `input[type=date]`** | native setter + change 直写，分片显示自动联动（与分片不同，这个能直写） |
| radio（附加信息 5 问 + 个人声明） | react-aria 原生 input[type=radio]，值 Y/N/true | 首选 MCP `act click` 并在重渲染后回读；连续失败才用 CDP `revalclick/clickn`。合成 `r.click()` 的 checked 可能是假成功。 |
| 文件上传 | `input[type=file]` hidden | 先显形真实 file input 并用 MCP `upload`；若 change 仍被 React 重置，才用 CDP `uploadc` 文件选择器拦截。 |

## 踩坑记录
1. **重复块添加**：合成 click 对「+ 添加一项」有效，但「找按钮向上爬容器」在区块共享祖先时会误点其他区块的添加按钮（本次误加 2 个教育块）。找按钮限定在 `h2.closest(...)` 的兄弟容器内。
2. **uid 生命周期**：重渲染后 data-jaa-uid 丢失/漂移；结构变化（加删块）后必须重扫。同 uid 双元素会让 querySelector 静默错位。
3. **弹层关闭**：Esc 派发无效；「取消」按钮常被 `header.fixed` 遮挡（MCP 遮挡检测会拦截）→ 点面板外空白坐标（如 click_at 250,650）。
4. **MCP act 遮挡检测**：页面长、sticky 底栏（放弃投递/暂存进度/确认并投递）会盖住内容——先 `scrollIntoView({block:'center'})` 再 act。
5. **验证先用 MCP 短 `evaluate` 读 store/DOM**，不要只信 a11y 树/diff 的瞬时触发器文本；ownership 丢失时才用 CDP 回读。
6. 面板选中后面板内会出现「清空」按钮 = 已选中的可靠信号。
7. 期望月薪区间含「面议」；最近毕业院校类型选项：985/211/港澳台/国内其他/QS100/国外其他。

## MCP-first 执行结论
- 扫描、普通字段、状态导出优先走 browseros-neo MCP 的短 `evaluate`；单次 timeout≤25s、业务预算 18s，
  返回 `deferred` 就在同一 page 续跑。
- 下拉、级联、搜索树、分片输入优先用 MCP `snapshot/act/diff`，保留遮挡保护与真实输入语义。
- `browseros-neo_run` 若当前环境不可用，退回 granular MCP 原语，不因此把 CDP 变成主流程。
- CDP 只负责 ownership 丢失、MCP 连续交互失败或受控上传失败后的同页接管；禁止 `cdp.mjs open` 重开表单。

## 本站特有问卷（qa 已沉淀）
- 了解渠道 23 选项（用户选「招聘官网」）；附加信息 5 个是/否（按先例全否）；个人声明单 radio 同意。
- 意向工作地点选项（站点公开列表，逐个精确文本匹配，最多 3）：不限/深圳/苏州/西安/上海/嘉善/天津/佛山/顺德/南京/东莞/南昌/岳阳/太原/常州/大连/长春/贵阳。 <!-- jaa-leak-allow: 站点自己的城市选项表 -->

## 🌟 同站二次投递：用「在线草稿」一键复用（2026-09-15 实测）

第二次投递时**不要手动重填**：
1. 表单顶部草稿区显示 `agent | 更新: <日期> | 使用`——「使用」是一个 **span 徽章**（`text-[10px] font-bold text-blue-600`），不是 button，`revalclick` 点它即可。
2. 点击后站点自动恢复上次投递的**全部内容**：个人信息（含用户手填的期望年薪）、教育 2 块、项目 15 块、5+1 个 radio 勾选、附件——全部就位（React store 层，重渲染不丢）。
3. 之后只需：跑必填完整性检查（`_required_chk` 式：label 带 `*` → 控件空值）→ 确认 0 缺失 → 交用户/投递。
4. 上次投递即生成草稿（首次投递时表单显示「暂无在线简历草稿」——首次仍需完整填写）。

**注意**：点草稿区顶部的「使用已有的在线草稿简历」标题按钮无反应；必须点条目里的「使用」徽章。
