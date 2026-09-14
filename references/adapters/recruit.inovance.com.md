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
| react-aria 级联 popover | 籍贯（省/市/县）、教育块城市（省/市/区，**必须选到区**） | 逐级点文本 span；叶子点击后自动关面板。省文本在 `span.text-[11px]`（a11y 树里不可见，用 CDP 搜 textContent 取坐标） |
| react-aria 可搜索树 | 专业类别（类目树：根节点→学科类） | 面板内搜索框 act fill（**会追加，需 clear:true**）→ 搜「电子信息」「计算机」等类目名（搜专业名如「人工智能」无结果）→ 点叶子行 |
| 日期分片（毕业/教育起止） | `date-input-group__segment` contenteditable spinbutton | 合成 KeyboardEvent 无效；**合成 beforeinput(insertText) 有效**；最稳：CDP `el.focus()` + MCP act type 真实键入 8 位 `20240901`（逐段自动流转）。整宽透明覆盖层 `div.absolute` 盖在组上——MCP act 点击会被遮挡检测拦截 |
| 项目块起止时间 | 隐藏/可见 **原生 `input[type=date]`** | native setter + change 直写，分片显示自动联动（与分片不同，这个能直写） |
| radio（附加信息 5 问 + 个人声明） | react-aria 原生 input[type=radio]，值 Y/N/true | **必须真实点击**（revalclick/clickn）。合成 r.click() 会 checked=true 有欺骗性但不进 React store，重渲染即丢 |
| 文件上传 | `input[type=file]` hidden | `DOM.setFileInputFiles` 不触发 change 且 React 立即重置 → 必须走 `Page.setInterceptFileChooserDialog` 拦截 + 真实点击「点击上传」+ `DOM.setFileInputFiles({backendNodeId})` |

## 踩坑记录
1. **重复块添加**：合成 click 对「+ 添加一项」有效，但「找按钮向上爬容器」在区块共享祖先时会误点其他区块的添加按钮（本次误加 2 个教育块）。找按钮限定在 `h2.closest(...)` 的兄弟容器内。
2. **uid 生命周期**：重渲染后 data-jaa-uid 丢失/漂移；结构变化（加删块）后必须重扫。同 uid 双元素会让 querySelector 静默错位。
3. **弹层关闭**：Esc 派发无效；「取消」按钮常被 `header.fixed` 遮挡（MCP 遮挡检测会拦截）→ 点面板外空白坐标（如 click_at 250,650）。
4. **MCP act 遮挡检测**：页面长、sticky 底栏（放弃投递/暂存进度/确认并投递）会盖住内容——先 `scrollIntoView({block:'center'})` 再 act。
5. **验证要以 CDP 读 store/DOM 为准**，a11y 树/diff 的触发器文本有延迟（选中后仍显示「请选择…」）。
6. 面板选中后面板内会出现「清空」按钮 = 已选中的可靠信号。
7. 期望月薪区间含「面议」；最近毕业院校类型选项：985/211/港澳台/国内其他/QS100/国外其他。

## MCP vs CDP 实测结论（2026-09-14，本站长表单场景）
- **MCP 会话重建是常态**：一次会话内重建 3 次（空闲/evaluate 失败均可触发），页面归属即丢，只能 tabs new（表单状态全丢）。cdp.mjs 无归属概念，跨会话稳定。
- **MCP 单步 act 质量好**：真实输入、自动遮挡检测（避免误点 sticky 底栏）、自带 diff 回读；`act type` 对 react-aria contenteditable 分片是唯一可靠键入通道。
- **CDP 批量无敌**：45 字段批写、30 个 date input、14 次加块均一次 eval 完成（<15s，无 60s 限制）；输出直落盘（MCP evaluate 有 5000 字符截断）。
- **`browseros-neo_run` 在本环境不可用**（structured output/setTimeout/emit 全挂），别试。
- **推荐混合流程**：CDP 管扫描/批量读写/落盘；MCP act 管单步交互（点按钮/开面板/键入分片/上传）+ 遮挡保护。跨会话韧性：MCP 死了 CDP 无缝接管同一页面。

## 本站特有问卷（qa 已沉淀）
- 了解渠道 23 选项（用户选「招聘官网」）；附加信息 5 个是/否（按先例全否）；个人声明单 radio 同意。
- 意向工作地点选项：不限/深圳/苏州/西安/上海/嘉善/天津/佛山/顺德/南京/东莞/南昌/岳阳/太原/常州/大连/长春/贵阳（最多 3）。
