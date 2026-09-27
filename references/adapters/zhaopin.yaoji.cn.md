# zhaopin.yaoji.cn（姚记科技招聘官网）适配笔记

> 本文件会随 skill 仓库发布：真实取值一律用占位符，见 `_TEMPLATE.md` 顶部说明。
> 写完跑 `python scripts/95_lint_notes.py --paths references/adapters/zhaopin.yaoji.cn.md`。

实测日期：2026-09-24 ｜ 岗位：<岗位名>（job/<岗位 id>，如「Agent工程师-26、27届秋招」）
表单：`https://zhaopin.yaoji.cn/job/<岗位 id>` → 点「投递简历」→ **单页 Radix Dialog**（非分步向导，无重复块；工作经历可「添加（最多3段）」）

## 技术栈（决定了整站打法）
- **飞书妙搭 / aPaaS 生成的 React18 SPA + Tailwind + shadcn/ui（Radix 原语）**；`<div id="root">`，脚本里能看到 `apaas_miaoda` 埋点。
- **无全站组件 store**，但 **React fiber 可达**：`button[role=combobox]` 往上 **14 层**就是 Radix `Select.Root`，`memoizedProps` 里同时有 `value` / `onValueChange`，子树里每个 `SelectItem` 的 `memoizedProps.value` 就是真实选项值 → **可以零开面板直写**。
- 普通文本/数字/邮箱/textarea 是**原生受控 input**：`HTMLInputElement.prototype` 的 value setter + `input`/`change` 即可写进 React state（写后用 `fiber.memoizedProps.value` 回读，别只看 `el.value`）。
- 必填判定：**扫描器全部报 required=False**，因为星号是 label 里的独立 `<span>*</span>`（label 文本形如「姓名 *」，归一化时把星号丢了）。→ 必须人工按 label 里的 `*` 认定必填。
- 附件：`<input type=file>` 默认 `class="hidden"`，由外层 div 触发点击。

## 字段 → 填法（本站实测）

区块：简历上传 / 作品集（选填） / 内推码 / 个人信息 / 联系方式 / 教育背景 / 工作经历 / 同意条款

| 字段 | 必填 | 控件 | 填法 |
|---|---|---|---|
| 简历上传 | ✅ | `input[type=file]`（accept `.pdf,.doc,.docx`） | 摘掉 `hidden` + 加 `aria-label` → `cdp.mjs upload`（`DOM.setFileInputFiles`）→ **再手动派发 `change`** |
| 作品集（选填） | — | 同上（`.pdf,.png,.jpg,.zip,.rar`） | 无依据就留空 |
| 内推码 | ✅ | **Radix RadioGroup**（`button[role=radio]`，`id=referral-yes/referral-no`，值 `yes/no`） | 上溯 fiber 找 `onValueChange` 直写 `'no'`；回读看 `data-state=checked` |
| 姓名 | ✅ | `input[type=text]`（ph「请输入姓名」） | 原生 setter |
| 年龄 | ✅ | `input[type=number]` | 画像只有 `<YYYY-MM-DD>` 生日 → 当场按投递日期算周岁，并在交付清单说明推导来源 |
| 性别 | ✅ | **Radix Select**（`button[role=combobox]`） | 组件 API 直写（选项值就是中文原文，如 `男`） |
| 当前所在城市 | ✅ | `input[type=text]` | **自由文本，不锁省/市选项**；画像 `location` 只有省级 → 逐岗问用户 |
| 是否接受线下面试 | ✅ | **原生** `input[type=radio][name=acceptOfflineInterview]`（是/否） | 原生 `checked` setter + `click()`；回读 `checked` |
| 手机号码 / 电子邮箱 | ✅ | `input[type=text]` / `input[type=email]` | 原生 setter；页面提示「请尽量填写 gmail 以外的邮箱」 |
| 学历 | ✅ | **Radix Select** | 选项 `高中/专科/本科/硕士/博士`，画像是「硕士研究生」→ **包含匹配，只进建议**；用户确认后 `add-option` 记对照 |
| 毕业院校 / 专业 | ✅ | `input[type=text]` | 原生 setter（**自由文本，无院校联想框**） |
| 毕业年份 | ✅ | `input[type=number]`（ph「如 2022」） | 只到**年**，画像 `2027-06` 截断即可 |
| 公司名称 | — | `input[type=text]` | 原生 setter；⚠️ 上传简历会被解析覆盖，见踩坑 3 |
| 入职时间 / 离职时间 | — | **两个普通 text input**（ph「如 2022-01」「如 2024-06，在职填“至今”」） | **没有日历**！直接写 `<YYYY-MM>` / `至今` |
| 工作内容描述 | — | `textarea` | 原生 setter |
| 我已阅读并同意《个人信息处理规则》 | ⛔ | `button[role=checkbox]` | **agent 不代勾**（法务同意），交用户本人 |
| 提交投递 | ⛔ | `button` | **agent 不点** |

## 组件配方（按类型，可复制到下次）

```js
// Radix Select / RadioGroup 零面板直写：从 trigger 上溯找 Root，再问它要真实选项值
function fk(el){ return Object.keys(el).find(k=>k.startsWith('__reactFiber$')); }
function up(el,pred,max){ let f=el[fk(el)],n=0; while(f&&n<(max||80)){ if(pred(f.memoizedProps)) return {f,n}; f=f.return; n++; } return null; }
const trig = [...document.querySelectorAll('[role=dialog] button[role=combobox]')][IDX];
const root = up(trig, p => p && typeof p.onValueChange==='function' && ('value' in p));   // 实测 depth=14
// 枚举选项：遍历 Root 子树，取 memoizedProps.value 为 string 且带 onSelect/textValue 的节点
root.f.memoizedProps.onValueChange('硕士');            // 直写，不碰面板 → 不会留下常驻 listbox
// 回读：trig.textContent（显示层）+ root.f.memoizedProps.value（状态层）
```

```js
// 内推码是 Radix RadioGroup（button[role=radio]，不是 input）：同样 onValueChange('no')
// 是否接受线下面试才是原生 radio：
const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'checked').set;
set.call(radioNo, true); radioNo.dispatchEvent(new Event('click',{bubbles:true})); radioNo.click();
```

```js
// 附件（React 页面的隐藏 file input）：先显形，再 setFileInputFiles，最后手动补 change
inp.classList.remove('hidden'); inp.style.cssText='opacity:1;display:block';
inp.setAttribute('aria-label','JAA简历上传');            // 便于 snapshot 定位
// → node scripts/cdp.mjs upload <target> <expr-file> "<本机简历绝对路径>.pdf"
inp.dispatchEvent(new Event('change',{bubbles:true,composed:true}));   // 关键：setFileInputFiles 不派发 change
```

## 校验 / 提交边界
- 无 `validate()` 可只读调用；提交按钮**始终可点**（不满足条件时点击才报错）→ 所以「填完没填完」只能靠回读，不能靠 disabled 判断。
- 回读用 `fiber.memoizedProps.value` / `data-state` / `checked`，**别信瞬时 a11y 文本**（Radix 的 listbox 常驻节点会污染快照，见踩坑 1）。
- **agent 不点「提交投递」、不代勾同意条款**；表单值只活在弹窗内存里，**刷新即丢（实测）**→ 用户必须在同一标签页核对后自己提交。

## 踩坑记录
1. **MCP `act click` 打不开 Radix Select**：Radix 的 trigger 监听 `pointerdown`，只补发 mouse 事件序列的点击不生效（`aria-expanded` 始终 false）。
   → 中途可以用合成 `PointerEvent('pointerdown')` 打开面板**读选项**；但**选中请改用组件 API 直写**。
2. **用真实鼠标点击选项 → 留下 `data-state=closed` 的常驻 listbox**：Radix Presence 的退场动画不结束，节点不卸载，
   于是 `#root` 被 `aria-hidden=true` 永久罩住 → MCP `snapshot` 只剩那个 listbox，后续任何下拉都点不开。
   派发 `animationend`/`Escape` 都救不回来。**唯一干净的解法：不开面板，走 `onValueChange` 直写。**
3. **上传简历会触发站点 AI 解析并覆盖字段**：本站会把「公司名称 / 入职时间 / 工作内容描述」按 PDF 原文重写
   （实测公司名空格被吞、`2026-09` 变成 `2026-09-01`、描述被写成简历工作经历段全文）。
   → **先上传、再校正文本字段**；解析出来的描述若比手写更完整，可沿用并在交付清单注明「来源=站点解析简历原文」。
4. **`30_verify.py` 误报「页面报错：请填写」**：它把区块静态提示（「请填写过往工作经历，至少填写一段（非必填可留空）」）
   当成字段级 error。→ 以 `document.querySelectorAll('[role=alert]').length === 0` 为准。
5. **扫描器把普通 `input` 认成 `custom-select`、`required` 全 False**：无框架 class 可依据（Tailwind 类名无语义）。
   填充不受影响，但**编译 mapping 时不能信**：实测 `40_build_mapping.py` 把「毕业院校」编成了画像第 2 条（本科段）、
   「学历」编成「硕士研究生」（页面没这个选项）、「当前所在城市」编成「<省>」——**全部需要人工/用户当次确认**。
6. 职位详情页的「投递简历」用 `cdp.mjs revalclick`（真实鼠标点）可能**不弹窗**（坐标在滚动动画未停时算的），
   `el.click()` 合成点击反而稳定。⚠️ 注意：这个「投递」只是**打开申请弹窗**，不是提交动作。

## 复用顺序（下次同站投递，~5 分钟）
1. MCP `tabs new <岗位 url>` → 等「投递简历」出现 → `evaluate` 里 `el.click()` 开弹窗。
2. `cdp.mjs eval` 上传 `<简历文件名>.pdf`（显形 → upload → 补 `change`）→ 等「正在解析简历...」消失。
3. 跑一次文本字段填充（**放在解析之后**），公司名/日期/描述按简历口径校正。
4. Radix 组件 API 直写：性别 / 学历 / 内推码；原生 radio setter：是否接受线下面试。
5. 回读 `fiber.memoizedProps.value` + `data-state` + `checked`，确认 `[role=alert]` 为 0。
6. 交用户：勾选同意条款、核对、自己点「提交投递」。
