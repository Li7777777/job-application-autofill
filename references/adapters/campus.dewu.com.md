# campus.dewu.com（得物 App 校园招聘）适配笔记

> 本文件随 skill 仓库发布，全部使用占位符；真实取值只在 `data/` 里。
> 写完执行：`python scripts/95_lint_notes.py --paths references/adapters/<host>.md`

实测日期：<YYYY-MM-DD> ｜ 岗位：<岗位名>（岗位 id <编号>）
表单：`/<岗位 id>/resume/edit`（**单页**，无分步向导；有重复块：教育 / 实习 / 项目 / 获奖；
**右下角只有一个「完成」按钮，没有暂存、也不自动保存**）

## 技术栈（决定了整站打法）
- 飞书 ATS（atsx-throne / `hire-fe-prod`）+ **formily** 表单，组件类名前缀 `ud__`
  （`ud__input` / `ud__select` / `ud__picker` / `ud__tree__node` / `ud-formily-item`）；
  扫描器识别为 `framework = feishu`，**通用八步可用**，但本页 React fiber 完全可达，走组件 API 更稳。
- 字段容器：`.ud-formily-item`，上面带 `data-form-field-id`（自定义字段是一串数字 id，
  语义字段是 `name` / `email` / `gender` / `preferred_city_list` / `school` 等）。
- **整表权威状态**在 `form` 元素的 fiber 上：`memoizedProps.form.values / .errors`（formily 实例）。
  `values.basic_info` 是对象、`education_list / project_list / award_list` 是数组 →
  一次读取就能对账，比读 DOM 可靠得多。

## 字段 → 填法（本站实测）

| 字段 | 控件 | 填法 |
|---|---|---|
| 姓名 / 邮箱 / 专业 / 公司名称 … | `input.ud__native-input` | 原生 setter + `input` + `change` |
| 语言水平 / 得物经历问答 / 描述 | `textarea` | 同上（用 textarea 的 setter） |
| 性别 / 是否接受调换工作地点 / 是否已上传作品集 / 获知渠道 | `ud__select`（只读搜索框） | fiber 往上找带 `onChange`+`options` 的 props，`onChange(opt.value, opt)`；值形如 `"1"/"2"/"3"`，回读 `.ud__select` 文本 |
| 期望工作地点 | `ud__select` + TreeSelect（`citySelectWrapper__*`，约 1 万项，multiple+treeCheckable） | 值 = 城市码字符串数组（省 `ST_*` / 市 `CT_*` / 区 `DS_*`）；面板里先在搜索框写城市名过滤，再点 `.ud__tree__node__label` 所在行的 checkbox；或直接 `onChange(['CT_<市码>'])` |
| 起止时间（教育/实习/项目） | `throne-biz-date-range-picker`（两个可写 input） | **可以键入**：原生 setter 写 `YYYY-MM` + `keydown Enter` + `change` + `blur` 就会进 store（起=`"2026-03"`，止=真实月或 `"-"`，「至今」直接往第二个 input 键入 `至今` 即可）；与下面的获奖年控件行为不同 |
| 获奖时间 | `ud__picker`，`placeholder = YYYY`（**只到年**） | **键入不提交**：必须从 input 的 fiber 往上找 `picker==='year' \|\| mode==='year'` 的 props，`onChange(new Date(y,0,1), 'YYYY')` |
| 简历附件 | 隐藏 `input[type=file]` | 显形 + `aria-label` → MCP `upload`；成功后出现「将简历内容解析到下方表单？ 解析并覆盖」 |
| 重复块「添加」 | `button` 文本 `添加` | 合成 `click()` 有效（区块内定位，见踩坑 4） |

## 组件配方（可复制）

```js
// 单选下拉：组件 onChange 直写（只在「选项原文相等」时点，否则只出建议）
const fkey = el => { for (const k of Object.keys(el)) if (/^__reactFiber\$|^__reactInternalInstance\$/.test(k)) return k };
const propsOf = (root, need) => { let n = root[fkey(root)];
  for (let d = 0; n && d < 12; d++, n = n.return) { const p = n.memoizedProps; if (p && typeof p.onChange === 'function' && need(p)) return p } return null };
const fi = [...document.querySelectorAll('.ud-formily-item')].find(x => /性别/.test(x.querySelector('.ud-formily-item-label')?.innerText || ''));
const p = propsOf(fi.querySelector('.ud__select'), q => Array.isArray(q.options) && q.options.length);
const opt = p.options.find(o => String(o.label).trim() === '<男/女/…>');   // 原文相等，不做包含匹配
p.onChange(opt.value, opt);
```

```js
// 起止时间（月粒度区间）：键入 + Enter 就能提交，可以整批循环
const iS = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
const type = (inp, v) => { inp.focus(); iS.call(inp, v); inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true })); inp.blur(); };
type(startInput, '<YYYY-MM>');  await new Promise(r => setTimeout(r, 220));
type(endInput, '至今');           // 或 '<YYYY-MM>'
```

```js
// 年份粒度日期控件（placeholder=YYYY）：键入不进 store，走组件 onChange(Date)
let n = input[fkey(input)], dp = null;
for (let d = 0; n && d < 14; d++, n = n.return) { const q = n.memoizedProps;
  if (q && typeof q.onChange === 'function' && (q.picker === 'year' || q.mode === 'year')) { dp = q; break } }
dp.onChange(new Date(<YYYY>, 0, 1), '<YYYY>');
```

```js
// 整表对账：formily values / errors
let n = document.querySelector('form')[fkey(document.querySelector('form'))], form = null, d = 0;
while (n && d++ < 80) { const p = n.memoizedProps; if (p && p.form && p.form.values) { form = p.form; break } n = n.return }
JSON.stringify({errors: (form.errors || []).map(e => e.path + ':' + e.feedbackText), values: form.values});
```

```js
// 重复区块取「叶子字段项」——容器与字段同名（都读到一个 label）会互相覆盖
const leaf = [...box.querySelectorAll('.ud-formily-item')]
  .filter(fi => !fi.querySelector('.ud-formily-item .ud-formily-item'));
```

## 校验 / 提交边界
- 必填判定：**星号只在 label 文本里**（`姓名*`），`input.required` 全为 false；扫描器给的
  `requiredConfidence` 多为 medium，按人工核对处理。页面里带 `*` 的必填：
  简历附件 / 姓名 / 手机号码 / 邮箱 / 性别 / 家庭现居住地 / 期望工作地点 / 是否接受调换工作地点 /
  证件号码 / 预计毕业月份 / 获知渠道（教育区块：学校 / 学历 / 二级学院 / 专业 / 起止时间）。
- `手机号码` 由账号预填（只读展示 `<+86> <手机号>`），`form.values.basic_info.mobile` 里已有值。
- **agent 一律不点「完成」**（它是保存/提交类按钮，被 `SUBMIT_RE` 拦下）；交用户自己点。
  ⚠️ 首次保存之后，底部按钮文案会变成 **「取消 / 保存」**（不再是「完成」）；按铁律要交用户点，
  只有用户明确授权代点时才点「保存」，并在交付说明里写清楚点了什么、什么时候（`/resume/view` 的
  「最近更新」时间戳就是保存成功的证据）。
- `form.errors === []` 且必填都有值 = 通过。

## 踩坑记录
1. **对「解析并覆盖」用合成 `dispatchEvent(mousedown/mouseup/click)` → 永久卡在「解析中……」**，
   控制台抛 `Uncaught (in promise)`，表单一个字段都不写。根因：该按钮走 React 真实事件链 + 轮询。
   → 用 `parsing-cancel` 取消，**改用 MCP `act click_at` 真实点击**；这次约 5 秒出
   「解析成功」并写入 25 个字段（姓名/邮箱/两段教育/实习/两个项目全文）。
2. 标签页被会话重建关掉 → **得物没有自动保存，全部填写丢失**（只有附件在服务端留下
   「上次上传」记录）。→ 填完尽快交用户点「完成」；不要在中途长时间空置。
3. **后台标签页定时器被冻结**：上传后解析/面板渲染会挂住。→ `node scripts/cdp.mjs wake <targetId>`
   把同一页置前（front + active + focus）后继续，不重开页面。
4. **`.ud-formily-item` 容器与字段 label 重复**：直接 `querySelectorAll` 会把区块容器也算进去，
   导致第 N 条记录写进第 1 条（实测第一条获奖被覆盖、少一条）。
   → 用「叶子项」过滤（见配方），并逐条回读 `values` 而不是只看 DOM。
5. `获奖时间` 用原生 setter 写进 input 后 **DOM 有值但 formily store 没有**（提交必被判定为空），
   必须走日期组件 `onChange`（配方 2）。
6. 自定义下拉的弹层在改动 `section.atsx-layout.scrollTop` 之后会跑到**负坐标**（`left/top` 为负、
   屏幕外），此时 `act click_at` 点不到 → 打开面板后**不要再滚容器**；或改走组件 `onChange`。
7. `绩点` 是 `ud__input-number`，**存不下分制**（画像 `<GPA>/5` 只能写成数字 `<GPA>`），
   且会把 `3.96/5` 截成 `3.96`；交审时要说明这一处信息损失。
8. **重复块一次 evaluate 里循环点「添加」+ 循环写值容易超时**（单次 cdp/evaluate 约 30s）：
   先单独一轮把行数加够（添加 13 次约 5s），再**按 5~6 行一批**写日期；每批开头先比对现有值再写，
   重跑就是幂等的，不会因为超时留下半成品。
9. 简历解析会把「项目名称」和「技术栈 / 仓库路径」拼在一起（`<项目名> <repo> - <技术栈>`），
   第二个项目的技术栈被塞进「项目角色」。→ 属解析结果，**必须让用户核对**，代理不擅自改写。

## 复用流程（下次同站投递，约 5–8 分钟）
1. MCP `tabs new /<岗位 id>/resume/edit` → `wait(for="selector", value=".ud-formily-item")`。
2. 显形隐藏 file input + `aria-label` → `snapshot` → `upload` 简历 → `wait(for="text", value="解析并覆盖")`。
3. **MCP `act click_at` 真实点「解析并覆盖」**（别用合成事件）→ 等「解析成功」。
4. 一轮 evaluate：补齐文本/多行字段 + 单选下拉 `onChange` + 城市 `onChange(['CT_<市码>'])` + 项目链接。
5. 重复块（项目 / 获奖）：**先单独一轮把行数点够**（`添加` 可循环，每行 ~400ms），再按 5~6 行
   一批写值；一律用**叶子项**定位；项目起止时间用键入+Enter（配方），获奖年份走组件 `onChange(Date)`。
6. `10_scan_form.js` / `15_dump_state.js` 导出 + 读 formily `values/errors` 对账（`errors` 必须为空）。
7. 交用户核对 → **由用户点「完成」/「保存」**（agent 不点，除非用户明确授权）。

> 已保存过的简历再进 `/resume/edit` 会把**服务端数据载回来**（附件区显示「上次上传」），
> 所以在同一页追加内容不会重复建简历；但未保存前标签页被关掉 = 全部丢失。

## 本站选项对照（公开选项，代理照抄即可）
- 性别：`<男/女/保密>`（值 1/2/3） <!-- jaa-leak-allow -->
- 是否接受调换工作地点：`是` / `否`（值 1/2） <!-- jaa-leak-allow -->
- 是否已上传作品集：`是` / `否` / `岗位非设计岗，无需作品集`（值 1/2/3） <!-- jaa-leak-allow -->
- 通过何种方式获知得物校招信息：`得物校招官方推送信息` / `牛客网` / `小红书` / `老师/同学推荐` /
  `实习僧` / `Boss直聘` / `学校就业信息网` / `在得物的亲属/朋友/学长学姐推荐` /
  `得物校招-校园大使` / `其他`（值 1–10） <!-- jaa-leak-allow -->
- 学历：`本科`=6 / `硕士`=7（值随选项表） <!-- jaa-leak-allow -->
- 城市树码样例：`中国大陆`=CN_1、`<省>`=ST_*、`<市>`=CT_*、`<县/区>`=DS_*（**逐岗城市不同，
  不要把某个市码写进画像**） <!-- jaa-leak-allow -->
